package wang.harlon.tinyui.sample

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import kotlinx.coroutines.delay
import org.jetbrains.compose.resources.ExperimentalResourceApi
import wang.harlon.tinyui.HostException
import wang.harlon.tinyui.HostServices
import wang.harlon.tinyui.HttpClient
import wang.harlon.tinyui.HttpRequest
import wang.harlon.tinyui.HttpResponse
import wang.harlon.tinyui.PageSink
import wang.harlon.tinyui.RuntimeBundle
import wang.harlon.tinyui.TinyUIPage
import wang.harlon.tinyui.components.registerBuiltins
import wang.harlon.tinyui.node.PatchProblem
import wang.harlon.tinyui.sample.res.Res
import wang.harlon.tinyui.schema.ComponentRegistry

private class Bundle(val runtime: RuntimeBundle, val page: ByteArray)

/** App-level, built once (docs/adr-003 §3.3). */
private val registry = ComponentRegistry().registerBuiltins()

private val sink = object : PageSink {
    override fun patchProblem(problem: PatchProblem) = println("TinyUI E5 $problem")
    override fun businessError(entry: String, message: String, stack: String?) = println("TinyUI E1 [$entry] $message")
    override fun log(line: String) = println("TinyUI $line")
}

/** Stands in for a backend: three pages of todos, 300 ms each. */
private object FakeTodos : HttpClient {
    override suspend fun request(request: HttpRequest): HttpResponse {
        delay(300)
        val page = Regex("page=(\\d+)").find(request.url)?.groupValues?.get(1)?.toInt() ?: throw HostException("E_HTTP", "404 ${request.url}")
        if (page > 3) throw HostException("E_HTTP", "404 page $page")
        val items = (1..8).joinToString(",") { i -> val id = (page - 1) * 8 + i; """{"id":$id,"title":"Todo #$id","done":${id % 3 == 0}}""" }
        val next = if (page < 3) "${page + 1}" else "null"
        return HttpResponse(200, """{"items":[$items],"next":$next}""")
    }
}

private val services = HostServices(http = FakeTodos, deviceInfo = mapOf("app" to "sample"))

@OptIn(ExperimentalResourceApi::class)
@Composable
fun App() {
    var bundle by remember { mutableStateOf<Bundle?>(null) }
    LaunchedEffect(Unit) {
        bundle = Bundle(
            RuntimeBundle(
                core = Res.readBytes("files/tinyui/runtime/core.bin"),
                native = Res.readBytes("files/tinyui/runtime/native.bin"),
            ),
            page = Res.readBytes("files/tinyui/pages/todos.bin"),
        )
    }
    MaterialTheme {
        Box(Modifier.fillMaxSize().safeDrawingPadding(), contentAlignment = Alignment.Center) {
            val b = bundle
            if (b == null) Text("loading…") else TinyUIPage(b.runtime, b.page, registry, sink, services)
        }
    }
}
