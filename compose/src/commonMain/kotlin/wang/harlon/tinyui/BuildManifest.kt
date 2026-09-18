package wang.harlon.tinyui

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/** `manifest.json` as `tinyui build` writes it: module names, the output path and the build id of each. */
class BuildManifest(
    val runtime: List<String>,
    val pages: List<String>,
    val files: Map<String, String>,
    val buildIds: Map<String, String>,
) {
    fun buildId(module: String): String = buildIds[module] ?: ""

    /** Output path of [module] without extension (`runtime/core`, `pages/home`): append `.bin` or `.js.map`. */
    fun file(module: String): String = files[module] ?: module

    companion object {
        fun parse(json: String): BuildManifest {
            val root = Json.parseToJsonElement(json).jsonObject
            val names = { key: String -> root[key]?.jsonArray?.map { it.jsonPrimitive.content } ?: emptyList() }
            val strings = { key: String -> root[key]?.jsonObject?.mapValues { it.value.jsonPrimitive.content } ?: emptyMap() }
            return BuildManifest(names("runtime"), names("pages"), strings("files"), strings("buildIds"))
        }
    }
}
