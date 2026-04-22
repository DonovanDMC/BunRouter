import type { Middleware } from "../Router.js";
import type { BunRequest, MaybePromise } from "bun";

export interface BearerAuthOptions<Path extends string = string, WebSocketData = unknown> {
    error?: string;
    message?: string;
    realm?: string;
    status?: number;
    validate: (token: string, req: BunRequest<Path>, server: Bun.Server<WebSocketData>) => MaybePromise<boolean | Response>;
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

export default function BearerAuth<Path extends string = string, WebSocketData = unknown>({
    error = "invalid_token",
    message = "Unauthorized",
    realm = "Restricted",
    status = 401,
    validate,
}: BearerAuthOptions<Path, WebSocketData>): Middleware<Path, WebSocketData> {
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
