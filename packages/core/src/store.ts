// createStore: docs/runtime-api.md §2.6. Property-level subscriptions over lazily created proxies.
import { notify, track, tracking, type Effect } from "./reactive.ts";

const RAW: unique symbol = Symbol("tinyui.raw");
/** Subscriptions to the key set itself (`Object.keys`, `for…in`, `JSON.stringify`); array length changes notify it too. */
const KEYS: unique symbol = Symbol("tinyui.keys");

type Subs = Set<Effect>;
type Key = string | symbol;

const proxies = new WeakMap<object, object>();
const subscribers = new WeakMap<object, Map<Key, Subs>>();

/**
 * Wraps a plain object or array so that reads inside effects subscribe per property and writes
 * through the proxy notify. Nested plain objects and arrays are wrapped on first read; anything
 * else (class instances, Map / Set, Date) is stored by value and only a reference swap triggers.
 */
export function createStore<T extends object>(init: T): T {
    const raw = unwrapShallow(init);
    if (!isWrappable(raw)) throw new Error("createStore() takes a plain object or an array");
    return wrap(raw) as T;
}

/** The plain data behind a store, with nested proxies replaced in place; for request bodies and logs. */
export function unwrap<T>(value: T): T {
    return unwrapDeep(value, new Set()) as T;
}

function unwrapDeep(value: unknown, seen: Set<object>): unknown {
    const raw = unwrapShallow(value);
    if (!isWrappable(raw) || seen.has(raw)) return raw;
    seen.add(raw);
    const r = raw as Record<Key, unknown>;
    for (const key of Object.keys(r)) {
        const v = r[key];
        const u = unwrapDeep(v, seen);
        if (u !== v) r[key] = u;
    }
    return raw;
}

function unwrapShallow(value: unknown): unknown {
    return (value !== null && typeof value === "object" && (value as { [RAW]?: object })[RAW]) || value;
}

function isWrappable(value: unknown): value is object {
    if (value === null || typeof value !== "object" || Object.isFrozen(value)) return false;
    const proto = Object.getPrototypeOf(value) as unknown;
    return proto === Object.prototype || proto === null || Array.isArray(value);
}

function wrap(value: unknown): unknown {
    if (!isWrappable(value) || RAW in value) return value;
    let proxy = proxies.get(value);
    if (!proxy) {
        proxy = new Proxy(value, handlers);
        proxies.set(value, proxy);
    }
    return proxy;
}

function subs(target: object, key: Key, create: boolean): Subs | undefined {
    let keys = subscribers.get(target);
    if (!keys) {
        if (!create) return undefined;
        subscribers.set(target, keys = new Map());
    }
    let s = keys.get(key);
    if (!s && create) keys.set(key, s = new Set());
    return s;
}

function observe(target: object, key: Key): void {
    if (tracking()) track(subs(target, key, true)!);
}

function changed(target: object, key: Key): void {
    const s = subs(target, key, false);
    if (s) notify(s);
}

const isIndex = (key: Key): boolean => typeof key === "string" && String(Number(key) >>> 0) === key;

const handlers: ProxyHandler<object> = {
    get(target, key, receiver) {
        if (key === RAW) return target;
        const value = Reflect.get(target, key, receiver) as unknown;
        if (typeof key === "symbol") return value;
        // array methods are read through here too; only elements and length are state
        if (!Array.isArray(target) || key === "length" || isIndex(key)) observe(target, key);
        return wrap(value);
    },
    has(target, key) {
        if (typeof key !== "symbol") observe(target, key);
        return Reflect.has(target, key);
    },
    ownKeys(target) {
        observe(target, KEYS);
        return Reflect.ownKeys(target);
    },
    set(target, key, value, receiver) {
        const raw = unwrapShallow(value);
        const had = Object.prototype.hasOwnProperty.call(target, key);
        const old = (target as Record<Key, unknown>)[key];
        const length = Array.isArray(target) ? target.length : -1;
        const ok = Reflect.set(target, key, raw, receiver);
        if (!had) changed(target, KEYS);
        if (!had || old !== raw) changed(target, key);
        if (length >= 0) {
            const now = (target as unknown[]).length;
            // assigning past the end grows an array without a `length` set; truncating drops elements without deletes
            if (key !== "length" && now !== length) changed(target, "length");
            if (key === "length") for (let i = now; i < length; i++) changed(target, String(i));
            if (now !== length) changed(target, KEYS);
        }
        return ok;
    },
    deleteProperty(target, key) {
        const had = Object.prototype.hasOwnProperty.call(target, key);
        const ok = Reflect.deleteProperty(target, key);
        if (had) {
            changed(target, key);
            changed(target, KEYS);
        }
        return ok;
    },
};
