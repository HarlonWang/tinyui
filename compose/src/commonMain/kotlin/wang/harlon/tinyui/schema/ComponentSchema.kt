package wang.harlon.tinyui.schema

import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull

/** How one prop crosses the bridge: its JSON scalar, the typed value it becomes, and the default `null` restores. */
sealed class PropSpec(val kind: String, val default: Any?) {
    abstract fun convert(value: JsonPrimitive): Any?

    class Str(default: String?) : PropSpec("string", default) {
        override fun convert(value: JsonPrimitive): Any? = value.takeIf { it.isString }?.content
    }

    class Num(default: Double?) : PropSpec("number", default) {
        override fun convert(value: JsonPrimitive): Any? = value.takeUnless { it.isString }?.doubleOrNull
    }

    class Bool(default: Boolean?) : PropSpec("boolean", default) {
        override fun convert(value: JsonPrimitive): Any? = value.takeUnless { it.isString }?.booleanOrNull
    }

    class Dp(default: androidx.compose.ui.unit.Dp?) : PropSpec("dp", default) {
        override fun convert(value: JsonPrimitive): Any? = value.takeUnless { it.isString }?.doubleOrNull?.dp
    }

    class Sp(default: TextUnit?) : PropSpec("sp", default) {
        override fun convert(value: JsonPrimitive): Any? = value.takeUnless { it.isString }?.doubleOrNull?.sp
    }

    /** `#RRGGBB` or `#AARRGGBB`. */
    class ColorSpec(default: Color?) : PropSpec("color", default) {
        override fun convert(value: JsonPrimitive): Any? = value.takeIf { it.isString }?.content?.let(::parseColor)
    }

    class Enum<T : kotlin.Enum<T>>(default: T?, private val values: Map<String, T>) : PropSpec("enum", default) {
        override fun convert(value: JsonPrimitive): Any? = value.takeIf { it.isString }?.content?.let { values[it] }
    }
}

internal fun parseColor(text: String): Color? {
    if (!text.startsWith("#")) return null
    val hex = text.substring(1)
    val argb = when (hex.length) {
        6 -> 0xFF000000L or (hex.toLongOrNull(16) ?: return null)
        8 -> hex.toLongOrNull(16) ?: return null
        else -> return null
    }
    return Color(argb.toULong().toLong().toInt())
}

class ComponentSchema internal constructor(
    val props: Map<String, PropSpec>,
    val events: Set<String>,
    val commands: Set<String>,
)

class SchemaBuilder internal constructor() {
    private val props = LinkedHashMap<String, PropSpec>()
    private val events = LinkedHashSet<String>()
    private val commands = LinkedHashSet<String>()

    fun string(name: String, default: String? = null) { props[name] = PropSpec.Str(default) }
    fun number(name: String, default: Double? = null) { props[name] = PropSpec.Num(default) }
    fun boolean(name: String, default: Boolean? = null) { props[name] = PropSpec.Bool(default) }
    fun dp(name: String, default: Dp? = null) { props[name] = PropSpec.Dp(default) }
    fun sp(name: String, default: TextUnit? = null) { props[name] = PropSpec.Sp(default) }
    fun color(name: String, default: Color? = null) { props[name] = PropSpec.ColorSpec(default) }
    inline fun <reified T : Enum<T>> enum(name: String, default: T? = null) = enum(name, default, enumValues<T>().associateBy { it.name })
    fun <T : Enum<T>> enum(name: String, default: T?, values: Map<String, T>) { props[name] = PropSpec.Enum(default, values) }
    fun event(name: String) { events += name }
    fun command(name: String) { commands += name }

    internal fun build() = ComponentSchema(props, events, commands)
}

/** A registered component renders one node through its [NodeScope]. */
fun interface Component {
    @Composable
    fun Render(scope: NodeScope)
}
