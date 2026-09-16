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
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.jetbrains.compose.resources.ExperimentalResourceApi
import wang.harlon.quickjs.JsValue
import wang.harlon.tinyui.PageEngine
import wang.harlon.tinyui.RuntimeBundle
import wang.harlon.tinyui.TinyUI
import wang.harlon.tinyui.sample.res.Res

@OptIn(ExperimentalResourceApi::class)
@Composable
fun App() {
    var text by remember { mutableStateOf("loading pages/home …") }
    LaunchedEffect(Unit) {
        val runtime = RuntimeBundle(
            core = Res.readBytes("files/tinyui/runtime/core.bin"),
            native = Res.readBytes("files/tinyui/runtime/native.bin"),
        )
        val page = Res.readBytes("files/tinyui/pages/home.bin")
        text = withContext(Dispatchers.Default) {
            runCatching {
                PageEngine.load(runtime, page).use { (it.callDefault() as JsValue.Str).value }
            }.getOrElse { "failed: $it" }
        }
    }
    MaterialTheme {
        Box(Modifier.fillMaxSize().padding(24.dp), contentAlignment = Alignment.Center) {
            Text("$text\n\nquickjs-kmp ${TinyUI.engineVersion}")
        }
    }
}
