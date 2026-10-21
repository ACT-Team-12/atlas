package com.stephensookra.atlas

import com.stephensookra.atlas.data.AtlasJson
import com.stephensookra.atlas.data.DoseReadings
import com.stephensookra.atlas.data.Language
import com.stephensookra.atlas.data.MedicineChanges
import com.stephensookra.atlas.data.StepsWhen
import com.stephensookra.atlas.data.TextSpan
import com.stephensookra.atlas.data.VerifiedItem
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * "Your medicine changes" on Android, checked against the website. mobile/shared/medicine-changes-vectors.json (the
 * same file the web suite and iOS replay) holds the expected row, reason, medicine name and old and new dose for every
 * case, in all seven app languages.
 */
class MedicineChangesTest {
    private val cases by lazy {
        AtlasJson.parseToJsonElement(File("../../shared/medicine-changes-vectors.json").readText()).jsonObject
            .getValue("cases").jsonArray.map { it.jsonObject }
    }

    private fun str(o: JsonObject, k: String): String? = o[k]?.takeIf { it != JsonNull }?.jsonPrimitive?.content

    @Test fun everyCaseMatchesTheWebsite() {
        assertTrue(cases.size >= 60)
        assertEquals(Language.entries.map { it.name }.toSet(), cases.map { str(it, "language") }.toSet())
        var passed = 0
        for (c in cases) {
            val name = str(c, "name")!!
            val quote = str(c, "quote")!!
            val kind = str(c, "kind")!!
            val paper = str(c, "paper")
            val span = paper?.let { val at = it.indexOf(quote); assertTrue("quote not in its paper: $name", at >= 0); TextSpan(at, at + quote.length) }
            val expect = c.getValue("expect").jsonObject
            val got = MedicineChanges.change("x", kind, quote, span, paper ?: "")
            if (str(expect, "row") == "none") {
                assertEquals(name, null, got)
            } else {
                assertTrue("$name: got null", got != null)
                got!!
                assertEquals(name, str(expect, "row"), got.row.name)
                // Every Stop on the card is also a stop the list's "Right away" rule accepts.
                if (got.row == MedicineChanges.Row.stop) assertTrue(name, StepsWhen.stopNowFromPaper(kind, quote, span, paper ?: ""))
                str(expect, "reason")?.let { assertEquals(name, it, got.reason) }
                if ("dose" in expect) {
                    val d = expect["dose"] as? JsonObject
                    assertEquals(name, d?.let { MedicineChanges.Dose(str(it, "was")!!, str(it, "now")!!) }, got.dose)
                }
                if ("medicine_name" in expect) assertEquals(name, str(expect, "medicine_name"), got.name)
                assertEquals(name, StepsWhen.trim(StepsWhen.spaces(quote)), got.quote)
                got.dose?.let { assertTrue(name, quote.contains(it.was) && quote.contains(it.now)) }
            }
            passed++
        }
        // android-ci reads this line from the test report to prove the shared vectors ran.
        println("medicine vectors: $passed of ${cases.size} equal to the web reference")
    }

    @Test fun groupsComeStopFirstAndLeaveOutEmptyRows() {
        val paper = "START taking these medications:\n- metformin 500 mg tablet. Take 1 tablet daily.\nSTOP taking these medications:\n- ibuprofen 200 mg tablet.\nWalk daily."
        fun item(id: String, kind: String, quote: String): VerifiedItem {
            val at = paper.indexOf(quote)
            return VerifiedItem(id, kind, id, id, source_quote = quote, span = TextSpan(at, at + quote.length))
        }
        val items = listOf(item("met", "medication", "metformin 500 mg tablet. Take 1 tablet daily."),
            item("ibu", "medication", "ibuprofen 200 mg tablet."), item("walk", "self_care", "Walk daily."))
        val groups = MedicineChanges.groups(items, paper)
        assertEquals(listOf(MedicineChanges.Row.stop, MedicineChanges.Row.start), groups.map { it.first })
        assertEquals(listOf("ibu", "met"), groups.flatMap { it.second }.map { it.id })
        assertEquals("was 10 mg, now 20 mg", MedicineChanges.doseWords(MedicineChanges.Dose("10 mg", "20 mg")))
    }

    @Test fun englishNumberWordsAndReadings() {
        assertEquals(listOf("2"), DoseReadings.englishNumbers("take two tablets"))
        assertEquals(listOf("120"), DoseReadings.englishNumbers("one hundred twenty"))
        assertEquals(emptyList<String>(), DoseReadings.englishNumbers("call a doctor"))
        assertEquals(listOf("1"), DoseReadings.englishNumbers("a tablet"))
        val r = DoseReadings.doseReadings("Take 2 tablets (20 mg total) by mouth once daily. Previously 10 mg once daily.")
        assertEquals(listOf("2", "20", "10"), r.map { it.value })
        assertEquals(listOf("dose", "mass", "mass"), r.map { it.unit })
        assertTrue(r.last().previously)
    }
}
