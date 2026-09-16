import { title } from "../../lib/format.ts";

export const ready = await Promise.resolve(true);
export default () => `${title("detail")} @ ${import.meta.url}`;
