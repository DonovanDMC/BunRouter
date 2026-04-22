import type { AnyBunServer, Middleware } from "../Router.js";
import type { BunRequest, MaybePromise } from "bun";

export interface RateLimitEntry {
    count: number;
    resetAt: number;
}

export interface RateLimitStore {
    delete(key: string): void;
    get(key: string): RateLimitEntry | undefined;
    set(key: string, value: RateLimitEntry): void;
}

export interface RateLimitOptions<T extends string = string, S extends AnyBunServer = AnyBunServer> {
    headers?: boolean;
    key?: (req: BunRequest<T>, server: S) => MaybePromise<string>;
    limit: number;
    message?: string;
    skip?: (req: BunRequest<T>, server: S) => MaybePromise<boolean>;
    status?: number;
    store?: RateLimitStore;
    windowMs: number;
}

function defaultKey<T extends string>(req: BunRequest<T>): string {
    return req.headers.get("cf-connecting-ip")
        ?? req.headers.get("x-real-ip")
        ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
        ?? "global";
}

function makeRateLimitHeaders(limit: number, remaining: number, resetAt: number): Record<string, string> {
    return {
        "x-ratelimit-limit": String(limit),
        "x-ratelimit-remaining": String(Math.max(remaining, 0)),
        "x-ratelimit-reset": String(Math.ceil(resetAt / 1000)),
    };
}

export default function RateLimit<T extends string = string, S extends AnyBunServer = AnyBunServer>({
    headers = true,
    key = defaultKey,
    limit,
    message = "Too many requests",
    skip,
    status = 429,
    store = new Map<string, RateLimitEntry>(),
    windowMs,
}: RateLimitOptions<T, S>): Middleware<T, S> {
    if (!Number.isInteger(limit) || limit <= 0) {
        throw new TypeError("RateLimit limit must be a positive integer");
    }
    if (!Number.isFinite(windowMs) || windowMs <= 0) {
        throw new TypeError("RateLimit windowMs must be a positive finite number");
    }

    return async (req, server, next) => {
        if (skip && await skip(req, server)) {
            return next(req, server);
        }

        const now = Date.now();
        const bucketKey = await key(req, server);
        const current = store.get(bucketKey);
        const entry = (!current || current.resetAt <= now)
            ? { count: 0, resetAt: now + windowMs }
            : current;

        entry.count += 1;
        store.set(bucketKey, entry);

        const remaining = limit - entry.count;
        if (entry.count > limit) {
            return Response.json(
                { message },
                {
                    headers: headers ? makeRateLimitHeaders(limit, remaining, entry.resetAt) : undefined,
                    status,
                },
            );
        }

        const response = await next(req, server);
        if (headers) {
            for (const [header, value] of Object.entries(makeRateLimitHeaders(limit, remaining, entry.resetAt))) {
                response.headers.set(header, value);
            }
        }

        return response;
    };
}
