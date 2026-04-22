import type { Middleware } from "../Router.js";
import type { BunRequest, MaybePromise } from "bun";

export type AfterHandler<Path extends string = string> = (req: BunRequest<Path>, res: Response) => MaybePromise<void>;

export default function After<Path extends string = string, WebSocketData = unknown>(handler: AfterHandler<Path>): Middleware<Path, WebSocketData> {
    return (req, server, next): Promise<Response> => {
        return Promise.resolve(next(req, server)).then(async (res) => {
            await Promise.resolve(handler(req, res));
            return res;
        });
    };
}
