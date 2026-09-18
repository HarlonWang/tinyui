import { build as esbuild, type Plugin } from "esbuild";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { compileModule, findQjsc } from "./qjsc.ts";
import { TransformError, transformJsx } from "./transform.ts";

/** Runtime module name as the engine sees it → output file under `runtime/`. */
export const RUNTIME_MODULES = { "tinyui-core": "core", "tinyui-native": "native" } as const;

export interface BuildOptions {
    /** Project root: pages are discovered under `<root>/src/pages`, packages resolved from `<root>/node_modules`. */
    root: string;
    /** Output directory; defaults to `<root>/dist`. */
    out?: string;
    /** Path to `qjsc-kmp`; falls back to `TINYUI_QJSC` and then `PATH`. */
    qjsc?: string;
    /** Emit only the ESM sources and skip bytecode; for debugging the transform without an engine build. */
    jsOnly?: boolean;
}

export interface BuiltModule {
    /** Module name as the engine sees it: `pages/home`, `tinyui-core`. */
    name: string;
    js: string;
    map: string;
    /** First 8 hex digits of the sha256 of the ESM output: pairs a stack trace with its source map (docs/build-chain.md). */
    buildId: string;
    bin?: string;
}

export interface BuildResult {
    runtime: BuiltModule[];
    pages: BuiltModule[];
    manifest: string;
}

export interface Manifest {
    runtime: string[];
    pages: string[];
    /** Module name → output path without extension (`runtime/core`, `pages/home`); hosts locate `.bin` / `.js.map` through it. */
    files: Record<string, string>;
    buildIds: Record<string, string>;
}

export async function build(options: BuildOptions): Promise<BuildResult> {
    const root = resolve(options.root);
    const out = resolve(options.out ?? join(root, "dist"));
    const pagesDir = join(root, "src", "pages");
    const pageNames = await discoverPages(pagesDir);
    if (pageNames.size === 0) throw new Error(`no pages found under ${pagesDir}`);

    const qjsc = options.jsOnly ? undefined : await findQjsc(options.qjsc);
    if (!options.jsOnly && !qjsc) {
        throw new Error("qjsc-kmp not found: pass --qjsc, set TINYUI_QJSC, or put it on PATH (or use --js-only)");
    }

    // stale outputs would otherwise be packaged along with the current pages
    await rm(join(out, "pages"), { recursive: true, force: true });
    await rm(join(out, "runtime"), { recursive: true, force: true });
    const runtime = await bundleRuntime(root, out);
    const pages = await bundlePages(root, out, pageNames);
    for (const m of [...runtime, ...pages]) {
        m.buildId = createHash("sha256").update(await readFile(m.js)).digest("hex").slice(0, 8);
        await rootRelativeSources(root, m.map);
    }
    if (qjsc) {
        for (const m of [...runtime, ...pages]) {
            m.bin = m.js.replace(/\.js$/, ".bin");
            await compileModule({ qjsc, input: m.js, output: m.bin, name: m.name });
        }
    }

    const manifest = join(out, "manifest.json");
    const content: Manifest = {
        runtime: runtime.map((m) => m.name),
        pages: pages.map((m) => m.name),
        files: Object.fromEntries([...runtime, ...pages].map((m) => [m.name, relative(out, m.js).replace(/\.js$/, "").split(sep).join("/")])),
        buildIds: Object.fromEntries([...runtime, ...pages].map((m) => [m.name, m.buildId])),
    };
    await writeFile(manifest, JSON.stringify(content, null, 2) + "\n");
    return { runtime, pages, manifest };
}

async function discoverPages(pagesDir: string): Promise<Map<string, string>> {
    const found = new Map<string, string>();
    let entries;
    try {
        entries = await readdir(pagesDir, { recursive: true, withFileTypes: true });
    } catch {
        return found;
    }
    for (const e of entries) {
        if (!e.isFile() || !/\.tsx?$/.test(e.name) || e.name.endsWith(".d.ts")) continue;
        const file = join(e.parentPath, e.name);
        const name = "pages/" + relative(pagesDir, file).replace(/\.tsx?$/, "").split(sep).join("/");
        const clash = found.get(name);
        if (clash) throw new Error(`page ${name} has two sources: ${clash} and ${file}`);
        found.set(name, file);
    }
    return new Map([...found].sort(([a], [b]) => (a < b ? -1 : 1)));
}

async function bundleRuntime(root: string, out: string): Promise<BuiltModule[]> {
    const built: BuiltModule[] = [];
    for (const [name, file] of Object.entries(RUNTIME_MODULES)) {
        const outfile = join(out, "runtime", file + ".js");
        await mkdir(dirname(outfile), { recursive: true });
        await esbuild({
            ...common(root),
            entryPoints: [name],
            outfile,
            external: Object.keys(RUNTIME_MODULES).filter((m) => m !== name),
        });
        built.push({ name, js: outfile, map: outfile + ".map", buildId: "" });
    }
    return built;
}

async function bundlePages(root: string, out: string, pages: Map<string, string>): Promise<BuiltModule[]> {
    const outdir = join(out, "pages");
    await esbuild({
        ...common(root),
        entryPoints: [...pages].map(([name, file]) => ({ in: file, out: name.slice("pages/".length) })),
        outdir,
        outbase: join(root, "src", "pages"),
        // the project's tsconfig says react-jsx for type checking; the output is classic h() regardless
        tsconfigRaw: { compilerOptions: { jsx: "react", jsxFactory: "h", jsxFragmentFactory: "Fragment" } },
        jsx: "transform",
        jsxFactory: "h",
        jsxFragment: "Fragment",
        inject: [JSX_SHIM],
        plugins: [pagePlugin],
    });
    return [...pages.keys()].map((name) => {
        const js = join(outdir, name.slice("pages/".length) + ".js");
        return { name, js, map: js + ".map", buildId: "" };
    });
}

/** esbuild writes `sources` relative to the map; the runtime and offline symbolication want paths from the project root. */
async function rootRelativeSources(root: string, mapFile: string): Promise<void> {
    const map = JSON.parse(await readFile(mapFile, "utf8")) as { sources: string[] };
    map.sources = map.sources.map((s) => {
        // a bare scheme (`tinyui:jsx-shim`) stays; an absolute path (`/x` or `C:\x`) or a map-relative one becomes root-relative
        if (!isAbsolute(s) && /^[a-z][a-z0-9+.-]*:/i.test(s)) return s;
        return relative(root, resolve(dirname(mapFile), s)).split(sep).join("/");
    });
    await writeFile(mapFile, JSON.stringify(map));
}

const JSX_SHIM = "tinyui:jsx-shim";
const TSX = /\.tsx$/;

/** `inject` wants a module; this serves one in memory so pages get `h` / `Fragment` from the runtime module. */
const pagePlugin: Plugin = {
    name: "tinyui-pages",
    setup(api) {
        api.onResolve({ filter: /^tinyui:jsx-shim$/ }, (args) => ({ path: args.path, namespace: "tinyui" }));
        // Runtime modules stay bare specifiers and are pure, so a page that never uses JSX keeps no import of h
        api.onResolve({ filter: /^tinyui-(core|native)$/ }, (args) => ({ path: args.path, external: true, sideEffects: false }));
        api.onLoad({ filter: /.*/, namespace: "tinyui" }, () => ({
            contents: 'export { h, Fragment, thunk } from "tinyui-core";',
            loader: "js",
        }));
        // docs/jsx-transform.md: wrap dynamic attributes before esbuild turns JSX into h()
        api.onLoad({ filter: TSX }, async (args) => {
            const source = await readFile(args.path, "utf8");
            try {
                // the map's `source` is resolved against the file's directory, so it has to be the absolute path
                const { code, map } = transformJsx(args.path, source);
                const inline = Buffer.from(map).toString("base64");
                return { contents: `${code}\n//# sourceMappingURL=data:application/json;base64,${inline}`, loader: "tsx" };
            } catch (e) {
                if (e instanceof TransformError) {
                    return { errors: [{ text: e.message.slice(e.message.indexOf(": ") + 2), location: { file: args.path, line: e.line, column: e.column - 1 } }] };
                }
                throw e;
            }
        });
    },
};

function common(root: string) {
    return {
        absWorkingDir: root,
        bundle: true,
        format: "esm" as const,
        platform: "neutral" as const,
        target: "esnext",
        sourcemap: true as const,
        logLevel: "silent" as const,
        splitting: false,
        treeShaking: true,
        legalComments: "none" as const,
    };
}
