// Fake `__host_*` globals installed before the runtime is imported (same shape as packages/core/test).
export const bridge = {
    calls: [] as { name: string; cbId: number; args: unknown }[],
    sent: [] as { name: string; args: unknown }[],
    queries: {} as Record<string, unknown>,
    applied: [] as unknown[][][],
};
const g = globalThis as Record<string, unknown>;
g["__host_apply"] = (json: string) => bridge.applied.push(JSON.parse(json));
g["__host_call"] = (name: string, cbId: number, args: string) => bridge.calls.push({ name, cbId, args: JSON.parse(args) });
g["__host_send"] = (name: string, args: string) => bridge.sent.push({ name, args: JSON.parse(args) });
g["__host_query"] = (name: string) => JSON.stringify(bridge.queries[name] ?? null);
g["__host_report"] = () => {};
