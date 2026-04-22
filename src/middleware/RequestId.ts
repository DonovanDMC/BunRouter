import type { Middleware } from "../Router.js";
import type { BunRequest, MaybePromise } from "bun";

export interface RequestIdOptions<Path extends string = string, WebSocketData = unknown> {
    generator?: (req: Bun.BunRequest<Path>, server: Bun.Server<WebSocketData>) => string;
    headerName?: string;
    includeInRequest?: boolean;
    includeInResponse?: boolean;
    overwrite?: boolean;
}

function createRequestId<Path extends string = string, WebSocketData = unknown>({
    generator = (): string => crypto.randomUUID(),
    headerName = "x-request-id",
    includeInRequest = true,
    includeInResponse = true,
    overwrite = false,
}: RequestIdOptions<Path, WebSocketData> = {}): Middleware<Path, WebSocketData> {
    return async (req, server, next) => {
        const existing = req.headers.get(headerName);
        const requestId = (!overwrite && existing) ? existing : generator(req, server);

        if (includeInRequest && (overwrite || !existing)) {
            req.headers.set(headerName, requestId);
        }

        const response = await next(req, server);
        if (includeInResponse && (overwrite || !response.headers.has(headerName))) {
            response.headers.set(headerName, requestId);
        }
        return response;
    };
}

function RequestId<Path extends string = string, WebSocketData = unknown>(req: BunRequest<Path>, server: Bun.Server<WebSocketData>, next: (req: BunRequest<Path>, server: Bun.Server<WebSocketData>) => MaybePromise<Response>): MaybePromise<Response>;
function RequestId<Path extends string = string, WebSocketData = unknown>(options: RequestIdOptions<Path, WebSocketData>): Middleware<Path, WebSocketData>;
function RequestId<Path extends string = string, WebSocketData = unknown>(
    arg1: BunRequest<Path> | RequestIdOptions<Path, WebSocketData>,
    arg2?: Bun.Server<WebSocketData>,
    arg3?: (req: BunRequest<Path>, server: Bun.Server<WebSocketData>) => MaybePromise<Response>,
): MaybePromise<Response> | Middleware<Path, WebSocketData> {
    if (arg1 instanceof Request) {
        return createRequestId<Path, WebSocketData>()(arg1, arg2!, arg3!);
    }

    return createRequestId(arg1);
}

export default RequestId;
