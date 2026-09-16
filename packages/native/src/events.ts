// docs/native-api.md §4: one bus for host events and business events.
import { onEmit, send } from "@tiny-ui/core";

/** J4: delivered to every page subscribed to `topic`, including native listeners. */
export function emit(topic: string, payload: Record<string, unknown> = {}): void {
    send("events.emit", { topic, payload });
}

/** K5: call during render; the subscription dies with the owner. */
export function on(topic: string, fn: (payload: unknown) => void): void {
    send("events.subscribe", { topic });
    onEmit(topic, fn);
}
