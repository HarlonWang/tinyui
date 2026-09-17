import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { color, defineComponent, enumOf, string, TEXT_STYLES } from "../src/schema/index.ts";
import { generateKt, generateTs } from "../src/schema/generate.ts";

const card = defineComponent("pp.Card", {
    props: { title: string({ required: true }), tint: color({ default: "primary" }), style: enumOf(TEXT_STYLES) },
    events: {},
});

describe("schema generator", () => {
    it("types color props as ColorValue; host packages import it from core, core defines it", () => {
        const host = generateTs([card]);
        assert.match(host, /import type \{ ColorValue, Node, Ref \} from "@tiny-ui\/core"/);
        assert.match(host, /tint\?: ColorValue;/);
        assert.doesNotMatch(host, /export type ColorValue/);
        const core = generateTs([card], "../node.ts");
        assert.match(core, /export type ColorValue = `#\$\{string\}` \| ColorToken;/);
        assert.match(core, /export type ColorToken = "primary" \|/);
    });

    it("emits the token name sets only for the built-in object", () => {
        const builtin = generateKt([card], "x", "BuiltinSchemas");
        assert.match(builtin, /val colorTokens: Set<String> = setOf\("primary"/);
        assert.match(builtin, /val textStyles: Set<String> = setOf\("displayLarge"/);
        assert.match(builtin, /"tint" to PropSpec\.ColorSpec\(default = "primary"/);
        assert.doesNotMatch(generateKt([card], "x", "HostSchemas"), /colorTokens/);
    });
});
