package wang.harlon.tinyui.components

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.sp
import wang.harlon.tinyui.schema.ComponentRegistry

/** First batch of built-ins (roadmap C); the JSX types in packages/core mirror these schemas by hand for M1. */
fun ComponentRegistry.registerBuiltins(): ComponentRegistry = apply {
    register("Column", {}) { scope -> Column(scope.modifier()) { scope.Children() } }
    register("Row", {}) { scope -> Row(scope.modifier()) { scope.Children() } }
    register("Text", {
        string("text", default = "")
        color("color", default = Color.Unspecified)
        sp("fontSize", default = TextUnit.Unspecified)
    }) { scope ->
        Text(
            text = scope["text"] ?: "",
            color = scope["color"] ?: Color.Unspecified,
            fontSize = scope["fontSize"] ?: TextUnit.Unspecified,
            modifier = scope.modifier(),
        )
    }
    register("Button", {
        string("text", default = "")
        event("onClick")
    }) { scope ->
        Button(onClick = { if (scope.has("onClick")) scope.dispatch("onClick") }, modifier = scope.modifier()) {
            Text(scope["text"] ?: "")
        }
    }
}

