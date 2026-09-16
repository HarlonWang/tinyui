package wang.harlon.tinyui.node

import androidx.compose.runtime.snapshots.Snapshot
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonPrimitive
import wang.harlon.tinyui.schema.ComponentRegistry

const val ROOT_ID = 0

/** Reported for every op the tree could not apply (E5). The page keeps running. */
class PatchProblem(val op: String, val reason: String) {
    override fun toString(): String = "$reason: $op"
}

/**
 * The page's node table. Only the JS thread writes it, inside [apply]; the main thread only recomposes
 * (docs/adr-003-kotlin-node-tree-and-registry.md §3.2). Op semantics: docs/patch-protocol.md.
 */
class NodeTree(private val registry: ComponentRegistry, private val report: (PatchProblem) -> Unit) {
    val root = UiNode(ROOT_ID, "root")
    private val nodes = HashMap<Int, UiNode>().apply { put(ROOT_ID, root) }

    val size: Int get() = nodes.size

    fun node(id: Int): UiNode? = nodes[id]

    /** Applies one flush atomically: other threads see the tree before or after, never in between. */
    fun apply(json: String) {
        val ops = try {
            Json.parseToJsonElement(json).jsonArray
        } catch (e: Exception) {
            report(PatchProblem(json.take(200), "message is not a JSON array (${e.message})"))
            return
        }
        Snapshot.withMutableSnapshot {
            for (op in ops) applyOp(op)
        }
    }

    fun clear() {
        root.children.clear()
        nodes.clear()
        nodes[ROOT_ID] = root
    }

    private fun applyOp(op: JsonElement) {
        val fields = op as? JsonArray ?: return report(PatchProblem(op.toString(), "op is not an array"))
        val kind = fields.getOrNull(0)?.string() ?: return report(PatchProblem(op.toString(), "op without kind"))
        when (kind) {
            "c" -> create(fields, op)
            "p" -> setProp(fields, op)
            "i" -> insert(fields, op)
            "m" -> move(fields, op)
            "r" -> remove(fields, op)
            "x" -> command(fields, op)
            else -> report(PatchProblem(op.toString(), "unknown op"))
        }
    }

    private fun create(f: JsonArray, op: JsonElement) {
        val id = f.int(1) ?: return report(PatchProblem(op.toString(), "c without id"))
        val type = f.string(2) ?: return report(PatchProblem(op.toString(), "c without type"))
        if (nodes.containsKey(id)) return report(PatchProblem(op.toString(), "id already exists"))
        val known = registry.schema(type) != null
        if (!known) report(PatchProblem(op.toString(), "unknown component type, rendering Placeholder"))
        nodes[id] = UiNode(id, if (known) type else ComponentRegistry.PLACEHOLDER)
    }

    private fun setProp(f: JsonArray, op: JsonElement) {
        val node = target(f, op) ?: return
        val key = f.string(2) ?: return report(PatchProblem(op.toString(), "p without key"))
        val value = f.getOrNull(3) ?: JsonNull
        val schema = registry.schema(node.type) ?: return
        if (key.length > 2 && key.startsWith("on") && key[2].isUpperCase()) {
            if (key !in schema.events) return report(PatchProblem(op.toString(), "event not in schema of ${node.type}"))
            val flag = (value as? JsonPrimitive)?.booleanOrNull ?: return report(PatchProblem(op.toString(), "event flag must be a boolean"))
            if (flag) node.events[key] = true else node.events.remove(key)
            return
        }
        val spec = schema.props[key] ?: return report(PatchProblem(op.toString(), "prop not in schema of ${node.type}"))
        if (value is JsonNull) {
            node.props[key] = spec.default
            return
        }
        val primitive = value as? JsonPrimitive ?: return report(PatchProblem(op.toString(), "prop value must be a scalar"))
        val converted = spec.convert(primitive) ?: return report(PatchProblem(op.toString(), "cannot convert ${primitive} to ${spec.kind} for ${node.type}.$key"))
        node.props[key] = converted
    }

    private fun insert(f: JsonArray, op: JsonElement) {
        val parent = f.int(1)?.let { nodes[it] } ?: return report(PatchProblem(op.toString(), "i: unknown parent"))
        val node = f.int(2)?.let { nodes[it] } ?: return report(PatchProblem(op.toString(), "i: unknown node"))
        if (node.parent != null) return report(PatchProblem(op.toString(), "i: node already has a parent"))
        val index = clamp(f.int(3), parent.children.size, op) ?: return
        node.parent = parent
        parent.children.add(index, node)
    }

    private fun move(f: JsonArray, op: JsonElement) {
        val parent = f.int(1)?.let { nodes[it] } ?: return report(PatchProblem(op.toString(), "m: unknown parent"))
        val node = f.int(2)?.let { nodes[it] } ?: return report(PatchProblem(op.toString(), "m: unknown node"))
        if (node.parent !== parent) return report(PatchProblem(op.toString(), "m: node is not a child of parent"))
        parent.children.remove(node)
        val index = clamp(f.int(3), parent.children.size, op) ?: run { parent.children.add(node); return }
        parent.children.add(index, node)
    }

    private fun remove(f: JsonArray, op: JsonElement) {
        val node = target(f, op) ?: return
        node.parent?.children?.remove(node)
        node.parent = null
        forget(node)
    }

    private fun command(f: JsonArray, op: JsonElement) {
        val node = target(f, op) ?: return
        val name = f.string(2) ?: return report(PatchProblem(op.toString(), "x without name"))
        val schema = registry.schema(node.type) ?: return
        if (name !in schema.commands) return report(PatchProblem(op.toString(), "command not in schema of ${node.type}"))
        val args = (f.getOrNull(3) as? JsonObject)?.mapValues { (_, v) -> (v as? JsonPrimitive)?.scalar() } ?: emptyMap()
        node.commands.add(Command(name, args))
    }

    private fun forget(node: UiNode) {
        nodes.remove(node.id)
        for (child in node.children) forget(child)
    }

    private fun target(f: JsonArray, op: JsonElement): UiNode? {
        val id = f.int(1) ?: run { report(PatchProblem(op.toString(), "op without id")); return null }
        return nodes[id] ?: run { report(PatchProblem(op.toString(), "unknown node $id")); null }
    }

    private fun clamp(index: Int?, size: Int, op: JsonElement): Int? {
        if (index == null) { report(PatchProblem(op.toString(), "missing index")); return null }
        if (index < 0 || index > size) {
            report(PatchProblem(op.toString(), "index $index out of [0, $size], clamped"))
            return index.coerceIn(0, size)
        }
        return index
    }

    private fun JsonArray.int(i: Int): Int? = (getOrNull(i) as? JsonPrimitive)?.intOrNull
    private fun JsonArray.string(i: Int): String? = (getOrNull(i) as? JsonPrimitive)?.takeIf { it.isString }?.content
    private fun JsonElement.string(): String? = (this as? JsonPrimitive)?.takeIf { it.isString }?.content
    private fun JsonPrimitive.scalar(): Any? = when {
        this is JsonNull -> null
        isString -> content
        booleanOrNull != null -> booleanOrNull
        else -> doubleOrNull
    }
}
