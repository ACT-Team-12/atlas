package com.stephensookra.atlas

import com.stephensookra.atlas.data.AtlasJson
import com.stephensookra.atlas.data.Check
import com.stephensookra.atlas.data.SafetyPatterns
import com.stephensookra.atlas.data.StepWhen
import com.stephensookra.atlas.data.StepsWhen
import com.stephensookra.atlas.data.TextSpan
import com.stephensookra.atlas.data.VerifiedItem
import com.stephensookra.atlas.data.WarningPin
import com.stephensookra.atlas.data.WhenGroup
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.int
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

    @Test fun timeTablesAreTheWebsites() {
        assertEquals(vectors.getValue("when_rule_groups").jsonArray.map { it.jsonPrimitive.content }, StepsWhen.RULE_GROUPS)
        assertEquals(vectors.getValue("num_words").jsonObject.mapValues { it.value.jsonPrimitive.int }, StepsWhen.NUM_WORDS)
        val labels = vectors.getValue("group_labels").jsonArray.map { p -> p.jsonArray.map { it.jsonPrimitive.content } }
        assertEquals(labels.map { it[0] }, WhenGroup.entries.map { it.name })
        for ((g, label) in labels) assertEquals("label of $g", label, WhenGroup.valueOf(g).label)
    }

    private fun span(o: JsonObject): TextSpan? =
        (o["span"] as? JsonObject)?.let { TextSpan(it.getValue("start").jsonPrimitive.int, it.getValue("end").jsonPrimitive.int) }

    @Test fun byWhenGroupsMatchTheWebsite() {
        val papers = vectors.getValue("papers").jsonObject.mapValues { it.value.jsonPrimitive.content }
        var total = 0
        for (w in vectors.getValue("when").jsonArray) {
            val o = w.jsonObject
            val text = o.getValue("text").jsonPrimitive.content
            val got = StepsWhen.fromText(text)
            assertEquals("whenFromText($text)", o.getValue("group").jsonPrimitive.content, got.group.name)
            assertEquals("whenFromText($text) words", o.getValue("words").jsonArray.map { it.jsonPrimitive.content }, got.words)
            total++
        }
        for (h in vectors.getValue("heading").jsonArray) {
            val o = h.jsonObject
            val paper = papers.getValue(o.getValue("paper").jsonPrimitive.content)
            assertEquals("listHeading($o)", o.getValue("heading").jsonPrimitive.content, StepsWhen.listHeading(paper, span(o)))
            total++
        }
        var stopNow = 0
        val steps = vectors.getValue("step").jsonArray
        for (s in steps) {
            val o = s.jsonObject
            val e = o.getValue("expected").jsonObject
            val got = StepsWhen.step(
                o.getValue("quote").jsonPrimitive.content, o.getValue("when").jsonPrimitive.content, o.getValue("kind").jsonPrimitive.content,
                span(o), Check.valueOf(o.getValue("check").jsonPrimitive.content), papers.getValue(o.getValue("paper").jsonPrimitive.content),
            )
            val want = StepWhen(WhenGroup.valueOf(e.getValue("group").jsonPrimitive.content), e.getValue("words").jsonArray.map { it.jsonPrimitive.content },
                e.getValue("from").jsonPrimitive.content)
            assertEquals("stepWhen($o)", want, got)
            if (want.group == WhenGroup.today && want.words.isEmpty() && want.from == "paper") stopNow++
            total++
        }
        assertTrue(steps.size > 1000 && stopNow > 10)
        println("safety vectors: when $total of $total equal to the web reference")
    }

    @Test fun groupedPutsWarningsFirstAndStopNowUnderRightAway() {
        val paper = "STOP taking these medications:\n- ibuprofen 200 mg tablet.\nCall 911 if you have chest pain.\nWalk daily."
        fun item(id: String, kind: String, quote: String): VerifiedItem {
            val at = paper.indexOf(quote)
            return VerifiedItem(id, kind, id, id, source_quote = quote, span = TextSpan(at, at + quote.length))
        }
        val items = listOf(item("walk", "self_care", "Walk daily."), item("stop", "medication", "ibuprofen 200 mg tablet."),
            item("call", "self_care", "Call 911 if you have chest pain."))
        val (warnings, groups) = StepsWhen.grouped(items, { Check.unchecked }, paper)
        assertEquals(listOf("call"), warnings.map { it.id })
        assertEquals(listOf(WhenGroup.today, WhenGroup.daily), groups.map { it.group })
        assertEquals(listOf(listOf("stop"), listOf("walk")), groups.map { g -> g.items.map { it.id } })
    }

    @Test fun aStepTheModelMislabeledIsStillStyledAndPinnedAsAWarning() {
        assertTrue(WarningPin.isWarning(VerifiedItem("a", "self_care", "Rest", "Rest.",
            source_quote = "Call 911 or go to the nearest emergency room if you have chest pain.")))
        assertFalse(WarningPin.isWarning(VerifiedItem("b", "self_care", "Walk", "Walk.", source_quote = "Walk 30 minutes a day.")))
    }
}
