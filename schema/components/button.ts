import { boolean, defineComponent, enumOf, string } from "tinyui-cli/schema";

export default defineComponent("Button", {
    doc: "Label is `text`, or the children when given (an indicator, an icon and a label…); children win.",
    props: {
        text: string({ default: "" }),
        enabled: boolean({ default: true }),
        variant: enumOf(["filled", "outlined", "text"], { default: "filled" }),
    },
    events: { onClick: {} },
    children: true,
});
