#!/usr/bin/env node
import { parseArgs } from "node:util";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { build } from "./build.ts";
import { generateKt, generateTs } from "./schema/generate.ts";
import { loadSchema } from "./schema/load.ts";

const USAGE = `usage: tinyui build [--root <dir>] [--out <dir>] [--qjsc <path>] [--js-only]
       tinyui schema --entry <schema.ts> [--ts <file>] [--kt <file> --package <pkg> [--object <Name>]] [--check]

build
  --root     project root, pages under <root>/src/pages (default: cwd)
  --out      output directory (default: <root>/dist)
  --qjsc     path to qjsc-kmp (default: $TINYUI_QJSC, then PATH)
  --js-only  emit ESM sources and source maps only, skip bytecode

schema
  --entry    TS module whose default export is the component list
  --ts       write JSX prop types here
  --kt       write Kotlin schemas here (with --package, optional --object, default BuiltinSchemas)
  --node-import  where the generated TS imports Node / Ref from (default tinyui-core)
  --check    exit 1 if a target is not already up to date, write nothing
`;

async function main(argv: string[]): Promise<number> {
    const { values, positionals } = parseArgs({
        args: argv,
        allowPositionals: true,
        options: {
            root: { type: "string" },
            out: { type: "string" },
            qjsc: { type: "string" },
            "js-only": { type: "boolean", default: false },
            entry: { type: "string" },
            ts: { type: "string" },
            kt: { type: "string" },
            package: { type: "string" },
            object: { type: "string", default: "BuiltinSchemas" },
            "node-import": { type: "string", default: "tinyui-core" },
            check: { type: "boolean", default: false },
            help: { type: "boolean", short: "h", default: false },
        },
    });
    if (values.help || (positionals[0] !== "build" && positionals[0] !== "schema")) {
        process.stdout.write(USAGE);
        return values.help ? 0 : 2;
    }
    if (positionals[0] === "schema") return schema(values);
    const result = await build({
        root: values.root ?? process.cwd(),
        ...(values.out !== undefined && { out: values.out }),
        ...(values.qjsc !== undefined && { qjsc: values.qjsc }),
        jsOnly: values["js-only"],
    });
    for (const m of [...result.runtime, ...result.pages]) {
        process.stdout.write(`${m.name} -> ${m.bin ?? m.js}\n`);
    }
    return 0;
}

async function schema(v: { entry?: string; ts?: string; kt?: string; package?: string; object: string; check: boolean; "node-import": string }): Promise<number> {
    if (!v.entry) throw new Error("schema: --entry is required");
    if (!v.ts && !v.kt) throw new Error("schema: nothing to generate; pass --ts and/or --kt");
    if (v.kt && !v.package) throw new Error("schema: --kt needs --package");
    const components = await loadSchema(v.entry);
    const targets: { file: string; content: string }[] = [];
    if (v.ts) targets.push({ file: v.ts, content: generateTs(components, v["node-import"]) });
    if (v.kt) targets.push({ file: v.kt, content: generateKt(components, v.package!, v.object) });
    let stale = 0;
    for (const t of targets) {
        const current = await readFile(t.file, "utf8").catch(() => null);
        if (current === t.content) continue;
        stale++;
        if (v.check) {
            process.stderr.write(`tinyui: ${t.file} is out of date; run tinyui schema\n`);
        } else {
            await mkdir(dirname(t.file), { recursive: true });
            await writeFile(t.file, t.content);
            process.stdout.write(`${t.file}\n`);
        }
    }
    return v.check && stale > 0 ? 1 : 0;
}

main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e: unknown) => {
        process.stderr.write(`tinyui: ${e instanceof Error ? e.message : String(e)}\n`);
        process.exit(1);
    },
);
