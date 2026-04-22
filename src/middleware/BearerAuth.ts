import type { AnyBunServer, Middleware } from "../Router.js";
import type { BunRequest, MaybePromise } from "bun";

export interface BearerAuthOptions<T extends string = string, S extends AnyBunServer = AnyBunServer> {
    error?: string;
    message?: string;
    realm?: string;
    status?: number;
    validate: (token: string, req: BunRequest<T>, server: S) => MaybePromise<boolean | Response>;
}

function unauthorizedResponse(realm: string, message: string, status: number, error?: string): Response {
    const challenge = [`Bearer realm="${realm.replaceAll("\"", "\\\"")}"`];
    if (error) challenge.push(`error="${error.replaceAll("\"", "\\\"")}"`);

    return Response.json(
        { message },
        {
            headers: {
                "www-authenticate": challenge.join(", "),
            },
            status,
        },
    );
}

function parseBearerToken(value: string | null): string | null {
    if (!value) return null;

    const [scheme, token] = value.split(/\s+/, 2);
    if (!scheme || !token || scheme.toLowerCase() !== "bearer") return null;
    return token;
}

export default function BearerAuth<T extends string = string, S extends AnyBunServer = AnyBunServer>({
    error = "invalid_token",
    message = "Unauthorized",
    realm = "Restricted",
    status = 401,
    validate,
}: BearerAuthOptions<T, S>): Middleware<T, S> {
    return async (req, server, next) => {
        const token = parseBearerToken(req.headers.get("authorization"));
        if (!token) {
            return unauthorizedResponse(realm, message, status, error);
        }

        const result = await validate(token, req, server);
        if (result instanceof Response) return result;
        if (!result) {
            return unauthorizedResponse(realm, message, status, error);
        }

        return next(req, server);
    };
}
