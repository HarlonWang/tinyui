import { Button, Column, signal, Text } from "tinyui-core";

export default function Counter() {
    const [count, setCount] = signal(0);
    return (
        <Column>
            <Text text={`Count: ${count()}`} fontSize={24} />
            <Button text="+1" onClick={() => setCount(count() + 1)} />
            <Text text={`page ${import.meta.url}`} color="#888888" />
        </Column>
    );
}
