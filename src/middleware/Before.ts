import type { AnyBunServer } from "../Router.js";
import type { BunRequest, MaybePromise } from "bun";

export type BeforeHandler = <T extends string = string>(req: BunRequest<T>) => MaybePromise<void>;

export default function Before(handler: BeforeHandler) {
    return <T extends string, S extends AnyBunServer = AnyBunServer>(req: BunRequest<T>, server: S, next: (req: BunRequest<T>, server: S) => MaybePromise<Response>): Promise<Response> => {
        return Promise.resolve(handler(req)).then(() => next(req, server));
    };
}
