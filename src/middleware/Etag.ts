import { Buffer } from "node:buffer";

import type { Middleware } from "../Router.js";
import type { BunRequest, MaybePromise } from "bun";

export interface ETagOptions<T extends string = string> {
    generator?: (body: ArrayBuffer, response: Response, req: BunRequest<T>) => MaybePromise<string | null | undefined>;
    methods?: Array<string>;
    weak?: boolean;
}

interface ETagMiddleware extends Middleware {
    <T extends string = string>(options: ETagOptions<T>): Middleware<T>;
}

const defaultMethods = new Set(["GET", "HEAD"]);

function formatTag(value: string, weak: boolean): string {
    return `${weak ? "W/" : ""}"${value.replaceAll("\"", "")}"`;
}

function normalizeHeaderValue(header: string): Array<string> {
    return header
        .split(",")
        .map(value => value.trim())
        .filter(Boolean);
}

function matchesIfNoneMatch(header: string | null, tag: string): boolean {
    if (!header) return false;
    const values = normalizeHeaderValue(header);
    return values.includes("*") || values.includes(tag);
}

async function defaultGenerator(body: ArrayBuffer, weak: boolean): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-1", body);
    return formatTag(Buffer.from(digest).toString("hex"), weak);
}

function createETag<T extends string = string>({
    generator,
    methods = [...defaultMethods],
    weak = false,
}: ETagOptions<T> = {}): Middleware<T> {
    const methodSet = new Set(methods.map(method => method.toUpperCase()));

    return async (req, server, next) => {
        if (!methodSet.has(req.method.toUpperCase())) {
            return next(req, server);
        }

        const response = await next(req, server);
        if (!response.ok || response.status === 204 || response.status === 205 || response.status === 304) {
            return response;
        }

        const tag = response.headers.get("etag") ?? await (async () => {
            const body = await response.clone().arrayBuffer();
            const generated = await generator?.(body, response, req);
            return generated ? formatTag(generated, weak) : defaultGenerator(body, weak);
        })();

        response.headers.set("etag", tag);
        if (!matchesIfNoneMatch(req.headers.get("if-none-match"), tag)) {
            return response;
        }

        const headers = new Headers(response.headers);
        headers.delete("content-length");
        return new Response(null, { headers, status: 304 });
    };
}

const defaultETag = createETag();
const ETag: ETagMiddleware = ((arg1, arg2, arg3) => {
    if (arg1 instanceof Request) {
        return defaultETag(arg1, arg2, arg3);
    }

    return createETag(arg1);
}) as ETagMiddleware;

export default ETag;
