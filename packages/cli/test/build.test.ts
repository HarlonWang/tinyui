import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { build, type BuildResult } from "../src/build.ts";
import { findQjsc } from "../src/qjsc.ts";

const root = join(import.meta.dirname, "fixtures", "app");

describe("tinyui build", () => {
    let out: string;
    let result: BuildResult;
    let qjsc: string | undefined;

    before(async () => {
        out = await mkdtemp(join(tmpdir(), "tinyui-build-"));
        qjsc = await findQjsc();
        result = await build({ root, out, jsOnly: !qjsc });
    });
    after(() => rm(out, { recursive: true, force: true }));

    it("names pages after their path under src/pages", () => {
        assert.deepEqual(result.pages.map((m) => m.name), ["pages/home", "pages/nested/detail"]);
        assert.deepEqual(result.runtime.map((m) => m.name), ["@tiny-ui/core", "@tiny-ui/native"]);
    });

    it("turns JSX into h() calls with the factory imported from @tiny-ui/core", async () => {
        const js = await readFile(join(out, "pages", "home.js"), "utf8");
        assert.match(js, /import \{ h, Fragment, thunk \} from "@tiny-ui\/core"/);
        assert.match(js, /h\(Column, null, .*h\(Text, \{ text: label \}\)/s);
        assert.match(js, /h\(Text, \{ text: thunk\(\(\) => title\(name\)\) \}\)/, "call expressions are wrapped");
        assert.doesNotMatch(js, /interface Props|: Props/, "types are erased");
    });

    it("ignores the project's react-jsx tsconfig: output is h(), never a jsx-runtime import", async () => {
        const js = await readFile(join(out, "pages", "home.js"), "utf8");
        assert.doesNotMatch(js, /jsx-runtime/);
        assert.match(js, /h\(Column/);
    });

    it("inlines relative imports and keeps @tiny-ui/* as bare specifiers", async () => {
        const js = await readFile(join(out, "pages", "home.js"), "utf8");
        assert.match(js, /function title\(name\)/, "../lib/format.ts is bundled in");
        assert.doesNotMatch(js, /from "\.\.?\//, "no relative imports survive");
        assert.match(js, /from "@tiny-ui\/core"/);
    });

    it("imports the JSX factory only from pages that use JSX", async () => {
        const js = await readFile(join(out, "pages", "nested", "detail.js"), "utf8");
        assert.doesNotMatch(js, /@tiny-ui\/core/, "no JSX, no factory import: the runtime module does not export h yet");
    });

    it("keeps ES2025 syntax as is", async () => {
        const js = await readFile(join(out, "pages", "nested", "detail.js"), "utf8");
        assert.match(js, /await Promise\.resolve\(true\)/, "top-level await is not rewritten");
        assert.match(js, /import\.meta\.url/);
    });

    it("writes a source map next to every module", async () => {
        for (const m of [...result.runtime, ...result.pages]) {
            const map = JSON.parse(await readFile(m.map, "utf8")) as { sources: string[] };
            assert.ok(map.sources.length > 0, `${m.name} has sources`);
        }
        const home = JSON.parse(await readFile(join(out, "pages", "home.js.map"), "utf8")) as { sources: string[] };
        assert.ok(home.sources.some((s) => s.endsWith("src/pages/home.tsx")));
    });

    it("bundles each runtime module on its own", async () => {
        const core = await readFile(join(out, "runtime", "core.js"), "utf8");
        assert.match(core, /export \{/);
        assert.doesNotMatch(core, /from "@tiny-ui\//);
    });

    it("rejects two sources for one page name", async () => {
        const clashRoot = await mkdtemp(join(tmpdir(), "tinyui-clash-"));
        try {
            await mkdir(join(clashRoot, "src", "pages"), { recursive: true });
            await writeFile(join(clashRoot, "src", "pages", "home.ts"), "export default () => 1;");
            await writeFile(join(clashRoot, "src", "pages", "home.tsx"), "export default () => 2;");
            await assert.rejects(build({ root: clashRoot, jsOnly: true }), /page pages\/home has two sources/);
        } finally {
            await rm(clashRoot, { recursive: true, force: true });
        }
    });

    it("lists everything in manifest.json", async () => {
        const manifest = JSON.parse(await readFile(result.manifest, "utf8"));
        assert.deepEqual(manifest, {
            runtime: ["@tiny-ui/core", "@tiny-ui/native"],
            pages: ["pages/home", "pages/nested/detail"],
        });
    });

    it("compiles every module to bytecode when qjsc-kmp is available", { skip: !process.env["TINYUI_QJSC"] && "TINYUI_QJSC not set" }, async () => {
        for (const m of [...result.runtime, ...result.pages]) {
            assert.ok(m.bin, `${m.name} has bytecode`);
            const bytes = await readFile(m.bin!);
            assert.equal(bytes.subarray(0, 4).toString("latin1"), "QJKB", `${m.name} bytecode header`);
        }
    });
});
