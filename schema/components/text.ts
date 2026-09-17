import { color, defineComponent, enumOf, number, sp, string, TEXT_STYLES } from "@tiny-ui/cli/schema";

export default defineComponent("Text", {
    props: {
        text: string({ required: true }),
        style: enumOf(TEXT_STYLES, { doc: "Material 3 text style; fontSize / fontWeight override its fields" }),
        color: color(),
        fontSize: sp(),
        fontWeight: enumOf(["normal", "medium", "bold"]),
        maxLines: number({ doc: "0 = unlimited", default: 0 }),
        align: enumOf(["start", "center", "end"], { default: "start" }),
    },
    events: { onClick: {} },
});
