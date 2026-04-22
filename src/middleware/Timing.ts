import type { Middleware } from "../Router.js";
import type { BunRequest, MaybePromise } from "bun";

export interface TimingOptions<T extends string = string> {
    description?: string;
    headerName?: string;
    log?: (durationMs: number, req: BunRequest<T>, response: Response) => MaybePromise<void>;
    metricName?: string;
    setHeader?: boolean;
}

interface TimingMiddleware extends Middleware {
    <T extends string = string>(options: TimingOptions<T>): Middleware<T>;
}

function roundDuration(durationMs: number): string {
    return durationMs.toFixed(2);
}

function createTiming<T extends string = string>({
    description,
    headerName = "server-timing",
    log,
    metricName = "app",
    setHeader = true,
}: TimingOptions<T> = {}): Middleware<T> {
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
            await log(durationMs, req, response);
        }

        return response;
    };
}

const defaultTiming = createTiming();
const Timing: TimingMiddleware = ((arg1, arg2, arg3) => {
    if (arg1 instanceof Request) {
        return defaultTiming(arg1, arg2, arg3);
    }

    return createTiming(arg1);
}) as TimingMiddleware;

export default Timing;
