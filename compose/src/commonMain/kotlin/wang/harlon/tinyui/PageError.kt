package wang.harlon.tinyui

/** One line of a JS stack. With a source map the location is the `.tsx` one and [mapped] is true; otherwise it is what the engine printed. */
class StackFrame(val function: String, val file: String, val line: Int, val column: Int?, val mapped: Boolean) {
    override fun toString(): String = "at $function ($file:$line${column?.let { ":$it" } ?: ""})"
}

/**
 * Every failure of a page in one shape (docs/adr-002 §3.5): [kind] is E1–E7. [frames] is [jsStack] parsed and,
 * where a source map was available, mapped back to the source; [buildId] pairs [jsStack] with the map offline.
 */
class PageError(
    val kind: String,
    val page: String,
    val buildId: String,
    val message: String,
    /** E1: the K entry that was running (`dispatch`, `resolve`, `emit`…). */
    val entry: String? = null,
    val jsStack: String? = null,
    val frames: List<StackFrame> = emptyList(),
    /** E5: the op that was skipped. */
    val op: String? = null,
) {
    override fun toString(): String = buildString {
        append(kind).append(' ').append(page)
        if (buildId.isNotEmpty()) append('@').append(buildId)
        entry?.let { append(" [").append(it).append(']') }
        append(": ").append(message)
        op?.let { append(" op=").append(it) }
        for (f in frames) append("\n    ").append(f)
    }
}

interface PageSink {
    fun error(error: PageError)
    /** `console.*` and engine log lines. */
    fun log(line: String)
}
