export const VERSION = "0.0.0";
export { PROTOCOL, pageVisible, host, onEmit } from "./page.ts";
export type { HostManifest } from "./page.ts";
export { signal, memo, effect, onCleanup, untrack } from "./reactive.ts";
export { createStore, unwrap } from "./store.ts";
export { h, Fragment, thunk, ref } from "./node.ts";
export type { Node, Ref, Component } from "./node.ts";
export { For, Show } from "./control.ts";
export type { ForProps, ShowProps } from "./control.ts";
export { createResource } from "./resource.ts";
export type { ResourceActions } from "./resource.ts";
export { call, query, send, HostError } from "./host.ts";
export * from "./components.ts";

// Globals the engine provides to page code; there is no DOM lib to declare them (docs/adr-005-engine.md).
declare global {
    interface ImportMeta {
        /** `tinyui:<module name>`, e.g. `tinyui:pages/home`. */
        readonly url: string;
    }
}
