import type { Middleware } from "../Router.js";
import type { MaybePromise } from "bun";

export interface CORSOptions {
    allowCredentials?: boolean;
    allowHeaders?: Array<string> | string;
    allowMethods?: Array<string> | string;
    exposeHeaders?: Array<string> | string;
    maxAge?: number;
    origin?: string | Array<string> | ((origin: string | null, req: Request) => MaybePromise<string | null | false | undefined>);
}

interface CORSMiddleware extends Middleware {
    (options: CORSOptions): Middleware;
}

function normalizeHeaderList(value?: Array<string> | string): string | null {
    if (!value) return null;
    return Array.isArray(value) ? value.join(", ") : value;
}

async function resolveOrigin(originConfig: CORSOptions["origin"], req: Request): Promise<string | null> {
    const requestOrigin = req.headers.get("origin");
    if (!originConfig || originConfig === "*") return "*";
    if (typeof originConfig === "function") {
        const resolved = await originConfig(requestOrigin, req);
        if (!resolved) return null;
        return resolved;
    }
    if (Array.isArray(originConfig)) {
        if (!requestOrigin || !originConfig.includes(requestOrigin)) return null;
        return requestOrigin;
    }
    return originConfig;
}

function applyCorsHeaders(req: Request, headers: Headers, resolvedOrigin: string, options: CORSOptions): void {
    headers.set("access-control-allow-origin", resolvedOrigin);

    if (resolvedOrigin !== "*") {
        headers.append("vary", "origin");
    }

    const allowMethods = normalizeHeaderList(options.allowMethods);
    if (allowMethods) headers.set("access-control-allow-methods", allowMethods);

    const allowHeaders = normalizeHeaderList(options.allowHeaders) ?? req.headers.get("access-control-request-headers");
    if (allowHeaders) {
        headers.set("access-control-allow-headers", allowHeaders);
        headers.append("vary", "access-control-request-headers");
    }

    const exposeHeaders = normalizeHeaderList(options.exposeHeaders);
    if (exposeHeaders) headers.set("access-control-expose-headers", exposeHeaders);

    if (options.allowCredentials) headers.set("access-control-allow-credentials", "true");
    if (options.maxAge !== undefined) headers.set("access-control-max-age", String(options.maxAge));
}

function createCORS(options: CORSOptions = {}): Middleware {
    return async (req, server, next) => {
        const resolvedOrigin = await resolveOrigin(options.origin, req);
        if (!resolvedOrigin) {
            if (req.method === "OPTIONS" && req.headers.has("access-control-request-method")) {
                return new Response(null, { status: 403 });
            }
            return next(req, server);
        }

        if (req.method === "OPTIONS" && req.headers.has("access-control-request-method")) {
            const headers = new Headers();
            applyCorsHeaders(req, headers, resolvedOrigin, options);
            return new Response(null, { headers, status: 204 });
        }

        const response = await next(req, server);
        applyCorsHeaders(req, response.headers, resolvedOrigin, options);
        return response;
    };
}

const defaultCORS = createCORS();
const CORS: CORSMiddleware = ((arg1, arg2, arg3) => {
    if (arg1 instanceof Request) {
        return defaultCORS(arg1, arg2, arg3);
    }

    return createCORS(arg1);
}) as CORSMiddleware;

export default CORS;
