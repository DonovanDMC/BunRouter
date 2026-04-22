import type { Middleware } from "../Router.js";
import type { BunRequest } from "bun";

export interface MethodOverrideOptions {
    allowedMethods?: Array<string>;
    headerName?: string;
    originalMethodHeader?: string | null;
    queryParameter?: string | null;
}

interface MethodOverrideMiddleware extends Middleware {
    (options: MethodOverrideOptions): Middleware;
}

function getOverriddenMethod(req: Request, headerName: string, queryParameter: string | null): string | null {
    const fromHeader = req.headers.get(headerName);
    if (fromHeader) return fromHeader.toUpperCase();
    if (!queryParameter) return null;

    const url = new URL(req.url);
    const fromQuery = url.searchParams.get(queryParameter);
    return fromQuery?.toUpperCase() ?? null;
}

function withMethod<T extends string>(req: BunRequest<T>, method: string, originalMethodHeader: string | null): BunRequest<T> {
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

function createMethodOverride({
    allowedMethods = ["POST"],
    headerName = "x-http-method-override",
    originalMethodHeader = "x-original-method",
    queryParameter = "_method",
}: MethodOverrideOptions = {}): Middleware {
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

const defaultMethodOverride = createMethodOverride();
const MethodOverride: MethodOverrideMiddleware = ((arg1, arg2, arg3) => {
    if (arg1 instanceof Request) {
        return defaultMethodOverride(arg1, arg2, arg3);
    }

    return createMethodOverride(arg1);
}) as MethodOverrideMiddleware;

export default MethodOverride;
