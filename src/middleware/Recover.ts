import type { Middleware } from "../Router.js";
import type { BunRequest, MaybePromise } from "bun";

export interface RecoverOptions<T extends string = string> {
    handler?: (error: unknown, req: BunRequest<T>) => MaybePromise<Response>;
    log?: boolean | ((error: unknown, req: BunRequest<T>) => MaybePromise<void>);
}

interface RecoverMiddleware extends Middleware {
    <T extends string = string>(options: RecoverOptions<T>): Middleware<T>;
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

function createRecover<T extends string = string>({
    handler = (error): Response => defaultResponse(error),
    log = false,
}: RecoverOptions<T> = {}): Middleware<T> {
    return async (req, server, next) => {
        try {
            return await next(req, server);
        } catch (error) {
            if (typeof log === "function") {
                await log(error, req);
            } else if (log) {
                console.error(`Recovered error for ${req.method} ${req.url}:`, error);
            }

            return handler(error, req);
        }
    };
}

const defaultRecover = createRecover();
const Recover: RecoverMiddleware = ((arg1, arg2, arg3) => {
    if (arg1 instanceof Request) {
        return defaultRecover(arg1, arg2, arg3);
    }

    return createRecover(arg1);
}) as RecoverMiddleware;

export default Recover;
