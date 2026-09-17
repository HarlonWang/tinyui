// docs/native-api.md §3: the truth lives in Kotlin; pages read snapshots and subscribe to changes.
import { internal, signal } from "@tiny-ui/core";

/** J2: the current value, or undefined. */
export function get<T = unknown>(key: string): T | undefined {
    const v = internal.query<T | null>("store.get", { key });
    return v === null ? undefined : v;
}

/** J4: writes the value; every page subscribed to `key` receives it. */
export function set(key: string, value: unknown): void {
    internal.send("store.set", { key, value: JSON.stringify(value) });
}

/** An accessor kept current by K5; call during render, read it inside effects and thunks. */
export function watch<T = unknown>(key: string): () => T | undefined {
    const [value, setValue] = signal<T | undefined>(get<T>(key));
    internal.send("store.subscribe", { key });
    internal.onEmit(`store:${key}`, (p) => setValue(() => ((p as { value: T | null }).value ?? undefined) as T | undefined));
    return value;
}
