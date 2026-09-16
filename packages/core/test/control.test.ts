import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { bridge } from "./host-stub.ts";
import { mount, tinyui, transaction, unmount } from "./helpers.ts";
import { Button, Column, For, h, onCleanup, Show, signal, Text, thunk } from "../src/index.ts";

const g = globalThis as Record<string, unknown>;
afterEach(() => unmount());

describe("Show", () => {
    it("is a slot between siblings: switching keeps sibling indices right", () => {
        mount(() => {
            const [on, setOn] = signal(false);
            g["__setOn"] = setOn;
            return h(Column, null,
                h(Text, { text: "head" }),
                h(Show, { when: thunk(() => on()), fallback: () => h(Text, { text: "off" }) }, () => h(Text, { text: "on" })),
                h(Text, { text: "tail" }),
            );
        });
        assert.deepEqual(bridge.ops().filter((o) => o[0] === "i"), [["i", 4, 1, 0], ["i", 4, 2, 1], ["i", 4, 3, 2], ["i", 0, 4, 0]]);
        const ops = transaction(() => (g["__setOn"] as (v: boolean) => void)(true));
        assert.deepEqual(ops, [["r", 2], ["c", 5, "Text"], ["p", 5, "text", "on"], ["i", 4, 5, 1]]);
        assert.deepEqual(transaction(() => (g["__setOn"] as (v: boolean) => void)(false)), [["r", 5], ["c", 6, "Text"], ["p", 6, "text", "off"], ["i", 4, 6, 1]]);
        unmount();
    });

    it("switches only on truthiness and disposes the old branch", () => {
        const log: string[] = [];
        mount(() => {
            const [user, setUser] = signal<{ name: string } | null>({ name: "a" });
            g["__setUser"] = setUser;
            return h(Column, null, h(Show, { when: thunk(() => user()) }, () => {
                onCleanup(() => log.push("branch disposed"));
                return h(Text, { text: thunk(() => user()!.name) });
            }));
        });
        assert.deepEqual(transaction(() => (g["__setUser"] as (v: unknown) => void)({ name: "b" })), [["p", 1, "text", "b"]], "same truthiness: no rebuild");
        assert.deepEqual(transaction(() => (g["__setUser"] as (v: unknown) => void)(null)), [["r", 1]]);
        assert.deepEqual(log, ["branch disposed"]);
        unmount();
    });
});

interface Todo { id: number; title: string }

function TodoList(props: { todos: Todo[] }) {
    return h(Column, null,
        h(Text, { text: "head" }),
        h(For, { each: thunk(() => props.todos), key: (t: Todo) => t.id }, (item: () => Todo, index: () => number) =>
            h(Button, { text: thunk(() => `${index()}:${item().title}`), onClick: () => {} })),
    );
}

function mountList(initial: Todo[]) {
    return mount(() => {
        const [todos, setTodos] = signal(initial);
        g["__setTodos"] = setTodos;
        return h(TodoList, { todos: thunk(() => todos()) });
    });
}
const setTodos = (v: Todo[]) => transaction(() => (g["__setTodos"] as (v: Todo[]) => void)(v));

describe("For", () => {
    it("creates rows after the static sibling and keeps them keyed", () => {
        const ops = mountList([{ id: 1, title: "a" }, { id: 2, title: "b" }]);
        assert.deepEqual(ops.filter((o) => o[0] === "i"), [["i", 4, 1, 0], ["i", 4, 2, 1], ["i", 4, 3, 2], ["i", 0, 4, 0]]);
        assert.deepEqual(ops.filter((o) => o[0] === "p" && o[2] === "text"), [["p", 1, "text", "head"], ["p", 2, "text", "0:a"], ["p", 3, "text", "1:b"]]);
        unmount();
    });

    it("updates a kept row through the item accessor instead of rebuilding it", () => {
        mountList([{ id: 1, title: "a" }, { id: 2, title: "b" }]);
        assert.deepEqual(setTodos([{ id: 1, title: "a2" }, { id: 2, title: "b" }]), [["p", 2, "text", "0:a2"]]);
        unmount();
    });

    it("removes, inserts and moves with indices offset by the static sibling", () => {
        mountList([{ id: 1, title: "a" }, { id: 2, title: "b" }, { id: 3, title: "c" }]);
        assert.deepEqual(setTodos([{ id: 3, title: "c" }, { id: 1, title: "a" }, { id: 4, title: "d" }]), [
            ["r", 3],
            ["m", 5, 4, 1],
            ["c", 6, "Button"], ["p", 6, "text", "2:d"], ["p", 6, "onClick", true], ["i", 5, 6, 3],
            ["p", 4, "text", "0:c"],
            ["p", 2, "text", "1:a"],
        ]);
        unmount();
    });

    it("disposes removed rows: their handlers are gone", () => {
        mountList([{ id: 1, title: "a" }]);
        setTodos([]);
        assert.deepEqual(transaction(() => tinyui().dispatch(2, "onClick", "{}")), []);
        unmount();
    });

    it("rejects duplicate keys and misplaced control flow", () => {
        assert.throws(() => mountList([{ id: 1, title: "a" }, { id: 1, title: "b" }]), /duplicate key/);
        unmount();
        assert.throws(() => mount(() => h(For, { each: [], key: (t: Todo) => t.id }, () => h(Text, { text: "x" })) as never), /page must return exactly one node/);
        unmount();
        assert.throws(() => mount(() => h(function Wrap() { return h(Show, { when: true }, () => h(Text, { text: "x" })); }, null)), /got a For \/ Show/);
        unmount();
    });
});
