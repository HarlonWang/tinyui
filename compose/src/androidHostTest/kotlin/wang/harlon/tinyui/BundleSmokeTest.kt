package wang.harlon.tinyui

import wang.harlon.quickjs.JsEngine
import wang.harlon.quickjs.JsEngineConfig
import wang.harlon.quickjs.JsValue
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals

/** Loads what `tinyui build` produced for the sample through the real engine; skips when the sample was not built. */
class BundleSmokeTest {
    private val out = File("../sample/shared/build/tinyui-cli")

    @Test
    fun builtBundlesLoadAndTheRuntimeComesUp() {
        if (!out.isDirectory) return
        JsEngine(JsEngineConfig(moduleScheme = PageHost.MODULE_SCHEME)).use { engine ->
            for (fn in listOf("__host_apply", "__host_query", "__host_call", "__host_send", "__host_report")) engine.registerFunction(fn) { JsValue.Undefined }
            assertEquals("@tiny-ui/core", engine.registerModule(out.resolve("runtime/core.bin").readBytes()))
            assertEquals("@tiny-ui/native", engine.registerModule(out.resolve("runtime/native.bin").readBytes()))
            engine.evaluateModule("import \"@tiny-ui/core\"; export const p = globalThis.__tinyui.protocol;").use {
                assertEquals(JsValue.Num(PageHost.PROTOCOL), it.get("p"))
            }
            engine.runBytecode(out.resolve("pages/counter.bin").readBytes()).let { if (it is AutoCloseable) it.close() }
        }
    }
}
