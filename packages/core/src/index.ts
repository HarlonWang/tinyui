export const VERSION = "0.0.0";

// Globals the engine provides to page code; there is no DOM lib to declare them (docs/adr-005-engine.md).
declare global {
    interface ImportMeta {
        /** `tinyui:<module name>`, e.g. `tinyui:pages/home`. */
        readonly url: string;
    }
}
