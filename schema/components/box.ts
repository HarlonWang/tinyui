import { defineComponent, enumOf } from "@tiny-ui/cli/schema";

export default defineComponent("Box", {
    doc: "Children stacked on top of each other.",
    props: {
        align: enumOf(["topStart", "topCenter", "topEnd", "centerStart", "center", "centerEnd", "bottomStart", "bottomCenter", "bottomEnd"], { default: "topStart" }),
    },
    events: { onClick: {} },
    children: true,
});
