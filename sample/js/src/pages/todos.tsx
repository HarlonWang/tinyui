import { Button, Column, createResource, effect, For, LazyColumn, ref, Row, Show, signal, Text, TextField, untrack, type LazyColumnCommands, type TextFieldCommands } from "@tiny-ui/core";
import { http } from "@tiny-ui/native";

interface Todo { id: number; title: string; done: boolean }
interface Page { items: Todo[]; next: number | null }

export default function Todos() {
    const [todos, setTodos] = signal<Todo[]>([]);
    const [next, setNext] = signal<number | null>(1);
    const [loading, setLoading] = signal(false);
    const [first, firstMeta] = createResource(() => http.get<Page>("/todos?page=1"));
    effect(() => {
        const r = first();
        if (r) untrack(() => { setTodos(r.body.items); setNext(r.body.next); });
    });
    const list = ref<LazyColumnCommands>();
    const input = ref<TextFieldCommands>();

    async function loadMore() {
        const page = next();
        if (page === null || loading()) return;
        setLoading(true);
        try {
            const { body } = await http.get<Page>(`/todos?page=${page}`);
            setTodos([...todos(), ...body.items]);
            setNext(body.next);
        } finally {
            setLoading(false);
        }
    }

    function add(title: string) {
        if (!title.trim()) return;
        setTodos([...todos(), { id: Date.now(), title: title.trim(), done: false }]);
        input.cmd("setText", { text: "" });
        list.cmd("scrollTo", { index: todos().length - 1 });
    }

    const toggle = (id: number) => setTodos(todos().map((t) => (t.id === id ? { ...t, done: !t.done } : t)));
    const remove = (id: number) => setTodos(todos().filter((t) => t.id !== id));

    return (
        <Column width="fill" height="fill" padding={16} gap={12}>
            <Text text={`${todos().length} todos · ${todos().filter((t) => t.done).length} done`} fontSize={20} fontWeight="bold" />
            <Row gap={8} align="center">
                <TextField ref={input} placeholder="New todo" width={240} onCommit={(e) => add(e.text)} />
                <Button text="Add" variant="outlined" onClick={() => input.cmd("focus")} />
            </Row>
            <Show when={first()} fallback={() => <Text text={firstMeta.error() ? "failed to load" : "loading…"} />}>
                {() => (
                    <LazyColumn ref={list} width="fill" gap={4} onReachEnd={() => loadMore()}>
                        <For each={todos()} key={(t) => t.id}>
                            {(todo) => <TodoRow todo={todo()} onToggle={() => toggle(todo().id)} onRemove={() => remove(todo().id)} />}
                        </For>
                    </LazyColumn>
                )}
            </Show>
        </Column>
    );
}

function TodoRow(props: { todo: Todo; onToggle: () => void; onRemove: () => void }) {
    return (
        <Row width="fill" gap={8} align="center" justify="spaceBetween" padding={8} background={props.todo.done ? "#EEF7EE" : "#F4F4F4"} cornerRadius={8} onClick={props.onToggle}>
            <Text text={props.todo.title} color={props.todo.done ? "#888888" : "#222222"} />
            <Button text="remove" variant="text" onClick={props.onRemove} />
        </Row>
    );
}
