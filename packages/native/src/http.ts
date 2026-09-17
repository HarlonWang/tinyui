// docs/native-api.md §5: J3 `http.request`, errors are HostError with the E3 codes.
import { internal } from "@tiny-ui/core";

export interface HttpOptions {
    headers?: Record<string, string>;
    /** ms; the host rejects with E_TIMEOUT */
    timeout?: number;
}

export interface HttpResponse<T = unknown> {
    status: number;
    /** parsed JSON body, or the text when it is not JSON */
    body: T;
}

export function request<T = unknown>(method: string, url: string, body?: unknown, options: HttpOptions = {}): Promise<HttpResponse<T>> {
    return internal.call<HttpResponse<T>>("http.request", { method, url, ...(body !== undefined && { body }), ...options });
}

export const get = <T = unknown>(url: string, options?: HttpOptions) => request<T>("GET", url, undefined, options);
export const post = <T = unknown>(url: string, body?: unknown, options?: HttpOptions) => request<T>("POST", url, body, options);
