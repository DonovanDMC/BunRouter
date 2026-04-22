# @yiffy/bun-router

A small TypeScript router for Bun with chainable route registration, reusable middleware chains, router-wide middleware defaults for future routes, and optional route auto-loading from a directory.

## Installation

```bash
bun add @yiffy/bun-router
```

## Overview

The package exports:

- `default`: a shared router instance
- `Router`: the router class if you want your own instance
- `RouteChain`: the chain object returned by `Router.new()` and `MiddlewareChain.new()`
- `MiddlewareChain`: the chain object returned by `router.use(...)`
- `Middleware`: built-in middleware helpers
- `AnyBunServer`, `Middleware`, and `Handler`: TypeScript types for server, middleware, and handlers

## Quick Start

```ts
import router from "@yiffy/bun-router";

router
    .new("/hello", "GET")
    .handle(() => Response.json({ message: "hello" }));

Bun.serve({
    port: 3000,
    routes: await router.load(),
});
```

## Creating Routes

Create a route with `router.new(path, method?)`.

- When `method` is provided, the route is registered for that HTTP method only.
- When `method` is omitted, the handler is registered directly on the path.
- Duplicate path or method/path registrations throw an error.

```ts
import { Router } from "@yiffy/bun-router";

const router = new Router();

router
    .new("/users/:id", "GET")
    .handle((req) => {
        return Response.json({
            id: req.params.id,
        });
    });

router
    .new("/health")
    .handle(() => new Response("ok"));
```

## Middleware

Middleware receives `(req, server, next)` and must return a `Response` or a promise for one.

- `router.use(...)` starts a reusable middleware chain
- `router.useAll(...)` adds middleware to all future routes created from that router
- `router.unuseAll(...)` removes a router-wide middleware for future routes
- `route.use(...)` adds middleware for a single route
- `middlewareChain.use(...)` adds middleware to a reusable chain
- `middlewareChain.unuse(...)` removes middleware from that reusable chain
- `middlewareChain.new(...)` creates a route preloaded with that chain's middleware
- `next(req, server)` continues the chain

```ts
import { Router, Middleware, type AnyBunServer } from "@yiffy/bun-router";

const router = new Router();
const auth = (req: Bun.BunRequest<"/private">, server: AnyBunServer, next: (req: Bun.BunRequest<"/private">, server: AnyBunServer) => Response | Promise<Response>) => {
    if (req.headers.get("authorization") !== "some secret") {
        return Response.json({ message: "Unauthorized" }, { status: 401 });
    }

    return next(req, server);
};

const requestId = Middleware.Before((req) => {
    req.headers.set("x-request-id", crypto.randomUUID());
});

router.useAll(Middleware.DebugLog);
router.useAll(requestId);

router
    .new("/private", "GET")
    .use(auth)
    .handle(() => Response.json({ ok: true }));

const api = router
    .use(Middleware.DebugLog("api:"));

api
    .new("/api/ping", "GET")
    .handle(() => Response.json({ ok: true }));
```

## Route Files

`router.load(directory?)` optionally imports every `*.ts` file in a directory once, then returns `router.list`.

This is useful when route modules register themselves against the default router:

```ts
// routes/hello.ts
import router from "@yiffy/bun-router";

router
    .new("/hello", "GET")
    .handle(() => new Response("hello"));
```

```ts
// server.ts
import router from "@yiffy/bun-router";

Bun.serve({
    routes: await router.load("./routes"),
});
```

Notes:

- `load()` is idempotent per router instance
- only `*.ts` files are scanned
- importing a route file should have the side effect of registering its routes
- `load(directory)` imports matching files before returning the route table

## Error Handling

If a handler or middleware throws or rejects, the router catches the error and returns a `500` JSON response:

```json
{ "message": "ErrorName: message" }
```

If the thrown error has an `Error` cause, the cause is appended to the message.

If you want custom error responses inside the middleware chain, add `Middleware.Recover(...)` near the start of the chain.

## API

### `new Router()`

Creates an isolated router instance.

### `router.new(path, method?)`

Starts a `RouteChain`.

### `router.use(middleware)`

Starts a `MiddlewareChain` that can be extended and used to create routes sharing the same middleware stack.

### `router.useAll(middleware)`

Adds middleware to all future routes created from that router. It does not apply retroactively to routes that already exist.

### `router.unuseAll(middleware)`

Removes a previously-added router-wide middleware from future routes. The function reference must match exactly.

### `middlewareChain.use(middleware)`

Adds middleware to that middleware chain.

### `middlewareChain.unuse(middleware)`

Removes middleware from that middleware chain. The function reference must match exactly.

### `middlewareChain.new(path, method?)`

Starts a `RouteChain` preloaded with the middleware stored on that chain.

### `route.use(middleware)`

Adds middleware to the current route chain.

### `route.handle(handler)`

Finalizes the route and registers it on the router.

### `await router.load(directory?)`

Loads route files from a directory and returns `router.list`.

### `router.list`

The route table to pass into `Bun.serve({ routes })`.

## Built-In Middleware

### `Middleware.Before(handler)`

Wraps a request-side effect function and turns it into router middleware. The injected handler runs before `next(req, server)`.

### `Middleware.After(handler)`

Runs a side effect after downstream middleware and the handler complete. The handler receives both the request and the final response, and the original response object is returned unchanged.

### `Middleware.Inject(handler)`

Compatibility alias for `Middleware.Before(handler)`.

### `Middleware.DebugLog`

Logs requests through `persistent-debug` defaulting to the namespace prefix `server:`. `<method>` is appended to the prefix for each request. For example, a `GET /hello` request would log with the namespace `server:get`.

It can be passed directly as middleware or called with a namespace prefix:

- `Middleware.DebugLog`
- `Middleware.DebugLog("api:")`

`persistent-debug` is an optional dependency. If it is not installed, the middleware emits a one-time process warning instead of throwing.

### `Middleware.RequestId(options?)`

Adds or forwards a request ID header. By default it uses `x-request-id`, writes the value onto the request before the handler runs, and mirrors it onto the response.

It can be passed directly as middleware or configured with options:

- `Middleware.RequestId`
- `Middleware.RequestId({ headerName: "x-correlation-id" })`

### `Middleware.Timing(options?)`

Measures request duration and appends a `Server-Timing` entry to the response. It can also call an optional logger hook with the measured duration and response.

It can be passed directly as middleware or configured with options.

### `Middleware.CORS(options?)`

Adds standard CORS headers and handles preflight `OPTIONS` requests. It supports fixed origins, allowlists, or a callback for dynamic origin resolution.

It can be passed directly as middleware or configured with options.

### `Middleware.BodyLimit({ maxBytes, ... })`

Rejects requests whose body exceeds a configured byte limit with a `413` JSON response. It checks `content-length` when available and otherwise measures the streamed body through a cloned request.

### `Middleware.Recover(options?)`

Intercepts downstream errors inside the middleware chain and maps them to a custom response. This is useful when you want route-specific or API-specific error formatting instead of the router's default `500` response.

It can be passed directly as middleware or configured with options.

### `Middleware.BasicAuth(options)`

Parses the `Authorization: Basic ...` header, calls a validation callback with the decoded username and password, and returns a `401` response with a `WWW-Authenticate` challenge when authentication fails.

### `Middleware.BearerAuth(options)`

Parses the `Authorization: Bearer ...` header, calls a validation callback with the token, and returns a `401` bearer challenge when authentication fails.

### `Middleware.MethodOverride(options?)`

Overrides the request method using `x-http-method-override` or a `_method` query parameter before calling the next middleware or handler.

This does not change Bun's initial route dispatch. It is most useful on method-agnostic routes or when your handler inspects `req.method` directly.

It can be passed directly as middleware or configured with options.

### `Middleware.ETag(options?)`

Computes an `ETag` for successful `GET` and `HEAD` responses, sets the header, and returns `304 Not Modified` when the request `If-None-Match` value matches.

It can be passed directly as middleware or configured with options.

### `Middleware.RateLimit(options)`

Applies a fixed-window rate limit with an in-memory store by default. It can emit standard limit headers and accepts custom key, skip, and storage functions.

## Middleware Examples

```ts
import { Middleware } from "@yiffy/bun-router";

const cors = Middleware.CORS({
    allowCredentials: true,
    allowHeaders: ["content-type", "authorization", "x-request-id"],
    allowMethods: ["GET", "POST", "OPTIONS"],
    origin: ["https://app.example.com", "https://admin.example.com"],
});

const before = Middleware.Before((req) => {
    req.headers.set("x-request-id", crypto.randomUUID());
});
const after = Middleware.After((_req, res) => {
    res.headers.set("x-finished", "1");
});
const requestId = Middleware.RequestId;
const timing = Middleware.Timing;
const configuredTiming = Middleware.Timing({ metricName: "router" });
const bodyLimit = Middleware.BodyLimit({ maxBytes: 1024 * 1024 });
const debugLog = Middleware.DebugLog;
const apiDebugLog = Middleware.DebugLog("api:");
const inject = Middleware.Inject((req) => {
    req.headers.set("x-legacy-hook", "1");
});
const recover = Middleware.Recover;
const auth = Middleware.BearerAuth({
    validate: (token) => token === process.env.API_TOKEN,
});
const etag = Middleware.ETag;
const rateLimit = Middleware.RateLimit({ limit: 60, windowMs: 60_000 });
const methodOverride = Middleware.MethodOverride;
```

## Development

```bash
bun install --frozen-lockfile --ignore-scripts
bun run lint
bun run build
```

The build outputs runtime code and declaration files into `dist/`.
