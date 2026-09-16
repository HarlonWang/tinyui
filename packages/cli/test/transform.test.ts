import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { transformJsx, TransformError } from "../src/transform.ts";

const t = (jsx: string) => transformJsx("page.tsx", `export default () => ${jsx};`).code;

describe("thunk wrapping", () => {
    it("wraps calls and member access, leaves identifiers and literals", () => {
        assert.match(t(`<Text text={"n: " + count()} />`), /text=\{thunk\(\(\) => "n: " \+ count\(\)\)\}/);
        assert.match(t(`<Text text={props.title} />`), /thunk\(\(\) => props\.title\)/);
        assert.match(t(`<Text text={items()!} />`), /thunk\(\(\) => items\(\)!\)/);
        assert.doesNotMatch(t(`<Text text={label} size={14} flag={a && b} />`), /thunk/);
        assert.doesNotMatch(t("<Text text={`${a} / ${b}`} />"), /thunk/);
    });
    it("descends into conditionals, templates and object literals but not function bodies", () => {
        assert.match(t(`<Text text={ok ? a() : "b"} />`), /thunk/);
        assert.match(t("<Text text={`${x()}`} />"), /thunk/);
        assert.match(t(`<Row style={{ padding: gap() }} />`), /style=\{thunk\(\(\) => \{ padding: gap\(\) \}\)\}/);
        assert.doesNotMatch(t(`<Row style={{ padding: 8 }} />`), /thunk/);
        assert.doesNotMatch(t(`<Row format={(n) => fmt(n)} />`), /thunk/);
    });
    it("never wraps ref, key, children and on* attributes", () => {
        const code = t(`<For each={items()} key={(it) => it.id} ref={r()} onClick={handlers.get()} />`);
        assert.match(code, /each=\{thunk/);
        assert.doesNotMatch(code, /key=\{thunk|ref=\{thunk|onClick=\{thunk/);
    });
    it("applies to components the same way", () => {
        assert.match(t(`<TodoRow todo={todo()} />`), /todo=\{thunk\(\(\) => todo\(\)\)\}/);
    });
});

describe("rejected shapes", () => {
    const rejects = (jsx: string, re: RegExp) =>
        assert.throws(() => t(jsx), (e: unknown) => e instanceof TransformError && re.test(e.message));
    it("spread attributes", () => rejects(`<Text {...props} />`, /spread/));
    it("expression children", () => {
        rejects(`<Column>{cond && <A />}</Column>`, /dynamic children/);
        rejects(`<Column>{list.map((x) => <A />)}</Column>`, /dynamic children/);
        rejects(`<Column>{value}</Column>`, /dynamic children/);
    });
    it("text children", () => rejects(`<Text>hi</Text>`, /text children/));
    it("allows a render function child and whitespace", () => {
        assert.doesNotThrow(() => t(`<Show when={x()}>\n    {() => <A />}\n</Show>`));
    });
    it("reports the location", () => {
        try { transformJsx("p.tsx", "const a = 1;\nconst b = <Text>hi</Text>;"); assert.fail(); }
        catch (e) { assert.equal((e as TransformError).message.slice(0, 9), "p.tsx:2:1"); }
    });
});

describe("source map", () => {
    it("maps back to the tsx file with content", () => {
        const { map } = transformJsx("pages/home.tsx", `export default () => <Text text={count()} />;`);
        const parsed = JSON.parse(map);
        assert.deepEqual(parsed.sources, ["pages/home.tsx"]);
        assert.ok(parsed.sourcesContent[0].includes("count()"));
    });
});
