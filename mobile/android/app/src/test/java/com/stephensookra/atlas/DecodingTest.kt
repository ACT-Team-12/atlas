package com.stephensookra.atlas

import com.stephensookra.atlas.data.ApiErrors
import com.stephensookra.atlas.data.AtlasJson
import com.stephensookra.atlas.data.Barrier
import com.stephensookra.atlas.data.CarePlanResponse
import com.stephensookra.atlas.data.ItemKind
import com.stephensookra.atlas.data.Language
import com.stephensookra.atlas.data.LatLng
import com.stephensookra.atlas.data.PlanRequest
import com.stephensookra.atlas.data.PlanResponse
import com.stephensookra.atlas.data.ResourceCard
import com.stephensookra.atlas.data.Sample
import com.stephensookra.atlas.data.nonEmpty
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Fixtures are real responses CAPTURED FROM THE LIVE API (https://atlas-team12.vercel.app) on 2026-10-02
 * with the labeled sample paper, by mobile/ios/scripts/capture_fixtures.py (copied from the iOS app's tests).
 * They are not hand-written.
 */
object Fixture {
    fun text(name: String): String =
        requireNotNull(Fixture::class.java.classLoader!!.getResource("fixtures/$name.json")) { "missing fixture $name" }.readText()

    val care: CarePlanResponse by lazy { AtlasJson.decodeFromString(CarePlanResponse.serializer(), text("extract_sample_live")) }
    val plan: PlanResponse by lazy { AtlasJson.decodeFromString(PlanResponse.serializer(), text("plan_sample_30303_live")) }
}

class DecodingTest {
    @Test fun decodesLiveExtractResponse() {
        val care = Fixture.care
        assertEquals("text", care.source_kind)
        assertEquals(care.stats.grounded, care.items.size)
        assertEquals(12, care.items.size)
        assertEquals(care.stats.refused, care.refused.size)
        assertTrue(care.has_warning_signs)
        assertTrue(care.items.all { it.grounded && it.source_quote.isNotEmpty() })
        assertTrue(care.items.all { it.itemKind != null })
        assertTrue(care.items.any { it.itemKind == ItemKind.warning_sign })
    }

    /** Every quote the server kept is found word for word in the text that was sent, at its span. */
    @Test fun everyQuoteMatchesItsSpanInSourceText() {
        val care = Fixture.care
        for (item in care.items) {
            val span = assertNotNull("no span for ${item.id}", item.span).let { item.span!! }
            // Spans are JavaScript (UTF-16) string offsets, the same unit as a Kotlin String index.
            assertEquals("span mismatch for ${item.id}", item.source_quote, care.source_text.substring(span.start, span.end))
        }
    }

    @Test fun sourceTextWasTheLabeledSampleUnchanged() {
        assertEquals(Sample.TEXT, Fixture.care.source_text)
    }

    @Test fun decodesLivePlanResponse() {
        val plan = Fixture.plan
        assertEquals("zip", plan.located.by)
        assertEquals("Near ZIP 30303", plan.located.label)
        assertEquals(plan.stats.steps, plan.steps.size)
        assertEquals(plan.stats.candidates, plan.resources.size)
        for (step in plan.steps) for (id in step.resource_ids) assertNotNull("missing $id", plan.resources[id])
        val clinics = plan.resources.values.filterIsInstance<ResourceCard.ClinicCard>()
        val programs = plan.resources.values.filterIsInstance<ResourceCard.ProgramCard>()
        assertEquals(4, clinics.size)
        assertTrue(programs.isNotEmpty())
        assertTrue(clinics.all { it.clinic.phone.isNotEmpty() && it.km != null })
        assertTrue(programs.all { it.program.evidence_quote.isNotEmpty() && it.program.source_url.isNotEmpty() })
        // Map keys are the card ids.
        assertTrue(plan.resources.all { (k, v) -> k == v.id })
    }

    @Test fun planStepsCiteCareItemsFromTheSameRun() {
        val ids = Fixture.care.items.map { it.id }.toSet()
        for (step in Fixture.plan.steps) for (id in step.care_ids) assertTrue("unknown care id $id", id in ids)
    }

    @Test fun planRoundTripsThroughJson() {
        val plan = Fixture.plan
        val again = AtlasJson.decodeFromString(PlanResponse.serializer(), AtlasJson.encodeToString(PlanResponse.serializer(), plan))
        assertEquals(plan, again)
        val raw = Json.parseToJsonElement(AtlasJson.encodeToString(PlanResponse.serializer(), plan)).jsonObject
        val anyCard = raw["resources"]!!.jsonObject.values.first().jsonObject
        assertTrue(anyCard["type"]!!.jsonPrimitive.content in setOf("clinic", "program"))
    }

    @Test fun toleratesExtraAndDefaultedFields() {
        val json = """
            {"source_text":"x","items":[{"id":"item-0","kind":"self_care","title":"Walk","plain_language":"Walk daily",
            "source_quote":"Walk 30 minutes","grounded":true,"span":null,"brand_new_field":42}],
            "stats":{"extracted":1,"grounded":1,"refused":0,"ms":5},"unknown":{"a":1}}
        """.trimIndent()
        val care = AtlasJson.decodeFromString(CarePlanResponse.serializer(), json)
        assertEquals("", care.items.first().why)
        assertFalse(care.items.first().needs_clarification)
        assertTrue(care.refused.isEmpty())
        assertFalse(care.has_warning_signs)
    }

    /** zod accepts a missing zip/location but rejects null, so nulls must be left out entirely. */
    @Test fun planRequestOmitsMissingLocationAndZip() {
        val req = PlanRequest(care = emptyList(), barriers = listOf(Barrier.transport, Barrier.cost), zip = "30303",
            location = null, language = Language.English, note = "")
        val obj = Json.parseToJsonElement(AtlasJson.encodeToString(PlanRequest.serializer(), req)) as JsonObject
        assertEquals("30303", obj["zip"]!!.jsonPrimitive.content)
        assertFalse(obj.containsKey("location"))
        assertEquals(listOf("transport", "cost"), obj["barriers"]!!.jsonArray.map { it.jsonPrimitive.content })
        assertEquals("English", obj["language"]!!.jsonPrimitive.content)

        val noZip = PlanRequest(emptyList(), emptyList(), null, LatLng(33.75, -84.39), Language.Spanish, "")
        val obj2 = Json.parseToJsonElement(AtlasJson.encodeToString(PlanRequest.serializer(), noZip)) as JsonObject
        assertFalse(obj2.containsKey("zip"))
        assertEquals(33.75, obj2["location"]!!.jsonObject["lat"]!!.jsonPrimitive.content.toDouble(), 0.0)
    }

    @Test fun serverErrorsBecomePlainWords() {
        assertEquals("Too many tries, wait a few minutes.", ApiErrors.from(429, """{"error":"rate"}"""))
        assertEquals("Provide the after-visit summary as text.", ApiErrors.from(400, """{"error":"Provide the after-visit summary as text."}"""))
        assertEquals("ATLAS had a problem on its side. Try again in a minute.", ApiErrors.from(502, "<html>"))
        assertEquals("Something went wrong. Try again.", ApiErrors.from(400, null))
    }

    /** The live API sends "" for a program with no phone (marta-reduced-fare). It must not get a Call button. */
    @Test fun emptyProgramPhoneIsTreatedAsMissing() {
        val card = Fixture.plan.resources["marta-reduced-fare"] as ResourceCard.ProgramCard
        assertEquals("", card.program.access.phone)
        assertNull(card.program.access.phone.nonEmpty())
        assertNotNull(card.program.access.url.nonEmpty())
        assertNull("   ".nonEmpty())
        assertNull((null as String?).nonEmpty())
    }

    @Test fun barrierOrderAndLabelsMatchWeb() {
        assertEquals(
            listOf("transport", "cost", "insurance", "language", "schedule", "tech", "referrals", "food", "housing"),
            Barrier.entries.map { it.name },
        )
        assertEquals("Getting there (no car, long bus ride)", Barrier.transport.label)
    }
}
