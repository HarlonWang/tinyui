// Type-check entry for `jsx: "react-jsx"` + `jsxImportSource: "@tiny-ui/core"`; the CLI still emits h() calls
// (docs/jsx-transform.md). The runtime functions exist so a react-jsx transform would also work.
import { Fragment as FragmentImpl, h, type Node, type Props } from "./node.ts";
import type { IntrinsicElements as Generated } from "./generated/components.ts";

export function jsx(type: string | ((props: Props) => Node), props: Props & { children?: unknown }): Node {
    const { children, ...rest } = props;
    return h(type, rest, ...(Array.isArray(children) ? (children as Node[]) : children === undefined ? [] : [children as Node]));
}

export { jsx as jsxs, jsx as jsxDEV };
export const Fragment = FragmentImpl;

export declare namespace JSX {
    type Element = Node;
    interface ElementChildrenAttribute { children: {} }
    interface IntrinsicElements extends Generated {}
}
