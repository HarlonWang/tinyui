import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { bridge } from "./host-stub.ts";
import { mount, transaction, unmount } from "./helpers.ts";
import { createOwner, effect, runPending, runWithOwner } from "../src/reactive.ts";
import { createStore, unwrap } from "../src/store.ts";
import { Column, For, h, Text, thunk } from "../src/index.ts";

const render = <T>(fn: () => T) => runWithOwner(createOwner(), fn);

describe("createStore", () => {
    it("subscribes per property: writing one field re-runs only its readers", () => {
        const store = createStore({ a: 1, b: 1 });
        let aRuns = 0, bRuns = 0;
        render(() => {
            effect(() => { store.a; aRuns++; });
            effect(() => { store.b; bRuns++; });
        });
        store.a = 2;
        runPending();
        assert.deepEqual([aRuns, bRuns], [2, 1]);
        store.a = 2;
        runPending();
        assert.equal(aRuns, 2, "same value is a no-op");
    });

    it("wraps nested objects lazily with a stable identity", () => {
        const store = createStore({ user: { name: "a", tags: ["x"] } });
        assert.equal(store.user, store.user);
        assert.equal(store.user.tags, store.user.tags);
        let runs = 0;
        render(() => effect(() => { store.user.name; runs++; }));
        store.user.name = "b";
        runPending();
        assert.equal(runs, 2);
        store.user = { name: "c", tags: [] };
        runPending();
        assert.equal(runs, 3, "replacing the parent re-reads through the new object");
        store.user.name = "d";
        runPending();
        assert.equal(runs, 4, "the new object is tracked too");
    });

    it("tracks array elements and length; push, splice and truncation notify", () => {
        const store = createStore({ list: [1, 2, 3] });
        const seen: number[][] = [];
        render(() => effect(() => seen.push(store.list.map((n) => n * 10))));
        store.list.push(4);
        runPending();
        store.list.splice(0, 1);
        runPending();
        store.list.length = 1;
        runPending();
        store.list[0] = 9;
        runPending();
        assert.deepEqual(seen, [[10, 20, 30], [10, 20, 30, 40], [20, 30, 40], [20], [90]]);
    });

    it("tracks the key set for iteration and `in`", () => {
        const store = createStore<Record<string, number>>({});
        const keys: string[][] = [];
        let has = 0;
        render(() => {
            effect(() => keys.push(Object.keys(store)));
            effect(() => { if ("x" in store) has++; });
        });
        store["x"] = 1;
        runPending();
        delete store["x"];
        runPending();
        assert.deepEqual(keys, [[], ["x"], []]);
        assert.equal(has, 1);
    });

    it("stores class instances and Map by value: only a reference swap triggers", () => {
        class Point { x: number; constructor(x = 0) { this.x = x; } }
        const store = createStore({ p: new Point(), m: new Map<string, number>() });
        let runs = 0;
        render(() => effect(() => { store.p.x; store.m.size; runs++; }));
        store.p.x = 5;
        store.m.set("k", 1);
        runPending();
        assert.equal(runs, 1);
        store.p = new Point(6);
        runPending();
        assert.equal(runs, 2);
    });

    it("keeps Proxy invariants and stays silent on writes that fail", () => {
        const inner = { n: 1 };
        const raw: { locked: { n: number }; open?: { n: number } } = { locked: inner };
        Object.defineProperty(raw, "locked", { value: inner, writable: false, configurable: false, enumerable: true });
        const store = createStore(raw);
        assert.equal(store.locked, inner, "a non-configurable, non-writable property comes back unwrapped");
        const sealed = createStore(Object.seal({ a: 1 }) as { a: number; b?: number });
        let runs = 0;
        render(() => effect(() => { sealed.b; runs++; }));
        assert.throws(() => { sealed.b = 2; }, TypeError);
        assert.throws(() => { delete (sealed as { a?: number }).a; }, TypeError);
        runPending();
        assert.equal(runs, 1, "a rejected write queues nothing");
    });

    it("unwrap returns plain data and rejects non-objects at creation", () => {
        const store = createStore({ user: { name: "a" }, list: [{ id: 1 }] });
        const copy = { ...store, extra: store.user };
        assert.equal(unwrap(store), unwrap(store));
        const raw = unwrap(copy);
        assert.equal(JSON.stringify(raw), JSON.stringify({ user: { name: "a" }, list: [{ id: 1 }], extra: { name: "a" } }));
        assert.notEqual(raw.extra, store.user, "nested proxies are replaced");
        assert.equal(createStore(store), store, "a store is returned as is");
        assert.throws(() => createStore(1 as unknown as object), /plain object or an array/);
        assert.throws(() => createStore(new Date() as unknown as object), /plain object or an array/);
    });
});

describe("createStore with For", () => {
    afterEach(() => unmount());

    it("a field write updates one binding without reconciling the list", () => {
        interface Todo { id: number; title: string; done: boolean }
        const store = createStore({ todos: [{ id: 1, title: "a", done: false }, { id: 2, title: "b", done: false }] as Todo[] });
        let reconciles = 0;
        mount(() => h(Column, null,
            h(For, { each: thunk(() => { reconciles++; return store.todos; }), key: (t: Todo) => t.id }, (item: () => Todo) =>
                h(Text, { text: thunk(() => item().title), color: thunk(() => (item().done ? "gray" : "black")) })),
        ));
        assert.equal(reconciles, 1);
        // rows are created before their parent: rows 1 / 2, Column 3
        assert.deepEqual(transaction(() => { store.todos[1]!.done = true; }), [["p", 2, "color", "gray"]]);
        assert.equal(reconciles, 1, "the For effect did not re-run");
        assert.deepEqual(transaction(() => { store.todos.push({ id: 3, title: "c", done: false }); }),
            [["c", 4, "Text"], ["p", 4, "text", "c"], ["p", 4, "color", "black"], ["i", 3, 4, 2]]);
        assert.equal(reconciles, 2);
        assert.deepEqual(transaction(() => { store.todos.splice(0, 1); }), [["r", 1]]);
        assert.equal(bridge.applied.length, 4);
    });
});
