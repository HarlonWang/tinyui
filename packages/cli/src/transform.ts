import MagicString from "magic-string";
import { parseSync } from "oxc-parser";

/** Attributes the compiler never wraps: docs/jsx-transform.md §2. */
const NEVER_WRAP = /^(ref|key|children|on[A-Z].*)$/;

export interface TransformResult {
    code: string;
    /** JSON source map, v3; `sources` holds the input path. */
    map: string;
}

export class TransformError extends Error {
    readonly file: string;
    readonly line: number;
    readonly column: number;
    constructor(file: string, line: number, column: number, message: string) {
        super(`${file}:${line}:${column}: ${message}`);
        this.file = file;
        this.line = line;
        this.column = column;
    }
}

/**
 * Wraps dynamic JSX attribute expressions in `thunk(() => …)` and rejects children shapes the
 * runtime cannot handle (docs/jsx-transform.md). JSX → `h()` and type erasure stay with esbuild.
 */
export function transformJsx(file: string, source: string): TransformResult {
    const { program, errors } = parseSync(file, source, { lang: "tsx" });
    if (errors.length > 0) {
        const e = errors[0]!;
        const at = e.labels?.[0]?.start ?? 0;
        const { line, column } = position(source, at);
        throw new TransformError(file, line, column, e.message);
    }
    const ms = new MagicString(source);
    const ctx = { file, source, ms };
    walk(program as unknown as AnyNode, (node) => {
        if (node.type === "JSXElement") {
            for (const attr of (node["openingElement"] as AnyNode)["attributes"] as AnyNode[]) visitAttribute(ctx, attr);
            visitChildren(ctx, node["children"] as AnyNode[]);
        } else if (node.type === "JSXFragment") {
            visitChildren(ctx, node["children"] as AnyNode[]);
        }
    });
    return {
        code: ms.toString(),
        map: ms.generateMap({ source: file, includeContent: true, hires: "boundary" }).toString(),
    };
}

interface Ctx { file: string; source: string; ms: MagicString }
type AnyNode = { type: string; start: number; end: number; [k: string]: unknown };

function visitAttribute(ctx: Ctx, attr: AnyNode) {
    if (attr.type === "JSXSpreadAttribute") {
        fail(ctx, attr, "spread attributes are not supported: spreading evaluates getters into a snapshot; list the props explicitly");
    }
    const name = attributeName(attr);
    const value = attr["value"] as AnyNode | null;
    if (!value || value.type !== "JSXExpressionContainer") return;
    const expr = value["expression"] as AnyNode;
    if (expr.type === "JSXEmptyExpression") return;
    if (NEVER_WRAP.test(name)) return;
    if (!isDynamic(expr)) return;
    ctx.ms.prependLeft(expr.start, "thunk(() => ");
    ctx.ms.appendRight(expr.end, ")");
}

function visitChildren(ctx: Ctx, children: AnyNode[]) {
    for (const child of children) {
        if (child.type === "JSXText") {
            if ((ctx.source.slice(child.start, child.end)).trim() !== "") {
                fail(ctx, child, "text children are not supported; pass text through a prop such as text=\"…\"");
            }
        } else if (child.type === "JSXExpressionContainer") {
            const expr = child["expression"] as AnyNode;
            if (expr.type === "JSXEmptyExpression") continue;
            if (expr.type !== "ArrowFunctionExpression" && expr.type !== "FunctionExpression") {
                fail(ctx, child, "dynamic children are not supported; use <Show> for conditions, <For> for lists, and a text prop for text");
            }
        }
    }
}

function attributeName(attr: AnyNode): string {
    const n = attr["name"] as AnyNode;
    if (n.type === "JSXNamespacedName") return `${(n["namespace"] as AnyNode)["name"]}:${(n["name"] as AnyNode)["name"]}`;
    return n["name"] as string;
}

/** True when the expression can read a signal: it contains a call or a property access outside any function body. */
function isDynamic(node: AnyNode): boolean {
    switch (node.type) {
        case "CallExpression":
        case "MemberExpression":
        case "ChainExpression":
        case "NewExpression":
        case "TaggedTemplateExpression":
            return true;
        case "ArrowFunctionExpression":
        case "FunctionExpression":
        case "JSXElement":
        case "JSXFragment":
        case "Literal":
        case "Identifier":
        case "ThisExpression":
            return false;
    }
    for (const value of Object.values(node)) {
        if (Array.isArray(value)) {
            for (const item of value) if (isNode(item) && isDynamic(item)) return true;
        } else if (isNode(value) && isDynamic(value)) {
            return true;
        }
    }
    return false;
}

function walk(node: AnyNode, visit: (n: AnyNode) => void) {
    visit(node);
    for (const value of Object.values(node)) {
        if (Array.isArray(value)) {
            for (const item of value) if (isNode(item)) walk(item, visit);
        } else if (isNode(value)) {
            walk(value, visit);
        }
    }
}

function isNode(v: unknown): v is AnyNode {
    return typeof v === "object" && v !== null && typeof (v as AnyNode).type === "string" && typeof (v as AnyNode).start === "number";
}

function fail(ctx: Ctx, node: AnyNode, message: string): never {
    const { line, column } = position(ctx.source, node.start);
    throw new TransformError(ctx.file, line, column, message);
}

function position(source: string, offset: number): { line: number; column: number } {
    let line = 1, last = 0;
    for (let i = 0; i < offset; i++) if (source.charCodeAt(i) === 10) { line++; last = i + 1; }
    return { line, column: offset - last + 1 };
}
