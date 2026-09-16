package wang.harlon.tinyui.sample

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import wang.harlon.tinyui.TinyUI

@Composable
fun App() {
    MaterialTheme {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Text("TinyUI sample · quickjs-kmp ${TinyUI.engineVersion}")
        }
    }
}
