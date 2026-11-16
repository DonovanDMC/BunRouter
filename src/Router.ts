import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type StripSuffix<S extends string> = S extends `:${infer P}.${string}` ? `:${P}` : S;
/** The path with param suffixes removed, `/files/:name.css` becomes `/files/:name`. Routes are typed with this, so `req.params` doesn't include the suffix. */
export type RoutePath<R extends string> = string extends R ? R : R extends `${infer Segment}/${infer Rest}` ? `${StripSuffix<Segment>}/${RoutePath<Rest>}` : StripSuffix<R>;
export type Middleware<R extends string = string, WebSocketData = unknown> = (req: Bun.BunRequest<R>, server: Bun.Server<WebSocketData>, next: Handler<R, WebSocketData>) => Bun.MaybePromise<Response>;
export type Handler<R extends string = string, WebSocketData = unknown> = (req: Bun.BunRequest<R>, server: Bun.Server<WebSocketData>) => Bun.MaybePromise<Response>;

type BunHandler<WebSocketData> = Bun.Serve.Handler<Bun.BunRequest, Bun.Server<WebSocketData>, Response>;
interface Param {
    name: string;
    suffix: string;
}
interface Entry<WebSocketData> {
    chain: RouteChain<string, WebSocketData>;
    params: Array<Param>;
    // nothing to check or rename, the request can be passed through as-is
    passthrough: boolean;
    specificity: number;
}
interface Group<WebSocketData> {
    entries: Array<Entry<WebSocketData>>;
    names: Array<string>;
    path: string;
}

const paramSegment = /^:([^./]+)(\..+)?$/;

function parsePath(path: string): { key: string; params: Array<Param>; path: string } {
    const params: Array<Param> = [];
    const segments = path.split("/").map((segment) => {
        const match = paramSegment.exec(segment);
        if (!match) return { key: segment, path: segment };
        params.push({ name: match[1]!, suffix: match[2] ?? "" });
        return { key: ":", path: `:${match[1]}` };
    });
    return {
        key: segments.map(s => s.key).join("/"),
        params,
        path: segments.map(s => s.path).join("/"),
    };
}

export default class Router<WebSocketData = unknown> {
    private _groups = new Map<string, Group<WebSocketData>>();
    private _loaded = false;
    private _middleware: Array<Middleware<string, WebSocketData>> = [];
    private _notFound: Handler<string, WebSocketData> | null = null;
    private list: Record<string, Partial<Record<Bun.Serve.HTTPMethod, BunHandler<WebSocketData>>>> = {};

    private _build(group: Group<WebSocketData>): BunHandler<WebSocketData> | Partial<Record<Bun.Serve.HTTPMethod, BunHandler<WebSocketData>>> {
        const { entries } = group;
        if (entries.length === 1 && entries[0]!.passthrough) {
            const { chain } = entries[0]!;
            const handler: BunHandler<WebSocketData> = (req, server) => chain._run(req, server);
            return chain.method === undefined ? handler : { [chain.method]: handler };
        }

        if (entries.some(e => e.chain.method === undefined)) {
            return (req, server) => this._dispatch(group, entries.filter(e => e.chain.method === undefined || e.chain.method === req.method || (req.method === "HEAD" && e.chain.method === "GET")), req, server);
        }

        const methods: Partial<Record<Bun.Serve.HTTPMethod, BunHandler<WebSocketData>>> = {};
        for (const method of new Set(entries.map(e => e.chain.method!))) {
            const candidates = entries.filter(e => e.chain.method === method);
            const handler: BunHandler<WebSocketData> = (req, server) => this._dispatch(group, candidates, req, server);
            methods[method] = handler;
        }
        return methods;
    }

    private _dispatch(group: Group<WebSocketData>, entries: Array<Entry<WebSocketData>>, req: Bun.BunRequest, server: Bun.Server<WebSocketData>): Bun.MaybePromise<Response> {
        const values = group.names.map(name => (req.params as Record<string, string>)[name]!);
        candidates: for (const entry of entries) {
            if (entry.passthrough) return entry.chain._run(req, server);

            const params: Record<string, string> = {};
            for (const [i, { name, suffix }] of entry.params.entries()) {
                const value = values[i]!;
                if (value.length <= suffix.length || !value.endsWith(suffix)) continue candidates;
                params[name] = value.slice(0, value.length - suffix.length);
            }
            Object.defineProperty(req, "params", { configurable: true, value: params, writable: true });
            return entry.chain._run(req, server);
        }

        return this._notFound ? this._notFound(req, server) : new Response("Not Found", { status: 404 });
    }

    // Bun only matches whole segments for params, and silently replaces routes that only differ by param names,
    // so routes are grouped by their shape and dispatched by param suffix here
    _add<R extends string = string>(route: RouteChain<R, WebSocketData>): void {
        const parsed = parsePath(route.path);
        let group = this._groups.get(parsed.key);
        if (!group) {
            group = { entries: [], names: parsed.params.map(p => p.name), path: parsed.path };
            this._groups.set(parsed.key, group);
        }

        const signature = parsed.params.map(p => p.suffix).join("/");
        for (const entry of group.entries) {
            if (entry.params.map(p => p.suffix).join("/") !== signature) continue;
            if (route.method === undefined || entry.chain.method === undefined || entry.chain.method === route.method) {
                throw new Error(`Route ${route.method === undefined ? "" : `${route.method} `}${route.path} conflicts with ${entry.chain.method === undefined ? "" : `${entry.chain.method} `}${entry.chain.path}`);
            }
        }

        group.entries.push({
            chain: route as never,
            params: parsed.params,
            passthrough: parsed.params.every((p, i) => p.suffix === "" && p.name === group.names[i]),
            specificity: parsed.params.reduce((total, p) => total + p.suffix.length, 0),
        });
        // longest suffixes first, method specific routes before method-less ones
        group.entries.sort((a, b) => (b.specificity - a.specificity) || (Number(a.chain.method === undefined) - Number(b.chain.method === undefined)));

        this.list[group.path] = this._build(group) as never;
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
    new<P extends string = string>(path: P, method?: Bun.Serve.HTTPMethod): RouteChain<RoutePath<P>, WebSocketData> {
        const chain = new RouteChain<RoutePath<P>, WebSocketData>(this, path, method);
        for (const mw of this._middleware) chain.use(mw as never);
        return chain;
    }

    /** Handler used when a request matches a route's path, but none of its param suffixes (`/files/:name.css` for `/files/name.js`). Defaults to a plain `404`. */
    notFound(func: Handler<string, WebSocketData>): this {
        this._notFound = func;
        return this;
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
    new<P extends string = string>(path: P, method?: Bun.Serve.HTTPMethod): RouteChain<RoutePath<P>, WebSocketData> {
        const chain = new RouteChain<RoutePath<P>, WebSocketData>(this.router, path, method);
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
    /** The path as registered, including param suffixes. */
    path: string;
    router: Router<WebSocketData>;

    constructor(router: Router<WebSocketData>, path: string, method?: Bun.Serve.HTTPMethod) {
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
