package wang.harlon.tinyui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import wang.harlon.quickjs.JsEngine
import wang.harlon.quickjs.JsEngineConfig
import wang.harlon.quickjs.JsException
import wang.harlon.quickjs.JsRef
import wang.harlon.quickjs.JsRuntime
import wang.harlon.quickjs.JsValue
import wang.harlon.quickjs.ObjectTransport
import wang.harlon.tinyui.node.Command
import wang.harlon.tinyui.node.NodeTree
import wang.harlon.tinyui.node.PatchProblem
import wang.harlon.tinyui.node.UiNode
import wang.harlon.tinyui.schema.ComponentRegistry
import wang.harlon.tinyui.schema.NodeScope

/** Bytecode of the runtime modules every page imports, as `tinyui build` writes them under `runtime/`. */
class RuntimeBundle(val core: ByteArray, val native: ByteArray)

/** Everything the host learns about a page's health, in one place (docs/adr-002 §3.5). */
interface PageSink {
    fun patchProblem(problem: PatchProblem)
    fun businessError(entry: String, message: String, stack: String?)
    fun log(line: String)
}

/** The page's failure: engine gone, error page to be rendered by the host. */
class PageFailure(val kind: String, val message: String)

/**
 * One page: its engine, coroutine scope and node tree (docs/adr-002 §3.4). Every K entry is
 * `entry` + `flush` under one [JsRuntime.withEngine] (docs/js-runtime.html §2).
 */
class PageHost(
    private val runtimeBundle: RuntimeBundle,
    private val page: ByteArray,
    val registry: ComponentRegistry,
    private val sink: PageSink,
    private val propsJson: String = "{}",
) {
    val tree = NodeTree(registry, sink::patchProblem)
    var failure: PageFailure? by mutableStateOf(null)
        private set

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val runtime = JsRuntime(JsEngineConfig(moduleScheme = MODULE_SCHEME, logger = sink::log))
    private var entries: Entries? = null

    private class Entries(val self: JsRef, val fns: Map<String, JsRef>) {
        fun call(name: String, vararg args: JsValue) = fns.getValue(name).invoke(self, args.toList())
        fun close() { fns.values.forEach { it.close() }; self.close() }
    }

    fun start() {
        scope.launch {
            try {
                runtime.withEngine {
                    registerHost(this)
                    step("registering @tiny-ui/core") { registerModule(runtimeBundle.core) }
                    step("registering @tiny-ui/native") { registerModule(runtimeBundle.native) }
                    // a registered module only runs on its first import; the runtime must be up before the page
                    evaluateModule("import \"@tiny-ui/core\"; import \"@tiny-ui/native\";").close()
                    val namespace = runBytecode(page, ObjectTransport.REF) as JsRef
                    if (namespace.isPromise) { namespace.close(); error("page module is still pending after microtasks were drained") }
                    val self = evaluate("__tinyui", objects = ObjectTransport.REF) as JsRef
                    val fns = ENTRY_NAMES.associateWith { self.get(it, ObjectTransport.REF) as JsRef }
                    val e = Entries(self, fns).also { entries = it }
                    val protocol = (self.get("protocol") as? JsValue.Num)?.value?.toInt()
                    check(protocol == PROTOCOL) { "protocol $protocol from the runtime module, host implements $PROTOCOL" }
                    namespace.use { ns ->
                        (ns.get("default", ObjectTransport.REF) as JsRef).use { default ->
                            e.call("mount", default, JsValue.Str(propsJson), JsValue.Str(registry.manifest()))
                        }
                    }
                    e.call("flush")
                }
            } catch (t: Throwable) {
                fail("E6", t)
            }
        }
    }

    fun dispatch(nodeId: Int, event: String, payload: String) = entry("dispatch", JsValue.Num(nodeId), JsValue.Str(event), JsValue.Str(payload))
    fun visible(visible: Boolean) = entry("visible", JsValue.Bool(visible))
    fun resolve(cbId: Int, resultJson: String) = entry("resolve", JsValue.Num(cbId), JsValue.Str(resultJson))
    fun reject(cbId: Int, errorJson: String) = entry("reject", JsValue.Num(cbId), JsValue.Str(errorJson))
    fun emit(topic: String, payloadJson: String) = entry("emit", JsValue.Str(topic), JsValue.Str(payloadJson))

    private fun entry(name: String, vararg args: JsValue) {
        if (failure != null) return
        scope.launch {
            try {
                runtime.withEngine {
                    val e = entries ?: return@withEngine
                    e.call(name, *args)
                    e.call("flush")
                }
            } catch (t: Throwable) {
                fail("E2", t)
            }
        }
    }

    fun close() {
        scope.launch {
            try {
                runtime.withEngine {
                    entries?.let { e -> runCatching { e.call("unmount") }; e.close() }
                    entries = null
                }
            } finally {
                runtime.close()
            }
        }
        scope.cancel()
        tree.clear()
    }

    private inline fun <T> step(what: String, block: () -> T): T =
        try { block() } catch (t: Throwable) { throw IllegalStateException("$what: ${t.message}", t) }

    private fun fail(kind: String, t: Throwable) {
        val message = (t as? JsException)?.let { "${it.message}\n${it.jsStack ?: ""}" } ?: t.message ?: t.toString()
        sink.log("page failed ($kind): $message")
        failure = PageFailure(kind, message)
    }

    private fun registerHost(engine: JsEngine) {
        engine.registerFunction("__host_apply") { args ->
            tree.apply((args[0] as JsValue.Str).value)
            JsValue.Undefined
        }
        engine.registerFunction("__host_report") { args ->
            val detail = (args[1] as JsValue.Str).value
            sink.businessError(entry = "js", message = detail, stack = null)
            JsValue.Undefined
        }
        engine.registerFunction("__host_query") { _ -> JsValue.Str("null") }
        engine.registerFunction("__host_call") { args ->
            val name = (args[0] as JsValue.Str).value
            val cbId = (args[1] as JsValue.Num).value.toInt()
            scope.launch { reject(cbId, """{"code":"E_UNSUPPORTED","message":"$name is not available"}""") }
            JsValue.Undefined
        }
        engine.registerFunction("__host_send") { _ -> JsValue.Undefined }
    }

    /** The scope a component renders through. */
    internal inner class Scope(override val node: UiNode) : NodeScope {
        @Suppress("UNCHECKED_CAST")
        override fun <T> get(key: String): T? = (node.props[key] ?: registry.schema(node.type)?.props?.get(key)?.default) as T?
        override fun has(event: String): Boolean = node.events[event] == true
        override fun dispatch(event: String, payload: String) = this@PageHost.dispatch(node.id, event, payload)
        override fun takeCommands(): List<Command> = node.commands.toList().also { node.commands.clear() }
        override fun modifier(): Modifier = Modifier

        @Composable
        override fun Children() {
            for (child in node.children) key(child.id) { Render(child) }
        }
    }

    @Composable
    internal fun Render(node: UiNode) {
        registry.Render(node.type, Scope(node))
    }

    companion object {
        /** `import.meta.url` of a page module is `tinyui:<name>` (docs/adr-005-engine.md). */
        const val MODULE_SCHEME = "tinyui"
        /** docs/patch-protocol.md §6 */
        const val PROTOCOL = 1
        private val ENTRY_NAMES = listOf("mount", "unmount", "visible", "dispatch", "resolve", "reject", "emit", "flush")
    }
}
