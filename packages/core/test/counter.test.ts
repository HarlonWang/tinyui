import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { bridge } from "./host-stub.ts";
import { mount, tinyui, transaction, unmount } from "./helpers.ts";
import { Button, Column, Fragment, h, onCleanup, ref, signal, Text, thunk } from "../src/index.ts";

function Counter() {
    const [count, setCount] = signal(0);
    return h(Column, null,
        h(Text, { text: thunk(() => "Count: " + count()) }),
        h(Button, { text: "+1", onClick: () => setCount(count() + 1) }),
    );
}

afterEach(() => unmount());

describe("Counter end to end", () => {
    it("mounts with the tree bottom-up and the root attached last", () => {
        const ops = mount(Counter);
        assert.deepEqual(ops, [
            ["c", 1, "Text"], ["p", 1, "text", "Count: 0"],
            ["c", 2, "Button"], ["p", 2, "text", "+1"], ["p", 2, "onClick", true],
            ["c", 3, "Column"], ["i", 3, 1, 0], ["i", 3, 2, 1],
            ["i", 0, 3, 0],
        ]);
        unmount();
    });

    it("a click transaction ships exactly one prop op", () => {
        mount(Counter);
        const ops = transaction(() => tinyui().dispatch(2, "onClick", "{}"));
        assert.deepEqual(ops, [["p", 1, "text", "Count: 1"]]);
        assert.deepEqual(transaction(() => tinyui().dispatch(2, "onClick", "{}")), [["p", 1, "text", "Count: 2"]]);
        unmount();
    });

    it("an unknown handler is ignored and an empty flush ships nothing", () => {
        mount(Counter);
        const before = bridge.applied.length;
        transaction(() => tinyui().dispatch(99, "onClick", "{}"));
        assert.equal(bridge.applied.length, before);
        unmount();
    });

    it("a throwing handler is reported as E1 and the transaction still flushes", () => {
        mount(() => {
            const [n, setN] = signal(0);
            return h(Column, null,
                h(Text, { text: thunk(() => String(n())) }),
                h(Button, { text: "x", onClick: () => { setN(1); throw new Error("boom"); } }));
        });
        const ops = transaction(() => tinyui().dispatch(2, "onClick", "{}"));
        assert.deepEqual(ops, [["p", 1, "text", "1"]]);
        assert.equal(bridge.reports.length, 1);
        assert.match((bridge.reports[0]!.detail as { message: string }).message, /boom/);
        unmount();
    });

    it("a render error in flush throws E2 with the buffer cleared", () => {
        mount(() => {
            const [n, setN] = signal(0);
            (globalThis as Record<string, unknown>)["__bump"] = () => setN(1);
            return h(Column, null, h(Text, { text: thunk(() => { if (n() > 0) throw new Error("render"); return "ok"; }) }));
        });
        ((globalThis as Record<string, unknown>)["__bump"] as () => void)();
        const before = bridge.applied.length;
        assert.throws(() => tinyui().flush(), /render/);
        assert.equal(bridge.applied.length, before);
        unmount();
    });

    it("unmount runs cleanups and clears handlers without patches", () => {
        let cleaned = false;
        mount(() => {
            onCleanup(() => { cleaned = true; });
            return h(Button, { text: "x", onClick: () => {} });
        });
        const before = bridge.applied.length;
        unmount();
        assert.equal(cleaned, true);
        assert.equal(bridge.applied.length, before);
        assert.deepEqual(transaction(() => tinyui().dispatch(1, "onClick", "{}")), []);
    });

    it("rejects bad shapes at mount", () => {
        assert.throws(() => mount(() => h(Text, { text: () => "x" } as never)), /did you forget to call it/);
        unmount();
        assert.throws(() => mount(() => h(Text, { text: { a: 1 } } as never)), /do not cross the bridge/);
        unmount();
        assert.throws(() => mount((() => Promise.resolve()) as never), /page must return exactly one node/);
        unmount();
        assert.throws(() => mount(() => h(function Bad() { return [h(Text, { text: "a" })]; } as never, null)), /must return exactly one node, got several/);
        unmount();
    });

    it("a Fragment splices its children into the parent", () => {
        const ops = mount(() => h(Column, null, h(Text, { text: "a" }), h(Fragment, null, h(Text, { text: "b" }), h(Text, { text: "c" })), h(Text, { text: "d" })));
        assert.deepEqual(ops.filter((o) => o[0] === "i"), [["i", 5, 1, 0], ["i", 5, 2, 1], ["i", 5, 3, 2], ["i", 5, 4, 3], ["i", 0, 5, 0]]);
        unmount();
        assert.throws(() => mount(() => h(Fragment, null, h(Text, { text: "a" })) as never), /page must return exactly one node/);
    });

    it("ref + cmd emits an x op in the current transaction", () => {
        const list = ref();
        mount(() => h(Column, { ref: list }, h(Text, { text: "a" })));
        const ops = transaction(() => list.cmd("scrollTo", { index: 0 }));
        assert.deepEqual(ops, [["x", 2, "scrollTo", { index: 0 }]]);
        unmount();
    });

    it("components get getters for thunk props and plain values otherwise", () => {
        function Row(props: { title: string; format: (s: string) => string }) {
            return h(Text, { text: thunk(() => props.format(props.title)) });
        }
        mount(() => {
            const [t, setT] = signal("a");
            (globalThis as Record<string, unknown>)["__setT"] = setT;
            return h(Column, null, h(Row, { title: thunk(() => t()), format: (s: string) => s.toUpperCase() }));
        });
        assert.deepEqual(bridge.ops().filter((o) => o[0] === "p"), [["p", 1, "text", "A"]]);
        assert.deepEqual(transaction(() => ((globalThis as Record<string, unknown>)["__setT"] as (v: string) => void)("b")), [["p", 1, "text", "B"]]);
        unmount();
    });
});
