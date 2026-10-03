package com.stephensookra.atlas

import com.stephensookra.atlas.data.AtlasJson
import com.stephensookra.atlas.data.LabSample
import com.stephensookra.atlas.data.PlanResponse
import com.stephensookra.atlas.data.ResourceCard
import com.stephensookra.atlas.data.ResultsResponse
import com.stephensookra.atlas.data.ShareText
import com.stephensookra.atlas.services.CalendarDraft
import com.stephensookra.atlas.ui.Links
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.net.URLDecoder

/**
 * The features the phone app gained to match the website on Oct 2: lab results, Send to family, nationwide clinics
 * and Add to my calendar. Fixtures are real responses captured from the live API (mobile/ios/scripts/capture_fixtures.py).
 */
class CatchUpTest {
    private val results by lazy { AtlasJson.decodeFromString(ResultsResponse.serializer(), Fixture.text("results_sample_live")) }
    private val ohio by lazy { AtlasJson.decodeFromString(PlanResponse.serializer(), Fixture.text("plan_sample_43215_live")) }

    @Test fun decodesLiveLabResults() {
        assertEquals(5, results.counts.outside); assertEquals(5, results.counts.inside); assertEquals(10, results.rows.size)
        for (row in results.rows) assertTrue("quote not in sample: ${row.quote}", LabSample.TEXT.contains(row.quote))
        val glucose = results.rows.first { it.test.startsWith("Glucose") }
        assertEquals("outside", glucose.status); assertEquals("high", glucose.direction)
    }

    @Test fun labSampleMatchesWebSource() {
        val web = File("../../../web/src/lib/sampleLabs.ts").readText()
        assertTrue(web.contains(LabSample.TEXT))
    }

    @Test fun labHeadlineNeverClaimsAnAllClearWithoutFullCoverage() {
        fun r(json: String) = AtlasJson.decodeFromString(ResultsResponse.serializer(), json)
        val row = """{"test":"Sodium","value":"139","quote":"Sodium 139","status":"inside"}"""
        val counts = """"counts":{"outside":0,"inside":1,"unknown":0}"""
        assertTrue(r("""{"rows":[],"counts":{"outside":0,"inside":0,"unknown":0}}""").headline.startsWith("We couldn't read any results"))
        assertTrue(r("""{"rows":[$row],$counts}""").headline.startsWith("None of the results we read"))
        assertEquals("We checked 1 of 3 result lines. None of the ones we checked is outside its range.",
            r("""{"rows":[$row],$counts,"coverage":{"candidates":3,"checked":1,"unchecked":["a","b"]}}""").headline)
        assertEquals("Nothing on this report is marked or printed as outside its range.",
            r("""{"rows":[$row],$counts,"coverage":{"candidates":1,"checked":1,"unchecked":[]}}""").headline)
    }

    @Test fun nationwidePlanOutsideGeorgia() {
        assertEquals("Near ZIP 43215", ohio.located.label)
        var clinics = 0
        for (card in ohio.resources.values) when (card) {
            is ResourceCard.ClinicCard -> {
                clinics++
                assertTrue(card.clinic.city.endsWith(", OH"))
                val dest = URLDecoder.decode(Links.transit(card.clinic), "UTF-8")
                assertTrue(dest.contains("Columbus, OH")); assertFalse(dest.contains(", GA "))
            }
            is ResourceCard.ProgramCard -> assertFalse(card.id.startsWith("marta") || card.id.startsWith("georgia") || card.id.startsWith("grady"))
        }
        assertTrue(clinics >= 1)
    }

    @Test fun shareTextCarriesTheLineFromThePaperAndOnlyUsedResources() {
        val text = ShareText.plan(Fixture.care.items, ohio, Fixture.care.questions_for_doctor)
        val grounded = Fixture.care.items.filter { it.grounded }
        val paperPart = text.substringAfter("WHAT THE PAPER SAYS TO DO").substringBefore("THE PLAN (")
        assertEquals(grounded.size, paperPart.split("Your paper says: \"").size - 1)
        for (i in grounded) assertTrue(text.contains(i.source_quote))
        val used = ohio.steps.flatMap { it.resource_ids }.toSet()
        for ((id, card) in ohio.resources) if (card is ResourceCard.ClinicCard) assertEquals(id in used, text.contains(card.clinic.name))
        assertTrue(text.endsWith("If something feels urgent, call the clinic or 911."))
    }

    @Test fun calendarDraftCarriesTheQuote() {
        val d = CalendarDraft("Fasting blood test", 1_800_000_000_000, "Return for basic metabolic panel within 2 weeks.", "Call to book.")
        assertEquals(3_600_000L, d.endMillis - d.startMillis)
        assertTrue(d.notes.contains("Your paper says: \"Return for basic metabolic panel within 2 weeks.\""))
        assertFalse(CalendarDraft("Apply", 0, "", "").notes.contains("Your paper says"))
    }
}
