package wang.harlon.tinyui.node

import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.snapshots.SnapshotStateList
import androidx.compose.runtime.snapshots.SnapshotStateMap

/** One node of the page tree; the recomposition unit (docs/adr-003-kotlin-node-tree-and-registry.md). */
class UiNode internal constructor(val id: Int, val type: String) {
    /** Typed prop values, converted on write by the component's schema. */
    val props: SnapshotStateMap<String, Any?> = mutableStateMapOf()
    /** Events the JS side registered a handler for. */
    val events: SnapshotStateMap<String, Boolean> = mutableStateMapOf()
    val children: SnapshotStateList<UiNode> = mutableStateListOf()
    /** One-shot commands waiting for the component to consume them (`x` op). */
    val commands: SnapshotStateList<Command> = mutableStateListOf()
    internal var parent: UiNode? = null
    /** Set once the creating flush is applied: `initial` props stop accepting writes. */
    internal var created = false
}

class Command(val name: String, val args: Map<String, Any?>)
