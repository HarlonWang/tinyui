package wang.harlon.tinyui.sample

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
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
import androidx.compose.ui.unit.dp
import org.jetbrains.compose.resources.ExperimentalResourceApi
import wang.harlon.tinyui.PageSink
import wang.harlon.tinyui.RuntimeBundle
import wang.harlon.tinyui.TinyUIPage
import wang.harlon.tinyui.components.registerBuiltins
import wang.harlon.tinyui.node.PatchProblem
import wang.harlon.tinyui.sample.res.Res
import wang.harlon.tinyui.schema.ComponentRegistry

private class Bundle(val runtime: RuntimeBundle, val counter: ByteArray)

/** App-level, built once (docs/adr-003 §3.3). */
private val registry = ComponentRegistry().registerBuiltins()

private val sink = object : PageSink {
    override fun patchProblem(problem: PatchProblem) = println("TinyUI E5 $problem")
    override fun businessError(entry: String, message: String, stack: String?) = println("TinyUI E1 [$entry] $message")
    override fun log(line: String) = println("TinyUI $line")
}

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
            counter = Res.readBytes("files/tinyui/pages/counter.bin"),
        )
    }
    MaterialTheme {
        Box(Modifier.fillMaxSize().padding(24.dp), contentAlignment = Alignment.Center) {
            val b = bundle
            if (b == null) Text("loading…") else TinyUIPage(b.runtime, b.counter, registry, sink)
        }
    }
}
