import { boolean, defineComponent, enumOf, field, string } from "tinyui-cli/schema";

export default defineComponent("TextField", {
    doc: "Text and cursor live on the Kotlin side; JS gets notified and issues commands (docs/adr-004 §3.3).",
    props: {
        initialText: string({ initial: true, default: "" }),
        placeholder: string({ default: "" }),
        singleLine: boolean({ default: true }),
        keyboard: enumOf(["text", "number", "email", "phone", "password"], { default: "text" }),
    },
    events: {
        onChange: { text: field.string() },
        onCommit: { text: field.string("on IME action or focus loss") },
    },
    commands: {
        setText: { text: field.string() },
        focus: {},
        blur: {},
    },
});
