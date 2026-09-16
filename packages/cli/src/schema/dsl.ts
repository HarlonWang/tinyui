// Component schema DSL: the single source of truth for built-in and host components (docs/components.md).
// `tinyui schema` turns definitions into JSX prop types (TS) and registration schemas (Kotlin).

export type PropKind = "string" | "number" | "boolean" | "dp" | "sp" | "color" | "enum" | "size";
export type FieldKind = "string" | "number" | "boolean";

export interface PropDef {
    kind: PropKind;
    required?: boolean;
    /** Only the value present at creation counts; later writes are ignored (docs/adr-004 §3.3). */
    initial?: boolean;
    default?: string | number | boolean;
    values?: readonly string[];
    doc?: string;
}

export interface FieldDef {
    kind: FieldKind;
    doc?: string;
}

export interface ComponentDef {
    name: string;
    doc?: string;
    props: Record<string, PropDef>;
    /** event name → payload fields (flat, docs/adr-004 §3.4) */
    events: Record<string, Record<string, FieldDef>>;
    /** command name → args fields */
    commands: Record<string, Record<string, FieldDef>>;
    children: boolean;
    /** Accepts the common layout props (docs/components.md §2). */
    layout: boolean;
}

interface PropOptions { required?: boolean; initial?: boolean; doc?: string }

function prop(kind: PropKind, o: PropOptions & { default?: string | number | boolean } = {}): PropDef {
    const d: PropDef = { kind };
    if (o.required) d.required = true;
    if (o.initial) d.initial = true;
    if (o.default !== undefined) d.default = o.default;
    if (o.doc) d.doc = o.doc;
    return d;
}

export const string = (o: PropOptions & { default?: string } = {}) => prop("string", o);
export const number = (o: PropOptions & { default?: number } = {}) => prop("number", o);
export const boolean = (o: PropOptions & { default?: boolean } = {}) => prop("boolean", o);
export const dp = (o: PropOptions & { default?: number } = {}) => prop("dp", o);
export const sp = (o: PropOptions & { default?: number } = {}) => prop("sp", o);
export const color = (o: PropOptions & { default?: string } = {}) => prop("color", o);
/** A number in dp, or "fill" / "wrap". */
export const size = (o: PropOptions & { default?: number | "fill" | "wrap" } = {}) => prop("size", o);
export function enumOf<const T extends readonly string[]>(values: T, o: PropOptions & { default?: T[number] } = {}): PropDef {
    return { ...prop("enum", o), values };
}

export const field = {
    string: (doc?: string): FieldDef => (doc ? { kind: "string", doc } : { kind: "string" }),
    number: (doc?: string): FieldDef => (doc ? { kind: "number", doc } : { kind: "number" }),
    boolean: (doc?: string): FieldDef => (doc ? { kind: "boolean", doc } : { kind: "boolean" }),
};

export interface ComponentInput {
    doc?: string;
    props?: Record<string, PropDef>;
    events?: Record<string, Record<string, FieldDef>>;
    commands?: Record<string, Record<string, FieldDef>>;
    children?: boolean;
    layout?: boolean;
}

export function defineComponent(name: string, input: ComponentInput = {}): ComponentDef {
    if (!/^[A-Z][A-Za-z0-9]*$|^[a-z][a-z0-9]*\.[A-Z][A-Za-z0-9]*$/.test(name)) {
        throw new Error(`component name ${name} must be Bare (built-in) or prefix.Name (host extension)`);
    }
    for (const ev of Object.keys(input.events ?? {})) {
        if (!/^on[A-Z]/.test(ev)) throw new Error(`${name}: event ${ev} must be named on[A-Z]…`);
    }
    for (const key of Object.keys(input.props ?? {})) {
        if (/^on[A-Z]/.test(key) || key === "ref" || key === "children" || key === "key") throw new Error(`${name}: ${key} cannot be a prop name`);
    }
    return {
        name,
        ...(input.doc !== undefined && { doc: input.doc }),
        props: input.props ?? {},
        events: input.events ?? {},
        commands: input.commands ?? {},
        children: input.children ?? false,
        layout: input.layout ?? true,
    };
}

/** The common layout props every `layout: true` component accepts; order = Modifier order (docs/components.md §2). */
export const LAYOUT_PROPS: Record<string, PropDef> = {
    width: size({ doc: "dp, or fill / wrap" }),
    height: size({ doc: "dp, or fill / wrap" }),
    cornerRadius: dp({ doc: "clips background and content" }),
    background: color(),
    padding: dp({ doc: "all four sides" }),
};
