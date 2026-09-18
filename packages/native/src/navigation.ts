// docs/native-api.md §2; the host implements Navigator (docs/app-model.md).
import { internal } from "tinyui-core";

export type Params = Record<string, string | number | boolean | null>;

/** J4: opens `page` (a module name such as `pages/detail`) on top of this one. */
export function push(page: string, params: Params = {}): void {
    internal.send("navigation.push", { page, params });
}

/** J4: closes this page; `result` reaches the page below through `onResult`. */
export function pop(result: unknown = null): void {
    internal.send("navigation.pop", { result });
}

/** K5 `navigation.result`: the page that was pushed from here popped with a result. Call during render. */
export function onResult(fn: (result: unknown, from: string) => void): void {
    internal.onEmit("navigation.result", (p) => { const r = p as { result: unknown; from: string }; fn(r.result, r.from); });
}
