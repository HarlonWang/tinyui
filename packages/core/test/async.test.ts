import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { bridge } from "./host-stub.ts";
import { drain, mount, tinyui, transaction, unmount } from "./helpers.ts";
import { call, Column, createResource, h, HostError, onEmit, pageVisible, query, signal, Text, thunk } from "../src/index.ts";
import * as timers from "../src/timers.ts";

const g = globalThis as Record<string, unknown>;
afterEach(() => unmount());

describe("createResource + K3", () => {
    it("fires the host call at creation and writes signals when resolved", async () => {
        mount(() => {
            const [user, { loading }] = createResource(() => call<{ name: string }>("http.get", { url: "/me" }));
            return h(Column, null, h(Text, { text: thunk(() => loading() ? "loading" : user()!.name) }));
        });
        assert.deepEqual(bridge.calls, [{ name: "http.get", cbId: 1, args: { url: "/me" } }]);
        assert.deepEqual(bridge.ops().filter((o) => o[0] === "p"), [["p", 1, "text", "loading"]]);
        tinyui().resolve(1, JSON.stringify({ name: "harlon" }));
        await drain();
        const before = bridge.applied.length;
        tinyui().flush();
        assert.deepEqual(bridge.applied.slice(before).flat(), [["p", 1, "text", "harlon"]]);
        unmount();
    });

    it("rejection lands in error() and is not reported", async () => {
        mount(() => {
            const [, { error }] = createResource(() => call("http.get"));
            return h(Column, null, h(Text, { text: thunk(() => { const e = error(); return e instanceof HostError ? e.code : "ok"; }) }));
        });
        tinyui().reject(2, JSON.stringify({ code: "E_NET", message: "offline" }));
        await drain();
        const before = bridge.applied.length;
        tinyui().flush();
        assert.deepEqual(bridge.applied.slice(before).flat(), [["p", 1, "text", "E_NET"]]);
        assert.equal(bridge.reports.length, 0);
        unmount();
    });

    it("a result arriving after unmount is dropped", async () => {
        mount(() => {
            const [v] = createResource(() => call("x"));
            return h(Column, null, h(Text, { text: thunk(() => String(v())) }));
        });
        const cbId = bridge.calls.at(-1)!.cbId;
        unmount();
        tinyui().resolve(cbId, "1");
        await drain();
        const before = bridge.applied.length;
        tinyui().flush();
        assert.equal(bridge.applied.length, before);
    });
});

describe("other entries", () => {
    it("query returns parsed JSON; timers use the cbId space", () => {
        bridge.queries["device.info"] = { os: "android" };
        assert.deepEqual(query("device.info"), { os: "android" });
        const id = timers.setTimeout(() => {}, 10);
        assert.equal(bridge.calls.at(-1)!.name, "timer.schedule");
        timers.clearTimeout(id);
        assert.deepEqual(bridge.sent.at(-1), { name: "timer.cancel", args: { cbId: id } });
    });

    it("visible() and emit() reach subscribed effects in one transaction", () => {
        mount(() => {
            const [net, setNet] = signal("?");
            onEmit("network", (p) => setNet((p as { online: boolean }).online ? "on" : "off"));
            return h(Column, null, h(Text, { text: thunk(() => `${pageVisible() ? "v" : "h"}:${net()}`) }));
        });
        assert.deepEqual(transaction(() => tinyui().visible(false)), [["p", 1, "text", "h:?"]]);
        assert.deepEqual(transaction(() => tinyui().emit("network", JSON.stringify({ online: true }))), [["p", 1, "text", "h:on"]]);
        unmount();
        tinyui().visible(true);
    });

    it("exposes the protocol version", () => {
        assert.equal(tinyui().protocol, 1);
        g;
    });
});
