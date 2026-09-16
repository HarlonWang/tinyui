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
 * host extensions a prefix such as `pp.KycCard`; both are declared in a schema DSL and generated.
 */
class ComponentRegistry {
    private class Entry(val schema: ComponentSchema, val component: Component)

    private val entries = LinkedHashMap<String, Entry>()

    init {
        register(ComponentSchema(PLACEHOLDER, emptyMap(), emptyMap(), emptyMap(), children = false, layout = true)) { Placeholder(it) }
    }

    fun register(schema: ComponentSchema, component: Component) {
        require(schema.type !in entries) { "component ${schema.type} already registered" }
        entries[schema.type] = Entry(schema, component)
    }

    fun schema(type: String): ComponentSchema? = entries[type]?.schema

    @Composable
    fun Render(type: String, scope: NodeScope) {
        (entries[type] ?: entries.getValue(PLACEHOLDER)).component.Render(scope)
    }

    /** The manifest handed to JS at mount (`hostJson`, docs/runtime-api.md §9). */
    fun manifest(capabilities: List<String>): String = buildJsonObject {
        put("components", JsonObject(entries.filterKeys { it != PLACEHOLDER }.mapValues { (_, e) ->
            buildJsonObject {
                put("props", JsonArray((e.schema.props.keys + if (e.schema.layout) LayoutProps.specs.keys else emptySet()).map(::JsonPrimitive)))
                put("events", JsonArray(e.schema.events.keys.map(::JsonPrimitive)))
                put("commands", JsonArray(e.schema.commands.keys.map(::JsonPrimitive)))
            }
        }))
        put("capabilities", JsonArray(capabilities.map(::JsonPrimitive)))
    }.toString()

    companion object {
        const val PLACEHOLDER = "Placeholder"
    }
}

/** Unknown component type: takes no space in release, shows the type in debug (docs/components.md §5). */
@Composable
internal expect fun Placeholder(scope: NodeScope)

@Composable
internal fun EmptyPlaceholder(scope: NodeScope) {
    Box(scope.modifier())
}
