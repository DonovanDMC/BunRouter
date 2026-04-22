import type { Middleware } from "../Router.js";

export interface RequestIdOptions {
    generator?: () => string;
    headerName?: string;
    includeInRequest?: boolean;
    includeInResponse?: boolean;
    overwrite?: boolean;
}

interface RequestIdMiddleware extends Middleware {
    (options: RequestIdOptions): Middleware;
}

function createRequestId({
    generator = (): string => crypto.randomUUID(),
    headerName = "x-request-id",
    includeInRequest = true,
    includeInResponse = true,
    overwrite = false,
}: RequestIdOptions = {}): Middleware {
    return async (req, server, next) => {
        const existing = req.headers.get(headerName);
        const requestId = (!overwrite && existing) ? existing : generator();

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

const defaultRequestId = createRequestId();
const RequestId: RequestIdMiddleware = ((arg1, arg2, arg3) => {
    if (arg1 instanceof Request) {
        return defaultRequestId(arg1, arg2, arg3);
    }

    return createRequestId(arg1);
}) as RequestIdMiddleware;

export default RequestId;
