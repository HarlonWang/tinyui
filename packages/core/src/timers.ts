import { allocateCbId, cancelPending, registerPending, send } from "./host.ts";

declare const __host_call: (name: string, cbId: number, argsJson: string) => void;

/** `setTimeout` on top of the host timer (J3 `timer.schedule`); ids share the cbId space. */
export function setTimeout(fn: () => void, ms = 0): number {
    const cbId = allocateCbId();
    registerPending(cbId, { resolve: () => fn(), reject: () => {} });
    __host_call("timer.schedule", cbId, JSON.stringify({ ms }));
    return cbId;
}

export function clearTimeout(id: number): void {
    cancelPending(id);
    send("timer.cancel", { cbId: id });
}

/** The engine has no timers (quickjs-libc is not linked); a host that already has them (Node tests) keeps its own. */
export function installGlobals(g: Record<string, unknown>): void {
    if ("setTimeout" in g) return;
    g["setTimeout"] = setTimeout;
    g["clearTimeout"] = clearTimeout;
}
