import type { AnyBunServer } from "../Router.js";
import type { BunRequest, MaybePromise } from "bun";

export type AfterHandler = <T extends string = string>(req: BunRequest<T>, res: Response) => MaybePromise<void>;

export default function After(handler: AfterHandler) {
    return <T extends string, S extends AnyBunServer = AnyBunServer>(req: BunRequest<T>, server: S, next: (req: BunRequest<T>, server: S) => MaybePromise<Response>): Promise<Response> => {
        return Promise.resolve(next(req, server)).then(async (res) => {
            await Promise.resolve(handler(req, res));
            return res;
        });
    };
}
