import { VERSION } from "@tiny-ui/core";
import { title } from "../lib/format.ts";

interface Props { name: string }

export default function Home({ name }: Props) {
    const label = title(name);
    return <Column><Text text={label} /><Text text={VERSION} /></Column>;
}
