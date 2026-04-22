import type { Middleware } from "../Router";

export default function ModifyResponse<Path extends string = string, WebSocketData = unknown>(handler: (res: Response) => Bun.MaybePromise<Response>): Middleware<Path, WebSocketData> {
    return async (req, server, next) => {
        return Promise.resolve(next(req, server)).then(res => handler(res));
    };
}
