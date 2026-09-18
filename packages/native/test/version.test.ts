import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { VERSION } from "../src/index.ts";

describe("VERSION", () => {
    it("matches package.json, the version the bytecode ships under", () => {
        const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
        assert.equal(VERSION, pkg.version);
    });
});
