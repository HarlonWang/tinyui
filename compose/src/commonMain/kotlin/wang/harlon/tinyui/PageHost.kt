package wang.harlon.tinyui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.foundation.layout.wrapContentWidth
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.Dp
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.DelicateCoroutinesApi
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.newSingleThreadContext
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put
import wang.harlon.quickjs.JsEngine
import wang.harlon.quickjs.JsEngineConfig
import wang.harlon.quickjs.JsException
import wang.harlon.quickjs.JsRef
import wang.harlon.quickjs.JsRuntime
import wang.harlon.quickjs.JsValue
import wang.harlon.quickjs.ObjectTransport
import wang.harlon.tinyui.node.NodeTree
import wang.harlon.tinyui.node.UINode
import wang.harlon.tinyui.schema.ComponentRegistry
import wang.harlon.tinyui.schema.NodeScope
import wang.harlon.tinyui.schema.SizeValue

/** Bytecode of the runtime modules every page imports, as `tinyui build` writes them under `runtime/`. */
class RuntimeBundle(val core: ByteArray, val native: ByteArray)

/** One page's bytecode; [name] is the module name (`pages/todos`) and [buildId] comes from `manifest.json`. */
class PageModule(val name: String, val bytecode: ByteArray, val buildId: String = "")

/** Everything the host learns about a page's health, in one place (docs/adr-002 §3.5). */
/** The page's failure (E2 / E6): engine gone, error page to be rendered by the host. */
class PageFailure(val error: PageError) {
    val kind: String get() = error.kind
    val message: String get() = error.message
}

/**
 * One page: its engine, coroutine scope and node tree (docs/adr-002 §3.4). Every K entry is
 * `entry` + `flush` under one [JsRuntime.withEngine] (docs/js-runtime.html §2). JS runs on a thread
 * owned by the page (docs/adr-002 §4), closed with the engine.
 */
@OptIn(DelicateCoroutinesApi::class, ExperimentalCoroutinesApi::class)
class PageHost(
    private val runtimeBundle: RuntimeBundle,
    private val page: PageModule,
    val registry: ComponentRegistry,
    private val sink: PageSink,
    private val services: HostServices = HostServices.Default,
    private val propsJson: String = "{}",
    /** K entries longer than this are interrupted and fail the page (docs/native-api.md §6). */
    private val entryTimeoutMs: Long = 5_000,
    private val sourceMaps: SourceMaps = SourceMaps.EMPTY,
) {
    val tree = NodeTree(registry) { report("E5", it.reason, op = it.op) }
    var failure: PageFailure? by mutableStateOf(null)
        private set

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val timers = HashMap<Int, Job>()
    private val subscriptions = HashMap<String, AutoCloseable>()
    private val storeVersions = HashMap<String, Long>()
    private val jsThread = newSingleThreadContext("tinyui-page")
    private val runtime = JsRuntime(
        JsEngineConfig(moduleScheme = MODULE_SCHEME, logger = sink::log, onUnhandledRejection = { report("E7", it.message ?: "unhandled rejection", stack = it.jsStack) }),
        jsThread,
    )
    private var entries: Entries? = null

    private class Entries(val self: JsRef, val fns: Map<String, JsRef>) {
        fun call(name: String, vararg args: JsValue) = fns.getValue(name).invoke(self, args.toList())
        fun close() { fns.values.forEach { it.close() }; self.close() }
    }

    fun start() {
        scope.launch {
            try {
                // K0 + K1 mount under the same timeout as every other entry: a page that spins on load fails as E6
                withTimeout(entryTimeoutMs) { runtime.withEngine {
                    registerHost(this)
                    step("registering @tiny-ui/core") { registerModule(runtimeBundle.core) }
                    step("registering @tiny-ui/native") { registerModule(runtimeBundle.native) }
                    // a registered module only runs on its first import; the runtime must be up before the page
                    evaluateModule("import \"@tiny-ui/core\"; import \"@tiny-ui/native\";").close()
                    val namespace = runBytecode(page.bytecode, ObjectTransport.REF) as JsRef
                    if (namespace.isPromise) { namespace.close(); error("page module is still pending after microtasks were drained") }
                    val self = evaluate("__tinyui", objects = ObjectTransport.REF) as JsRef
                    val fns = ENTRY_NAMES.associateWith { self.get(it, ObjectTransport.REF) as JsRef }
                    val e = Entries(self, fns).also { entries = it }
                    val protocol = (self.get("protocol") as? JsValue.Num)?.value?.toInt()
                    check(protocol == PROTOCOL) { "protocol $protocol from the runtime module, host implements $PROTOCOL" }
                    namespace.use { ns ->
                        (ns.get("default", ObjectTransport.REF) as JsRef).use { default ->
                            e.call("mount", default, JsValue.Str(propsJson), JsValue.Str(registry.manifest(CAPABILITIES)))
                        }
                    }
                    e.call("flush")
                } }
            } catch (t: TimeoutCancellationException) {
                fail("E6", IllegalStateException("page load exceeded ${entryTimeoutMs} ms and was interrupted"))
            } catch (t: Throwable) {
                fail("E6", t)
            }
        }
    }

    fun dispatch(nodeId: Int, event: String, payload: String) = entry("dispatch", JsValue.Num(nodeId), JsValue.Str(event), JsValue.Str(payload))
    fun visible(visible: Boolean) = entry("visible", JsValue.Bool(visible))
    fun resolve(cbId: Int, resultJson: String) = entry("resolve", JsValue.Num(cbId), JsValue.Str(resultJson))
    fun reject(cbId: Int, code: String, message: String) =
        entry("reject", JsValue.Num(cbId), JsValue.Str(buildJsonObject { put("code", code); put("message", message) }.toString()))
    /** K5. The host calls this for `navigation.result`; bus topics arrive through the page's own subscriptions. */
    fun emit(topic: String, payloadJson: String) = entry("emit", JsValue.Str(topic), JsValue.Str(payloadJson))

    private fun entry(name: String, vararg args: JsValue, before: () -> Unit = {}, skipWhen: () -> Boolean = { false }) {
        if (failure != null) return
        scope.launch {
            try {
                withTimeout(entryTimeoutMs) {
                    runtime.withEngine {
                        before()
                        if (skipWhen()) return@withEngine
                        val e = entries ?: return@withEngine
                        e.call(name, *args)
                        e.call("flush")
                    }
                }
            } catch (t: TimeoutCancellationException) {
                fail("E6", IllegalStateException("K entry $name exceeded ${entryTimeoutMs} ms and was interrupted"))
            } catch (t: Throwable) {
                fail("E2", t)
            }
        }
    }

    fun close() {
        scope.cancel() // pending entries and timers are its children
        tree.clear()
        // not a child of `scope`: cancelling the page must not cancel its own teardown; the lock orders it after any running entry
        CoroutineScope(Dispatchers.Default).launch {
            try {
                runtime.withEngine {
                    subscriptions.values.forEach { runCatching { it.close() } }
                    subscriptions.clear()
                    entries?.let { e -> runCatching { e.call("unmount") }; e.close() }
                    entries = null
                }
            } finally {
                runtime.close()
                jsThread.close()
            }
        }
    }

    private inline fun <T> step(what: String, block: () -> T): T =
        try { block() } catch (t: Throwable) { throw IllegalStateException("$what: ${t.message}", t) }

    private fun fail(kind: String, t: Throwable) {
        val error = report(kind, t.message ?: t.toString(), stack = (t as? JsException)?.jsStack)
        failure = PageFailure(error)
    }

    private fun report(kind: String, message: String, entry: String? = null, stack: String? = null, op: String? = null): PageError {
        val error = PageError(kind, page.name, page.buildId, message, entry, stack, sourceMaps.frames(stack), op)
        sink.error(error)
        return error
    }

    private fun registerHost(engine: JsEngine) {
        engine.registerFunction("__host_apply") { args ->
            tree.apply((args[0] as JsValue.Str).value)
            JsValue.Undefined
        }
        engine.registerFunction("__host_report") { args ->
            val kind = (args[0] as? JsValue.Str)?.value
            val detail = (args[1] as? JsValue.Str)?.value ?: ""
            val fields = runCatching { Json.parseToJsonElement(detail).jsonObject }.getOrNull()
            if (kind == "E1" && fields != null) {
                report(
                    "E1",
                    fields["message"]?.jsonPrimitive?.contentOrNull ?: "",
                    entry = fields["entry"]?.jsonPrimitive?.contentOrNull ?: "?",
                    stack = fields["stack"]?.jsonPrimitive?.contentOrNull,
                )
            } else {
                report("E1", "unparseable $kind report: $detail")
            }
            JsValue.Undefined
        }
        engine.registerFunction("__host_query") { args -> JsValue.Str(query((args[0] as JsValue.Str).value, (args[1] as JsValue.Str).value)) }
        engine.registerFunction("__host_call") { args ->
            call((args[0] as JsValue.Str).value, (args[1] as JsValue.Num).value.toInt(), (args[2] as JsValue.Str).value)
            JsValue.Undefined
        }
        engine.registerFunction("__host_send") { args ->
            send((args[0] as JsValue.Str).value, (args[1] as JsValue.Str).value)
            JsValue.Undefined
        }
    }

    /** J2 whitelist (docs/native-api.md §1); anything else answers null. */
    private fun query(name: String, argsJson: String): String {
        val a = args(argsJson)
        return when (name) {
            "device.info" -> JsonObject((platformInfo() + services.deviceInfo).mapValues { JsonPrimitive(it.value) }).toString()
            "i18n.t" -> services.i18n.translate(a.str("key") ?: return "null", a["args"]?.toString() ?: "{}")?.let { JsonPrimitive(it).toString() } ?: "null"
            "config.get" -> a.str("key")?.let(services.config::get) ?: "null"
            "store.get" -> a.str("key")?.let(services.store::get) ?: "null"
            else -> "null"
        }
    }

    /** J3 (docs/native-api.md §5); results come back through [resolve] / [reject] as one transaction each. */
    private fun call(name: String, cbId: Int, argsJson: String) {
        val a = args(argsJson)
        when (name) {
            "timer.schedule" -> schedule(cbId, a)
            "http.request" -> scope.launch {
                try {
                    val request = HttpRequest(
                        method = a.str("method") ?: "GET",
                        url = a.str("url") ?: throw HostException("E_INVALID", "http.request needs url"),
                        headers = (a["headers"] as? JsonObject)?.mapValues { it.value.jsonPrimitive.content } ?: emptyMap(),
                        bodyJson = a["body"]?.toString(),
                        timeoutMs = a["timeout"]?.jsonPrimitive?.longOrNull,
                    )
                    val response = services.http.request(request)
                    resolve(cbId, buildJsonObject { put("status", response.status); put("body", Json.parseToJsonElement(response.bodyJson)) }.toString())
                } catch (e: HostException) {
                    reject(cbId, e.code, e.message ?: "")
                } catch (e: Exception) {
                    reject(cbId, "E_NET", e.message ?: e.toString())
                }
            }
            else -> scope.launch { reject(cbId, "E_UNSUPPORTED", "$name is not available") }
        }
    }

    /** J4 (docs/native-api.md §2–§4). */
    private fun send(name: String, argsJson: String) {
        val a = args(argsJson)
        when (name) {
            "timer.cancel" -> a["cbId"]?.jsonPrimitive?.intOrNull?.let { timers.remove(it)?.cancel() }
            "navigation.push" -> services.navigator.push(a.str("page") ?: return, a["params"]?.toString() ?: "{}")
            "navigation.pop" -> services.navigator.pop(a["result"]?.toString())
            "store.set" -> { val key = a.str("key") ?: return; services.store.set(key, a.str("value") ?: "null") }
            // one host listener per key / topic; JS fans out to its own handlers
            "store.subscribe" -> { val key = a.str("key") ?: return; subscriptions.getOrPut("store:$key") { services.store.observe(key) { v -> storeChanged(key, v) } } }
            "events.emit" -> services.events.emit(a.str("topic") ?: return, a["payload"]?.toString() ?: "{}")
            "events.subscribe" -> { val topic = a.str("topic") ?: return; subscriptions.getOrPut("events:$topic") { services.events.subscribe(topic) { json -> emit(topic, json) } } }
            else -> sink.log("unknown J4 $name")
        }
    }

    /** Notifications may arrive out of order across threads; the version decides, applied inside the entry (under the lock). */
    private fun storeChanged(key: String, value: StoreValue) {
        var stale = false
        entry("emit", JsValue.Str("store:$key"), JsValue.Str("""{"value":${value.json}}"""), before = {
            val last = storeVersions[key] ?: -1
            if (value.version <= last) stale = true else storeVersions[key] = value.version
        }, skipWhen = { stale })
    }

    /**
     * The host side of `setTimeout` (J3 `timer.schedule` → K3 `resolve`); dies with the page.
     * [timers] is only touched while holding the runtime lock: here and in `timer.cancel` (host functions
     * run inside the calling entry) and in the `before` step of the firing entry.
     */
    private fun schedule(cbId: Int, a: JsonObject) {
        val ms = a["ms"]?.jsonPrimitive?.doubleOrNull ?: 0.0
        timers[cbId] = scope.launch {
            delay(ms.toLong().coerceAtLeast(0))
            entry("resolve", JsValue.Num(cbId), JsValue.Str(""), before = { timers.remove(cbId) })
        }
    }

    private fun args(json: String): JsonObject = runCatching { Json.parseToJsonElement(json).jsonObject }.getOrDefault(JsonObject(emptyMap()))
    private fun JsonObject.str(key: String): String? = this[key]?.jsonPrimitive?.contentOrNull

    /** The scope a component renders through. */
    internal inner class Scope(override val node: UINode) : NodeScope {
        @Suppress("UNCHECKED_CAST")
        override fun <T> get(key: String): T? = (node.props[key] ?: registry.schema(node.type)?.prop(key)?.default) as T?
        override fun has(event: String): Boolean = node.events[event] == true
        override fun dispatch(event: String, payload: String) = this@PageHost.dispatch(node.id, event, payload)

        /** docs/components.md §2: size → clip → background → gesture → padding. */
        @Composable
        override fun modifier(clickable: Boolean): Modifier {
            var m: Modifier = Modifier
            when (val w = get<SizeValue>("width")) { is SizeValue.Fixed -> m = m.width(w.dp); SizeValue.Fill -> m = m.fillMaxWidth(); SizeValue.Wrap -> m = m.wrapContentWidth(); null -> {} }
            when (val h = get<SizeValue>("height")) { is SizeValue.Fixed -> m = m.height(h.dp); SizeValue.Fill -> m = m.fillMaxHeight(); SizeValue.Wrap -> m = m.wrapContentHeight(); null -> {} }
            get<Dp>("cornerRadius")?.let { m = m.clip(RoundedCornerShape(it)) }
            color("background")?.let { m = m.background(it) }
            if (clickable && has("onClick")) m = m.clickable { dispatch("onClick") }
            get<Dp>("padding")?.let { m = m.padding(it) }
            return m
        }

        @Composable
        override fun Children() {
            for (child in node.children) key(child.id) { Render(child) }
        }

        @Composable
        override fun RenderChild(child: UINode) = Render(child)
    }

    @Composable
    internal fun Render(node: UINode) {
        registry.Render(node.type, Scope(node))
    }

    companion object {
        /** `import.meta.url` of a page module is `tinyui:<name>` (docs/adr-005-engine.md). */
        const val MODULE_SCHEME = "tinyui"
        /** docs/patch-protocol.md §6 */
        const val PROTOCOL = 1
        private val ENTRY_NAMES = listOf("mount", "unmount", "visible", "dispatch", "resolve", "reject", "emit", "flush")
        private val CAPABILITIES = listOf("device.info", "i18n.t", "config.get", "store.get", "store.set", "navigation.push", "navigation.pop", "events.emit", "http.request", "timer.schedule")
    }
}
