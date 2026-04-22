import type { Middleware } from "../Router.js";
import type { BunRequest, MaybePromise } from "bun";

export interface TimingOptions<Path extends string = string, WebSocketData = unknown> {
    description?: string;
    headerName?: string;
    log?: (durationMs: number, req: BunRequest<Path>, response: Response, server: Bun.Server<WebSocketData>) => MaybePromise<void>;
    metricName?: string;
    setHeader?: boolean;
}

function roundDuration(durationMs: number): string {
    return durationMs.toFixed(2);
}

function createTiming<Path extends string = string, WebSocketData = unknown>({
    description,
    headerName = "server-timing",
    log,
    metricName = "app",
    setHeader = true,
}: TimingOptions<Path, WebSocketData> = {}): Middleware<Path, WebSocketData> {
    return async (req, server, next) => {
        const startedAt = performance.now();
        const response = await next(req, server);
        const durationMs = performance.now() - startedAt;

        if (setHeader) {
            const parts = [`${metricName};dur=${roundDuration(durationMs)}`];
            if (description) parts.push(`desc="${description.replaceAll("\"", "\\\"")}"`);
            response.headers.append(headerName, parts.join(";"));
        }

        if (log) {
            await log(durationMs, req, response, server);
        }

        return response;
    };
}

function Timing<Path extends string = string, WebSocketData = unknown>(req: BunRequest<Path>, server: Bun.Server<WebSocketData>, next: (req: BunRequest<Path>, server: Bun.Server<WebSocketData>) => MaybePromise<Response>): MaybePromise<Response>;
function Timing<Path extends string = string, WebSocketData = unknown>(options: TimingOptions<Path, WebSocketData>): Middleware<Path, WebSocketData>;
function Timing<Path extends string = string, WebSocketData = unknown>(
    arg1: BunRequest<Path> | TimingOptions<Path, WebSocketData>,
    arg2?: Bun.Server<WebSocketData>,
    arg3?: (req: BunRequest<Path>, server: Bun.Server<WebSocketData>) => MaybePromise<Response>,
): MaybePromise<Response> | Middleware<Path, WebSocketData> {
    if (arg1 instanceof Request) {
        return createTiming<Path, WebSocketData>()(arg1, arg2!, arg3!);
    }

    return createTiming(arg1);
}

export default Timing;
