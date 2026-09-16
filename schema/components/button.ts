import { boolean, defineComponent, enumOf, string } from "@tiny-ui/cli/schema";

export default defineComponent("Button", {
    props: {
        text: string({ required: true }),
        enabled: boolean({ default: true }),
        variant: enumOf(["filled", "outlined", "text"], { default: "filled" }),
    },
    events: { onClick: {} },
});
