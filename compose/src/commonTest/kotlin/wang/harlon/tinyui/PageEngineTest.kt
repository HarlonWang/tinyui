package wang.harlon.tinyui

import wang.harlon.quickjs.JsBytecode
import wang.harlon.quickjs.JsException
import wang.harlon.quickjs.JsValue
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class PageEngineTest {
    private val runtime = RuntimeBundle(
        core = module("@tiny-ui/core", "export const VERSION = '0.0.0'; export function h(type, props) { return { type, props }; }"),
        native = module("@tiny-ui/native", "import { VERSION } from '@tiny-ui/core'; export const NATIVE = 'native ' + VERSION;"),
    )

    @Test
    fun loadsRuntimeModulesThenPage() {
        val page = module(
            "pages/home",
            """
            import { VERSION, h } from "@tiny-ui/core";
            import { NATIVE } from "@tiny-ui/native";
            export default (who) => `${'$'}{who}: core ${'$'}{VERSION}, ${'$'}{NATIVE}, at ${'$'}{import.meta.url}`;
            """,
        )
        PageEngine.load(runtime, page).use { engine ->
            val text = engine.callDefault(JsValue.Str("hello")) as JsValue.Str
            assertEquals("hello: core 0.0.0, native 0.0.0, at tinyui:pages/home", text.value)
        }
    }

    @Test
    fun topLevelAwaitOnSynchronousWorkResolvesBeforeLoadReturns() {
        val page = module("pages/async", "export const ready = await Promise.resolve(42); export default () => ready;")
        PageEngine.load(runtime, page).use { engine ->
            assertEquals(JsValue.Num(42.0), engine.callDefault())
        }
    }

    @Test
    fun pendingPageModuleIsRejected() {
        val page = module("pages/stuck", "await new Promise(() => {}); export default () => 0;")
        val e = assertFailsWith<IllegalStateException> { PageEngine.load(runtime, page) }
        assertTrue("pending" in e.message!!)
    }

    @Test
    fun unknownImportFailsAtLoad() {
        val page = module("pages/bad", "import { x } from 'pages/other'; export default () => x;")
        assertFailsWith<JsException> { PageEngine.load(runtime, page) }
    }

    private fun module(name: String, source: String): ByteArray =
        JsBytecode.compile(source.trimIndent(), name, module = true, strip = JsBytecode.Strip.SOURCE)
}
