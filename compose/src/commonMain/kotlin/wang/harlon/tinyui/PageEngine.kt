package wang.harlon.tinyui

import wang.harlon.quickjs.JsEngine
import wang.harlon.quickjs.JsEngineConfig
import wang.harlon.quickjs.JsRef
import wang.harlon.quickjs.JsValue
import wang.harlon.quickjs.ObjectTransport

/** Bytecode of the runtime modules every page imports, as `tinyui build` writes them under `runtime/`. */
class RuntimeBundle(val core: ByteArray, val native: ByteArray)

/**
 * One page's engine: the runtime modules registered, the page module evaluated, its namespace held
 * (K0 of docs/adr-002-bridge-communication.md). Closing it unloads the page.
 */
class PageEngine private constructor(
    private val engine: JsEngine,
    private val namespace: JsRef,
) : AutoCloseable {
    /** Calls the page module's `default` export with [args]; objects come back as JSON. */
    fun callDefault(vararg args: JsValue): JsValue =
        (namespace.get("default", ObjectTransport.REF) as JsRef).use { it.call(*args) }

    override fun close() {
        namespace.close()
        engine.close()
    }

    companion object {
        /** `import.meta.url` of a page module is `tinyui:<name>` (docs/adr-005-engine.md). */
        const val MODULE_SCHEME = "tinyui"

        fun load(
            runtime: RuntimeBundle,
            page: ByteArray,
            config: JsEngineConfig = JsEngineConfig(moduleScheme = MODULE_SCHEME),
        ): PageEngine {
            val engine = JsEngine(config)
            try {
                engine.registerModule(runtime.core)
                engine.registerModule(runtime.native)
                val namespace = engine.runBytecode(page, ObjectTransport.REF) as JsRef
                if (namespace.isPromise) {
                    namespace.close()
                    error("page module is still pending after microtasks were drained; top-level await may only wait on synchronous work")
                }
                return PageEngine(engine, namespace)
            } catch (e: Throwable) {
                engine.close()
                throw e
            }
        }
    }
}
