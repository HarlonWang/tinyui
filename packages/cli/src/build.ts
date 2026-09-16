import { build as esbuild, type Plugin } from "esbuild";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { compileModule, findQjsc } from "./qjsc.ts";

export const RUNTIME_MODULES = ["@tiny-ui/core", "@tiny-ui/native"] as const;

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
    /** Module name as the engine sees it: `pages/home`, `@tiny-ui/core`. */
    name: string;
    js: string;
    map: string;
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

    const runtime = await bundleRuntime(root, out);
    const pages = await bundlePages(root, out, pageNames);
    if (qjsc) {
        for (const m of [...runtime, ...pages]) {
            m.bin = m.js.replace(/\.js$/, ".bin");
            await compileModule({ qjsc, input: m.js, output: m.bin, name: m.name });
        }
    }

    const manifest = join(out, "manifest.json");
    const content: Manifest = { runtime: runtime.map((m) => m.name), pages: pages.map((m) => m.name) };
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
    for (const name of RUNTIME_MODULES) {
        const outfile = join(out, "runtime", name.replace("@tiny-ui/", "") + ".js");
        await mkdir(dirname(outfile), { recursive: true });
        await esbuild({
            ...common(root),
            entryPoints: [name],
            outfile,
            external: RUNTIME_MODULES.filter((m) => m !== name),
        });
        built.push({ name, js: outfile, map: outfile + ".map" });
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
        jsx: "transform",
        jsxFactory: "h",
        jsxFragment: "Fragment",
        inject: [JSX_SHIM],
        plugins: [pagePlugin],
    });
    return [...pages.keys()].map((name) => {
        const js = join(outdir, name.slice("pages/".length) + ".js");
        return { name, js, map: js + ".map" };
    });
}

const JSX_SHIM = "tinyui:jsx-shim";

/** `inject` wants a module; this serves one in memory so pages get `h` / `Fragment` from the runtime module. */
const pagePlugin: Plugin = {
    name: "tinyui-pages",
    setup(api) {
        api.onResolve({ filter: /^tinyui:jsx-shim$/ }, (args) => ({ path: args.path, namespace: "tinyui" }));
        // Runtime modules stay bare specifiers and are pure, so a page that never uses JSX keeps no import of h
        api.onResolve({ filter: /^@tiny-ui\// }, (args) => ({ path: args.path, external: true, sideEffects: false }));
        api.onLoad({ filter: /.*/, namespace: "tinyui" }, () => ({
            contents: 'export { h, Fragment } from "@tiny-ui/core";',
            loader: "js",
        }));
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
