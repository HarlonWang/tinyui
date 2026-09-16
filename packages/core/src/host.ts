// JS → Kotlin entries and the pending table: docs/runtime-api.md §9.
declare const __host_apply: (patchJson: string) => void;
declare const __host_query: (name: string, argsJson: string) => string;
declare const __host_call: (name: string, cbId: number, argsJson: string) => void;
declare const __host_send: (name: string, argsJson: string) => void;
declare const __host_report: (kind: string, detailJson: string) => void;

interface Pending {
    resolve: (value: unknown) => void;
    reject: (error: HostError) => void;
}

export class HostError extends Error {
    readonly code: string;
    constructor(code: string, message: string) {
        super(message);
        this.code = code;
    }
}

const pending = new Map<number, Pending>();
let nextCbId = 1;

export function apply(patchJson: string): void {
    __host_apply(patchJson);
}

/** J2: synchronous whitelisted query; the host answers with JSON text. */
export function query<T>(name: string, args: Record<string, unknown> = {}): T {
    return JSON.parse(__host_query(name, JSON.stringify(args))) as T;
}

/** J3: asynchronous capability; settles when the host calls K3. */
export function call<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
    const cbId = nextCbId++;
    return new Promise<T>((resolve, reject) => {
        pending.set(cbId, { resolve: resolve as (v: unknown) => void, reject });
        __host_call(name, cbId, JSON.stringify(args));
    });
}

/** J4: fire and forget. */
export function send(name: string, args: Record<string, unknown> = {}): void {
    __host_send(name, JSON.stringify(args));
}

export function report(kind: "E1", detail: { entry: string; message: string; stack?: string }): void {
    __host_report(kind, JSON.stringify(detail));
}

export function resolvePending(cbId: number, resultJson: string): void {
    const p = pending.get(cbId);
    if (!p) return;
    pending.delete(cbId);
    p.resolve(resultJson === "" ? undefined : JSON.parse(resultJson));
}

export function rejectPending(cbId: number, errorJson: string): void {
    const p = pending.get(cbId);
    if (!p) return;
    pending.delete(cbId);
    const e = JSON.parse(errorJson) as { code?: string; message?: string };
    p.reject(new HostError(e.code ?? "unknown", e.message ?? "host call failed"));
}

export function cancelPending(cbId: number): void {
    pending.delete(cbId);
}

export function allocateCbId(): number {
    return nextCbId++;
}

export function registerPending(cbId: number, p: Pending): void {
    pending.set(cbId, p);
}
