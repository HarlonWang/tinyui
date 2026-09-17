package wang.harlon.tinyui.schema

import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle

/** A `color` prop: a literal, or a theme token the host resolves at composition (docs/components.md §6). */
sealed interface ColorValue {
    data class Literal(val color: Color) : ColorValue
    data class Token(val name: String) : ColorValue

    @Composable
    fun resolve(): Color = when (this) {
        is Literal -> color
        is Token -> Theme.color(MaterialTheme.colorScheme, name) ?: Color.Unspecified
    }
}

/** Token names → MaterialTheme values. The name lists in the schema DSL (cli `schema/tokens.ts`) must match these. */
object Theme {
    fun isColorToken(name: String): Boolean = color(PROBE, name) != null

    fun color(scheme: ColorScheme, token: String): Color? = when (token) {
        "primary" -> scheme.primary
        "onPrimary" -> scheme.onPrimary
        "primaryContainer" -> scheme.primaryContainer
        "onPrimaryContainer" -> scheme.onPrimaryContainer
        "inversePrimary" -> scheme.inversePrimary
        "secondary" -> scheme.secondary
        "onSecondary" -> scheme.onSecondary
        "secondaryContainer" -> scheme.secondaryContainer
        "onSecondaryContainer" -> scheme.onSecondaryContainer
        "tertiary" -> scheme.tertiary
        "onTertiary" -> scheme.onTertiary
        "tertiaryContainer" -> scheme.tertiaryContainer
        "onTertiaryContainer" -> scheme.onTertiaryContainer
        "background" -> scheme.background
        "onBackground" -> scheme.onBackground
        "surface" -> scheme.surface
        "onSurface" -> scheme.onSurface
        "surfaceVariant" -> scheme.surfaceVariant
        "onSurfaceVariant" -> scheme.onSurfaceVariant
        "surfaceTint" -> scheme.surfaceTint
        "inverseSurface" -> scheme.inverseSurface
        "inverseOnSurface" -> scheme.inverseOnSurface
        "error" -> scheme.error
        "onError" -> scheme.onError
        "errorContainer" -> scheme.errorContainer
        "onErrorContainer" -> scheme.onErrorContainer
        "outline" -> scheme.outline
        "outlineVariant" -> scheme.outlineVariant
        "scrim" -> scheme.scrim
        "surfaceBright" -> scheme.surfaceBright
        "surfaceDim" -> scheme.surfaceDim
        "surfaceContainer" -> scheme.surfaceContainer
        "surfaceContainerHigh" -> scheme.surfaceContainerHigh
        "surfaceContainerHighest" -> scheme.surfaceContainerHighest
        "surfaceContainerLow" -> scheme.surfaceContainerLow
        "surfaceContainerLowest" -> scheme.surfaceContainerLowest
        else -> null
    }

    fun textStyle(typography: Typography, name: String): TextStyle? = when (name) {
        "displayLarge" -> typography.displayLarge
        "displayMedium" -> typography.displayMedium
        "displaySmall" -> typography.displaySmall
        "headlineLarge" -> typography.headlineLarge
        "headlineMedium" -> typography.headlineMedium
        "headlineSmall" -> typography.headlineSmall
        "titleLarge" -> typography.titleLarge
        "titleMedium" -> typography.titleMedium
        "titleSmall" -> typography.titleSmall
        "bodyLarge" -> typography.bodyLarge
        "bodyMedium" -> typography.bodyMedium
        "bodySmall" -> typography.bodySmall
        "labelLarge" -> typography.labelLarge
        "labelMedium" -> typography.labelMedium
        "labelSmall" -> typography.labelSmall
        else -> null
    }

    private val PROBE = ColorScheme(
        primary = Color.Black, onPrimary = Color.Black, primaryContainer = Color.Black, onPrimaryContainer = Color.Black, inversePrimary = Color.Black,
        secondary = Color.Black, onSecondary = Color.Black, secondaryContainer = Color.Black, onSecondaryContainer = Color.Black,
        tertiary = Color.Black, onTertiary = Color.Black, tertiaryContainer = Color.Black, onTertiaryContainer = Color.Black,
        background = Color.Black, onBackground = Color.Black, surface = Color.Black, onSurface = Color.Black,
        surfaceVariant = Color.Black, onSurfaceVariant = Color.Black, surfaceTint = Color.Black, inverseSurface = Color.Black, inverseOnSurface = Color.Black,
        error = Color.Black, onError = Color.Black, errorContainer = Color.Black, onErrorContainer = Color.Black,
        outline = Color.Black, outlineVariant = Color.Black, scrim = Color.Black,
        surfaceBright = Color.Black, surfaceDim = Color.Black, surfaceContainer = Color.Black, surfaceContainerHigh = Color.Black,
        surfaceContainerHighest = Color.Black, surfaceContainerLow = Color.Black, surfaceContainerLowest = Color.Black,
    )
}
