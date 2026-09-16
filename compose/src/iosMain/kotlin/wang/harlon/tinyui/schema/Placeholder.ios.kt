package wang.harlon.tinyui.schema

import androidx.compose.foundation.border
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import kotlin.native.Platform
import kotlin.experimental.ExperimentalNativeApi

@OptIn(ExperimentalNativeApi::class)
@Composable
internal actual fun Placeholder(scope: NodeScope) {
    if (Platform.isDebugBinary) {
        Text("<${scope.node.type} #${scope.node.id}>", color = Color.Red, modifier = scope.modifier().border(1.dp, Color.Red).padding(4.dp))
    } else {
        EmptyPlaceholder(scope)
    }
}
