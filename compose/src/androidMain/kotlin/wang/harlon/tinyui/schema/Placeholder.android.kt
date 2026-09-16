package wang.harlon.tinyui.schema

import android.content.pm.ApplicationInfo
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp

@Composable
internal actual fun Placeholder(scope: NodeScope) {
    val debuggable = (LocalContext.current.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0
    if (debuggable) {
        Text("<${scope.node.type} #${scope.node.id}>", color = Color.Red, modifier = scope.modifier().border(1.dp, Color.Red).padding(4.dp))
    } else {
        EmptyPlaceholder(scope)
    }
}
