import type { Middleware } from "../Router";

export default function ModifyRequest<Path extends string = string, WebSocketData = unknown>(handler: (req: Bun.BunRequest<Path>) => Bun.MaybePromise<Bun.BunRequest<Path>>): Middleware<Path, WebSocketData> {
    return async (req, server, next) => {
        return Promise.resolve(handler(req)).then(req => next(req, server));
    };
}
