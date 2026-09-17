// Runtime signals: docs/js-runtime.html §1 / §3 for the model, docs/runtime-api.md §2 for the contract.

export interface Owner {
    effects: Effect[];
    cleanups: (() => void)[];
    disposed: boolean;
}

export interface Effect {
    fn: () => void;
    deps: Set<Effect>[];
    owner: Owner | null;
    cleanups: (() => void)[];
    queued: boolean;
    disposed: boolean;
    runs: number;
    memo: Memo<unknown> | null;
}

interface Memo<T> {
    effect: Effect;
    subs: Set<Effect>;
    value: T;
    dirty: boolean;
}

let currentEffect: Effect | null = null;
let currentOwner: Owner | null = null;
const pending: Effect[] = [];
const ran: Effect[] = [];

const MAX_RUNS_PER_FLUSH = 100;

export function createOwner(): Owner {
    return { effects: [], cleanups: [], disposed: false };
}

/** Runs [fn] as a synchronous render period under [owner]: effects it creates belong to the owner. */
export function runWithOwner<T>(owner: Owner, fn: () => T): T {
    const prevOwner = currentOwner, prevEffect = currentEffect;
    currentOwner = owner;
    currentEffect = null;
    try {
        return fn();
    } finally {
        currentOwner = prevOwner;
        currentEffect = prevEffect;
    }
}

export function disposeOwner(owner: Owner): void {
    if (owner.disposed) return;
    owner.disposed = true;
    for (const e of owner.effects) disposeEffect(e);
    owner.effects.length = 0;
    const cleanups = owner.cleanups.splice(0).reverse();
    for (const c of cleanups) c();
}

export function insideRender(): boolean {
    return currentOwner !== null;
}

/** True while an effect is collecting dependencies; stores use it to skip allocating subscriber sets. */
export function tracking(): boolean {
    return currentEffect !== null;
}

export function signal<T>(init: T): [get: () => T, set: (next: T | ((prev: T) => T)) => void] {
    let value = init;
    const subs = new Set<Effect>();
    const get = () => {
        track(subs);
        return value;
    };
    const set = (next: T | ((prev: T) => T)) => {
        const v = typeof next === "function" ? (next as (prev: T) => T)(value) : next;
        if (v === value) return;
        value = v;
        notify(subs);
    };
    return [get, set];
}

export function memo<T>(fn: () => T): () => T {
    const effect = createEffectRecord(() => {
        const v = fn();
        m.dirty = false;
        m.value = v;
    });
    const m: Memo<T> = { effect, subs: new Set(), value: undefined as T, dirty: true };
    effect.memo = m as Memo<unknown>;
    return () => {
        track(m.subs);
        if (m.dirty && !effect.disposed) runEffect(effect);
        return m.value;
    };
}

export function effect(fn: () => void): void {
    runEffect(createEffectRecord(fn));
}

export function onCleanup(fn: () => void): void {
    if (currentEffect) currentEffect.cleanups.push(fn);
    else if (currentOwner) currentOwner.cleanups.push(fn);
    else throw new Error("onCleanup() called outside a synchronous render period");
}

export function untrack<T>(fn: () => T): T {
    const prev = currentEffect;
    currentEffect = null;
    try {
        return fn();
    } finally {
        currentEffect = prev;
    }
}

/** Re-runs every queued effect until the queue is empty. Throws (E2) on an update loop or a render error. */
export function runPending(): void {
    try {
        for (let i = 0; i < pending.length; i++) {
            const e = pending[i]!;
            e.queued = false;
            if (e.disposed) continue;
            if (++e.runs > MAX_RUNS_PER_FLUSH) throw new Error("update loop: an effect re-ran more than 100 times in one flush");
            runEffect(e);
        }
    } finally {
        pending.length = 0;
        for (const e of ran) e.runs = 0;
        ran.length = 0;
    }
}

function createEffectRecord(fn: () => void): Effect {
    if (!currentOwner) throw new Error("effect() called outside a synchronous render period");
    const e: Effect = { fn, deps: [], owner: currentOwner, cleanups: [], queued: false, disposed: false, runs: 0, memo: null };
    currentOwner.effects.push(e);
    return e;
}

function runEffect(e: Effect): void {
    if (e.disposed) return;
    unsubscribe(e);
    runCleanups(e);
    const prevEffect = currentEffect, prevOwner = currentOwner;
    currentEffect = e;
    currentOwner = e.owner;
    try {
        e.fn();
    } finally {
        currentEffect = prevEffect;
        currentOwner = prevOwner;
    }
}

function disposeEffect(e: Effect): void {
    e.disposed = true;
    unsubscribe(e);
    runCleanups(e);
}

function unsubscribe(e: Effect): void {
    for (const subs of e.deps) subs.delete(e);
    e.deps.length = 0;
}

function runCleanups(e: Effect): void {
    const cleanups = e.cleanups.splice(0).reverse();
    for (const c of cleanups) c();
}

export function track(subs: Set<Effect>): void {
    const e = currentEffect;
    if (!e || subs.has(e)) return;
    subs.add(e);
    e.deps.push(subs);
}

export function notify(subs: Set<Effect>): void {
    for (const e of subs) {
        if (e.memo) {
            if (!e.memo.dirty) {
                e.memo.dirty = true;
                notify(e.memo.subs);
            }
        } else if (!e.queued) {
            e.queued = true;
            pending.push(e);
            if (e.runs === 0) ran.push(e);
        }
    }
}
