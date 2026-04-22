import type { Middleware } from "../Router.js";
import type { BunRequest, MaybePromise } from "bun";

export interface MethodOverrideOptions {
    allowedMethods?: Array<string>;
    headerName?: string;
    originalMethodHeader?: string | null;
    queryParameter?: string | null;
}

function getOverriddenMethod(req: Request, headerName: string, queryParameter: string | null): string | null {
    const fromHeader = req.headers.get(headerName);
    if (fromHeader) return fromHeader.toUpperCase();
    if (!queryParameter) return null;

    const url = new URL(req.url);
    const fromQuery = url.searchParams.get(queryParameter);
    return fromQuery?.toUpperCase() ?? null;
}

function withMethod<Path extends string = string>(req: BunRequest<Path>, method: string, originalMethodHeader: string | null): BunRequest<Path> {
    const headers = new Headers(req.headers);
    if (originalMethodHeader) headers.set(originalMethodHeader, req.method);

    const proxy = new Proxy(req, {
        get(target, property, receiver): unknown {
            if (property === "method") return method;
            if (property === "headers") return headers;

            const value: unknown = Reflect.get(target, property, receiver);
            return typeof value === "function" ? value.bind(target) : value;
        },
    });

    return proxy;
}

function createMethodOverride<Path extends string = string, WebSocketData = unknown>({
    allowedMethods = ["POST"],
    headerName = "x-http-method-override",
    originalMethodHeader = "x-original-method",
    queryParameter = "_method",
}: MethodOverrideOptions = {}): Middleware<Path, WebSocketData> {
    const allowed = new Set(allowedMethods.map(method => method.toUpperCase()));

    return (req, server, next) => {
        if (!allowed.has(req.method.toUpperCase())) {
            return next(req, server);
        }

        const override = getOverriddenMethod(req, headerName, queryParameter);
        if (!override || override === req.method.toUpperCase()) {
            return next(req, server);
        }

        return next(withMethod(req, override, originalMethodHeader), server);
    };
}

function MethodOverride<Path extends string = string, WebSocketData = unknown>(req: BunRequest<Path>, server: Bun.Server<WebSocketData>, next: (req: BunRequest<Path>, server: Bun.Server<WebSocketData>) => MaybePromise<Response>): MaybePromise<Response>;
function MethodOverride<Path extends string = string, WebSocketData = unknown>(options: MethodOverrideOptions): Middleware<Path, WebSocketData>;
function MethodOverride<Path extends string = string, WebSocketData = unknown>(
    arg1: BunRequest<Path> | MethodOverrideOptions,
    arg2?: Bun.Server<WebSocketData>,
    arg3?: (req: BunRequest<Path>, server: Bun.Server<WebSocketData>) => MaybePromise<Response>,
): MaybePromise<Response> | Middleware<Path, WebSocketData> {
    if (arg1 instanceof Request) {
        return createMethodOverride<Path, WebSocketData>()(arg1, arg2!, arg3!);
    }

    return createMethodOverride<Path, WebSocketData>(arg1);
}

export default MethodOverride;
