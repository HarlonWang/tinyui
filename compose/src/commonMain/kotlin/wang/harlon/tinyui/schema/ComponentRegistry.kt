package wang.harlon.tinyui.schema

import androidx.compose.foundation.layout.Box
import androidx.compose.runtime.Composable
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * App-level, immutable once handed to a page (docs/adr-003 §3.3). Built-in types use bare names,
 * host extensions a prefix such as `pp.KycCard`.
 */
class ComponentRegistry {
    private class Entry(val schema: ComponentSchema, val component: Component)

    private val entries = LinkedHashMap<String, Entry>()

    init {
        register(PLACEHOLDER, {}) { Box(it.modifier()) }
    }

    fun register(type: String, schema: SchemaBuilder.() -> Unit, component: Component) {
        require(type !in entries) { "component $type already registered" }
        entries[type] = Entry(SchemaBuilder().apply(schema).build(), component)
    }

    fun schema(type: String): ComponentSchema? = entries[type]?.schema

    @Composable
    fun Render(type: String, scope: NodeScope) {
        (entries[type] ?: entries.getValue(PLACEHOLDER)).component.Render(scope)
    }

    /** The manifest handed to JS at mount (`hostJson`, docs/runtime-api.md §9). */
    fun manifest(capabilities: List<String> = emptyList()): String = buildJsonObject {
        put("components", JsonObject(entries.filterKeys { it != PLACEHOLDER }.mapValues { (_, e) ->
            buildJsonObject {
                put("props", JsonArray(e.schema.props.keys.map(::JsonPrimitive)))
                put("events", JsonArray(e.schema.events.map(::JsonPrimitive)))
                put("commands", JsonArray(e.schema.commands.map(::JsonPrimitive)))
            }
        }))
        put("capabilities", JsonArray(capabilities.map(::JsonPrimitive)))
    }.toString()

    companion object {
        const val PLACEHOLDER = "Placeholder"
    }
}
