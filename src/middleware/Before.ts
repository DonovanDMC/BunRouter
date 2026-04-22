import type { Middleware } from "../Router.js";
import type { BunRequest, MaybePromise } from "bun";

export type BeforeHandler<Path extends string = string> = (req: BunRequest<Path>) => MaybePromise<void>;

export default function Before<Path extends string = string, WebSocketData = unknown>(handler: BeforeHandler<Path>): Middleware<Path, WebSocketData> {
    return (req, server, next): Promise<Response> => {
        return Promise.resolve(handler(req)).then(() => next(req, server));
    };
}
