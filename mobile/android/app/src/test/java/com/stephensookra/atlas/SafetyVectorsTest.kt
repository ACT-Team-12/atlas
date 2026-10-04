package com.stephensookra.atlas

import com.stephensookra.atlas.data.AtlasJson
import com.stephensookra.atlas.data.SafetyPatterns
import com.stephensookra.atlas.data.VerifiedItem
import com.stephensookra.atlas.data.WarningPin
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * mobile/shared/safety-vectors.json holds the website's own answers for the safety rules and the exact text of every
 * pattern they use (the same file iOS replays). This checks that the app runs the same patterns and gives the same
 * answer for every case.
 */
class SafetyVectorsTest {
    private val vectors by lazy { AtlasJson.parseToJsonElement(File("../../shared/safety-vectors.json").readText()).jsonObject }

    @Test fun patternsAreTheWebsitesWordForWord() {
        val patterns = vectors.getValue("patterns").jsonObject
        assertEquals(patterns.keys, SafetyPatterns.all.keys)
        for ((name, p) in patterns) {
            val mine = SafetyPatterns.all[name]
            assertNotNull("$name is missing on Android", mine)
            assertEquals("$name differs from the website", p.jsonObject.getValue("source").jsonPrimitive.content, mine!!.source)
            assertEquals("$name flags differ from the website", p.jsonObject.getValue("flags").jsonPrimitive.content, mine.flags)
            mine.regex() // every pattern compiles here
        }
        println("safety patterns: ${patterns.size} of ${SafetyPatterns.all.size} equal to the web reference")
    }

    @Test fun warningPinsMatchTheWebsite() {
        val cases = vectors.getValue("warning").jsonArray
        var paperYes = 0
        for (c in cases) {
            val o = c.jsonObject
            val quote = o.getValue("quote").jsonPrimitive.content
            val kind = o.getValue("kind").jsonPrimitive.content
            val paper = o.getValue("paper").jsonPrimitive.boolean
            assertEquals("warningFromPaper($quote)", paper, WarningPin.fromPaper(quote))
            assertEquals("isWarning($kind, $quote)", o.getValue("pinned").jsonPrimitive.boolean, WarningPin.isWarning(kind, quote))
            if (paper) paperYes++
        }
        assertTrue(cases.size > 100)
        assertTrue("the table must hold both answers", paperYes in 1 until cases.size)
        println("safety vectors: warning ${cases.size} of ${cases.size} equal to the web reference")
    }

    @Test fun aStepTheModelMislabeledIsStillStyledAndPinnedAsAWarning() {
        assertTrue(WarningPin.isWarning(VerifiedItem("a", "self_care", "Rest", "Rest.",
            source_quote = "Call 911 or go to the nearest emergency room if you have chest pain.")))
        assertFalse(WarningPin.isWarning(VerifiedItem("b", "self_care", "Walk", "Walk.", source_quote = "Walk 30 minutes a day.")))
    }
}
