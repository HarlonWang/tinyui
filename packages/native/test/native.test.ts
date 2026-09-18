import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { bridge } from "./host-stub.ts";
import { Column, h, Text, thunk } from "tinyui-core";
import { events, host, http, navigation, store } from "../src/index.ts";

type Entries = { mount(page: unknown, props: string, host: string): void; unmount(): void; flush(): void; resolve(id: number, json: string): void; emit(topic: string, json: string): void };
const tinyui = (): Entries => (globalThis as Record<string, unknown>)["__tinyui"] as Entries;
const HOST = JSON.stringify({ components: {}, capabilities: [] });
const drain = () => new Promise((r) => setTimeout(r, 0));
afterEach(() => tinyui().unmount());

describe("tinyui-native", () => {
    it("http.get is a J3 http.request that resolves through K3", async () => {
        const p = http.get<{ ok: boolean }>("/me", { timeout: 100 });
        const call = bridge.calls.at(-1)!;
        assert.equal(call.name, "http.request");
        assert.deepEqual(call.args, { method: "GET", url: "/me", timeout: 100 });
        tinyui().resolve(call.cbId, JSON.stringify({ status: 200, body: { ok: true } }));
        await drain();
        assert.deepEqual(await p, { status: 200, body: { ok: true } });
    });

    it("host.call is a J3 under the host's own name", async () => {
        const p = host.call<{ url: string }>("checkout.start", { plan: "annual" });
        const call = bridge.calls.at(-1)!;
        assert.deepEqual([call.name, call.args], ["checkout.start", { plan: "annual" }]);
        tinyui().resolve(call.cbId, JSON.stringify({ url: "https://pay" }));
        await drain();
        assert.deepEqual(await p, { url: "https://pay" });
    });

    it("store.watch reads the snapshot, subscribes, and follows K5", () => {
        bridge.queries["store.get"] = { n: 1 };
        tinyui().mount(() => {
            const cart = store.watch<{ n: number }>("cart"); // at render, like any subscription
            return h(Column, null, h(Text, { text: thunk(() => String((cart() ?? { n: 0 }).n)) }));
        }, "{}", HOST);
        tinyui().flush();
        assert.deepEqual(bridge.sent.at(-1), { name: "store.subscribe", args: { key: "cart" } });
        assert.deepEqual(bridge.applied.at(-1)!.filter((o) => o[0] === "p"), [["p", 1, "text", "1"]]);
        tinyui().emit("store:cart", JSON.stringify({ value: { n: 5 } }));
        tinyui().flush();
        assert.deepEqual(bridge.applied.at(-1), [["p", 1, "text", "5"]]);
        store.set("cart", { n: 6 });
        assert.deepEqual(bridge.sent.at(-1), { name: "store.set", args: { key: "cart", value: '{"n":6}' } });
    });

    it("events.on subscribes once per handler and navigation is fire-and-forget", () => {
        const seen: unknown[] = [];
        tinyui().mount(() => { events.on("net", (p) => seen.push(p)); navigation.onResult((r) => seen.push(r)); return h(Text, { text: "x" }); }, "{}", HOST);
        tinyui().flush();
        assert.deepEqual(bridge.sent.at(-1), { name: "events.subscribe", args: { topic: "net" } });
        tinyui().emit("net", JSON.stringify({ online: true }));
        tinyui().emit("navigation.result", JSON.stringify({ result: 42, from: "pages/x" }));
        assert.deepEqual(seen, [{ online: true }, 42]);
        navigation.push("pages/detail", { id: 1 });
        assert.deepEqual(bridge.sent.at(-1), { name: "navigation.push", args: { page: "pages/detail", params: { id: 1 } } });
    });
});
