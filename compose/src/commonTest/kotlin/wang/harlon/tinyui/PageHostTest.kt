package wang.harlon.tinyui

import kotlinx.coroutines.Dispatchers
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
            unmount() {}, visible() {}, emit() {},
            resolve(cbId) { patches.push(["p",1,"text","timer " + cbId]); }, reject() {},
            dispatch(id, event) {
                if (id === 2 && event === "onClick") handler();
                if (event === "onTimer") __host_call("timer.schedule", 7, JSON.stringify({ ms: 10 }));
                if (event === "onBoom") { try { throw new Error("boom"); } catch (e) { __host_report("E1", JSON.stringify({ entry: "dispatch", message: e.message, stack: e.stack })); } }
            },
            flush() { if (count > 2) throw new Error("render exploded"); if (patches.length) { __host_apply(JSON.stringify(patches)); patches = []; } },
        };
        export const VERSION = "stub";
    """)
    private val native = module("@tiny-ui/native", "export const NATIVE = 1;")
    private val page = module("pages/counter", "export default function Counter() { return 'page'; }")

    private fun host(props: String = "{}") = PageHost(RuntimeBundle(core, native), page, ComponentRegistry().registerBuiltins(), sink, props)

    // runTest's virtual time never advances the real engine thread: wait on a real dispatcher
    private suspend fun PageHost.await(check: () -> Boolean) =
        withContext(Dispatchers.Default) {
            withTimeout(5_000) {
                while (!check()) {
                    failure?.let { if (!check()) error("page failed: ${it.message}\n${log.joinToString("\n")}") }
                    delay(10)
                }
            }
        }

    @Test
    fun mountsThroughTheEngineAndRendersFromTheTree() = runTest {
        val host = host("""{"name":"tinyui"}""")
        host.start()
        host.await { host.tree.root.children.isNotEmpty() }
        assertEquals("hello tinyui / 4", host.tree.node(1)!!.props["text"])
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
