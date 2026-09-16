import { VERSION } from "@tiny-ui/core";
import { greeting } from "../lib/greeting.ts";

export default function home(): string {
    return greeting(`core ${VERSION}`, import.meta.url);
}
