package wang.harlon.tinyui.schema

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Modifier
import wang.harlon.tinyui.node.Command
import wang.harlon.tinyui.node.UiNode

/** What a component sees of its node: typed props, registered events, children (docs/adr-003 §3.3). */
interface NodeScope {
    val node: UiNode

    /** A prop declared in the schema, already converted; the schema default when JS never set it. */
    operator fun <T> get(key: String): T?

    /** Whether JS registered a handler for [event]; components attach gestures only when true. */
    fun has(event: String): Boolean

    /** K2: fire and forget, on any thread. [payload] is the flat JSON object the event schema declares. */
    fun dispatch(event: String, payload: String = "{}")

    /** Layout modifier from the common props; with [clickable] the click gesture is attached when `onClick` is registered. */
    fun modifier(clickable: Boolean = true): Modifier

    @Composable
    fun Children()

    /** Renders one child; for components that lay children out themselves (LazyColumn). */
    @Composable
    fun RenderChild(child: UiNode)
}

/** Consumes this node's commands as they arrive, oldest first; one-shot, after composition (docs/adr-004 §3.2). */
@Composable
fun NodeScope.Commands(handler: suspend (Command) -> Unit) {
    val node = node
    LaunchedEffect(node) {
        snapshotFlow { node.commands.toList() }.collect { pending ->
            if (pending.isEmpty()) return@collect
            node.commands.removeAll(pending)
            for (c in pending) handler(c)
        }
    }
}
