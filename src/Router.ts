import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type Middleware<R extends string = string, WebSocketData = unknown> = (req: Bun.BunRequest<R>, server: Bun.Server<WebSocketData>, next: Handler<R, WebSocketData>) => Bun.MaybePromise<Response>;
export type Handler<R extends string = string, WebSocketData = unknown> = (req: Bun.BunRequest<R>, server: Bun.Server<WebSocketData>) => Bun.MaybePromise<Response>;

export default class Router<WebSocketData = unknown> {
    private _loaded = false;
    private _middleware: Array<Middleware<string, WebSocketData>> = [];
    private list: Record<string, Partial<Record<Bun.Serve.HTTPMethod, Bun.Serve.Handler<Bun.BunRequest, Bun.Server<WebSocketData>, Response>>>> = {};

    _add<R extends string = string>(route: RouteChain<R, WebSocketData>): void {
        if (route.method === undefined) {
            if (this.list[route.path] !== undefined) {
                throw new Error(`Route ${route.path} already exists`);
            }
        } else {
            if (this.list[route.path]?.[route.method] !== undefined) {
                throw new Error(`Route ${route.method} ${route.path} already exists`);
            }
        }

        const handler = ((req: Bun.BunRequest, server: Bun.Server<WebSocketData>): Bun.MaybePromise<Response> => route._run(req as Bun.BunRequest<R>, server)) as never;
        if (route.method) {
            this.list[route.path] ??= {};
            this.list[route.path]![route.method] = handler;
        } else {
            this.list[route.path] = handler;
        }
    }

    getMap(): Router["list"] {
        return Object.fromEntries(
            Object.entries(this.list).map(([path, route]) => {
                if (typeof route === "function") {
                    return [path, route];
                }

                return [path, { ...route }];
            }),
        );
    }

    /**
     * Load all of the files from a directory.
     * @param directory Directory to load route files from. Relative paths are resolved against the current working directory, pass a `URL` (e.g. `new URL("routes", import.meta.url)`) to resolve relative to a module. Files matching `pattern` will be imported. Exports are ignored, the files are expected to register routes to a shared router on import.
     */
    async load(directory: string | URL, pattern = "**/*.ts"): Promise<void> {
        const dir = directory instanceof URL ? fileURLToPath(directory) : resolve(directory);
        for await (const name of new Bun.Glob(pattern).scan(dir)) {
            const path = import.meta.resolve(join(dir, name));
            await import(path);
        }
    }

    /** Start a new route. Chained {@link RouteChain.use | use} calls will only apply to this route. */
    new<R extends string = string>(path: R, method?: Bun.Serve.HTTPMethod): RouteChain<R, WebSocketData> {
        const chain = new RouteChain<R, WebSocketData>(this, path, method);
        for (const mw of this._middleware) chain.use(mw as never);
        return chain;
    }

    /** Routes map for the bun server. */
    toRoutes(): Bun.Serve.Routes<WebSocketData, string> {
        return this.list;
    }

    /** Remove middleware from all future routes in the router, does not affect already registered routes. The provided function must be the exact same function that was previously used. */
    unuseAll(middleware: Middleware<string, WebSocketData>): this {
        this._middleware = this._middleware.filter(mw => mw !== middleware);
        return this;
    }

    /** Start a new middleware chain. Chained {@link MiddlewareChain.use | use} calls will only apply to this chain. */
    use(middleware: Middleware<string, WebSocketData>): MiddlewareChain<WebSocketData> {
        return new MiddlewareChain<WebSocketData>(this).use(middleware);
    }

    /** Add middleware to all future routes in the router, does not apply retroactively. */
    useAll(middleware: Middleware<string, WebSocketData>): this {
        this._middleware.push(middleware);
        return this;
    }
}

export class MiddlewareChain<WebSocketData = unknown> {
    middlewares: Array<Middleware<string, WebSocketData>> = [];
    router: Router<WebSocketData>;

    constructor(router: Router<WebSocketData>) {
        this.router = router;
    }

    /** Start a new route. Chained {@link RouteChain.use | use} calls will only apply to this route. */
    new<R extends string = string>(path: R, method?: Bun.Serve.HTTPMethod): RouteChain<R, WebSocketData> {
        const chain = new RouteChain<R, WebSocketData>(this.router, path, method);
        for (const mw of this.middlewares) chain.use(mw as never);
        return chain;
    }

    /** Remove middleware from this chain. The provided function must be the exact same function that was previously used. */
    unuse(middleware: Middleware<string, WebSocketData>): this {
        this.middlewares = this.middlewares.filter(mw => mw !== middleware);
        return this;
    }

    /** Add middleware to this chain. Chained {@link RouteChain.use | use} calls will only apply to routes created from this chain. */
    use(middleware: Middleware<string, WebSocketData>): this {
        this.middlewares.push(middleware);
        return this;
    }
}

export class RouteChain<R extends string = string, WebSocketData = unknown> {
    handler!: Handler<R, WebSocketData>;
    method?: Bun.Serve.HTTPMethod;
    middlewares: Array<Middleware<R, WebSocketData>> = [];
    path: R;
    router: Router<WebSocketData>;

    constructor(router: Router<WebSocketData>, path: R, method?: Bun.Serve.HTTPMethod) {
        this.router = router;
        this.path = path;
        this.method = method;
    }

    private _handleError(location: string, err: unknown): Response {
        console.error(`Error in ${location} for ${this.method} ${this.path}:`, err);
        let message = `Unhandled error: ${String(err)}`;
        if (err instanceof Error) {
            message = `${err.name}: ${err.message}`;
            if (err.cause instanceof Error) {
                message += ` | Cause: ${err.cause.name}: ${err.cause.message}`;
            }
        }
        return Response.json({ message }, { status: 500 });
    }

    private _next(index: number, req: Bun.BunRequest<R>, server: Bun.Server<WebSocketData>): Bun.MaybePromise<Response> {
        if (index < this.middlewares.length) {
            const middleware = this.middlewares[index]!;
            return middleware(req, server, (nextReq, nextServer) => this._next(index + 1, nextReq, nextServer));
        } else {
            return this.handler(req, server);
        }
    }

    /** @internal */
    _run(req: Bun.BunRequest<R>, server: Bun.Server<WebSocketData>): Bun.MaybePromise<Response> {
        return Promise.resolve(this._next(0, req, server)).catch(this._handleError.bind(this, "pipeline"));
    }

    /** Handle a request for this route. This ends the chain. */
    handle(func: Handler<R, WebSocketData>): Router<WebSocketData> {
        this.handler = func;
        this.router._add(this);
        return this.router;
    }

    /** Add middleware to this route. Chained {@link RouteChain.use | use} calls will only apply to this route. */
    use(middleware: Middleware<R, WebSocketData>): this {
        this.middlewares.push(middleware);
        return this;
    }
}
