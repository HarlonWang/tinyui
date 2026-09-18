package wang.harlon.tinyui

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import wang.harlon.quickjs.JsEngine
import wang.harlon.quickjs.JsEngineConfig
import wang.harlon.quickjs.JsValue
import wang.harlon.tinyui.components.registerBuiltins
import wang.harlon.tinyui.schema.ComponentRegistry
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** Loads what `tinyui build` produced for the sample through the real engine; skips when the sample was not built. */
class BundleSmokeTest {
    private val out = File("../sample/shared/build/tinyui-cli")

    @Test
    fun builtBundlesLoadAndTheRuntimeComesUp() {
        if (!out.isDirectory) return
        JsEngine(JsEngineConfig(moduleScheme = PageHost.MODULE_SCHEME)).use { engine ->
            for (fn in listOf("__host_apply", "__host_query", "__host_call", "__host_send", "__host_report")) engine.registerFunction(fn) { JsValue.Undefined }
            assertEquals("tinyui-core", engine.registerModule(out.resolve("runtime/core.bin").readBytes()))
            assertEquals("tinyui-native", engine.registerModule(out.resolve("runtime/native.bin").readBytes()))
            engine.evaluateModule("import \"tinyui-core\"; export const p = globalThis.__tinyui.protocol;").use {
                assertEquals(JsValue.Num(PageHost.PROTOCOL), it.get("p"))
            }
            engine.runBytecode(out.resolve("pages/counter.bin").readBytes()).let { if (it is AutoCloseable) it.close() }
        }
    }

    /** A rejected `await` in the todos page's `loadMore` is E7; its frames map back to the `.tsx` through the built map. */
    @Test
    fun stacksFromABuiltPageMapBackToTheSource() = runBlocking {
        if (!out.isDirectory) return@runBlocking
        val manifest = BuildManifest.parse(out.resolve("manifest.json").readText())
        val maps = SourceMaps(mapOf("pages/todos" to out.resolve("pages/todos.js.map").readText(), "tinyui-core" to out.resolve("runtime/core.js.map").readText()))
        val errors = mutableListOf<PageError>()
        val sink = object : PageSink {
            override fun error(error: PageError) { errors += error }
            override fun log(line: String) {}
        }
        val http = object : HttpClient {
            override suspend fun request(request: HttpRequest): HttpResponse =
                if (request.url.endsWith("page=1")) HttpResponse(200, """{"items":[{"id":1,"title":"a","done":false}],"next":2}""")
                else throw HostException("E_HTTP", "500")
        }
        val runtime = RuntimeBundle(out.resolve("runtime/core.bin").readBytes(), out.resolve("runtime/native.bin").readBytes())
        val page = PageModule("pages/todos", out.resolve("pages/todos.bin").readBytes(), manifest.buildId("pages/todos"))
        val host = PageHost(runtime, page, ComponentRegistry().registerBuiltins(), sink, HostServices(http = http), sourceMaps = maps)
        host.start()
        try {
            // the list only exists once the first page has loaded; node ids are dense, so scan them
            fun lazyColumn(): Int? = (1..host.tree.size * 2).firstOrNull { host.tree.node(it)?.type == "LazyColumn" }
            withContext(Dispatchers.Default) { withTimeout(10_000) {
                while (lazyColumn() == null) delay(20)
                host.dispatch(lazyColumn()!!, "onReachEnd", "{}")
                while (errors.none { it.kind == "E7" }) delay(20)
            } }
            val e = errors.single { it.kind == "E7" }
            assertEquals(manifest.buildId("pages/todos"), e.buildId)
            val own = e.frames.firstOrNull { it.mapped && it.file == "src/pages/todos.tsx" } ?: error("no mapped frame in ${e.frames}; stack=${e.jsStack}")
            val source = File("../sample/js/src/pages/todos.tsx").readLines()
            assertTrue("await http.get" in source[own.line - 1], "frame $own points at the await; stack=${e.jsStack}")
        } finally {
            host.close()
        }
    }
}
