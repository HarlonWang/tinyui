#!/usr/bin/env node
import { parseArgs } from "node:util";
import { build } from "./build.ts";

const USAGE = `usage: tinyui build [--root <dir>] [--out <dir>] [--qjsc <path>] [--js-only]

  --root     project root, pages under <root>/src/pages (default: cwd)
  --out      output directory (default: <root>/dist)
  --qjsc     path to qjsc-kmp (default: $TINYUI_QJSC, then PATH)
  --js-only  emit ESM sources and source maps only, skip bytecode
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
            help: { type: "boolean", short: "h", default: false },
        },
    });
    if (values.help || positionals[0] !== "build") {
        process.stdout.write(USAGE);
        return values.help ? 0 : 2;
    }
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

main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e: unknown) => {
        process.stderr.write(`tinyui: ${e instanceof Error ? e.message : String(e)}\n`);
        process.exit(1);
    },
);
