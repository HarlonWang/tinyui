package wang.harlon.tinyui

import platform.UIKit.UIDevice

internal actual fun platformInfo(): Map<String, String> = mapOf(
    "os" to "ios",
    "osVersion" to UIDevice.currentDevice.systemVersion,
    "model" to UIDevice.currentDevice.model,
)
