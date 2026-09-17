package wang.harlon.tinyui

import wang.harlon.quickjs.QuickJs

object TinyUI {
    /** Version of the quickjs-kmp SDK this build links against. */
    val engineVersion: String get() = QuickJs.sdkVersion

    /** Debug builds show the (mapped) JS stack on the page-failure screen; keep false in release. */
    var debug: Boolean = false
}
