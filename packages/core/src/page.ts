// Kotlin → JS entries (`globalThis.__tinyui`): docs/runtime-api.md §9.
import { createOwner, disposeOwner, insideRender, onCleanup, runPending, runWithOwner, signal, type Owner } from "./reactive.ts";
import { handlers, patches, resetIds, type Node, type Props } from "./node.ts";
import { apply, rejectPending, report, resolvePending } from "./host.ts";
import { installGlobals } from "./timers.ts";

export const PROTOCOL = 1;

export interface HostManifest {
    components: Record<string, { props: string[]; events: string[]; commands: string[] }>;
    capabilities: string[];
}

let root: Owner | null = null;
let current: HostManifest = { components: {}, capabilities: [] };
const [visible, setVisible] = signal(true);
const topics = new Map<string, Set<(payload: unknown) => void>>();

export function pageVisible(): boolean {
    return visible();
}

export function manifest(): HostManifest {
    return current;
}

/** K5 subscription; the subscription dies with the current owner. */
export function onEmit(topic: string, fn: (payload: unknown) => void): void {
    if (!insideRender()) throw new Error("onEmit() called outside a synchronous render period");
    let set = topics.get(topic);
    if (!set) topics.set(topic, (set = new Set()));
    set.add(fn);
    onCleanup(() => { set.delete(fn); });
}

function guarded(entry: string, fn: () => void): void {
    try {
        fn();
    } catch (e) {
        const err = e as Error;
        report("E1", { entry, message: err?.message ?? String(e), ...(err?.stack !== undefined && { stack: err.stack }) });
    }
}

export const entries = {
    protocol: PROTOCOL,

    mount(page: (props: Props) => Node, propsJson: string, hostJson: string): void {
        if (root) throw new Error("mount() called twice");
        current = JSON.parse(hostJson) as HostManifest;
        const props = JSON.parse(propsJson) as Props;
        resetIds();
        root = createOwner();
        let node: unknown;
        try {
            node = runWithOwner(root, () => page(props));
            if (typeof node !== "number") {
                throw new Error(`page must return exactly one node, got ${node instanceof Promise ? "a Promise" : String(node)}`);
            }
        } catch (e) {
            disposeOwner(root);
            root = null;
            patches.length = 0;
            throw e;
        }
        patches.push(["i", 0, node, 0]);
    },

    unmount(): void {
        if (root) disposeOwner(root);
        root = null;
        patches.length = 0;
        handlers.clear();
        topics.clear();
    },

    visible(v: boolean): void {
        setVisible(v);
    },

    dispatch(nodeId: number, event: string, payloadJson: string): void {
        const handler = handlers.get(`${nodeId}:${event}`);
        if (!handler) return;
        guarded("dispatch", () => handler(JSON.parse(payloadJson)));
    },

    resolve(cbId: number, resultJson: string): void {
        guarded("resolve", () => resolvePending(cbId, resultJson));
    },

    reject(cbId: number, errorJson: string): void {
        guarded("reject", () => rejectPending(cbId, errorJson));
    },

    emit(topic: string, payloadJson: string): void {
        const set = topics.get(topic);
        if (!set) return;
        const payload = JSON.parse(payloadJson);
        for (const fn of [...set]) guarded("emit", () => fn(payload));
    },

    /** Second call of every K entry: re-runs effects, ships the patches (J1). Throws E2 with the buffer cleared. */
    flush(): void {
        try {
            runPending();
        } catch (e) {
            patches.length = 0;
            throw e;
        }
        if (patches.length === 0) return;
        const json = JSON.stringify(patches);
        patches.length = 0;
        apply(json);
    },
};

export function install(g: Record<string, unknown>): void {
    g["__tinyui"] = entries;
    installGlobals(g);
}

install(globalThis as unknown as Record<string, unknown>);
