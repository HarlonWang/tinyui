import { Button, Column, createResource, createStore, effect, For, LazyColumn, ref, Row, Show, Text, TextField, untrack, type LazyColumnCommands, type TextFieldCommands } from "@tiny-ui/core";
import { http } from "@tiny-ui/native";

interface Todo { id: number; title: string; done: boolean }
interface Page { items: Todo[]; next: number | null }

export default function Todos() {
    const store = createStore({ todos: [] as Todo[], next: 1 as number | null, loading: false });
    const [first, firstMeta] = createResource(() => http.get<Page>("/todos?page=1"));
    effect(() => {
        const r = first();
        if (r) untrack(() => { store.todos = r.body.items; store.next = r.body.next; });
    });
    const list = ref<LazyColumnCommands>();
    const input = ref<TextFieldCommands>();

    async function loadMore() {
        const page = store.next;
        if (page === null || store.loading) return;
        store.loading = true;
        try {
            const { body } = await http.get<Page>(`/todos?page=${page}`);
            store.todos.push(...body.items);
            store.next = body.next;
        } finally {
            store.loading = false;
        }
    }

    function add(title: string) {
        if (!title.trim()) return;
        store.todos.push({ id: Date.now(), title: title.trim(), done: false });
        input.cmd("setText", { text: "" });
        list.cmd("scrollTo", { index: store.todos.length - 1 });
    }

    const remove = (id: number) => {
        const at = store.todos.findIndex((t) => t.id === id);
        if (at >= 0) store.todos.splice(at, 1);
    };

    return (
        <Column width="fill" height="fill" padding={16} gap={12}>
            <Text text={`${store.todos.length} todos · ${store.todos.filter((t) => t.done).length} done`} fontSize={20} fontWeight="bold" />
            <Show when={first()} fallback={() => <Text text={firstMeta.error() ? "failed to load" : "loading…"} />}>
                {() => (
                    <Column width="fill" gap={12}>
                        <Row gap={8} align="center">
                            <TextField ref={input} placeholder="New todo" width={240} onCommit={(e) => add(e.text)} />
                            <Button text="Add" variant="outlined" onClick={() => input.cmd("focus")} />
                        </Row>
                        <LazyColumn ref={list} width="fill" gap={4} onReachEnd={() => loadMore()}>
                            <For each={store.todos} key={(t) => t.id}>
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
        <Row width="fill" gap={8} align="center" justify="spaceBetween" padding={8} background={props.todo.done ? "#EEF7EE" : "#F4F4F4"} cornerRadius={8} onClick={() => { props.todo.done = !props.todo.done; }}>
            <Text text={props.todo.title} color={props.todo.done ? "#888888" : "#222222"} />
            <Button text="remove" variant="text" onClick={props.onRemove} />
        </Row>
    );
}
