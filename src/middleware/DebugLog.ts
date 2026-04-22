import Inject from "./Before.js";

import type { Middleware } from "../Router.js";
import type { BunRequest, MaybePromise } from "bun";

let PersistentDebug: typeof import("persistent-debug").default | null = null;
try {
    PersistentDebug = (await import("persistent-debug")).default;
} catch {
    // ignore
}

interface DebugLogMiddleware extends Middleware {
    (namespace: string): Middleware;
}

let debugMissingWarningEmitted = false;
function makeDebugLog(namespace: string): Middleware {
    return Inject((req) => {
        if (PersistentDebug) {
            PersistentDebug(`${namespace}${req.method.toLowerCase()}`, req.url);
        } else if (!debugMissingWarningEmitted) {
            process.emitWarning("BunRouter: persistent-debug module is missing. Debug logs will not be available.", { code: "BUN_ROUTER_DEBUG_MISSING" });
            debugMissingWarningEmitted = true;
        }
    });
}

const defaultDebugLog = makeDebugLog("server:");
const DebugLog: DebugLogMiddleware = ((arg1: string | BunRequest, arg2?: Bun.Server<never>, arg3?: (req: BunRequest, server: Bun.Server<never>) => MaybePromise<Response>) => {
    if (typeof arg1 === "string") {
        return makeDebugLog(arg1);
    }

    return defaultDebugLog(arg1, arg2!, arg3!);
}) as DebugLogMiddleware;

export default DebugLog;
