import { insideRender, onCleanup, signal } from "./reactive.ts";

export interface ResourceActions {
    loading: () => boolean;
    error: () => unknown;
    refetch: () => void;
}

/** docs/runtime-api.md §6: signals are created now, written when the promise settles. */
export function resource<T>(fetcher: () => Promise<T>): [data: () => T | undefined, actions: ResourceActions] {
    if (!insideRender()) throw new Error("resource() called outside a synchronous render period");
    const [data, setData] = signal<T | undefined>(undefined);
    const [loading, setLoading] = signal(false);
    const [error, setError] = signal<unknown>(undefined);
    let disposed = false;
    onCleanup(() => { disposed = true; });
    const run = () => {
        setLoading(true);
        setError(undefined);
        fetcher().then(
            (v) => { if (disposed) return; setData(() => v); setLoading(false); },
            (e: unknown) => { if (disposed) return; setError(e); setLoading(false); },
        );
    };
    run();
    return [data, { loading, error, refetch: run }];
}
