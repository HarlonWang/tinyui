package wang.harlon.tinyui

import wang.harlon.quickjs.QuickJs

object TinyUI {
    /** Version of the quickjs-kmp SDK this build links against. */
    val engineVersion: String get() = QuickJs.sdkVersion
}
