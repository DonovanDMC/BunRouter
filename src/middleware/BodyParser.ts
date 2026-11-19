import type { AnyPathMiddleware } from "../Router.js";
import type { BusboyConfig, BusboyInstance } from "@fastify/busboy";

export type BodyType = "json" | "multipart" | "text" | "urlencoded";
export type FormBody = Record<string, File | string | Array<File | string>>;
/** What a body is parsed into before `parse` is called: a JSON value, a string for text, a {@link FormBody} for forms, or `undefined` when there's no body. */
export type RawBody = unknown;

export interface BodyParserOptions<T = RawBody> {
    /** Content types to parse, anything else gets a `415`. Defaults to all of them. */
    accept?: Array<BodyType>;
    /** Busboy limits for form bodies. Hitting any of them gets a `413`. */
    limits?: BusboyConfig["limits"];
    /** Max body size in bytes, `413` when exceeded. Defaults to 1MiB. Applies to form bodies as a whole, including files. */
    maxBytes?: number;
    /** Validate or transform the parsed body, its return value becomes `req.parsedBody`. Throwing gets a `400` with the error's message. */
    parse?: (raw: RawBody, req: Request) => T | Promise<T>;
}

class BodyError extends Error {
    status: number;
    constructor(status: number, message: string) {
        super(message);
        this.status = status;
    }
}

let Busboy: typeof import("@fastify/busboy").default | null = null;
async function loadBusboy(): Promise<typeof import("@fastify/busboy").default> {
    try {
        Busboy ??= (await import("@fastify/busboy")).default;
    } catch (err) {
        throw new Error("BunRouter: @fastify/busboy is required to parse form bodies", { cause: err });
    }
    return Busboy;
}

function getType(contentType: string): BodyType | null {
    const mime = contentType.split(";")[0]!.trim().toLowerCase();
    if (mime === "application/json" || mime.endsWith("+json")) return "json";
    if (mime === "multipart/form-data") return "multipart";
    if (mime === "application/x-www-form-urlencoded") return "urlencoded";
    if (mime.startsWith("text/")) return "text";
    return null;
}

// uses a reader, for await on the body threw inside bun for form bodies
async function* limited(body: ReadableStream<Uint8Array>, maxBytes: number): AsyncGenerator<Uint8Array> {
    const reader = body.getReader();
    let total = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) return;
            total += value.byteLength;
            if (total > maxBytes) throw new BodyError(413, "Request body too large");
            yield value;
        }
    } finally {
        await reader.cancel().catch(() => {});
    }
}

async function readText(body: ReadableStream<Uint8Array>, maxBytes: number, contentType: string): Promise<string> {
    const charset = /charset="?([^";]+)"?/i.exec(contentType)?.[1] ?? "utf-8";
    let decoder: TextDecoder;
    try {
        decoder = new TextDecoder(charset as Bun.Encoding);
    } catch {
        throw new BodyError(415, `Unsupported charset: ${charset}`);
    }

    let text = "";
    for await (const chunk of limited(body, maxBytes)) text += decoder.decode(chunk, { stream: true });
    return text + decoder.decode();
}

async function readForm(body: ReadableStream<Uint8Array>, maxBytes: number, contentType: string, limits: BusboyConfig["limits"]): Promise<FormBody> {
    const Parser = await loadBusboy();
    let bb: BusboyInstance;
    try {
        bb = new Parser({ headers: { "content-type": contentType }, limits });
    } catch (err) {
        throw new BodyError(400, err instanceof Error ? err.message : "Invalid form body");
    }

    // null prototype so field names like __proto__ are just fields
    const form = Object.create(null) as FormBody;
    const add = (name: string, value: File | string): void => {
        const existing = form[name];
        if (existing === undefined) form[name] = value;
        else if (Array.isArray(existing)) existing.push(value);
        else form[name] = [existing, value];
    };

    const pending: Array<Promise<void>> = [];
    const done = new Promise<void>((resolve, reject) => {
        const tooLarge = (): void => {
            reject(new BodyError(413, "Request body too large"));
        };
        bb.on("field", (name, value, nameTruncated, valueTruncated) => {
            if (nameTruncated || valueTruncated) tooLarge();
            else add(name, value);
        });
        bb.on("file", (name, stream, filename, _encoding, mimeType) => {
            const chunks: Array<Buffer> = [];
            stream.on("data", (chunk: Buffer) => {
                chunks.push(chunk);
            });
            pending.push(new Promise((resolveFile, rejectFile) => {
                stream.on("error", rejectFile);
                stream.on("end", () => {
                    if (stream.truncated) {
                        rejectFile(new BodyError(413, "Request body too large"));
                        return;
                    }
                    add(name, new File(chunks, filename, { type: mimeType }));
                    resolveFile();
                });
            }));
        });
        bb.on("partsLimit", tooLarge);
        bb.on("filesLimit", tooLarge);
        bb.on("fieldsLimit", tooLarge);
        bb.on("error", (err) => {
            reject(new BodyError(400, err instanceof Error ? err.message : "Invalid form body"));
        });
        bb.on("finish", resolve);
    });
    // so an early reject doesn't go unhandled while we're still writing
    done.catch(() => {});

    try {
        for await (const chunk of limited(body, maxBytes)) {
            if (!bb.write(chunk)) await Promise.race([new Promise(resolve => bb.once("drain", resolve)), done]);
        }
        bb.end();
        await done;
        await Promise.all(pending);
    } catch (err) {
        bb.destroy();
        throw err;
    }
    return form;
}

async function readBody(req: Request, type: BodyType, maxBytes: number, contentType: string, limits: BusboyConfig["limits"]): Promise<RawBody> {
    const body = req.body!;
    switch (type) {
        case "json": {
            const text = await readText(body, maxBytes, contentType);
            if (text === "") return undefined;
            try {
                return JSON.parse(text) as unknown;
            } catch {
                throw new BodyError(400, "Invalid JSON body");
            }
        }
        case "text": {
            return readText(body, maxBytes, contentType);
        }
        case "multipart":
        case "urlencoded": {
            return readForm(body, maxBytes, contentType, limits);
        }
    }
}

/**
 * Parses the request body into `req.parsedBody`. JSON is parsed with `JSON.parse`, text is decoded with the request's charset,
 * and form bodies (urlencoded and multipart) are parsed with `@fastify/busboy`, with files as `File` objects. Repeated form fields become arrays.
 */
export default function BodyParser<T = RawBody>({
    accept = ["json", "multipart", "text", "urlencoded"],
    limits,
    maxBytes = 1024 * 1024,
    parse,
}: BodyParserOptions<T> = {}): AnyPathMiddleware<{ parsedBody: T }> {
    if (Number.isNaN(maxBytes) || maxBytes < 0) {
        throw new TypeError("BodyParser maxBytes must be a non-negative number");
    }
    const accepted = new Set(accept);

    return async (req, server, next) => {
        let raw: RawBody;
        try {
            const contentType = req.headers.get("content-type") ?? "";
            const length = req.headers.get("content-length");
            if (length && Number.parseInt(length, 10) > maxBytes) throw new BodyError(413, "Request body too large");

            if (req.body === null || length === "0") {
                raw = undefined;
            } else {
                const type = getType(contentType);
                if (type === null || !accepted.has(type)) throw new BodyError(415, "Unsupported content type");
                raw = await readBody(req, type, maxBytes, contentType, limits);
            }
        } catch (err) {
            if (err instanceof BodyError) return Response.json({ message: err.message }, { status: err.status });
            throw err;
        }

        let parsedBody: T;
        try {
            parsedBody = parse ? await parse(raw, req) : raw as T;
        } catch (err) {
            return Response.json({ message: err instanceof Error ? err.message : "Invalid body" }, { status: 400 });
        }

        return next(Object.assign(req, { parsedBody }), server);
    };
}
