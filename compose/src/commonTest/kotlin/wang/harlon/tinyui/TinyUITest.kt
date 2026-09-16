package wang.harlon.tinyui

import kotlin.test.Test
import kotlin.test.assertTrue

class TinyUITest {
    @Test
    fun linksAgainstQuickJs() {
        assertTrue(TinyUI.engineVersion.isNotEmpty())
    }
}
