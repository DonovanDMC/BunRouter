import { Buffer } from "node:buffer";

import type { Middleware } from "../Router.js";
import type { BunRequest, MaybePromise } from "bun";

export interface BasicAuthOptions<Path extends string = string, WebSocketData = unknown> {
    message?: string;
    realm?: string;
    status?: number;
    validate: (username: string, password: string, req: BunRequest<Path>, server: Bun.Server<WebSocketData>) => MaybePromise<boolean | Response>;
}

function unauthorizedResponse(realm: string, message: string, status: number): Response {
    return Response.json(
        { message },
        {
            headers: {
                "www-authenticate": `Basic realm="${realm.replaceAll("\"", "\\\"")}"`,
            },
            status,
        },
    );
}

function parseBasicAuthorization(value: string | null): { password: string; username: string } | null {
    if (!value) return null;

    const [scheme, token] = value.split(/\s+/, 2);
    if (!scheme || !token || scheme.toLowerCase() !== "basic") return null;

    let decoded: string;
    try {
        decoded = Buffer.from(token, "base64").toString("utf8");
    } catch {
        return null;
    }

    const separator = decoded.indexOf(":");
    if (separator < 0) return null;

    return {
        password: decoded.slice(separator + 1),
        username: decoded.slice(0, separator),
    };
}

export default function BasicAuth<Path extends string = string, WebSocketData = unknown>({
    message = "Unauthorized",
    realm = "Restricted",
    status = 401,
    validate,
}: BasicAuthOptions<Path, WebSocketData>): Middleware<Path, WebSocketData> {
    return async (req, server, next) => {
        const credentials = parseBasicAuthorization(req.headers.get("authorization"));
        if (!credentials) {
            return unauthorizedResponse(realm, message, status);
        }

        const result = await validate(credentials.username, credentials.password, req, server);
        if (result instanceof Response) return result;
        if (!result) {
            return unauthorizedResponse(realm, message, status);
        }

        return next(req, server);
    };
}
