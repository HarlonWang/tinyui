package wang.harlon.tinyui

import android.os.Build

internal actual fun platformInfo(): Map<String, String> = mapOf(
    "os" to "android",
    "osVersion" to Build.VERSION.RELEASE.orEmpty(),
    "model" to Build.MODEL.orEmpty(),
)
