// docs/native-api.md §7: J3 for capabilities the host App registers under its own names.
import { internal } from "@tiny-ui/core";

/** Rejects with HostError E_UNSUPPORTED when the host did not register [name]. */
export function call<T = void>(name: string, args: Record<string, unknown> = {}): Promise<T> {
    return internal.call<T>(name, args);
}
