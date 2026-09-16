import { color, defineComponent, enumOf, number, sp, string } from "@tiny-ui/cli/schema";

export default defineComponent("Text", {
    props: {
        text: string({ required: true }),
        color: color(),
        fontSize: sp(),
        fontWeight: enumOf(["normal", "medium", "bold"], { default: "normal" }),
        maxLines: number({ doc: "0 = unlimited", default: 0 }),
        align: enumOf(["start", "center", "end"], { default: "start" }),
    },
    events: { onClick: {} },
});
