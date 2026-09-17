package wang.harlon.tinyui

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/** `manifest.json` as `tinyui build` writes it: module names and the build id of each. */
class BuildManifest(val runtime: List<String>, val pages: List<String>, val buildIds: Map<String, String>) {
    fun buildId(module: String): String = buildIds[module] ?: ""

    companion object {
        fun parse(json: String): BuildManifest {
            val root = Json.parseToJsonElement(json).jsonObject
            val names = { key: String -> root[key]?.jsonArray?.map { it.jsonPrimitive.content } ?: emptyList() }
            val ids = root["buildIds"]?.jsonObject?.mapValues { it.value.jsonPrimitive.content } ?: emptyMap()
            return BuildManifest(names("runtime"), names("pages"), ids)
        }
    }
}
