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

/** `width` / `height`: a length in dp, or fill / wrap the parent. */
sealed interface SizeValue {
    data class Fixed(val dp: Dp) : SizeValue
    data object Fill : SizeValue
    data object Wrap : SizeValue
}

/**
 * How one prop crosses the bridge: its JSON scalar, the typed value it becomes, and the default `null` restores.
 * Instances are generated from schema/ (docs/components.md).
 */
sealed class PropSpec(val kind: String, val required: Boolean, val initial: Boolean) {
    /** Typed default; `null` when the schema has none. */
    abstract val default: Any?
    abstract fun convert(value: JsonPrimitive): Any?

    class Str(default: String?, required: Boolean = false, initial: Boolean = false) : PropSpec("string", required, initial) {
        override val default: String? = default
        override fun convert(value: JsonPrimitive): Any? = value.takeIf { it.isString }?.content
    }

    class Num(default: Double?, required: Boolean = false, initial: Boolean = false) : PropSpec("number", required, initial) {
        override val default: Double? = default
        override fun convert(value: JsonPrimitive): Any? = value.takeUnless { it.isString }?.doubleOrNull
    }

    class Bool(default: Boolean?, required: Boolean = false, initial: Boolean = false) : PropSpec("boolean", required, initial) {
        override val default: Boolean? = default
        override fun convert(value: JsonPrimitive): Any? = value.takeUnless { it.isString }?.booleanOrNull
    }

    class Dp(default: Double?, required: Boolean = false, initial: Boolean = false) : PropSpec("dp", required, initial) {
        override val default: androidx.compose.ui.unit.Dp? = default?.dp
        override fun convert(value: JsonPrimitive): Any? = value.takeUnless { it.isString }?.doubleOrNull?.dp
    }

    class Sp(default: Double?, required: Boolean = false, initial: Boolean = false) : PropSpec("sp", required, initial) {
        override val default: TextUnit? = default?.sp
        override fun convert(value: JsonPrimitive): Any? = value.takeUnless { it.isString }?.doubleOrNull?.sp
    }

    /** `#RRGGBB` / `#AARRGGBB`, or a theme token name (Theme.kt). */
    class ColorSpec(default: String?, required: Boolean = false, initial: Boolean = false) : PropSpec("color", required, initial) {
        override val default: ColorValue? = default?.let(::parseColorValue)
        override fun convert(value: JsonPrimitive): Any? = value.takeIf { it.isString }?.content?.let(::parseColorValue)
    }

    /** Stored as the enum name; the composable maps it. */
    class Enum(val values: Set<String>, default: String?, required: Boolean = false, initial: Boolean = false) : PropSpec("enum", required, initial) {
        override val default: String? = default
        override fun convert(value: JsonPrimitive): Any? = value.takeIf { it.isString }?.content?.takeIf { it in values }
    }

    class Size(default: String?, required: Boolean = false, initial: Boolean = false) : PropSpec("size", required, initial) {
        override val default: SizeValue? = default?.let(::parseSize)
        override fun convert(value: JsonPrimitive): Any? =
            if (value.isString) parseSize(value.content) else value.doubleOrNull?.let { SizeValue.Fixed(it.dp) }

        private fun parseSize(text: String): SizeValue? = when (text) {
            "fill" -> SizeValue.Fill
            "wrap" -> SizeValue.Wrap
            else -> text.toDoubleOrNull()?.let { SizeValue.Fixed(it.dp) }
        }
    }
}

/** A field of an event payload or command args (flat, scalar). */
enum class FieldSpec {
    Str, Num, Bool;

    fun accepts(value: JsonPrimitive): Boolean = when (this) {
        Str -> value.isString
        Num -> !value.isString && value.doubleOrNull != null
        Bool -> !value.isString && value.booleanOrNull != null
    }
}

internal fun parseColorValue(text: String): ColorValue? =
    if (text.startsWith("#")) parseColor(text)?.let { ColorValue.Literal(it) }
    else text.takeIf(Theme::isColorToken)?.let { ColorValue.Token(it) }

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

class ComponentSchema(
    val type: String,
    val props: Map<String, PropSpec>,
    val events: Map<String, Map<String, FieldSpec>>,
    val commands: Map<String, Map<String, FieldSpec>>,
    val children: Boolean,
    /** Accepts [LayoutProps]. */
    val layout: Boolean,
) {
    /** Own props plus the common layout props when [layout] is on. */
    fun prop(key: String): PropSpec? = props[key] ?: if (layout) LayoutProps.specs[key] else null
}

/** The common layout props; the order here is the Modifier order (docs/components.md §2). */
object LayoutProps {
    val specs: Map<String, PropSpec> = linkedMapOf(
        "weight" to PropSpec.Num(default = null),
        "width" to PropSpec.Size(default = null),
        "height" to PropSpec.Size(default = null),
        "cornerRadius" to PropSpec.Dp(default = null),
        "background" to PropSpec.ColorSpec(default = null),
        "borderWidth" to PropSpec.Dp(default = null),
        "borderColor" to PropSpec.ColorSpec(default = null),
        "padding" to PropSpec.Dp(default = null),
        "paddingHorizontal" to PropSpec.Dp(default = null),
        "paddingVertical" to PropSpec.Dp(default = null),
    )
}

/** A registered component renders one node through its [NodeScope]. */
fun interface Component {
    @Composable
    fun Render(scope: NodeScope)
}
