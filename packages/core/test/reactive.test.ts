import assert from "node:assert/strict";
import { describe, it } from "node:test";
import "./host-stub.ts";
import { createOwner, disposeOwner, effect, memo, onCleanup, runPending, runWithOwner, signal, untrack } from "../src/reactive.ts";

const render = <T>(fn: () => T) => { const owner = createOwner(); return { owner, result: runWithOwner(owner, fn) }; };

describe("signal + effect", () => {
    it("runs the effect once on creation and again at flush after a write", () => {
        const [count, setCount] = signal(0);
        const seen: number[] = [];
        const { owner } = render(() => effect(() => seen.push(count())));
        assert.deepEqual(seen, [0]);
        setCount(1);
        assert.equal(count(), 1, "the write is visible immediately");
        assert.deepEqual(seen, [0], "the effect waits for flush");
        runPending();
        assert.deepEqual(seen, [0, 1]);
        disposeOwner(owner);
        setCount(2);
        runPending();
        assert.deepEqual(seen, [0, 1], "disposed effects never run again");
    });

    it("skips equal writes and batches several writes into one run", () => {
        const [a, setA] = signal(1);
        const [b, setB] = signal(1);
        let runs = 0;
        render(() => effect(() => { a(); b(); runs++; }));
        setA(1);
        runPending();
        assert.equal(runs, 1);
        setA(2); setB(2); setA(3);
        runPending();
        assert.equal(runs, 2);
    });

    it("resubscribes on every run so a switched branch drops the old dependency", () => {
        const [flag, setFlag] = signal(true);
        const [a, setA] = signal("a");
        const [b, setB] = signal("b");
        const seen: string[] = [];
        render(() => effect(() => seen.push(flag() ? a() : b())));
        setFlag(false); runPending();
        setA("a2"); runPending();
        assert.deepEqual(seen, ["a", "b"], "a() is no longer a dependency");
        setB("b2"); runPending();
        assert.deepEqual(seen, ["a", "b", "b2"]);
    });

    it("updater form and reads in handlers do not subscribe", () => {
        const [n, setN] = signal(1);
        let runs = 0;
        render(() => effect(() => { untrack(() => n()); runs++; }));
        setN((p) => p + 1);
        runPending();
        assert.equal(n(), 2);
        assert.equal(runs, 1);
    });

    it("throws outside a render period and on an update loop", () => {
        assert.throws(() => effect(() => {}), /outside a synchronous render period/);
        assert.throws(() => onCleanup(() => {}), /outside a synchronous render period/);
        const [n, setN] = signal(0);
        render(() => effect(() => { setN(n() + 1); }));
        assert.throws(() => runPending(), /update loop/);
    });
});

describe("memo", () => {
    it("is lazy, cached, and current right after a write", () => {
        const [n, setN] = signal(2);
        let computed = 0;
        const { result: double } = render(() => memo(() => { computed++; return n() * 2; }));
        assert.equal(computed, 0);
        assert.equal(double(), 4);
        assert.equal(double(), 4);
        assert.equal(computed, 1);
        setN(3);
        assert.equal(double(), 6, "pull-based: no flush needed");
        assert.equal(computed, 2);
    });

    it("schedules effects that read it", () => {
        const [n, setN] = signal(1);
        const seen: number[] = [];
        render(() => { const m = memo(() => n() * 10); effect(() => seen.push(m())); });
        setN(2); runPending();
        assert.deepEqual(seen, [10, 20]);
    });
});

describe("onCleanup", () => {
    it("inside an effect runs before the next run and on dispose; on an owner runs at dispose in reverse order", () => {
        const [n, setN] = signal(0);
        const log: string[] = [];
        const { owner } = render(() => {
            onCleanup(() => log.push("owner-1"));
            onCleanup(() => log.push("owner-2"));
            effect(() => { n(); onCleanup(() => log.push("effect")); });
        });
        setN(1); runPending();
        assert.deepEqual(log, ["effect"]);
        disposeOwner(owner);
        assert.deepEqual(log, ["effect", "effect", "owner-2", "owner-1"]);
    });
});
