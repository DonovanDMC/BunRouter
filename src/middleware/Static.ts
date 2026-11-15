import { stat } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import type { Middleware } from "../Router.js";
import type { BunFile, BunRequest } from "bun";
import type { Stats } from "node:fs";

export interface StaticOptions {
    /** Serve files and directories whose name starts with a dot. Defaults to `false`, in which case they fall through. */
    dotfiles?: boolean;
    /** Call `next` when no file is found. When `false`, a `404` is returned instead. Defaults to `true`. */
    fallthrough?: boolean;
    /** Extra headers to set on every served file. */
    headers?: Record<string, string> | ((path: string, file: BunFile) => Record<string, string> | undefined);
    /** Add `immutable` to the `cache-control` header. */
    immutable?: boolean;
    /** File names to look for when a directory is requested. Defaults to `["index.html"]`, `false` disables. */
    index?: Array<string> | string | false;
    /** `cache-control` max-age in seconds. Defaults to `0`. */
    maxAge?: number;
    /** URL prefix to strip before mapping the path onto `root`. Defaults to `/`. */
    prefix?: string;
    /** Redirect directory requests without a trailing slash to the slashed URL. Defaults to `true`. */
    redirect?: boolean;
    /** Directory to serve files from. Relative paths are resolved against the current working directory. */
    root: string | URL;
}

const methods = new Set(["GET", "HEAD"]);

function normalizePrefix(prefix: string): string {
    const trimmed = prefix.replace(/\/+$/, "");
    if (!trimmed) return "";
    return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

async function statOrNull(path: string): Promise<Stats | null> {
    try {
        return await stat(path);
    } catch {
        return null;
    }
}

// only single ranges are supported, anything else gets the full file
function parseRange(header: string, size: number): { end: number; start: number } | null | false {
    const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
    if (!match || (!match[1] && !match[2])) return null;

    let start: number;
    let end: number;
    if (match[1]) {
        start = Number(match[1]);
        end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
    } else {
        // suffix range, the last n bytes
        start = Math.max(size - Number(match[2]), 0);
        end = size - 1;
    }

    if (start > end || start >= size) return false;
    return { end, start };
}

export default function Static<Path extends string = string, WebSocketData = unknown>({
    dotfiles = false,
    fallthrough = true,
    headers: extraHeaders,
    immutable = false,
    index = ["index.html"],
    maxAge = 0,
    prefix = "/",
    redirect = true,
    root,
}: StaticOptions): Middleware<Path, WebSocketData> {
    const rootDir = resolve(root instanceof URL ? fileURLToPath(root) : root);
    const urlPrefix = normalizePrefix(prefix);
    const indexFiles = index === false ? [] : (Array.isArray(index) ? index : [index]);
    const cacheControl = `public, max-age=${Math.max(Math.floor(maxAge), 0)}${immutable ? ", immutable" : ""}`;

    const notFound = (req: BunRequest<Path>, server: Bun.Server<WebSocketData>, next: (req: BunRequest<Path>, server: Bun.Server<WebSocketData>) => Bun.MaybePromise<Response>): Bun.MaybePromise<Response> =>
        fallthrough ? next(req, server) : new Response("Not Found", { status: 404 });

    return async (req, server, next) => {
        if (!methods.has(req.method.toUpperCase())) {
            return next(req, server);
        }

        const url = new URL(req.url);
        let pathname: string;
        try {
            pathname = decodeURIComponent(url.pathname);
        } catch {
            return new Response("Bad Request", { status: 400 });
        }

        if (pathname.includes("\0")) {
            return new Response("Bad Request", { status: 400 });
        }

        if (urlPrefix && pathname !== urlPrefix && !pathname.startsWith(`${urlPrefix}/`)) {
            return next(req, server);
        }

        const relative = pathname.slice(urlPrefix.length);
        if (!dotfiles && relative.split("/").some(segment => segment.startsWith(".") && segment !== "." && segment !== "..")) {
            return notFound(req, server, next);
        }

        let filePath = join(rootDir, relative);
        if (filePath !== rootDir && !filePath.startsWith(rootDir + sep)) {
            return notFound(req, server, next);
        }

        let stats = await statOrNull(filePath);
        if (stats?.isDirectory()) {
            if (redirect && !url.pathname.endsWith("/")) {
                const location = new URL(url);
                location.pathname += "/";
                return new Response(null, { headers: { location: location.pathname + location.search }, status: 301 });
            }

            const dir = filePath;
            stats = null;
            for (const name of indexFiles) {
                const candidate = join(dir, name);
                const candidateStats = await statOrNull(candidate);
                if (candidateStats?.isFile()) {
                    filePath = candidate;
                    stats = candidateStats;
                    break;
                }
            }
        }

        if (!stats?.isFile()) {
            return notFound(req, server, next);
        }

        const file = Bun.file(filePath);
        const headers = new Headers({
            "accept-ranges": "bytes",
            "cache-control": cacheControl,
            "content-type": file.type,
            "last-modified": stats.mtime.toUTCString(),
        });

        const custom = typeof extraHeaders === "function" ? extraHeaders(filePath, file) : extraHeaders;
        if (custom) {
            for (const [key, value] of Object.entries(custom)) headers.set(key, value);
        }

        // if-none-match takes priority, leave that to the ETag middleware
        const ifModifiedSince = req.headers.get("if-modified-since");
        if (ifModifiedSince && !req.headers.has("if-none-match")) {
            const since = Date.parse(ifModifiedSince);
            // http dates only have second precision
            if (!Number.isNaN(since) && Math.floor(stats.mtimeMs / 1000) * 1000 <= since) {
                headers.delete("content-type");
                return new Response(null, { headers, status: 304 });
            }
        }

        const size = stats.size;
        const rangeHeader = req.headers.get("range");
        const range = rangeHeader ? parseRange(rangeHeader, size) : null;
        if (range === false) {
            headers.set("content-range", `bytes */${size}`);
            return new Response(null, { headers, status: 416 });
        }

        if (range) {
            headers.set("content-range", `bytes ${range.start}-${range.end}/${size}`);
            headers.set("content-length", String(range.end - range.start + 1));
            const body = req.method.toUpperCase() === "HEAD" ? null : file.slice(range.start, range.end + 1);
            return new Response(body, { headers, status: 206 });
        }

        headers.set("content-length", String(size));
        return new Response(req.method.toUpperCase() === "HEAD" ? null : file, { headers, status: 200 });
    };
}
