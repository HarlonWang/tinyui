package wang.harlon.tinyui

import androidx.compose.foundation.layout.Box
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.key
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import wang.harlon.tinyui.schema.ComponentRegistry

/**
 * Renders one TinyUI page; the host owns navigation and passes the page's bytecode (docs/app-model.md).
 * To deliver a navigation result to this page, keep the [PageHost] (see [onHost]) and call [PageHost.emit].
 */
@Composable
fun TinyUIPage(
    runtime: RuntimeBundle,
    page: ByteArray,
    registry: ComponentRegistry,
    sink: PageSink,
    services: HostServices = HostServices.Default,
    propsJson: String = "{}",
    modifier: Modifier = Modifier,
    error: @Composable (PageFailure) -> Unit = { Text("TinyUI page failed (${it.kind}): ${it.message}") },
    onHost: (PageHost) -> Unit = {},
) {
    val host = remember(runtime, page, registry, sink, services, propsJson) { PageHost(runtime, page, registry, sink, services, propsJson) }
    DisposableEffect(host) {
        onHost(host)
        host.start()
        onDispose { host.close() }
    }
    Box(modifier) {
        val failure = host.failure
        if (failure != null) {
            error(failure)
        } else {
            for (child in host.tree.root.children) key(child.id) { host.Render(child) }
        }
    }
}

