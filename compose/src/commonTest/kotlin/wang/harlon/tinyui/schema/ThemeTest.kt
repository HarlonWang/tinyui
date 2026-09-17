package wang.harlon.tinyui.schema

import androidx.compose.material3.Typography
import androidx.compose.material3.lightColorScheme
import androidx.compose.ui.graphics.Color
import kotlinx.serialization.json.JsonPrimitive
import wang.harlon.tinyui.components.generated.BuiltinSchemas
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull

class ThemeTest {
    @Test
    fun everyTokenTheSchemaDslKnowsResolves() {
        val scheme = lightColorScheme()
        for (token in BuiltinSchemas.colorTokens) assertNotNull(Theme.color(scheme, token), "color token $token")
        val typography = Typography()
        for (name in BuiltinSchemas.textStyles) assertNotNull(Theme.textStyle(typography, name), "text style $name")
    }

    @Test
    fun colorPropsTakeLiteralsAndTokensOnly() {
        val spec = PropSpec.ColorSpec(default = "primary")
        assertEquals(ColorValue.Token("primary"), spec.default)
        assertEquals(ColorValue.Literal(Color(0xFF112233)), spec.convert(JsonPrimitive("#112233")))
        assertEquals(ColorValue.Token("onSurfaceVariant"), spec.convert(JsonPrimitive("onSurfaceVariant")))
        assertNull(spec.convert(JsonPrimitive("Primary")), "token names are case-sensitive")
        assertNull(spec.convert(JsonPrimitive("#12")), "malformed literal")
        assertNull(spec.convert(JsonPrimitive(1)))
    }
}
