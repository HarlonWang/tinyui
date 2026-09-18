import { defineComponent, dp, field } from "tinyui-cli/schema";

export default defineComponent("LazyColumn", {
    doc: "Virtualised vertical list; children are usually a <For>.",
    props: {
        gap: dp({ default: 0 }),
    },
    events: {
        onReachEnd: {},
        onScrollEnd: { index: field.number("first visible child") },
    },
    commands: {
        scrollTo: { index: field.number() },
    },
    children: true,
});
