package wang.harlon.tinyui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import wang.harlon.tinyui.components.generated.BuiltinSchemas
import wang.harlon.tinyui.schema.Commands
import wang.harlon.tinyui.schema.ComponentRegistry
import wang.harlon.tinyui.schema.NodeScope
import wang.harlon.tinyui.schema.Theme

/** First batch of built-ins (docs/components.md §3); schemas come from schema/ via `tinyui schema`. */
fun ComponentRegistry.registerBuiltins(): ComponentRegistry = apply {
    register(BuiltinSchemas.Column) { scope ->
        Column(
            modifier = scope.modifier(),
            verticalArrangement = verticalArrangement(scope["justify"], scope["gap"]),
            horizontalAlignment = when (scope.get<String>("align")) { "center" -> Alignment.CenterHorizontally; "end" -> Alignment.End; else -> Alignment.Start },
        ) { scope.Children() }
    }
    register(BuiltinSchemas.Row) { scope ->
        Row(
            modifier = scope.modifier(),
            horizontalArrangement = horizontalArrangement(scope["justify"], scope["gap"]),
            verticalAlignment = when (scope.get<String>("align")) { "center" -> Alignment.CenterVertically; "end" -> Alignment.Bottom; else -> Alignment.Top },
        ) { scope.Children() }
    }
    register(BuiltinSchemas.Box) { scope ->
        Box(modifier = scope.modifier(), contentAlignment = boxAlignment(scope["align"])) { scope.Children() }
    }
    register(BuiltinSchemas.Text) { scope ->
        val maxLines = scope.get<Double>("maxLines")?.toInt()?.takeIf { it > 0 } ?: Int.MAX_VALUE
        Text(
            text = scope["text"] ?: "",
            style = scope.get<String>("style")?.let { Theme.textStyle(MaterialTheme.typography, it) } ?: LocalTextStyle.current,
            color = scope.color("color") ?: Color.Unspecified,
            fontSize = scope["fontSize"] ?: TextUnit.Unspecified,
            fontWeight = when (scope.get<String>("fontWeight")) { "normal" -> FontWeight.Normal; "medium" -> FontWeight.Medium; "bold" -> FontWeight.Bold; else -> null },
            maxLines = maxLines,
            overflow = if (maxLines == Int.MAX_VALUE) TextOverflow.Clip else TextOverflow.Ellipsis,
            textAlign = when (scope.get<String>("align")) { "center" -> TextAlign.Center; "end" -> TextAlign.End; else -> TextAlign.Start },
            modifier = scope.modifier(),
        )
    }
    register(BuiltinSchemas.Button) { scope ->
        val onClick = { if (scope.has("onClick")) scope.dispatch("onClick") }
        val enabled = scope.get<Boolean>("enabled") ?: true
        val label: @Composable () -> Unit = { Text(scope["text"] ?: "") }
        val modifier = scope.modifier(clickable = false) // the button owns the click and its enabled state
        when (scope.get<String>("variant")) {
            "outlined" -> OutlinedButton(onClick = onClick, enabled = enabled, modifier = modifier, content = { label() })
            "text" -> TextButton(onClick = onClick, enabled = enabled, modifier = modifier, content = { label() })
            else -> Button(onClick = onClick, enabled = enabled, modifier = modifier, content = { label() })
        }
    }
    register(BuiltinSchemas.TextField) { scope -> TextFieldComponent(scope) }
    register(BuiltinSchemas.LazyColumn) { scope -> LazyColumnComponent(scope) }
    register(BuiltinSchemas.Spacer) { scope -> Spacer(scope.modifier()) }
}

private fun verticalArrangement(justify: String?, gap: Dp?): Arrangement.Vertical {
    val spaced = gap != null && gap > 0.dp
    return when (justify) {
        "center" -> if (spaced) Arrangement.spacedBy(gap!!, Alignment.CenterVertically) else Arrangement.Center
        "end" -> if (spaced) Arrangement.spacedBy(gap!!, Alignment.Bottom) else Arrangement.Bottom
        "spaceBetween" -> Arrangement.SpaceBetween
        else -> if (spaced) Arrangement.spacedBy(gap!!) else Arrangement.Top
    }
}

private fun horizontalArrangement(justify: String?, gap: Dp?): Arrangement.Horizontal {
    val spaced = gap != null && gap > 0.dp
    return when (justify) {
        "center" -> if (spaced) Arrangement.spacedBy(gap!!, Alignment.CenterHorizontally) else Arrangement.Center
        "end" -> if (spaced) Arrangement.spacedBy(gap!!, Alignment.End) else Arrangement.End
        "spaceBetween" -> Arrangement.SpaceBetween
        else -> if (spaced) Arrangement.spacedBy(gap!!) else Arrangement.Start
    }
}

private fun boxAlignment(name: String?): Alignment = when (name) {
    "topCenter" -> Alignment.TopCenter; "topEnd" -> Alignment.TopEnd
    "centerStart" -> Alignment.CenterStart; "center" -> Alignment.Center; "centerEnd" -> Alignment.CenterEnd
    "bottomStart" -> Alignment.BottomStart; "bottomCenter" -> Alignment.BottomCenter; "bottomEnd" -> Alignment.BottomEnd
    else -> Alignment.TopStart
}

/** Text and cursor stay here; JS gets `onChange` / `onCommit` and sends `setText` / `focus` / `blur` (docs/adr-004 §3.3). */
@Composable
private fun TextFieldComponent(scope: NodeScope) {
    var text by remember { mutableStateOf(scope.get<String>("initialText") ?: "") }
    val focusRequester = remember { FocusRequester() }
    val focusManager = LocalFocusManager.current
    val commit = { if (scope.has("onCommit")) scope.dispatch("onCommit", payload("text", text)) }
    scope.Commands { command ->
        when (command.name) {
            "setText" -> { text = command.args["text"] as? String ?: ""; if (scope.has("onChange")) scope.dispatch("onChange", payload("text", text)) }
            "focus" -> focusRequester.requestFocus()
            "blur" -> focusManager.clearFocus()
        }
    }
    val keyboard = when (scope.get<String>("keyboard")) {
        "number" -> KeyboardType.Number; "email" -> KeyboardType.Email; "phone" -> KeyboardType.Phone; "password" -> KeyboardType.Password
        else -> KeyboardType.Text
    }
    OutlinedTextField(
        value = text,
        onValueChange = { text = it; if (scope.has("onChange")) scope.dispatch("onChange", payload("text", it)) },
        placeholder = scope.get<String>("placeholder")?.takeIf { it.isNotEmpty() }?.let { { Text(it) } },
        singleLine = scope.get<Boolean>("singleLine") ?: true,
        keyboardOptions = KeyboardOptions(keyboardType = keyboard, imeAction = ImeAction.Done),
        keyboardActions = KeyboardActions(onDone = { commit() }),
        visualTransformation = if (keyboard == KeyboardType.Password) PasswordVisualTransformation() else VisualTransformation.None,
        modifier = scope.modifier(clickable = false).focusRequester(focusRequester).onFocusChanged { if (!it.isFocused) commit() },
    )
}

/** Rows are the node's children; virtualisation only in composition (docs/adr-003 §3.6). */
@Composable
private fun LazyColumnComponent(scope: NodeScope) {
    val state = rememberLazyListState()
    val node = scope.node
    scope.Commands { command ->
        if (command.name == "scrollTo") state.animateScrollToItem(((command.args["index"] as? Double) ?: 0.0).toInt().coerceIn(0, maxOf(0, node.children.size - 1)))
    }
    if (scope.has("onReachEnd")) {
        // fires on each arrival at the last row and when the list grows while there; re-arms once the user scrolls away
        LaunchedEffect(state, node) {
            var firedFor = -1
            snapshotFlow { (state.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: -1) to node.children.size }
                .distinctUntilChanged()
                .collect { (last, size) ->
                    val atEnd = size > 0 && last >= size - 1
                    if (!atEnd) firedFor = -1
                    else if (firedFor != size) { firedFor = size; scope.dispatch("onReachEnd") }
                }
        }
    }
    if (scope.has("onScrollEnd")) {
        LaunchedEffect(state) {
            var scrolling = false
            snapshotFlow { state.isScrollInProgress }.distinctUntilChanged().collect { now ->
                if (scrolling && !now) scope.dispatch("onScrollEnd", buildJsonObject { put("index", state.firstVisibleItemIndex) }.toString())
                scrolling = now
            }
        }
    }
    val gap = scope.get<Dp>("gap") ?: 0.dp
    LazyColumn(state = state, modifier = scope.modifier(), verticalArrangement = if (gap > 0.dp) Arrangement.spacedBy(gap) else Arrangement.Top) {
        items(node.children, key = { it.id }) { child -> key(child.id) { scope.RenderChild(child) } }
    }
}

private fun payload(key: String, value: String) = buildJsonObject { put(key, value) }.toString()
