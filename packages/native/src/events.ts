// docs/native-api.md §4: one bus for host events and business events.
import { internal } from "tinyui-core";

/** J4: delivered to every page subscribed to `topic`, including native listeners. */
export function emit(topic: string, payload: Record<string, unknown> = {}): void {
    internal.send("events.emit", { topic, payload });
}

/** K5: call during render; the subscription dies with the owner. */
export function on(topic: string, fn: (payload: unknown) => void): void {
    internal.send("events.subscribe", { topic });
    internal.onEmit(topic, fn);
}
