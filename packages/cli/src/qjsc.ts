import { execFile } from "node:child_process";
import { access, constants } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const EXECUTABLE = process.platform === "win32" ? "qjsc-kmp.exe" : "qjsc-kmp";

/** Locates the quickjs-kmp host compiler: explicit path, then `TINYUI_QJSC`, then `PATH`. */
export async function findQjsc(explicit?: string): Promise<string | undefined> {
    const candidates = [explicit, process.env["TINYUI_QJSC"]].filter((p): p is string => !!p);
    for (const p of candidates) {
        if (await isExecutable(p)) return p;
        throw new Error(`qjsc-kmp not found at ${p}`);
    }
    for (const dir of (process.env["PATH"] ?? "").split(delimiter)) {
        if (dir && (await isExecutable(join(dir, EXECUTABLE)))) return join(dir, EXECUTABLE);
    }
    return undefined;
}

export interface CompileOptions {
    qjsc: string;
    input: string;
    output: string;
    /** Module name recorded in the bytecode; the engine registers and imports it under this exact name. */
    name: string;
}

/** Compiles one ES module source file to engine bytecode with source text stripped (line numbers kept). */
export async function compileModule({ qjsc, input, output, name }: CompileOptions): Promise<void> {
    try {
        await execFileAsync(qjsc, ["-m", "-n", name, "--strip-source", "-o", output, input]);
    } catch (e) {
        const stderr = (e as { stderr?: string }).stderr?.trim();
        throw new Error(`qjsc-kmp failed for ${name}${stderr ? `:\n${stderr}` : ""}`, { cause: e });
    }
}

async function isExecutable(path: string): Promise<boolean> {
    try {
        await access(path, constants.X_OK);
        return true;
    } catch {
        return false;
    }
}
