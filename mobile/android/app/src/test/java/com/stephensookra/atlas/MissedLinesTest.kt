package com.stephensookra.atlas

import com.stephensookra.atlas.data.AtlasJson
import com.stephensookra.atlas.data.CarePlanResponse
import com.stephensookra.atlas.data.MissedLines
import com.stephensookra.atlas.data.MissedLinesPayload
import com.stephensookra.atlas.data.MissedLinesView
import com.stephensookra.atlas.data.MissedSentence
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * The phone rebuilds "Lines on your paper we didn't turn into steps" from `missed_lines` and the ids of the steps still
 * kept. mobile/shared/missed-lines-vectors.json holds the website's own answer (missedLinesView) for every fixture and
 * kept set; this replays each one through MissedLines.view and asserts the same result.
 */
class MissedLinesTest {
    private val vectors by lazy { AtlasJson.parseToJsonElement(File("../../shared/missed-lines-vectors.json").readText()).jsonObject }

    @Test fun matchesTheWebReferenceForEveryVector() {
        val fixtures = vectors.getValue("fixtures").jsonArray
        var cases = 0
        var shownWithLines = 0
        for (f in fixtures) {
            val fx = f.jsonObject
            val name = fx.getValue("name").jsonPrimitive.content
            // Through the app's own decoder, exactly as a response or a saved plan is read.
            val payload = AtlasJson.decodeFromJsonElement(MissedLinesPayload.serializer(), fx.getValue("payload"))
            for (c in fx.getValue("cases").jsonArray) {
                val kept = c.jsonObject.getValue("kept").jsonArray.map { it.jsonPrimitive.content }
                val want = c.jsonObject.getValue("expected").jsonObject
                val got = MissedLines.view(payload, kept)
                assertEquals("$name kept=$kept", want.summary(), got.summary())
                if (got is MissedLinesView.Shown && got.lines.isNotEmpty()) shownWithLines++
                cases++
            }
        }
        assertEquals(17, fixtures.size)
        assertEquals(576, cases)
        assertTrue("too few cases with missed lines: $shownWithLines", shownWithLines > 400)
        println("missed_lines vectors: ${fixtures.size} fixtures, $cases kept sets, all equal to the web reference")
    }

    private fun JsonObject.summary(): String =
        if (getValue("show").jsonPrimitive.boolean) {
            listOf(
                "show", getValue("languages").jsonArray.map { it.jsonPrimitive.content }, getValue("total").jsonPrimitive.int,
                getValue("covered").jsonPrimitive.int, getValue("lines").jsonArray.map { it.jsonPrimitive.content },
            ).toString()
        } else listOf("hidden", getValue("why").jsonPrimitive.content).toString()

    private fun MissedLinesView.summary(): String = when (this) {
        is MissedLinesView.Shown -> listOf("show", languages, total, covered, lines.map { it.text }).toString()
        is MissedLinesView.Hidden -> listOf("hidden", why).toString()
    }

    // ---- Beyond the vectors

    private fun s(text: String, start: Int, end: Int, group: Int, critical: List<List<Int>> = emptyList()) =
        MissedSentence(text, start, end, "imperative", critical, group)

    @Test fun absentFieldHidesTheSectionAndOldResponsesStillDecode() {
        val old = AtlasJson.decodeFromString(CarePlanResponse.serializer(), """{"items":[],"stats":{"extracted":0,"grounded":0,"refused":0,"ms":1}}""")
        assertNull(old.missed_lines)
        val v = MissedLines.view(old.missed_lines, emptyList())
        assertEquals(MissedLinesView.Hidden("missing"), v)
        assertEquals("", MissedLines.announcement(v))
    }

    @Test fun decodesTheServerShape() {
        val care = AtlasJson.decodeFromString(CarePlanResponse.serializer(), """{"items":[],"stats":{"extracted":0,"grounded":0,"refused":0,"ms":1},
            "missed_lines":{"show":true,"languages":["en"],"quotes":{"a":[[0,10]]},
            "sentences":[{"text":"Take 1 tablet daily.","start":0,"end":20,"reason":"imperative","critical":[[5,6]],"group":0}]}}""")
        val p = care.missed_lines!!
        assertEquals(listOf(listOf(0, 10)), p.quotes["a"])
        assertEquals(MissedLinesView.Shown(listOf("en"), 1, 1, emptyList()), MissedLines.view(p, listOf("a")))
        assertEquals(1, (MissedLines.view(p, emptyList()) as MissedLinesView.Shown).lines.size)
        val hidden = AtlasJson.decodeFromString(MissedLinesPayload.serializer(), """{"show":false,"why":"unsupported_language"}""")
        assertEquals(MissedLinesView.Hidden("unsupported_language"), MissedLines.view(hidden, listOf("a")))
    }

    @Test fun showWithoutSentencesNeverClaimsAllCovered() {
        assertEquals(MissedLinesView.Hidden("no_instructions"), MissedLines.view(MissedLinesPayload(show = true, languages = listOf("en")), listOf("a")))
    }

    @Test fun touchingRangesMergeAndMalformedRangesNeverCoverALine() {
        // A number split across two quotes: only the two together hold it.
        val p = MissedLinesPayload(show = true, languages = listOf("en"),
            quotes = mapOf("a" to listOf(listOf(0, 18)), "b" to listOf(listOf(18, 25)), "bad" to listOf(listOf(0))),
            sentences = listOf(s("Take 1 tablet for 10 days.", 0, 26, 0, critical = listOf(listOf(17, 19)))))
        fun missed(vararg ids: String) = (MissedLines.view(p, ids.toList()) as MissedLinesView.Shown).lines.size
        assertEquals(1, missed("a")); assertEquals(1, missed("b")); assertEquals(0, missed("a", "b"))
        assertEquals(1, missed("bad"))
        val badCritical = p.copy(sentences = listOf(s("Take 1 tablet for 10 days.", 0, 26, 0, critical = listOf(listOf(17)))))
        assertEquals(1, (MissedLines.view(badCritical, listOf("a", "b")) as MissedLinesView.Shown).lines.size)
    }

    @Test fun announcementAndBadgeMatchTheWebsiteWording() {
        val one = MissedLinesView.Shown(listOf("en"), 2, 1, listOf(s("Call 911.", 0, 9, 0)))
        val two = one.copy(covered = 0, lines = listOf(s("Call 911.", 0, 9, 0), s("Take it.", 10, 18, 1)))
        assertEquals("1 line on your paper looks like instructions but is not in a step. Open \"Lines on your paper we didn't turn into steps\" to read it.",
            MissedLines.announcement(one))
        assertEquals("2 lines on your paper look like instructions but are not in a step. Open \"Lines on your paper we didn't turn into steps\" to read them.",
            MissedLines.announcement(two))
        assertEquals("Every instruction-like line on your paper is in a step.", MissedLines.announcement(one.copy(covered = 2, lines = emptyList())))
        assertEquals("1 line", MissedLines.lineCountLabel(1)); assertEquals("3 lines", MissedLines.lineCountLabel(3))
        assertEquals("", MissedLines.announcement(MissedLinesView.Hidden("empty")))
    }

    @Test fun webWordingIsCopiedExactly() {
        val web = File("../../../web/src/ui/MissedLines.tsx").readText().replace("&apos;", "'")
        for (s in listOf(MissedLines.TITLE, MissedLines.ALL_IN_A_STEP, MissedLines.ALL_IN_A_STEP_NOTE, MissedLines.READ_THESE, MissedLines.CAN_MISS)) {
            assertTrue("not in MissedLines.tsx: $s", web.contains(s))
        }
    }
}
