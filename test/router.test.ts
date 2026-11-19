import { afterAll, describe, expect, it } from "bun:test";

import Router from "../src/Router.js";

const servers: Array<Bun.Server<unknown>> = [];
afterAll(() => {
    for (const server of servers) void server.stop(true);
});

function serve(router: Router): (path: string, init?: RequestInit) => Promise<Response> {
    const server = Bun.serve({ port: 0, routes: router.toRoutes() });
    servers.push(server);
    return (path, init) => fetch(new URL(path, server.url), init);
}

describe("param suffixes", () => {
    it("matches the suffix and strips it from params", async () => {
        const router = new Router();
        router.new("/styles/:name.css", "GET").handle(req => Response.json(req.params));
        const request = serve(router);

        expect(await (await request("/styles/main.css")).json()).toEqual({ name: "main" });
        expect((await request("/styles/main")).status).toBe(404);
        expect((await request("/styles/main.js")).status).toBe(404);
        expect((await request("/styles/.css")).status).toBe(404);
    });

    it("dispatches between suffixes and a plain param on the same path", async () => {
        const router = new Router();
        router.new("/files/:name", "GET").handle(req => new Response(`plain:${req.params.name}`));
        router.new("/files/:name.css", "GET").handle(req => new Response(`css:${req.params.name}`));
        router.new("/files/:file.min.js", "GET").handle(req => new Response(`minjs:${req.params.file}`));
        router.new("/files/:file.js", "GET").handle(req => new Response(`js:${req.params.file}`));
        const request = serve(router);

        expect(await (await request("/files/a.css")).text()).toBe("css:a");
        expect(await (await request("/files/a.js")).text()).toBe("js:a");
        expect(await (await request("/files/a.min.js")).text()).toBe("minjs:a");
        expect(await (await request("/files/a.txt")).text()).toBe("plain:a.txt");
    });

    it("keeps methods separate", async () => {
        const router = new Router();
        router.new("/x/:id.json", "GET").handle(req => new Response(`get:${req.params.id}`));
        router.new("/x/:key", "POST").handle(req => new Response(`post:${req.params.key}`));
        const request = serve(router);

        expect(await (await request("/x/1.json")).text()).toBe("get:1");
        expect(await (await request("/x/1.json", { method: "POST" })).text()).toBe("post:1.json");
    });

    it("mixes method-less and method routes", async () => {
        const router = new Router();
        router.new("/m/:id.txt").handle(req => new Response(`any:${req.params.id}`));
        router.new("/m/:id", "GET").handle(req => new Response(`get:${req.params.id}`));
        const request = serve(router);

        expect(await (await request("/m/1.txt", { method: "DELETE" })).text()).toBe("any:1");
        expect(await (await request("/m/1")).text()).toBe("get:1");
        expect((await request("/m/1", { method: "DELETE" })).status).toBe(404);
    });

    it("uses the notFound handler when no suffix matches", async () => {
        const router = new Router();
        router.notFound(() => new Response("nope", { status: 404 }));
        router.new("/styles/:name.css", "GET").handle(() => new Response("ok"));
        const request = serve(router);

        expect(await (await request("/styles/main.js")).text()).toBe("nope");
    });

    it("throws on conflicting routes that only differ by param name", () => {
        const router = new Router();
        router.new("/a/:x", "GET").handle(() => new Response("x"));
        expect(() => router.new("/a/:y", "GET").handle(() => new Response("y"))).toThrow();
        router.new("/b/:x.css").handle(() => new Response("x"));
        expect(() => router.new("/b/:y.css", "GET").handle(() => new Response("y"))).toThrow();
    });

    it("leaves plain routes untouched", () => {
        const router = new Router();
        router.new("/users/:id", "GET").handle(() => new Response("ok"));
        router.new("/health").handle(() => new Response("ok"));
        expect(Object.keys(router.getMap())).toEqual(["/users/:id", "/health"]);
    });
});

describe("trailing slashes", () => {
    it("404s by default", async () => {
        const router = new Router();
        router.new("/users", "GET").handle(() => new Response("users"));
        const request = serve(router);

        expect((await request("/users/")).status).toBe(404);
    });

    it("ignores them", async () => {
        const router = new Router({ trailingSlash: "ignore" });
        router.new("/users", "GET").handle(() => new Response("users"));
        router.new("/users/:id.json", "GET").handle(req => new Response(`json:${req.params.id}`));
        router.new("/users/:id", "GET").handle(req => new Response(`user:${req.params.id}`));
        const request = serve(router);

        expect(await (await request("/users/")).text()).toBe("users");
        expect(await (await request("/users/1/")).text()).toBe("user:1");
        expect(await (await request("/users/1.json/")).text()).toBe("json:1");
    });

    it("prefers routes explicitly registered with a trailing slash", async () => {
        const router = new Router({ trailingSlash: "ignore" });
        router.new("/a/").handle(() => new Response("slash"));
        router.new("/a").handle(() => new Response("plain"));
        const request = serve(router);

        expect(await (await request("/a")).text()).toBe("plain");
        expect(await (await request("/a/")).text()).toBe("slash");
    });

    it("redirects them", async () => {
        const router = new Router().configure({ trailingSlash: "redirect" });
        router.new("/users/:id", "GET").handle(req => new Response(`user:${req.params.id}`));
        const request = serve(router);

        const res = await request("/users/1/?x=1", { redirect: "manual" });
        expect(res.status).toBe(308);
        expect(res.headers.get("location")).toBe("/users/1?x=1");
        expect(await (await request("/users/1/")).text()).toBe("user:1");
    });

    it("leaves the root and wildcards alone", () => {
        const router = new Router({ trailingSlash: "ignore" });
        router.new("/").handle(() => new Response("root"));
        router.new("/assets/*").handle(() => new Response("asset"));
        expect(Object.keys(router.getMap())).toEqual(["/", "/assets/*"]);
    });
});
