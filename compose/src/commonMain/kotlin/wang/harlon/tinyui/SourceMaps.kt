package wang.harlon.tinyui

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/**
 * The `.js.map` files `tinyui build` wrote, keyed by module name (`pages/todos`, `@tiny-ui/core`), parsed on first use.
 * Ship them in debug builds only (docs/build-chain.md); release stacks are mapped offline with the build id.
 */
class SourceMaps(maps: Map<String, String>) {
    private val entries: Map<String, Lazy<SourceMap>> = maps.mapValues { (_, json) -> lazy { SourceMap(json) } }

    /** Parses an engine stack (`    at fn (module:line:col)` per line), mapping the frames whose module has a map. */
    fun frames(stack: String?): List<StackFrame> {
        if (stack.isNullOrBlank()) return emptyList()
        return stack.lineSequence().mapNotNull(::frame).toList()
    }

    private fun frame(line: String): StackFrame? {
        val m = FRAME.matchEntire(line.trim()) ?: return null
        val function = m.groups[1]?.value ?: "<anonymous>"
        val location = m.groups[2]?.value ?: m.groups[3]!!.value
        val loc = LOCATION.matchEntire(location)
            ?: return StackFrame(function, location, 0, null, mapped = false)
        val file = loc.groupValues[1]
        val lineNo = loc.groupValues[2].toInt()
        val column = loc.groups[3]?.value?.toInt()
        val map = entries[file.removePrefix("${PageHost.MODULE_SCHEME}:")]?.value
        val mapped = map?.lookup(lineNo, column)
        return if (mapped != null) StackFrame(function, mapped.file, mapped.line, mapped.column, mapped = true)
        else StackFrame(function, file, lineNo, column, mapped = false)
    }

    companion object {
        val EMPTY = SourceMaps(emptyMap())
        private val FRAME = Regex("""at (?:(.+?) \((.+)\)|(.+))""")
        private val LOCATION = Regex("""(.+?):(\d+)(?::(\d+))?""")
    }
}

/** Source map v3 (`mappings` VLQ), enough to answer "which source line is generated line L, column C". */
internal class SourceMap(json: String) {
    class Position(val file: String, val line: Int, val column: Int)

    private val sources: List<String>
    /** Per generated line: segments as (generatedColumn, sourceIndex, sourceLine, sourceColumn), all 0-based. */
    private val lines: List<IntArray>

    init {
        val root = Json.parseToJsonElement(json).jsonObject
        sources = root["sources"]?.jsonArray?.map { it.jsonPrimitive.content } ?: emptyList()
        lines = decode(root["mappings"]?.jsonPrimitive?.content ?: "")
    }

    /** [line] and [column] as the engine prints them (1-based); without a column the first segment of the line answers. */
    fun lookup(line: Int, column: Int?): Position? {
        val segments = lines.getOrNull(line - 1) ?: return null
        if (segments.isEmpty()) return null
        var best = -1
        val target = (column ?: 1) - 1
        for (i in 0 until segments.size / 4) {
            if (segments[i * 4] <= target) best = i else break
        }
        if (best < 0) best = 0
        val source = sources.getOrNull(segments[best * 4 + 1]) ?: return null
        return Position(source, segments[best * 4 + 2] + 1, segments[best * 4 + 3] + 1)
    }

    private fun decode(mappings: String): List<IntArray> {
        val out = ArrayList<IntArray>()
        var source = 0; var sourceLine = 0; var sourceColumn = 0
        for (group in mappings.split(';')) {
            var generated = 0
            val segments = ArrayList<Int>()
            if (group.isNotEmpty()) for (segment in group.split(',')) {
                val fields = vlq(segment)
                generated += fields[0]
                if (fields.size >= 4) {
                    source += fields[1]; sourceLine += fields[2]; sourceColumn += fields[3]
                    segments += generated; segments += source; segments += sourceLine; segments += sourceColumn
                }
            }
            out += segments.toIntArray()
        }
        return out
    }

    private fun vlq(segment: String): IntArray {
        val values = ArrayList<Int>()
        var value = 0; var shift = 0
        for (c in segment) {
            val digit = BASE64.indexOf(c)
            require(digit >= 0) { "bad VLQ character '$c'" }
            value = value or ((digit and 31) shl shift)
            if (digit and 32 != 0) { shift += 5; continue }
            values += if (value and 1 != 0) -(value shr 1) else value shr 1
            value = 0; shift = 0
        }
        return values.toIntArray()
    }

    private companion object {
        const val BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
    }
}
