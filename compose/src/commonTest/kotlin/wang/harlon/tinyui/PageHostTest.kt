package wang.harlon.tinyui

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import wang.harlon.quickjs.JsBytecode
import wang.harlon.tinyui.components.registerBuiltins
import wang.harlon.tinyui.node.PatchProblem
import wang.harlon.tinyui.schema.ComponentRegistry
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull

/** Drives PageHost with a hand-written stand-in for `@tiny-ui/core`: the K/J entry shapes, not the real runtime. */
class PageHostTest {
    private val log = mutableListOf<String>()
    private val sink = object : PageSink {
        override fun patchProblem(problem: PatchProblem) { log += "E5 $problem" }
        override fun businessError(entry: String, message: String, stack: String?) { log += "E1 $message @$entry stack=${stack != null}" }
        override fun log(line: String) { log += line }
    }

    private val core = module("@tiny-ui/core", """
        let patches = [], count = 0, handler = null, page = null;
        globalThis.__tinyui = {
            protocol: 1,
            mount(p, props, host) {
                page = p; const name = JSON.parse(props).name ?? "world";
                patches.push(["c",1,"Text"],["p",1,"text","hello " + name + " / " + Object.keys(JSON.parse(host).components).length],
                             ["c",2,"Button"],["p",2,"text","+1"],["p",2,"onClick",true],["c",3,"Column"],["i",3,1,0],["i",3,2,1],["i",0,3,0]);
                handler = () => { count++; patches.push(["p",1,"text","count " + count]); };
            },
            unmount() {}, visible() {},
            resolve(cbId, json) { patches.push(["p",1,"text", cbId === 9 ? "http " + json : "timer " + cbId]); },
            reject(cbId, json) { patches.push(["p",1,"text","rejected " + json]); },
            dispatch(id, event, payloadJson) {
                if (id === 2 && event === "onClick") handler();
                if (event === "onTimer") __host_call("timer.schedule", 7, JSON.stringify({ ms: 10 }));
                if (event === "onBoom") { try { throw new Error("boom"); } catch (e) { __host_report("E1", JSON.stringify({ entry: "dispatch", message: e.message, stack: e.stack })); } }
                if (event === "onQuery") patches.push(["p",1,"text", __host_query("store.get", JSON.stringify({ key: "cart" })) + "|" + __host_query("i18n.t", JSON.stringify({ key: "hi" })) + "|" + JSON.parse(__host_query("device.info", "{}")).os]);
                if (event === "onHttp") __host_call("http.request", 9, JSON.stringify({ method: "GET", url: "/todos" }));
                if (event === "onSubscribe") { __host_send("store.subscribe", JSON.stringify({ key: "cart" })); __host_send("events.subscribe", JSON.stringify({ topic: "net" })); patches.push(["p",1,"text","subscribed"]); }
                if (event === "onSet") __host_send("store.set", JSON.stringify({ key: "cart", value: payloadJson }));
            },
            emit(topic, json) { patches.push(["p",1,"text", topic + " " + json]); },
            flush() { if (count > 2) throw new Error("render exploded"); if (patches.length) { __host_apply(JSON.stringify(patches)); patches = []; } },
        };
        export const VERSION = "stub";
    """)
    private val native = module("@tiny-ui/native", "export const NATIVE = 1;")
    private val page = module("pages/counter", "export default function Counter() { return 'page'; }")

    private val store = InMemoryStore().apply { set("cart", """{"n":2}""") }
    private val services = HostServices(
        store = store,
        i18n = I18n { key, _ -> "hello-$key" },
        deviceInfo = mapOf("app" to "test"),
        http = object : HttpClient {
            override suspend fun request(request: HttpRequest): HttpResponse =
                if (request.url == "/todos") HttpResponse(200, """[{"id":1}]""") else throw HostException("E_HTTP", "404")
        },
    )

    private fun host(props: String = "{}") = PageHost(RuntimeBundle(core, native), page, ComponentRegistry().registerBuiltins(), sink, services, props)

    // runTest's virtual time never advances the real engine thread: wait on a real dispatcher
    private suspend fun PageHost.await(check: () -> Boolean) =
        withContext(Dispatchers.Default) {
            try {
                withTimeout(5_000) {
                    while (!check()) {
                        failure?.let { if (!check()) error("page failed: ${it.message}\n${log.joinToString("\n")}") }
                        delay(10)
                    }
                }
            } catch (e: TimeoutCancellationException) {
                error("timed out; text=${tree.node(1)?.props?.get("text")} log=${log.joinToString(" | ")}")
            }
        }

    @Test
    fun mountsThroughTheEngineAndRendersFromTheTree() = runTest {
        val host = host("""{"name":"tinyui"}""")
        host.start()
        host.await { host.tree.root.children.isNotEmpty() }
        assertEquals("hello tinyui / 8", host.tree.node(1)!!.props["text"])
        assertNull(host.failure)
        host.close()
    }

    @Test
    fun dispatchIsATransactionEndingInFlush() = runTest {
        val host = host()
        host.start()
        host.await { host.tree.root.children.isNotEmpty() }
        host.dispatch(2, "onClick", "{}")
        host.await { host.tree.node(1)!!.props["text"] == "count 1" }
        host.dispatch(2, "onClick", "{}")
        host.await { host.tree.node(1)!!.props["text"] == "count 2" }
        assertNull(host.failure)
        host.close()
    }

    @Test
    fun timersComeBackThroughResolveAndE1ReportsKeepTheirFields() = runTest {
        val host = host()
        host.start()
        host.await { host.tree.root.children.isNotEmpty() }
        host.dispatch(2, "onTimer", "{}")
        host.await { host.tree.node(1)!!.props["text"] == "timer 7" }
        host.dispatch(2, "onBoom", "{}")
        host.await { log.any { it.startsWith("E1 boom") } }
        host.close()
    }

    @Test
    fun hostServicesAnswerJ2J3J4AndK5() = runTest {
        val host = host()
        host.start()
        host.await { host.tree.root.children.isNotEmpty() }
        val text = { host.tree.node(1)!!.props["text"] as? String }
        host.dispatch(2, "onQuery", "{}")
        host.await { text() == """{"n":2}|"hello-hi"|${platformInfo()["os"]}""" }
        host.dispatch(2, "onHttp", "{}")
        host.await { text() == """http {"status":200,"body":[{"id":1}]}""" }
        host.dispatch(2, "onSubscribe", "{}")
        host.await { text() == "subscribed" }
        services.events.emit("net", """{"online":false}""")
        host.await { text() == """net {"online":false}""" }
        host.dispatch(2, "onSet", """{"n":3}""")
        host.await { text() == """store:cart {"value":{"n":3}}""" }
        assertEquals("""{"n":3}""", store.get("cart"))
        host.close()
    }

    @Test
    fun renderErrorsFailThePage() = runTest {
        val host = host()
        host.start()
        host.await { host.tree.root.children.isNotEmpty() }
        repeat(3) { host.dispatch(2, "onClick", "{}") }
        host.await { host.failure != null }
        val failure = assertNotNull(host.failure)
        assertEquals("E2", failure.kind)
        assertEquals(true, "render exploded" in failure.message)
        host.close()
    }

    @Test
    fun protocolMismatchIsE6() = runTest {
        val badCore = module("@tiny-ui/core", "globalThis.__tinyui = { protocol: 99 }; export const VERSION = 'x';")
        val host = PageHost(RuntimeBundle(badCore, native), page, ComponentRegistry().registerBuiltins(), sink)
        host.start()
        host.await { host.failure != null }
        assertEquals("E6", host.failure!!.kind)
        host.close()
    }

    private fun module(name: String, source: String): ByteArray =
        JsBytecode.compile(source.trimIndent(), name, module = true, strip = JsBytecode.Strip.SOURCE)
}
