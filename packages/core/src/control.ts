// For / Show: docs/runtime-api.md §4; slot mechanics in node.ts.
import { disposeOwner, effect, onCleanup, signal, untrack, type Owner } from "./reactive.ts";
import { CONTROL, renderInOwner, Slot, type Component, type Node } from "./node.ts";

export interface ShowProps<T> {
    when: T;
    children: () => Node;
    fallback?: () => Node;
}

export const Show: Component<ShowProps<unknown>> = Object.assign(function Show(props: ShowProps<unknown>): Node {
    const slot = new Slot();
    let current: { owner: Owner; node: number } | null = null;
    let shown: boolean | undefined;
    effect(() => {
        const truthy = !!props.when;
        if (truthy === shown) return;
        shown = truthy;
        untrack(() => {
            if (current) {
                disposeOwner(current.owner);
                slot.remove(current.node);
                current = null;
            }
            const render = truthy ? props.children : props.fallback;
            if (render) {
                current = renderInOwner(render, truthy ? "<Show> children" : "<Show> fallback");
                slot.insert(current.node, 0);
            }
        });
    });
    onCleanup(() => { if (current) disposeOwner(current.owner); });
    return slot as unknown as Node;
}, { [CONTROL]: true as const });

export interface ForProps<T> {
    each: T[];
    key: (item: T, index: number) => string | number;
    children: (item: () => T, index: () => number) => Node;
}

interface Row<T> {
    owner: Owner;
    node: number;
    setItem: (v: T) => void;
    setIndex: (i: number) => void;
}

export const For: Component<ForProps<unknown>> = Object.assign(function For<T>(props: ForProps<T>): Node {
    const slot = new Slot();
    const rows = new Map<string | number, Row<T>>();
    let order: (string | number)[] = [];
    effect(() => {
        const list = props.each ?? [];
        const keys: (string | number)[] = [];
        const seen = new Set<string | number>();
        for (let i = 0; i < list.length; i++) {
            const k = props.key(list[i]!, i);
            if (seen.has(k)) throw new Error(`<For> duplicate key ${String(k)}`);
            seen.add(k);
            keys.push(k);
        }
        untrack(() => {
            for (const k of order) {
                if (!seen.has(k)) {
                    const row = rows.get(k)!;
                    disposeOwner(row.owner);
                    slot.remove(row.node);
                    rows.delete(k);
                }
            }
            for (let i = 0; i < keys.length; i++) {
                const k = keys[i]!, item = list[i]!;
                const row = rows.get(k);
                if (row) {
                    row.setItem(item);
                    row.setIndex(i);
                    if (slot.nodes[i] !== row.node) slot.move(row.node, i);
                } else {
                    const [getItem, setItem] = signal<T>(item);
                    const [getIndex, setIndex] = signal(i);
                    const { owner, node } = renderInOwner(() => props.children(getItem, getIndex), "<For> row");
                    rows.set(k, { owner, node, setItem, setIndex });
                    slot.insert(node, i);
                }
            }
            order = keys;
        });
    });
    onCleanup(() => { for (const row of rows.values()) disposeOwner(row.owner); });
    return slot as unknown as Node;
}, { [CONTROL]: true as const });
