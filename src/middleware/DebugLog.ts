import Inject from "./Before.js";

import type { Middleware } from "../Router.js";
import type { BunRequest, MaybePromise } from "bun";

let PersistentDebug: typeof import("persistent-debug").default | null = null;
try {
    PersistentDebug = (await import("persistent-debug")).default;
} catch {
    // ignore
}

let debugMissingWarningEmitted = false;
function makeDebugLog<Path extends string = string, WebSocketData = unknown>(namespace: string): Middleware<Path, WebSocketData> {
    return Inject<Path, WebSocketData>((req) => {
        if (PersistentDebug) {
            PersistentDebug(`${namespace}${req.method.toLowerCase()}`, req.url);
        } else if (!debugMissingWarningEmitted) {
            process.emitWarning("BunRouter: persistent-debug module is missing. Debug logs will not be available.", { code: "BUN_ROUTER_DEBUG_MISSING" });
            debugMissingWarningEmitted = true;
        }
    });
}

function DebugLog<Path extends string = string, WebSocketData = unknown>(req: BunRequest<Path>, server: Bun.Server<WebSocketData>, next: (req: BunRequest<Path>, server: Bun.Server<WebSocketData>) => MaybePromise<Response>): MaybePromise<Response>;
function DebugLog<Path extends string = string, WebSocketData = unknown>(namespace: string): Middleware<Path, WebSocketData>;
function DebugLog<Path extends string = string, WebSocketData = unknown>(
    arg1: string | BunRequest<Path>,
    arg2?: Bun.Server<WebSocketData>,
    arg3?: (req: BunRequest<Path>, server: Bun.Server<WebSocketData>) => MaybePromise<Response>,
): MaybePromise<Response> | Middleware<Path, WebSocketData> {
    if (typeof arg1 === "string") {
        return makeDebugLog<Path, WebSocketData>(arg1);
    }

    return makeDebugLog<Path, WebSocketData>("server:")(arg1, arg2!, arg3!);
}

export default DebugLog;
