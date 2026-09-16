import { build as esbuild } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { ComponentDef } from "./dsl.ts";
import { identOf } from "./generate.ts";

/** Bundles a schema entry (TS) and imports it; the entry's default export is the component list. */
export async function loadSchema(entry: string): Promise<ComponentDef[]> {
    const dir = await mkdtemp(join(tmpdir(), "tinyui-schema-"));
    try {
        const outfile = join(dir, "schema.mjs");
        await esbuild({ entryPoints: [resolve(entry)], bundle: true, format: "esm", platform: "node", target: "node22", outfile, logLevel: "silent" });
        const mod = (await import(pathToFileURL(outfile).href)) as { default?: unknown };
        const list = mod.default;
        if (!Array.isArray(list) || list.some((c) => typeof c !== "object" || typeof (c as ComponentDef).name !== "string")) {
            throw new Error(`${entry} must default-export an array of defineComponent() results`);
        }
        const names = new Set<string>();
        const idents = new Map<string, string>();
        for (const c of list as ComponentDef[]) {
            if (names.has(c.name)) throw new Error(`duplicate component ${c.name}`);
            names.add(c.name);
            const id = identOf(c.name);
            const other = idents.get(id);
            if (other) throw new Error(`components ${other} and ${c.name} both generate the identifier ${id}`);
            idents.set(id, c.name);
        }
        return list as ComponentDef[];
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
}
