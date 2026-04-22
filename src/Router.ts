import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Glob, type BunRequest, type MaybePromise, type Serve, type Server } from "bun";

export type AnyBunServer = Server<unknown>;
export type Middleware<R extends string = string, S extends AnyBunServer = AnyBunServer> = (req: BunRequest<R>, server: S, next: Handler<R, S>) => MaybePromise<Response>;
export type Handler<R extends string = string, S extends AnyBunServer = AnyBunServer> = (req: BunRequest<R>, server: S) => MaybePromise<Response>;

export default class Router<S extends AnyBunServer = AnyBunServer> {
    private _loaded = false;
    private _middleware: Array<Middleware<string, S>> = [];
    /** Route map for the router. Prefer using {@link load} over directly accessing this in case router load behavior changes in the future. */
    list: Record<string, Partial<Record<Serve.HTTPMethod, Serve.Handler<BunRequest, S, Response> | Response>>> = {};

    _add<R extends string>(route: RouteChain<R, S>): void {
        if (route.method === undefined) {
            if (this.list[route.path] !== undefined) {
                throw new Error(`Route ${route.path} already exists`);
            }
        } else {
            if (this.list[route.path]?.[route.method] !== undefined) {
                throw new Error(`Route ${route.method} ${route.path} already exists`);
            }
        }

        const handler = ((req: BunRequest, server: S): MaybePromise<Response> => route._run(req as BunRequest<R>, server)) as never;
        if (route.method) {
            this.list[route.path] ??= {};
            this.list[route.path]![route.method] = handler;
        } else {
            this.list[route.path] = handler;
        }
    }

    /**
     * Load the route map for bun. Prefer using this over {@link list} in case router load behavior changes in the future.
     * @param directory Optional directory to load route files from. If provided, all `.ts` files in the directory will be imported. Exports are ignored, the files are expected to register routes to a shared router on import.
     */
    async load(directory: string | URL | null = null): Promise<Router<S>["list"]> {
        if (this._loaded) return this.list;
        if (directory) {
            const dir = directory instanceof URL ? fileURLToPath(directory) : resolve(import.meta.dirname, directory);
            for await (const name of new Glob("*.ts").scan(dir)) {
                const path = import.meta.resolve(join(dir, name));
                await import(path);
            }
        }
        this._loaded = true;
        return this.list;
    }

    /** Start a new route. Chained {@link RouteChain.use | use} calls will only apply to this route. */
    new<R extends string>(path: R, method?: Serve.HTTPMethod): RouteChain<R, S> {
        const chain = new RouteChain<R, S>(this, path, method);
        for (const mw of this._middleware) chain.use(mw);
        return chain;
    }

    /** Remove middleware from all future routes in the router, does not affect already registered routes. The provided function must be the exact same function that was previously used. */
    unuseAll(middleware: Middleware<string, S>): this {
        this._middleware = this._middleware.filter(mw => mw !== middleware);
        return this;
    }

    /** Start a new middleware chain. Chained {@link MiddlewareChain.use | use} calls will only apply to this chain. */
    use(middleware: Middleware<string, S>): MiddlewareChain<S> {
        return new MiddlewareChain<S>(this).use(middleware);
    }

    /** Add middleware to all future routes in the router, does not apply retroactively. */
    useAll(middleware: Middleware<string, S>): this {
        this._middleware.push(middleware);
        return this;
    }
}

export class MiddlewareChain<S extends AnyBunServer = AnyBunServer> {
    middlewares: Array<Middleware<string, S>> = [];
    router: Router<S>;

    constructor(router: Router<S>) {
        this.router = router;
    }

    /** Start a new route. Chained {@link RouteChain.use | use} calls will only apply to this route. */
    new<R extends string>(path: R, method?: Serve.HTTPMethod): RouteChain<R, S> {
        const chain = new RouteChain<R, S>(this.router, path, method);
        for (const mw of this.middlewares) chain.use(mw);
        return chain;
    }

    /** Remove middleware from this chain. The provided function must be the exact same function that was previously used. */
    unuse(middleware: Middleware<string, S>): this {
        this.middlewares = this.middlewares.filter(mw => mw !== middleware);
        return this;
    }

    /** Add middleware to this chain. Chained {@link RouteChain.use | use} calls will only apply to routes created from this chain. */
    use(middleware: Middleware<string, S>): this {
        this.middlewares.push(middleware);
        return this;
    }
}

export class RouteChain<R extends string = string, S extends AnyBunServer = AnyBunServer> {
    handler!: Handler<R, S>;
    method?: Serve.HTTPMethod;
    middlewares: Array<Middleware<R, S>> = [];
    path: R;
    router: Router<S>;

    constructor(router: Router<S>, path: R, method?: Serve.HTTPMethod) {
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

    private _next(index: number, req: BunRequest<R>, server: S): MaybePromise<Response> {
        if (index < this.middlewares.length) {
            const middleware = this.middlewares[index]!;
            return middleware(req, server, (nextReq, nextServer) => this._next(index + 1, nextReq, nextServer));
        } else {
            return this.handler(req, server);
        }
    }

    /** @internal */
    _run(req: BunRequest<R>, server: S): MaybePromise<Response> {
        return Promise.resolve(this._next(0, req, server)).catch(this._handleError.bind(this, "pipeline"));
    }

    /** Handle a request for this route. This ends the chain. */
    handle(func: Handler<R, S>): Router<S> {
        this.handler = func;
        this.router._add(this);
        return this.router;
    }

    /** Add middleware to this route. Chained {@link RouteChain.use | use} calls will only apply to this route. */
    use(middleware: Middleware<R, S>): this {
        this.middlewares.push(middleware);
        return this;
    }
}
