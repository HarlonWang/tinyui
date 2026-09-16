// Node ids, slots, handlers and the patch buffer: docs/patch-protocol.md; docs/runtime-api.md §3.
import { createOwner, disposeOwner, effect, insideRender, onCleanup, runWithOwner, type Owner } from "./reactive.ts";

/** A node handle. At runtime it is the node id. */
export type Node = number & { readonly __tinyuiNode: unique symbol };

export type Scalar = string | number | boolean | null | undefined;
export type Props = Record<string, unknown>;
export type Child = Node | Slot | Node[] | Slot[] | null | undefined | false;
export type Component<P = Props> = ((props: P) => Node) & { [CONTROL]?: true };

export const CONTROL: unique symbol = Symbol("tinyui.control");

export class Thunk<T> {
    readonly fn: () => T;
    constructor(fn: () => T) {
        this.fn = fn;
    }
}

/** Marks a dynamic prop; the CLI inserts it (docs/jsx-transform.md), business code rarely writes it. */
export function thunk<T>(fn: () => T): T {
    return new Thunk(fn) as unknown as T;
}

export const patches: unknown[][] = [];
export const handlers = new Map<string, (payload: unknown) => void>();
let nextId = 1;

export function resetIds(): void {
    nextId = 1;
}

interface SlotEntry {
    length: number;
}

/** A variable-length range in a parent's children, owned by For / Show. */
export class Slot implements SlotEntry {
    parent = 0;
    position = -1;
    length = 0;
    readonly nodes: number[] = [];
    private entries: SlotEntry[] | null = null;

    mount(parent: number, entries: SlotEntry[], position: number): void {
        this.parent = parent;
        this.entries = entries;
        this.position = position;
        for (let i = 0; i < this.nodes.length; i++) patches.push(["i", parent, this.nodes[i], this.offset() + i]);
    }

    insert(node: number, at: number): void {
        this.nodes.splice(at, 0, node);
        this.length = this.nodes.length;
        if (this.entries) patches.push(["i", this.parent, node, this.offset() + at]);
    }

    move(node: number, to: number): void {
        const from = this.nodes.indexOf(node);
        if (from < 0) throw new Error("move: node not in slot");
        this.nodes.splice(from, 1);
        this.nodes.splice(to, 0, node);
        if (this.entries) patches.push(["m", this.parent, node, this.offset() + to]);
    }

    remove(node: number): void {
        const at = this.nodes.indexOf(node);
        if (at < 0) throw new Error("remove: node not in slot");
        this.nodes.splice(at, 1);
        this.length = this.nodes.length;
        if (this.entries) patches.push(["r", node]);
    }

    private offset(): number {
        let n = 0;
        for (let i = 0; i < this.position; i++) n += this.entries![i]!.length;
        return n;
    }
}

export interface Ref {
    cmd(name: string, args?: Record<string, Scalar>): void;
}

export function ref(): Ref {
    const r = { id: 0, cmd(name: string, args: Record<string, Scalar> = {}) {
        if (r.id === 0) throw new Error("ref.cmd() before the ref was attached to a node");
        patches.push(["x", r.id, name, args]);
    } };
    return r;
}

/** `<>…</>`: its children are spliced into the parent's; only valid in a children position. */
export const Fragment: Component<{ children?: Child | Child[] }> = Object.assign(
    function Fragment(props: { children?: Child | Child[] }): Node {
        return flatten(props.children) as unknown as Node;
    },
    { [CONTROL]: true as const },
);

export function h(type: string | Component<any>, props: Props | null, ...children: Child[]): Node {
    if (!insideRender()) throw new Error("h() called outside a synchronous render period");
    if (typeof type === "function") return callComponent(type, props, children);
    return createElement(type, props, children);
}

function callComponent(type: Component<any>, props: Props | null, children: Child[]): Node {
    const p: Props = {};
    if (props) {
        for (const key of Object.keys(props)) {
            const v = props[key];
            if (v instanceof Thunk) Object.defineProperty(p, key, { get: v.fn, enumerable: true });
            else p[key] = v;
        }
    }
    if (children.length === 1 && typeof children[0] === "function") p["children"] = children[0];
    else if (children.length > 0) p["children"] = flatten(children);
    const result: unknown = type(p);
    if (type[CONTROL]) return result as Node;
    if (typeof result !== "number") {
        const what = result instanceof Promise ? "a Promise (async components are not supported; use createResource)"
            : Array.isArray(result) ? "several nodes (wrap them in one container)"
            : result instanceof Slot ? "a For / Show (wrap it in one container)"
            : String(result);
        throw new Error(`component ${type.name || "<anonymous>"} must return exactly one node, got ${what}`);
    }
    return result as Node;
}

function createElement(type: string, props: Props | null, children: Child[]): Node {
    const id = nextId++;
    patches.push(["c", id, type]);
    if (props) {
        for (const key of Object.keys(props)) {
            const v = props[key];
            if (key === "ref") {
                (v as { id: number }).id = id;
            } else if (/^on[A-Z]/.test(key)) {
                if (typeof v !== "function") throw new Error(`<${type} ${key}> must be a function`);
                const k = `${id}:${key}`;
                handlers.set(k, v as (payload: unknown) => void);
                onCleanup(() => handlers.delete(k));
                patches.push(["p", id, key, true]);
            } else if (v instanceof Thunk) {
                bindProp(id, type, key, v.fn as () => unknown);
            } else {
                patches.push(["p", id, key, scalar(type, key, v)]);
            }
        }
    }
    const entries: SlotEntry[] = [];
    for (const child of flatten(children)) {
        if (child instanceof Slot) {
            entries.push(child);
            child.mount(id, entries, entries.length - 1);
        } else {
            entries.push({ length: 1 });
            patches.push(["i", id, child, entries.length - 1]);
        }
    }
    return id as Node;
}

function bindProp(id: number, type: string, key: string, fn: () => unknown): void {
    let last: unknown = undefined, first = true;
    effect(() => {
        const v = scalar(type, key, fn());
        if (first || v !== last) {
            first = false;
            last = v;
            patches.push(["p", id, key, v]);
        }
    });
}

function scalar(type: string, key: string, v: unknown): string | number | boolean | null {
    if (v === undefined || v === null) return null;
    const t = typeof v;
    if (t === "string" || t === "number" || t === "boolean") return v as string | number | boolean;
    if (t === "function") throw new Error(`<${type} ${key}> is a function; did you forget to call it?`);
    throw new Error(`<${type} ${key}> must be a string, number, boolean or null; props do not cross the bridge as objects`);
}

function flatten(children: Child | Child[] | undefined): (number | Slot)[] {
    const out: (number | Slot)[] = [];
    const push = (c: Child | Child[]) => {
        if (c === null || c === undefined || c === false) return;
        if (Array.isArray(c)) for (const x of c) push(x);
        else out.push(c as number | Slot);
    };
    push(children);
    return out;
}

/** Runs [render] in a fresh owner and checks it produced exactly one node. */
export function renderInOwner(render: () => Node, what: string): { owner: Owner; node: number } {
    const owner = createOwner();
    let node: unknown;
    try {
        node = runWithOwner(owner, render);
    } catch (e) {
        disposeOwner(owner);
        throw e;
    }
    if (typeof node !== "number") {
        disposeOwner(owner);
        throw new Error(`${what} must return exactly one node`);
    }
    return { owner, node };
}
