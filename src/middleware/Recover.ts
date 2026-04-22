import type { Middleware } from "../Router.js";
import type { BunRequest, MaybePromise } from "bun";

export interface RecoverOptions<T extends string = string, WebSocketData = unknown> {
    handler?: (error: unknown, req: BunRequest<T>, server: Bun.Server<WebSocketData>) => MaybePromise<Response>;
    log?: boolean | ((error: unknown, req: BunRequest<T>, server: Bun.Server<WebSocketData>) => MaybePromise<void>);
}

function defaultResponse(error: unknown): Response {
    let message = `Unhandled error: ${String(error)}`;
    if (error instanceof Error) {
        message = `${error.name}: ${error.message}`;
        if (error.cause instanceof Error) {
            message += ` | Cause: ${error.cause.name}: ${error.cause.message}`;
        }
    }
    return Response.json({ message }, { status: 500 });
}

function createRecover<Path extends string = string, WebSocketData = unknown>({
    handler = (error): Response => defaultResponse(error),
    log = false,
}: RecoverOptions<Path, WebSocketData> = {}): Middleware<Path, WebSocketData> {
    return async (req, server, next) => {
        try {
            return await next(req, server);
        } catch (error) {
            if (typeof log === "function") {
                await log(error, req, server);
            } else if (log) {
                console.error(`Recovered error for ${req.method} ${req.url}:`, error);
            }

            return handler(error, req, server);
        }
    };
}

function Recover<Path extends string = string, WebSocketData = unknown>(req: BunRequest<Path>, server: Bun.Server<WebSocketData>, next: (req: BunRequest<Path>, server: Bun.Server<WebSocketData>) => MaybePromise<Response>): MaybePromise<Response>;
function Recover<Path extends string = string, WebSocketData = unknown>(options: RecoverOptions<Path, WebSocketData>): Middleware<Path, WebSocketData>;
function Recover<Path extends string = string, WebSocketData = unknown>(
    arg1: BunRequest<Path> | RecoverOptions<Path, WebSocketData>,
    arg2?: Bun.Server<WebSocketData>,
    arg3?: (req: BunRequest<Path>, server: Bun.Server<WebSocketData>) => MaybePromise<Response>,
): MaybePromise<Response> | Middleware<Path, WebSocketData> {
    if (arg1 instanceof Request) {
        return createRecover<Path, WebSocketData>()(arg1, arg2!, arg3!);
    }

    return createRecover(arg1);
}

export default Recover;
