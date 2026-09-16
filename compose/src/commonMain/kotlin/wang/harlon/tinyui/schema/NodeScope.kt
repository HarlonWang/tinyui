package wang.harlon.tinyui.schema

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import wang.harlon.tinyui.node.Command
import wang.harlon.tinyui.node.UiNode

/** What a component sees of its node: typed props, registered events, children (docs/adr-003 §3.3). */
interface NodeScope {
    val node: UiNode

    /** A prop declared in the schema, already converted; `null` when neither JS nor the schema set it. */
    operator fun <T> get(key: String): T?

    /** Whether JS registered a handler for [event]; components attach gestures only when true. */
    fun has(event: String): Boolean

    /** K2: fire and forget, on any thread. */
    fun dispatch(event: String, payload: String = "{}")

    /** Takes the queued commands for this node, oldest first. */
    fun takeCommands(): List<Command>

    /** Layout modifier from the common props (empty in M1). */
    fun modifier(): Modifier

    @Composable
    fun Children()
}
