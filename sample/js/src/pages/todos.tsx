import { Button, Column, effect, For, LazyColumn, observable, ref, resource, Row, Show, Text, TextField, untrack, type LazyColumnCommands, type TextFieldCommands } from "tinyui-core";
import { http } from "tinyui-native";

interface Todo { id: number; title: string; done: boolean }
interface Page { items: Todo[]; next: number | null }

export default function Todos() {
    const state = observable({ todos: [] as Todo[], next: 1 as number | null, loading: false });
    const [first, firstMeta] = resource(() => http.get<Page>("/todos?page=1"));
    effect(() => {
        const r = first();
        if (r) untrack(() => { state.todos = r.body.items; state.next = r.body.next; });
    });
    const list = ref<LazyColumnCommands>();
    const input = ref<TextFieldCommands>();

    async function loadMore() {
        const page = state.next;
        if (page === null || state.loading) return;
        state.loading = true;
        try {
            const { body } = await http.get<Page>(`/todos?page=${page}`);
            state.todos.push(...body.items);
            state.next = body.next;
        } finally {
            state.loading = false;
        }
    }

    function add(title: string) {
        if (!title.trim()) return;
        state.todos.push({ id: Date.now(), title: title.trim(), done: false });
        input.cmd("setText", { text: "" });
        list.cmd("scrollTo", { index: state.todos.length - 1 });
    }

    const remove = (id: number) => {
        const at = state.todos.findIndex((t) => t.id === id);
        if (at >= 0) state.todos.splice(at, 1);
    };

    return (
        <Column width="fill" height="fill" padding={16} gap={12}>
            <Text text={`${state.todos.length} todos · ${state.todos.filter((t) => t.done).length} done`} style="titleLarge" />
            <Show when={first()} fallback={() => <Text text={firstMeta.error() ? "failed to load" : "loading…"} />}>
                {() => (
                    <Column width="fill" gap={12}>
                        <Row gap={8} align="center">
                            <TextField ref={input} placeholder="New todo" width={240} onCommit={(e) => add(e.text)} />
                            <Button text="Add" variant="outlined" onClick={() => input.cmd("focus")} />
                        </Row>
                        <LazyColumn ref={list} width="fill" gap={4} onReachEnd={() => loadMore()}>
                            <For each={state.todos} key={(t) => t.id}>
                                {(todo) => <TodoRow todo={todo()} onRemove={() => remove(todo().id)} />}
                            </For>
                        </LazyColumn>
                    </Column>
                )}
            </Show>
        </Column>
    );
}

function TodoRow(props: { todo: Todo; onRemove: () => void }) {
    return (
        <Row width="fill" gap={8} align="center" padding={8} background={props.todo.done ? "secondaryContainer" : "surfaceContainer"} cornerRadius={8} borderWidth={props.todo.done ? 2 : 0} borderColor="primary" onClick={() => { props.todo.done = !props.todo.done; }}>
            <Text text={props.todo.title} style="bodyLarge" color={props.todo.done ? "onSurfaceVariant" : "onSurface"} weight={1} />
            <Button text="remove" variant="text" onClick={props.onRemove} />
        </Row>
    );
}
