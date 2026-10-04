package com.stephensookra.atlas

import com.stephensookra.atlas.data.Check
import com.stephensookra.atlas.data.PaperFirst
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * These unit tests run on the desktop JVM, whose regex engine accepts flags that Android's ICU engine rejects at
 * runtime. The (?U) flag passed every unit test and crashed the release app on the steps screen. Guard the source.
 */
class AndroidRegexTest {
    @Test fun noRegexFlagsAndroidRejects() {
        val files = File("src/main/java").walk().filter { it.isFile && it.extension == "kt" }.toList()
        assertTrue("walked too few source files: ${files.size}", files.size >= 20)
        val bad = files.filter { f -> f.readText().let { "(?U)" in it || "UNICODE_CHARACTER_CLASS" in it } }
        assertEquals("regex flags Android's ICU engine rejects", emptyList<File>(), bad)
    }

    @Test fun askPersonCollapsesJavaScriptWhitespace() {
        val a = PaperFirst.askPerson("medication", "  Take one \n\t tablet daily  ", Check.unchecked)!!
        assertEquals("My paper says: \"Take one tablet daily\" Can you confirm what I should take?", a.question)
    }
}
