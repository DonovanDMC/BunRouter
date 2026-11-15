import { describe, expect, it, mock } from "bun:test";

import * as Middleware from "../src/middleware.js";
import Router, { type Handler, type Middleware as RouterMiddleware } from "../src/Router.js";

type TestRequest<T extends string = string> = Bun.BunRequest<T>;

const server = {} as Bun.Server<unknown>;

function makeRequest<T extends string = string>(url = "http://localhost/test", init?: RequestInit, params: Record<string, string> = {}): TestRequest<T> {
    const req = new Request(url, init) as TestRequest<T>;
    Object.defineProperty(req, "params", {
        configurable: true,
        value: params,
        writable: true,
    });
    return req;
}

async function runMiddleware<T extends string = string>(
    middleware: RouterMiddleware<T>,
    req: TestRequest<T> = makeRequest<T>(),
    next: Handler<T> = async () => new Response("ok"),
): Promise<Response> {
    return middleware(req, server, next);
}

describe("Router middleware integration", () => {
    it("applies router-wide middleware to future routes only", async () => {
        const router = new Router();
        const seen: Array<string> = [];
        const first = mock(async (req: TestRequest, _server: Bun.Server<unknown>, next: Handler) => {
            seen.push(`first:${req.method}`);
            return next(req, server);
        });
        const second = mock(async (req: TestRequest, _server: Bun.Server<unknown>, next: Handler) => {
            seen.push(`second:${req.method}`);
            return next(req, server);
        });

        router.useAll(first);
        router.new("/first", "GET").handle(() => new Response("first"));
        router.useAll(second);
        router.new("/second", "GET").handle(() => new Response("second"));
        router.unuseAll(second);
        router.new("/third", "GET").handle(() => new Response("third"));

        const map = router.getMap();
        const firstRoute = map["/first"]?.GET as Handler;
        const secondRoute = map["/second"]?.GET as Handler;
        const thirdRoute = map["/third"]?.GET as Handler;

        await firstRoute(makeRequest("http://localhost/first", { method: "GET" }), server);
        await secondRoute(makeRequest("http://localhost/second", { method: "GET" }), server);
        await thirdRoute(makeRequest("http://localhost/third", { method: "GET" }), server);

        expect(seen).toEqual([
            "first:GET",
            "first:GET",
            "second:GET",
            "first:GET",
        ]);
    });
});

describe("Before", () => {
    it("runs a side effect before next", async () => {
        const calls: Array<string> = [];
        const middleware = Middleware.Before((req) => {
            calls.push(req.method);
        });

        const response = await runMiddleware(middleware, makeRequest("http://localhost/test", { method: "POST" }), async () => {
            calls.push("next");
            return new Response("ok");
        });

        expect(await response.text()).toBe("ok");
        expect(calls).toEqual(["POST", "next"]);
    });
});

describe("After", () => {
    it("runs a side effect after next and returns the original response", async () => {
        const calls: Array<string> = [];
        const response = new Response("ok");
        const middleware = Middleware.After(async (_req, res) => {
            calls.push(await res.clone().text());
            res.headers.set("x-after", "1");
        });

        const result = await runMiddleware(middleware, makeRequest(), async () => {
            calls.push("next");
            return response;
        });

        expect(result).toBe(response);
        expect(result.headers.get("x-after")).toBe("1");
        expect(calls).toEqual(["next", "ok"]);
    });
});

describe("Inject", () => {
    it("aliases Before", async () => {
        const calls: Array<string> = [];
        const middleware = Middleware.Inject((req) => {
            calls.push(req.method);
        });

        const response = await runMiddleware(middleware, makeRequest("http://localhost/test", { method: "PUT" }), async () => {
            calls.push("next");
            return new Response("ok");
        });

        expect(await response.text()).toBe("ok");
        expect(calls).toEqual(["PUT", "next"]);
    });
});

describe("DebugLog", () => {
    it("works when passed directly as middleware", async () => {
        const next = mock(async () => new Response("ok"));

        const response = await Middleware.DebugLog(
            makeRequest("http://localhost/test", { method: "GET" }),
            server as Bun.Server<never>,
            next as unknown as (req: TestRequest, server: Bun.Server<never>) => Promise<Response>,
        );

        expect(await response.text()).toBe("ok");
        expect(next).toHaveBeenCalledTimes(1);
    });

    it("works when called with a namespace", async () => {
        const next = mock(async () => new Response("ok"));
        const middleware = Middleware.DebugLog("api:");

        const response = await runMiddleware(middleware, makeRequest("http://localhost/test", { method: "PATCH" }), next as unknown as Handler);

        expect(await response.text()).toBe("ok");
        expect(next).toHaveBeenCalledTimes(1);
    });
});

describe("RequestId", () => {
    it("works when passed directly as middleware", async () => {
        const req = makeRequest("http://localhost/test");

        const response = await runMiddleware(Middleware.RequestId, req);

        expect(req.headers.get("x-request-id")).toBeString();
        expect(response.headers.get("x-request-id")).toBe(req.headers.get("x-request-id"));
    });

    it("adds a request and response id", async () => {
        const middleware = Middleware.RequestId({ generator: () => "req-123" });
        const req = makeRequest("http://localhost/test");

        const response = await runMiddleware(middleware, req);

        expect(req.headers.get("x-request-id")).toBe("req-123");
        expect(response.headers.get("x-request-id")).toBe("req-123");
    });

    it("preserves an existing id by default", async () => {
        const middleware = Middleware.RequestId({ generator: () => "new-id" });
        const req = makeRequest("http://localhost/test", {
            headers: { "x-request-id": "existing-id" },
        });

        const response = await runMiddleware(middleware, req);

        expect(req.headers.get("x-request-id")).toBe("existing-id");
        expect(response.headers.get("x-request-id")).toBe("existing-id");
    });
});

describe("Timing", () => {
    it("works when passed directly as middleware", async () => {
        const response = await runMiddleware(Middleware.Timing);

        expect(response.headers.get("server-timing")).toContain("app;dur=");
    });

    it("adds a server-timing header and calls the log hook", async () => {
        const log = mock(async () => {});
        const middleware = Middleware.Timing({ description: "router", log, metricName: "app" });

        const response = await runMiddleware(middleware);

        expect(response.headers.get("server-timing")).toContain("app;dur=");
        expect(response.headers.get("server-timing")).toContain("desc=\"router\"");
        expect(log).toHaveBeenCalledTimes(1);
    });
});

describe("CORS", () => {
    it("works when passed directly as middleware", async () => {
        const req = makeRequest("http://localhost/test", {
            headers: {
                origin: "https://app.example.com",
            },
        });

        const response = await runMiddleware(Middleware.CORS, req);

        expect(response.headers.get("access-control-allow-origin")).toBe("*");
    });

    it("handles preflight requests", async () => {
        const middleware = Middleware.CORS({
            allowHeaders: ["authorization"],
            allowMethods: ["GET", "POST", "OPTIONS"],
            origin: ["https://app.example.com"],
        });
        const req = makeRequest("http://localhost/test", {
            headers: {
                "origin": "https://app.example.com",
                "access-control-request-method": "POST",
            },
            method: "OPTIONS",
        });

        const response = await runMiddleware(middleware, req);

        expect(response.status).toBe(204);
        expect(response.headers.get("access-control-allow-origin")).toBe("https://app.example.com");
        expect(response.headers.get("access-control-allow-methods")).toBe("GET, POST, OPTIONS");
    });

    it("rejects disallowed preflight origins", async () => {
        const middleware = Middleware.CORS({ origin: ["https://allowed.example.com"] });
        const req = makeRequest("http://localhost/test", {
            headers: {
                "origin": "https://blocked.example.com",
                "access-control-request-method": "GET",
            },
            method: "OPTIONS",
        });

        const response = await runMiddleware(middleware, req);
        expect(response.status).toBe(403);
    });
});

describe("BodyLimit", () => {
    it("rejects requests that exceed content-length", async () => {
        const middleware = Middleware.BodyLimit({ maxBytes: 3 });
        const req = makeRequest("http://localhost/test", {
            body: "hello",
            headers: { "content-length": "5" },
            method: "POST",
        });

        const response = await runMiddleware(middleware, req);

        expect(response.status).toBe(413);
        expect(await response.json()).toEqual({ message: "Request body too large" });
    });

    it("rejects requests that exceed the streamed body limit", async () => {
        const middleware = Middleware.BodyLimit({ maxBytes: 3 });
        const req = makeRequest("http://localhost/test", {
            body: "hello",
            method: "POST",
        });

        const response = await runMiddleware(middleware, req);

        expect(response.status).toBe(413);
    });
});

describe("Recover", () => {
    it("works when passed directly as middleware", async () => {
        const response = await runMiddleware(Middleware.Recover, makeRequest(), async () => {
            throw new Error("boom");
        });

        expect(response.status).toBe(500);
        expect(await response.json()).toEqual({ message: "Error: boom" });
    });

    it("returns a custom response when downstream throws", async () => {
        const middleware = Middleware.Recover({
            handler: error => Response.json({ message: String(error) }, { status: 418 }),
        });

        const response = await runMiddleware(middleware, makeRequest(), async () => {
            throw new Error("boom");
        });

        expect(response.status).toBe(418);
        expect(await response.json()).toEqual({ message: "Error: boom" });
    });
});

describe("ModifyRequest", () => {
    it("passes the replaced request downstream", async () => {
        const middleware = Middleware.ModifyRequest((req) => {
            const replaced = new Request(req, {
                headers: {
                    ...Object.fromEntries(req.headers),
                    "x-replaced-request": "1",
                },
            }) as TestRequest;
            Object.defineProperty(replaced, "params", {
                configurable: true,
                value: req.params,
                writable: true,
            });
            return replaced;
        });

        let seenHeader = "";
        const response = await runMiddleware(middleware, makeRequest(), async (req) => {
            seenHeader = req.headers.get("x-replaced-request") ?? "";
            return new Response("ok");
        });

        expect(await response.text()).toBe("ok");
        expect(seenHeader).toBe("1");
    });
});

describe("BasicAuth", () => {
    it("rejects missing credentials", async () => {
        const middleware = Middleware.BasicAuth({
            validate: () => true,
        });

        const response = await runMiddleware(middleware);

        expect(response.status).toBe(401);
        expect(response.headers.get("www-authenticate")).toContain("Basic");
    });

    it("accepts valid credentials", async () => {
        const middleware = Middleware.BasicAuth({
            validate: (username, password) => username === "don" && password === "secret",
        });
        const token = Buffer.from("don:secret").toString("base64");

        const response = await runMiddleware(middleware, makeRequest("http://localhost/test", {
            headers: { authorization: `Basic ${token}` },
        }));

        expect(response.status).toBe(200);
    });
});

describe("BearerAuth", () => {
    it("rejects missing tokens", async () => {
        const middleware = Middleware.BearerAuth({
            validate: () => true,
        });

        const response = await runMiddleware(middleware);

        expect(response.status).toBe(401);
        expect(response.headers.get("www-authenticate")).toContain("Bearer");
    });

    it("accepts valid tokens", async () => {
        const middleware = Middleware.BearerAuth({
            validate: token => token === "secret-token",
        });

        const response = await runMiddleware(middleware, makeRequest("http://localhost/test", {
            headers: { authorization: "Bearer secret-token" },
        }));

        expect(response.status).toBe(200);
    });
});

describe("MethodOverride", () => {
    it("works when passed directly as middleware", async () => {
        const req = makeRequest("http://localhost/ignored?_method=PATCH", {
            method: "POST",
        });

        let seenMethod = "";
        await runMiddleware(Middleware.MethodOverride, req, async (nextReq) => {
            seenMethod = nextReq.method;
            return new Response("ok");
        });

        expect(seenMethod).toBe("PATCH");
    });

    it("overrides the method while preserving other request properties", async () => {
        const req = makeRequest("http://localhost/ignored", {
            headers: { "x-http-method-override": "DELETE" },
            method: "POST",
        }, { id: "123" });

        let seenMethod = "";
        let seenParam = "";
        const response = await runMiddleware(Middleware.MethodOverride, req, async (nextReq) => {
            seenMethod = nextReq.method;
            seenParam = (nextReq.params as Record<string, string>).id ?? "";
            return new Response("ok");
        });

        expect(await response.text()).toBe("ok");
        expect(seenMethod).toBe("DELETE");
        expect(seenParam).toBe("123");
        expect(req.method).toBe("POST");
    });
});

describe("ETag", () => {
    it("works when passed directly as middleware", async () => {
        const response = await runMiddleware(Middleware.ETag, makeRequest("http://localhost/test", { method: "GET" }), async () => new Response("hello"));

        expect(response.headers.get("etag")).toMatch(/^"[\da-f]+"$/);
    });

    it("adds an etag header to cacheable responses", async () => {
        const response = await runMiddleware(Middleware.ETag, makeRequest("http://localhost/test", { method: "GET" }), async () => new Response("hello"));

        expect(response.headers.get("etag")).toMatch(/^"[\da-f]+"$/);
    });

    it("returns 304 when if-none-match matches", async () => {
        const tag = "\"known-tag\"";
        const middleware = Middleware.ETag({
            generator: async () => "known-tag",
        });
        const req = makeRequest("http://localhost/test", {
            headers: { "if-none-match": tag },
            method: "GET",
        });

        const response = await runMiddleware(middleware, req, async () => new Response("hello"));

        expect(response.status).toBe(304);
        expect(response.headers.get("etag")).toBe(tag);
    });
});

describe("ModifyResponse", () => {
    it("replaces the downstream response", async () => {
        const middleware = Middleware.ModifyResponse(async (res) => {
            return new Response(await res.text(), {
                headers: {
                    "x-replaced-response": "1",
                },
                status: 201,
                statusText: "Created",
            });
        });

        const response = await runMiddleware(middleware, makeRequest(), async () => new Response("ok"));

        expect(await response.text()).toBe("ok");
        expect(response.status).toBe(201);
        expect(response.headers.get("x-replaced-response")).toBe("1");
    });
});

describe("RateLimit", () => {
    it("allows requests until the limit and then rejects", async () => {
        const middleware = Middleware.RateLimit({
            key: () => "client-1",
            limit: 2,
            windowMs: 60_000,
        });

        const first = await runMiddleware(middleware);
        const second = await runMiddleware(middleware);
        const third = await runMiddleware(middleware);

        expect(first.status).toBe(200);
        expect(second.status).toBe(200);
        expect(third.status).toBe(429);
        expect(third.headers.get("x-ratelimit-limit")).toBe("2");
    });
});

describe("Static", () => {
    const root = `${import.meta.dirname}/fixtures/static`;
    const middleware = Middleware.Static({ prefix: "/static", root });
    const fallback: Handler = async () => new Response("fallback", { status: 404 });

    it("serves a file under the prefix", async () => {
        const response = await runMiddleware(middleware, makeRequest("http://localhost/static/hello.txt"), fallback);

        expect(response.status).toBe(200);
        expect(await response.text()).toBe("hello\n");
        expect(response.headers.get("content-type")).toStartWith("text/plain");
        expect(response.headers.get("last-modified")).toBeTruthy();
    });

    it("serves index files and redirects directories without a trailing slash", async () => {
        const redirect = await runMiddleware(middleware, makeRequest("http://localhost/static/sub?x=1"), fallback);
        expect(redirect.status).toBe(301);
        expect(redirect.headers.get("location")).toBe("/static/sub/?x=1");

        const response = await runMiddleware(middleware, makeRequest("http://localhost/static/sub/"), fallback);
        expect(await response.text()).toBe("<p>index</p>\n");
    });

    it("falls through for missing files, dotfiles, and traversal", async () => {
        for (const path of ["/static/missing.txt", "/static/.secret", "/static/..%2Fmiddleware.test.ts", "/other/hello.txt"]) {
            const response = await runMiddleware(middleware, makeRequest(`http://localhost${path}`), fallback);
            expect(await response.text()).toBe("fallback");
        }
    });

    it("returns 404 when fallthrough is disabled", async () => {
        const strict = Middleware.Static({ fallthrough: false, prefix: "/static", root });
        const response = await runMiddleware(strict, makeRequest("http://localhost/static/missing.txt"), fallback);

        expect(response.status).toBe(404);
        expect(await response.text()).toBe("Not Found");
    });

    it("supports single byte ranges", async () => {
        const response = await runMiddleware(middleware, makeRequest("http://localhost/static/hello.txt", { headers: { range: "bytes=1-3" } }), fallback);

        expect(response.status).toBe(206);
        expect(response.headers.get("content-range")).toBe("bytes 1-3/6");
        expect(await response.text()).toBe("ell");

        const invalid = await runMiddleware(middleware, makeRequest("http://localhost/static/hello.txt", { headers: { range: "bytes=10-" } }), fallback);
        expect(invalid.status).toBe(416);
    });

    it("returns 304 when if-modified-since is current", async () => {
        const first = await runMiddleware(middleware, makeRequest("http://localhost/static/hello.txt"), fallback);
        const response = await runMiddleware(middleware, makeRequest("http://localhost/static/hello.txt", {
            headers: { "if-modified-since": first.headers.get("last-modified")! },
        }), fallback);

        expect(response.status).toBe(304);
    });

    it("skips non GET/HEAD methods", async () => {
        const response = await runMiddleware(middleware, makeRequest("http://localhost/static/hello.txt", { method: "POST" }), fallback);

        expect(await response.text()).toBe("fallback");
    });
});
