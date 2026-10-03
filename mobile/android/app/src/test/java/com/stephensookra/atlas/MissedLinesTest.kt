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
        var invalid = 0
        for (f in fixtures) {
            val fx = f.jsonObject
            val name = fx.getValue("name").jsonPrimitive.content
            val sourceLength = fx.getValue("source_length").jsonPrimitive.int
            val malformed = name.startsWith("malformed:")
            // Through the app's own decoder, exactly as a response or a saved plan is read.
            val payload = AtlasJson.decodeFromJsonElement(MissedLinesPayload.serializer(), fx.getValue("payload"))
            for (c in fx.getValue("cases").jsonArray) {
                val kept = c.jsonObject.getValue("kept").jsonArray.map { it.jsonPrimitive.content }
                val want = c.jsonObject.getValue("expected").jsonObject
                val got = MissedLines.view(payload, kept, sourceLength)
                assertEquals("$name kept=$kept", want.summary(), got.summary())
                // A real payload sits inside its paper, so leaving the length out never changes the answer.
                if (!malformed) assertEquals("$name kept=$kept unbounded", got, MissedLines.view(payload, kept))
                if (got is MissedLinesView.Shown && got.lines.isNotEmpty()) shownWithLines++
                if (got == MissedLinesView.Hidden(MissedLines.INVALID)) invalid++
                cases++
            }
        }
        assertEquals(35, fixtures.size)
        assertEquals(732, cases)
        assertTrue("too few cases with missed lines: $shownWithLines", shownWithLines > 600)
        assertEquals("every malformed case, and only those, is hidden as invalid", 12 * 3, invalid)
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
        val v = MissedLines.view(MissedLinesPayload(show = true, languages = listOf("en")), listOf("a"))
        assertEquals(MissedLinesView.Hidden(MissedLines.INVALID), v)
        assertEquals("", MissedLines.announcement(v))
    }

    @Test fun touchingRangesMerge() {
        // A number split across two quotes: only the two together hold it.
        val p = MissedLinesPayload(show = true, languages = listOf("en"),
            quotes = mapOf("a" to listOf(listOf(0, 18)), "b" to listOf(listOf(18, 25))),
            sentences = listOf(s("Take 1 tablet for 10 days.", 0, 26, 0, critical = listOf(listOf(17, 19)))))
        fun missed(vararg ids: String) = (MissedLines.view(p, ids.toList(), sourceLength = 26) as MissedLinesView.Shown).lines.size
        assertEquals(1, missed("a")); assertEquals(1, missed("b")); assertEquals(0, missed("a", "b"))
    }

    /** One sentence the kept quote does not touch, so a valid payload always shows it as missed. */
    private val good = MissedLinesPayload(show = true, languages = listOf("en"),
        quotes = mapOf("a" to listOf(listOf(30, 40))),
        sentences = listOf(s("Take 1 tablet for 10 days.", 0, 26, 0, critical = listOf(listOf(5, 6), listOf(18, 20)))))

    @Test fun malformedPayloadsAreHiddenWithNoAllCoveredClaim() {
        assertEquals(1, (MissedLines.view(good, listOf("a"), sourceLength = 40) as MissedLinesView.Shown).lines.size)
        val one = good.sentences[0]
        val bad = mapOf(
            "kept range [-1, MAX] overlaps everything" to good.copy(quotes = mapOf("a" to listOf(listOf(-1, Int.MAX_VALUE)))),
            "one number" to good.copy(quotes = mapOf("a" to listOf(listOf(0)))),
            "three numbers" to good.copy(quotes = mapOf("a" to listOf(listOf(0, 26, 30)))),
            "start after end" to good.copy(quotes = mapOf("a" to listOf(listOf(26, 0)))),
            "empty range" to good.copy(quotes = mapOf("a" to listOf(listOf(5, 5)))),
            "negative start" to good.copy(quotes = mapOf("a" to listOf(listOf(-3, 26)))),
            "past the paper" to good.copy(quotes = mapOf("a" to listOf(listOf(0, 41)))),
            "an unkept item's bad range still poisons the payload" to good.copy(quotes = good.quotes + ("z" to listOf(listOf(-1, 2)))),
            "sentence end before start" to good.copy(sentences = listOf(one.copy(start = 26, end = 0))),
            "sentence negative" to good.copy(sentences = listOf(one.copy(start = -1))),
            "sentence past the paper" to good.copy(sentences = listOf(one.copy(end = 41))),
            "critical outside its sentence" to good.copy(sentences = listOf(one.copy(critical = listOf(listOf(30, 35))))),
            "critical one number" to good.copy(sentences = listOf(one.copy(critical = listOf(listOf(17))))),
            "critical reversed" to good.copy(sentences = listOf(one.copy(critical = listOf(listOf(19, 17))))),
            "group out of range" to good.copy(sentences = listOf(one.copy(group = 1))),
            "group negative" to good.copy(sentences = listOf(one.copy(group = -1))),
            "group points forward" to good.copy(sentences = listOf(one, s("Call 911.", 27, 36, 2), s("Call 911.", 37, 40, 2))),
            "group points at a non-first sentence" to good.copy(sentences = listOf(one, s("Call 911.", 27, 36, 0), s("Take 1 tablet for 10 days.", 37, 40, 1))),
        )
        for ((name, p) in bad) {
            for (kept in listOf(listOf("a"), listOf("a", "z"), emptyList())) {
                val v = MissedLines.view(p, kept, sourceLength = 40)
                assertEquals(name, MissedLinesView.Hidden(MissedLines.INVALID), v)
                assertEquals(name, "", MissedLines.announcement(v))
            }
        }
        // Without a known paper length the bounds that need it cannot be checked, but [-1, MAX] is still refused.
        assertEquals(MissedLinesView.Hidden(MissedLines.INVALID), MissedLines.view(bad.getValue("kept range [-1, MAX] overlaps everything"), listOf("a")))
        assertEquals(MissedLinesView.Hidden(MissedLines.INVALID),
            MissedLines.view(good.copy(quotes = mapOf("a" to listOf(listOf(0, Int.MAX_VALUE)))), listOf("a"), sourceLength = 40))
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

    @Test fun aPayloadWithoutItsPaperIsHidden() {
        // [0, 2147483647] is only refused against a paper length; without source_text there is none to check it against.
        val wide = good.copy(quotes = mapOf("a" to listOf(listOf(0, Int.MAX_VALUE))))
        val noPaper = CarePlanResponse(items = emptyList(), stats = com.stephensookra.atlas.data.CareStats(0, 0, 0, 1), missed_lines = wide)
        assertEquals("", noPaper.source_text)
        assertEquals(MissedLinesView.Hidden(MissedLines.INVALID), MissedLines.forCare(noPaper, listOf("a")))
        assertEquals("even a well-formed payload needs its paper", MissedLinesView.Hidden(MissedLines.INVALID), MissedLines.forCare(noPaper.copy(missed_lines = good), listOf("a")))
        val withPaper = noPaper.copy(source_text = "x".repeat(40), missed_lines = good)
        assertEquals(1, (MissedLines.forCare(withPaper, listOf("a")) as MissedLinesView.Shown).lines.size)
        assertEquals(MissedLinesView.Hidden("missing"), MissedLines.forCare(null, listOf("a")))
    }

    @Test fun webWordingIsCopiedExactly() {
        val web = File("../../../web/src/ui/MissedLines.tsx").readText().replace("&apos;", "'")
        for (s in listOf(MissedLines.TITLE, MissedLines.ALL_IN_A_STEP, MissedLines.ALL_IN_A_STEP_NOTE, MissedLines.READ_THESE, MissedLines.CAN_MISS)) {
            assertTrue("not in MissedLines.tsx: $s", web.contains(s))
        }
    }
}
