import { boolean, defineComponent } from "tinyui-cli/schema";

export default defineComponent("RadioButton", {
    doc: "Selection lives in JS: `onClick` reports the tap, `selected` is a plain prop.",
    props: {
        selected: boolean({ required: true }),
        enabled: boolean({ default: true }),
    },
    events: { onClick: {} },
});
