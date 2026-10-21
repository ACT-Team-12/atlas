package com.stephensookra.atlas

import com.stephensookra.atlas.data.AskPaper
import com.stephensookra.atlas.data.AskRequest
import com.stephensookra.atlas.data.AtlasJson
import com.stephensookra.atlas.data.Language
import com.stephensookra.atlas.data.VerifiedItem
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
 * "Ask my paper" on Android, checked against the website. mobile/shared/ask-vectors.json (the same file iOS replays) holds
 * the website's own answers: every fixed string in seven languages, which questions are urgent (never sent), the ready
 * question, and which quotes survive onThisPaper.
 */
class AskPaperTest {
    private val vectors by lazy { AtlasJson.parseToJsonElement(File("../../shared/ask-vectors.json").readText()).jsonObject }

    private fun str(o: JsonObject, k: String) = o.getValue(k).jsonPrimitive.content

    @Test fun fixedStringsAreTheWebsitesInAllSevenLanguages() {
        val web = vectors.getValue("text").jsonObject
        assertEquals(Language.entries.map { it.name }.toSet(), web.keys)
        assertEquals(AskPaper.MAX_QUESTION, vectors.getValue("max_question").jsonPrimitive.int)
        for (language in Language.entries) {
            val w = web.getValue(language.name).jsonObject
            val t = AskPaper.strings(language)
            val mine = mapOf(
                "title" to t.title, "intro" to t.intro, "label" to t.label, "placeholder" to t.placeholder, "button" to t.button,
                "asking" to t.asking, "refusal" to t.refusal, "readyLabel" to t.readyLabel, "readyHint" to t.readyHint,
                "copy" to t.copy, "copied" to t.copied, "urgentTitle" to t.urgentTitle, "urgentBody" to t.urgentBody,
                "urgentPaper" to t.urgentPaper, "paperLabel" to t.paperLabel, "leadNote" to t.leadNote, "error" to t.error,
                "busy" to t.busy, "unavailable" to t.unavailable, "today" to t.today,
                "readyQuestion" to t.readyQuestion("can I drive?"), "about" to t.about("ibuprofen"),
                "held1" to t.held(1), "held2" to t.held(2), "held5" to t.held(5),
            )
            assertEquals(language.name, w.keys, mine.keys)
            for ((k, v) in mine) assertEquals("$language.$k", str(w, k), v)
        }
    }

    @Test fun urgentReadyAndOnThisPaperMatchTheWebsite() {
        var passed = 0
        val urgent = vectors.getValue("urgent").jsonArray.map { it.jsonObject }
        for (u in urgent) {
            assertEquals(str(u, "question"), u.getValue("urgent").jsonPrimitive.boolean, AskPaper.isUrgentQuestion(str(u, "question")))
            passed++
        }
        val ready = vectors.getValue("ready").jsonArray.map { it.jsonObject }
        for (r in ready) {
            val want = r.getValue("expected").jsonObject
            val got = AskPaper.askAboutQuestion(str(r, "question"), str(r, "language"))
            assertEquals(r.toString(), str(want, "who"), got.who)
            assertEquals(r.toString(), str(want, "label"), got.label)
            assertEquals(r.toString(), str(want, "question"), got.question)
            passed++
        }
        val paper = vectors.getValue("on_this_paper").jsonArray.map { it.jsonObject }
        for (c in paper) {
            val res = AskPaper.decode(c.getValue("res").toString())!!
            val want = AskPaper.decode(c.getValue("expected").toString())!!
            assertEquals(str(c, "name"), want, AskPaper.onThisPaper(res, str(c, "source")))
            passed++
        }
        val total = urgent.size + ready.size + paper.size
        assertTrue("too few Ask my paper cases: $total", total > 90)
        // android-ci reads this line from the test report to prove the shared vectors ran.
        println("ask vectors: $passed of $total equal to the web reference")
    }

    @Test fun refusalsShowFixedWordsNotTheServersEnglish() {
        assertEquals(AskPaper.strings(Language.English).today, AskPaper.errorMessage(429, "shared-daily", Language.English))
        assertEquals(AskPaper.strings(Language.Spanish).busy, AskPaper.errorMessage(429, null, Language.Spanish))
        assertEquals(AskPaper.strings(Language.French).unavailable, AskPaper.errorMessage(503, "unavailable", Language.French))
        assertEquals(AskPaper.strings(Language.Korean).error, AskPaper.errorMessage(500, "shared-daily", Language.Korean))
    }

    @Test fun anUnknownKindIsAnErrorNotAnAnswer() {
        assertNull(AskPaper.decode("""{"kind":"advice","text":"take two"}"""))
        assertNull(AskPaper.decode("""{"error":"busy"}"""))
        assertNull(AskPaper.decode("not json"))
        assertEquals(AskPaper.Response.Urgent, AskPaper.decode("""{"kind":"urgent"}"""))
    }

    @Test fun theRequestIsTheWebsitesBody() {
        val body = AtlasJson.encodeToString(AskRequest.serializer(), AskRequest("Take 1 tablet daily.", Language.Spanish, "when?"))
        val o = AtlasJson.parseToJsonElement(body).jsonObject
        assertEquals(setOf("source_text", "language", "question"), o.keys)
        assertEquals("Spanish", str(o, "language"))
    }

    @Test fun urgentCardShowsOnlyThePapersOwnWarningLines() {
        val items = listOf(
            VerifiedItem("a", "warning_sign", "", "", source_quote = "Rest at home.", grounded = true),
            VerifiedItem("b", "self_care", "", "", source_quote = "Call 911 if you have chest pain.", grounded = true),
        )
        assertEquals(listOf("b"), AskPaper.warningLines(items).map { it.id })
    }
}
