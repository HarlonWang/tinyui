import { boolean, defineComponent, dp, enumOf } from "@tiny-ui/cli/schema";

export default defineComponent("Column", {
    doc: "Vertical stack.",
    props: {
        gap: dp({ default: 0, doc: "space between children" }),
        align: enumOf(["start", "center", "end"], { default: "start", doc: "cross axis" }),
        justify: enumOf(["start", "center", "end", "spaceBetween"], { default: "start", doc: "main axis" }),
        scroll: boolean({ default: false, doc: "scrolls along the main axis; padding stays outside the scrolling content" }),
    },
    events: { onClick: {} },
    children: true,
});
