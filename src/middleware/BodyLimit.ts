import type { Middleware } from "../Router.js";
import type { BunRequest } from "bun";

export interface BodyLimitOptions {
    maxBytes: number;
    message?: string;
    status?: number;
}

function limitExceededResponse(message: string, status: number): Response {
    return Response.json({ message }, { status });
}

async function exceedsBodyLimit<Path extends string = string>(req: BunRequest<Path>, maxBytes: number): Promise<boolean> {
    const clone = req.clone();
    const reader = clone.body?.getReader() as ReadableStreamDefaultReader<Uint8Array> | undefined;
    if (!reader) return false;

    let total = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) return false;
            total += value.byteLength;
            if (total > maxBytes) return true;
        }
    } finally {
        reader.releaseLock();
        await clone.body?.cancel().catch(() => {});
    }
}

export default function BodyLimit<Path extends string = string, WebSocketData = unknown>({ maxBytes, message = "Request body too large", status = 413 }: BodyLimitOptions): Middleware<Path, WebSocketData> {
    if (!Number.isFinite(maxBytes) || maxBytes < 0) {
        throw new TypeError("BodyLimit maxBytes must be a non-negative finite number");
    }

    return async (req, server, next) => {
        const contentLength = req.headers.get("content-length");
        if (contentLength) {
            const parsed = Number.parseInt(contentLength, 10);
            if (!Number.isNaN(parsed) && parsed > maxBytes) {
                return limitExceededResponse(message, status);
            }
        }

        if (req.body && await exceedsBodyLimit<Path>(req, maxBytes)) {
            return limitExceededResponse(message, status);
        }

        return next(req, server);
    };
}
