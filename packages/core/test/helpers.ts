import { bridge } from "./host-stub.ts";
import type { Node, Props } from "../src/node.ts";

type Entries = typeof import("../src/page.ts")["entries"];
export const tinyui = (): Entries => (globalThis as Record<string, unknown>)["__tinyui"] as Entries;

const HOST = JSON.stringify({ components: {}, capabilities: [] });

/** One K entry as Kotlin does it: the entry, then flush(). */
export function transaction(fn: () => void): unknown[][] {
    const before = bridge.applied.length;
    fn();
    tinyui().flush();
    return bridge.applied.slice(before).flat();
}

export function mount(page: (props: Props) => Node, props: Props = {}): unknown[][] {
    bridge.reset();
    return transaction(() => tinyui().mount(page, JSON.stringify(props), HOST));
}

export function unmount(): void {
    tinyui().unmount();
}

/** Drains microtasks the way quickjs-kmp does before an entry returns. */
export const drain = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
