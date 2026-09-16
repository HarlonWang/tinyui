// Installs fake `__host_*` globals before the runtime is imported; tests read what crossed the bridge.
export const bridge = {
    applied: [] as unknown[][][],
    calls: [] as { name: string; cbId: number; args: unknown }[],
    sent: [] as { name: string; args: unknown }[],
    reports: [] as { kind: string; detail: unknown }[],
    queries: {} as Record<string, unknown>,
    reset() { this.applied.length = 0; this.calls.length = 0; this.sent.length = 0; this.reports.length = 0; },
    /** All ops of all flushes since the last reset, in order. */
    ops(): unknown[][] { return this.applied.flat(); },
};
const g = globalThis as Record<string, unknown>;
g["__host_apply"] = (json: string) => bridge.applied.push(JSON.parse(json));
g["__host_call"] = (name: string, cbId: number, args: string) => bridge.calls.push({ name, cbId, args: JSON.parse(args) });
g["__host_send"] = (name: string, args: string) => bridge.sent.push({ name, args: JSON.parse(args) });
g["__host_query"] = (name: string) => JSON.stringify(bridge.queries[name] ?? null);
g["__host_report"] = (kind: string, detail: string) => bridge.reports.push({ kind, detail: JSON.parse(detail) });
