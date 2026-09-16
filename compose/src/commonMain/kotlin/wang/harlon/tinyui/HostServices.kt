package wang.harlon.tinyui

import kotlin.concurrent.atomics.AtomicReference
import kotlin.concurrent.atomics.ExperimentalAtomicApi
import kotlin.concurrent.atomics.update

/** What the host App provides to pages (docs/native-api.md); every part has a default that does nothing. */
class HostServices(
    val navigator: Navigator = Navigator.None,
    val store: Store = InMemoryStore(),
    val http: HttpClient = HttpClient.None,
    val i18n: I18n = I18n.None,
    val config: Config = Config.None,
    val events: EventBus = EventBus(),
    /** Extra values merged into `device.info` (docs/native-api.md §1). */
    val deviceInfo: Map<String, String> = emptyMap(),
) {
    companion object {
        /** One shared instance, so a page whose host passes nothing keeps a stable `remember` key. */
        val Default = HostServices()
    }
}

/** J4 `navigation.push` / `navigation.pop`; results travel back as K5 `navigation.result` (docs/app-model.md). */
interface Navigator {
    fun push(page: String, paramsJson: String)
    fun pop(resultJson: String?)

    object None : Navigator {
        override fun push(page: String, paramsJson: String) {}
        override fun pop(resultJson: String?) {}
    }
}

/** A store value with the monotonic version of its write; listeners drop what arrives out of order. */
class StoreValue(val json: String, val version: Long)

/** App-wide key → JSON text; the truth for cross-page state (docs/app-model.md §3). */
interface Store {
    fun get(key: String): String?
    fun set(key: String, json: String)
    /** [listener] receives every write to [key], possibly out of order across threads; the returned handle removes it. */
    fun observe(key: String, listener: (StoreValue) -> Unit): AutoCloseable
}

/** Copy-on-write: pages subscribe on their engine threads while the host writes from anywhere. */
@OptIn(ExperimentalAtomicApi::class)
class InMemoryStore : Store {
    private val values = AtomicReference<Map<String, StoreValue>>(emptyMap())
    private val listeners = Listeners<StoreValue>()

    override fun get(key: String): String? = values.load()[key]?.json

    override fun set(key: String, json: String) {
        var written: StoreValue? = null
        values.update { map -> StoreValue(json, (map[key]?.version ?: 0) + 1).also { written = it }.let { map + (key to it) } }
        listeners.notify(key, written!!)
    }

    override fun observe(key: String, listener: (StoreValue) -> Unit): AutoCloseable = listeners.add(key, listener)
}

class HttpRequest(val method: String, val url: String, val headers: Map<String, String>, val bodyJson: String?, val timeoutMs: Long?)

/** J3 `http.request`; [bodyJson] is JSON text or null. Throw [HostException] for E3 codes. */
interface HttpClient {
    suspend fun request(request: HttpRequest): HttpResponse

    object None : HttpClient {
        override suspend fun request(request: HttpRequest): HttpResponse = throw HostException("E_UNSUPPORTED", "http is not available")
    }
}

class HttpResponse(val status: Int, val bodyJson: String)

/** An E3 failure with one of the codes in docs/native-api.md §6. */
class HostException(val code: String, message: String) : Exception(message)

/** J2 `i18n.t`. */
fun interface I18n {
    fun translate(key: String, argsJson: String): String?

    companion object {
        val None = I18n { _, _ -> null }
    }
}

/** J2 `config.get`, JSON text. */
fun interface Config {
    fun get(key: String): String?

    companion object {
        val None = Config { null }
    }
}

/** One bus for host events and business events; pages subscribe per topic (docs/app-model.md §3). */
class EventBus {
    private val listeners = Listeners<String>()

    fun emit(topic: String, payloadJson: String) = listeners.notify(topic, payloadJson)

    fun subscribe(topic: String, listener: (String) -> Unit): AutoCloseable = listeners.add(topic, listener)
}

@OptIn(ExperimentalAtomicApi::class)
internal class Listeners<T> {
    private val byKey = AtomicReference<Map<String, List<(T) -> Unit>>>(emptyMap())

    fun add(key: String, listener: (T) -> Unit): AutoCloseable {
        byKey.update { it + (key to (it[key].orEmpty() + listener)) }
        return AutoCloseable { byKey.update { it + (key to (it[key].orEmpty() - listener)) } }
    }

    fun notify(key: String, value: T) {
        byKey.load()[key]?.forEach { it(value) }
    }
}

internal expect fun platformInfo(): Map<String, String>
