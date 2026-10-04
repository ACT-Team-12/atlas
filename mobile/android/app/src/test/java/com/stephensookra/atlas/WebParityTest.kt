package com.stephensookra.atlas

import com.stephensookra.atlas.data.AtlasJson
import com.stephensookra.atlas.data.Barrier
import com.stephensookra.atlas.data.CarePlanResponse
import com.stephensookra.atlas.data.Check
import com.stephensookra.atlas.data.HelperLink
import com.stephensookra.atlas.data.HelperPresets
import com.stephensookra.atlas.data.Language
import com.stephensookra.atlas.data.LatLng
import com.stephensookra.atlas.data.MeaningRequest
import com.stephensookra.atlas.data.MeaningResponse
import com.stephensookra.atlas.data.MeaningResult
import com.stephensookra.atlas.data.MeaningState
import com.stephensookra.atlas.data.MeaningStatus
import com.stephensookra.atlas.data.PaperFirst
import com.stephensookra.atlas.data.PlanStep
import com.stephensookra.atlas.data.ReadingLevel
import com.stephensookra.atlas.data.SavedSession
import com.stephensookra.atlas.data.ShareText
import com.stephensookra.atlas.data.StaleGuard
import com.stephensookra.atlas.data.VerifiedItem
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * The Oct 3 catch-up with the website: paper first with the second-model double-check, helper links and the
 * outdated-plan guard. Each case mirrors a rule in web/src/lib (paperFirst.ts, planQuotes.ts, speechText.ts,
 * shareText.ts, meaningRun.ts, helperLink.ts, staleGuard.ts).
 */
class WebParityTest {
    private fun item(id: String, quote: String = "Take metformin 500 mg twice a day.", grounded: Boolean = true, kind: String = "medication") =
        VerifiedItem(id = id, kind = kind, title = "Diabetes medicine", plain_language = "Take one pill two times a day.",
            `when` = "Morning and evening", source_quote = quote, grounded = grounded)

    private fun certified(id: String) = MeaningResult(id = id, certified = true, model_verdict = "same", numbers_ok = true)
    private fun flagged(id: String) = MeaningResult(id = id, flagged = true, model_verdict = "different", what_differs = "paper says \"500 mg\"")

    // ---- Paper first

    @Test fun uncheckedQuoteLeadsAndExplanationIsSecondaryWithNote() {
        val v = PaperFirst.careStep(item("a"), Check.unchecked)
        assertFalse(v.explanationLeads)
        assertEquals("Your paper says:", v.quoteLabel)
        assertEquals("Take metformin 500 mg twice a day.", v.quote)
        // The AI's title and when are its words too, so they are secondary with the plain words.
        assertEquals("Diabetes medicine · Morning and evening · Take one pill two times a day.", v.explanation)
        assertEquals(PaperFirst.NOTE_UNCHECKED, v.note)
    }

    @Test fun unconfirmedCardIsLabelledCalmly() {
        val v = PaperFirst.careStep(item("a"), Check.unchecked)
        assertEquals("Copied word for word from your paper", v.screenLabel)
        assertEquals("Plain words (not double-checked yet)", v.note)
        assertFalse(v.note!!.contains("follow your paper"))
        val web = File("../../../web/src/lib/stepsView.ts").readText()
        assertTrue("stepsView.ts SEAL_TEXT.once differs", web.contains("\"${PaperFirst.CHECKED_ONCE}\""))
    }

    @Test fun askPersonUsesOnlyThePapersWords() {
        val quote = "lisinopril 10 mg tablet. Take 2 tablets (20 mg total) by mouth once daily. Previously 10 mg once daily."
        for (check in listOf(Check.unchecked, Check.flagged)) {
            val a = PaperFirst.askPerson("medication", quote, check)!!
            assertEquals("Ask your pharmacist", a.label)
            assertEquals("My paper says: \"$quote\" Can you confirm what I should take?", a.question)
        }
        val lab = PaperFirst.askPerson("lab_test", "Hemoglobin A1c - due in 3 months", Check.unchecked)!!
        assertEquals("Ask your clinic", lab.label)
        assertEquals("My paper says: \"Hemoglobin A1c - due in 3 months\" Can you help me understand what I should do?", lab.question)
        assertNull(PaperFirst.askPerson("medication", quote, Check.certified))
        assertNull(PaperFirst.askPerson("warning_sign", "Call 911 if you have chest pain.", Check.unchecked))
        assertNull(PaperFirst.askPerson("medication", "  ", Check.unchecked))
        val web = File("../../../web/src/lib/askPerson.ts").readText()
        for (s in listOf("Can you confirm what I should take?", "Can you help me understand what I should do?", "Ask your pharmacist", "Ask your clinic", "My paper says: \"\${quote}\" Can")) {
            assertTrue("askPerson.ts lacks: $s", web.contains(s))
        }
    }

    @Test fun certifiedExplanationLeadsWithItsQuote() {
        val v = PaperFirst.careStep(item("a"), Check.certified)
        assertTrue(v.explanationLeads)
        assertEquals("Take one pill two times a day.", v.explanation)
        assertNull(v.note)
        assertEquals(listOf("Take one pill two times a day.", "Your paper says: \"Take metformin 500 mg twice a day.\""), PaperFirst.lines(v))
    }

    @Test fun textThatLeavesTheScreenNeverCarriesAnUncertifiedExplanation() {
        for (check in listOf(Check.unchecked, Check.flagged)) {
            val lines = PaperFirst.lines(PaperFirst.careStep(item("a"), check))
            assertEquals("Your paper says: \"Take metformin 500 mg twice a day.\"", lines[0])
            assertEquals(2, lines.size)
            assertFalse(lines.any { it.contains("one pill") || it.contains("Diabetes medicine") })
        }
        assertEquals(PaperFirst.LEFT_OUT_FLAGGED, PaperFirst.lines(PaperFirst.careStep(item("a"), Check.flagged))[1])
        assertEquals(PaperFirst.LEFT_OUT_UNCHECKED, PaperFirst.lines(PaperFirst.careStep(item("a"), Check.unchecked))[1])
    }

    @Test fun noQuoteMeansNoExplanation() {
        val v = PaperFirst.careStep(item("a", quote = "   "), Check.certified)
        assertEquals("", v.quote); assertNull(v.explanation)
        assertTrue(PaperFirst.lines(v).isEmpty())
    }

    @Test fun labRowLeadsWithTheReportLine() {
        val row = AtlasJson.decodeFromString(com.stephensookra.atlas.data.ResultRow.serializer(),
            """{"test":"Glucose","value":"142","quote":"Glucose 142 H","plain_name":"Blood sugar","status":"outside"}""")
        val v = PaperFirst.labRow(row)
        assertFalse(v.explanationLeads)
        assertEquals("Your report says:", v.quoteLabel)
        assertEquals("Blood sugar", v.explanation)
        assertEquals(PaperFirst.NOTE_UNCHECKED, v.note)
    }

    @Test fun remindersUseTheKindAndOnlyACertifiedWhen() {
        assertEquals("Medicine from your paper", PaperFirst.bookTitle("medication"))
        assertEquals("Appointment from your paper", PaperFirst.bookTitle("unknown"))
        assertEquals("", PaperFirst.bookWhen(item("a"), Check.unchecked))
        assertEquals("", PaperFirst.bookWhen(item("a"), Check.flagged))
        assertEquals("Morning and evening", PaperFirst.bookWhen(item("a"), Check.certified))
    }

    @Test fun planStepQuotesAreGroundedDeduplicatedAndSkipUnknownIds() {
        val items = listOf(item("a"), item("b", quote = "Take metformin 500 mg twice a day."), item("c", quote = "Not real", grounded = false), item("d", quote = "Labs in 2 weeks."))
        val step = PlanStep(title = "Get a ride", care_ids = listOf("a", "b", "c", "zzz", "d"))
        assertEquals(listOf("Take metformin 500 mg twice a day.", "Labs in 2 weeks."), PaperFirst.planStepQuotes(step, items))
        assertTrue(PaperFirst.planStepQuotes(PlanStep(title = "Call 211"), items).isEmpty())
    }

    @Test fun planReadAloudStartsWithTheSuggestionNoteAndCarriesQuotes() {
        val plan = Fixture.plan
        val lines = PaperFirst.planSpeechLines(plan, Fixture.care.items)
        assertEquals(PaperFirst.PLAN_IS_A_SUGGESTION, lines[0])
        assertEquals(plan.summary, lines[1])
        val quoted = plan.steps.flatMap { PaperFirst.planStepQuotes(it, Fixture.care.items) }
        assertEquals(2 + plan.steps.size + quoted.size, lines.size)
    }

    @Test fun planSuggestionWordingMatchesWeb() {
        val web = File("../../../web/src/lib/speechText.ts").readText()
        assertTrue(web.contains("\"${PaperFirst.PLAN_IS_A_SUGGESTION}\""))
        val pf = File("../../../web/src/lib/paperFirst.ts").readText()
        for (s in listOf(PaperFirst.NOTE_UNCHECKED, PaperFirst.NOTE_FLAGGED, PaperFirst.LEFT_OUT_UNCHECKED, PaperFirst.LEFT_OUT_FLAGGED)) {
            assertTrue("paperFirst.ts lacks: $s", pf.contains(s))
        }
    }

    // ---- The double-check (/api/meaning)

    @Test fun meaningRequestMatchesTheBrowsersBody() {
        assertNull(MeaningRequest.of(emptyList(), Language.English))
        val many = (0 until 45).map { item("item-$it") }
        val req = MeaningRequest.of(many, Language.Spanish)!!
        assertEquals(40, req.items.size)
        assertEquals("Diabetes medicine. Take one pill two times a day.", req.items[0].plain_language)
        val json = Json.parseToJsonElement(AtlasJson.encodeToString(MeaningRequest.serializer(), req)).jsonObject
        assertEquals("Spanish", json["language"]!!.jsonPrimitive.content)
        val first = json["items"]!!.jsonArray[0].jsonObject
        assertEquals(setOf("id", "plain_language", "when", "source_quote"), first.keys)
        // No language: the field is left out (the server's zod schema accepts missing, not null).
        val noLang = AtlasJson.encodeToString(MeaningRequest.serializer(), MeaningRequest.of(many.take(1), null)!!)
        assertEquals(setOf("items"), Json.parseToJsonElement(noLang).jsonObject.keys)
    }

    @Test fun meaningStateOnlyCertifiesFinishedRequestedIds() {
        val req = MeaningRequest.of(listOf(item("a"), item("b"), item("c")), Language.English)!!
        val response = AtlasJson.decodeFromString(MeaningResponse.serializer(), """
            {"results":[
              {"id":"a","flagged":false,"numbers_ok":true,"unexpected_numbers":[],"model_verdict":"same","what_differs":"","certified":true},
              {"id":"b","flagged":true,"numbers_ok":false,"unexpected_numbers":["2"],"model_verdict":"different","what_differs":"x","certified":false},
              {"id":"c","flagged":false,"numbers_ok":true,"unexpected_numbers":[],"model_verdict":"unclear","what_differs":"","certified":false},
              {"id":"evil","flagged":false,"numbers_ok":true,"unexpected_numbers":[],"model_verdict":"same","what_differs":"","certified":true}
            ],"flagged":1,"checker_model":"m","ms":10}""")
        val state = MeaningState.done(req, response)
        assertEquals(Check.certified, state.checkFor("a"))
        assertEquals(Check.flagged, state.checkFor("b"))
        assertEquals(Check.unchecked, state.checkFor("c"))
        assertEquals(Check.unchecked, state.checkFor("evil"))
        assertFalse(state.byId.containsKey("evil"))
        // While loading or after an error, nothing leads with an explanation.
        assertEquals(Check.unchecked, MeaningState(MeaningStatus.loading, state.byId).checkFor("a"))
        assertEquals(Check.unchecked, MeaningState(MeaningStatus.error, state.byId).checkFor("a"))
        assertEquals(Check.flagged, PaperFirst.checkOf(MeaningResult("x", flagged = true, certified = true)))
    }

    @Test fun shareTextSendsAnExplanationOnlyWhenCertified() {
        val items = listOf(item("a"), item("b", quote = "Labs in 2 weeks.", kind = "lab_test"), item("c", quote = "Walk daily.", kind = "self_care"))
        val plan = Fixture.plan.copy(steps = listOf(PlanStep(title = "Get a ride", action = "Call MARTA Mobility.", care_ids = listOf("b"))))
        val meaning = MeaningState(MeaningStatus.done, mapOf("a" to certified("a"), "b" to flagged("b")))
        val text = ShareText.plan(items, plan, emptyList(), meaning, items)
        assertTrue(text.contains("1. Medicine: Diabetes medicine (Morning and evening)"))
        assertTrue(text.contains("   Take one pill two times a day."))
        assertTrue(text.contains("2. Lab test\n   Double-check this one with your clinic"))
        assertTrue(text.contains("3. Self care\n   Your paper says: \"Walk daily.\"\n   ${PaperFirst.LEFT_OUT_UNCHECKED}"))
        assertEquals(1, text.split("Take one pill two times a day.").size - 1)
        assertTrue(text.contains("1. Get a ride. Call MARTA Mobility.\n   Your paper says: \"Labs in 2 weeks.\""))
        assertTrue(text.contains("Suggestion from ATLAS, not the paper: ${plan.summary}"))
        // With no double-check at all (the default), no explanation leaves the phone.
        assertFalse(ShareText.plan(items, plan, emptyList()).contains("one pill"))
    }

    @Test fun nextVisitQuestionsCarryTheAIQuestionOnlyWhenCertified() {
        val aiQ = "QUESTION-WHICH-METFORMIN-DOSE"
        val asks = item("a").copy(needs_clarification = true, question_for_clinic = aiQ)
        val plan = Fixture.plan.copy(steps = emptyList())
        // Older readings also repeat the step's question in the general list: it must not leak through there either.
        val general = listOf(aiQ, "Do I need a ride?")
        for (meaning in listOf(MeaningState.IDLE, MeaningState(MeaningStatus.error), MeaningState(MeaningStatus.done, mapOf("a" to flagged("a"))))) {
            val text = ShareText.plan(listOf(asks), plan, general, meaning, listOf(asks))
            assertFalse(text.contains(aiQ))
            assertTrue(text.contains("- My paper says: \"Take metformin 500 mg twice a day.\" Can you confirm what I should take?"))
            assertTrue(text.contains("- Do I need a ride?"))
        }
        val ok = ShareText.plan(listOf(asks), plan, general, MeaningState(MeaningStatus.done, mapOf("a" to certified("a"))), listOf(asks))
        assertEquals(1, ok.split(aiQ).size - 1)
        // A removed step's question stays out of the general list as well.
        assertEquals(listOf("Do I need a ride?"), PaperFirst.visitQuestions(emptyList(), general, listOf(asks)) { Check.certified })
        assertEquals("which pain medicines are safe", PaperFirst.questionKey("  Which pain-medicines, are SAFE?? "))
        assertTrue("visitQuestions.ts moved", File("../../../web/src/lib/visitQuestions.ts").readText().contains("export function visitQuestions"))
    }

    @Test fun extractResponseCarriesItsLanguageAndOldFilesStillLoad() {
        val care = AtlasJson.decodeFromString(CarePlanResponse.serializer(),
            """{"items":[],"stats":{"extracted":0,"grounded":0,"refused":0,"ms":1},"language":"Korean"}""")
        assertEquals(Language.Korean, care.language)
        assertNull(AtlasJson.decodeFromString(CarePlanResponse.serializer(), """{"items":[],"stats":{"extracted":0,"grounded":0,"refused":0,"ms":1}}""").language)
        val old = AtlasJson.decodeFromString(SavedSession.serializer(), """{"text":"x","language":"English","level":"simple","savedAt":1}""")
        assertEquals(MeaningStatus.idle, old.meaning.status)
        assertNull(old.planFingerprint)
    }

    // ---- Helper links

    @Test fun parsesTheDocumentedHelperLink() {
        assertEquals(HelperPresets(Language.Spanish, ReadingLevel.simple, "30310"), HelperLink.parseFragment("#try&via=helper&lang=es&level=simple&zip=30310"))
        assertEquals(HelperPresets(), HelperLink.parseFragment("try&via=helper"))
        assertEquals(HelperPresets(language = Language.Amharic), HelperLink.parseFragment("#via=helper&lang=am"))
    }

    @Test fun helperLinkRejectsAnythingOffTheAllowLists() {
        assertNull(HelperLink.parseFragment(null))
        assertNull(HelperLink.parseFragment(""))
        assertNull(HelperLink.parseFragment("#try&lang=es"))
        assertNull(HelperLink.parseFragment("#via=helper&via=helper&lang=es")) // repeated via is ambiguous
        assertNull(HelperLink.parseFragment("#via=Helper"))
        assertNull(HelperLink.parseFragment("#via=helper&lang=es&" + "x".repeat(120)))
        val p = HelperLink.parseFragment("#via=helper&lang=%65s&level=SIMPLE&zip=00000&lang2=es&zip=3031")!!
        assertEquals(HelperPresets(), p)
        assertEquals(HelperPresets(level = ReadingLevel.detailed), HelperLink.parseFragment("#via=helper&lang=es&lang=fr&level=detailed&zip=1234a"))
    }

    @Test fun onlyOurOwnHttpsHostCounts() {
        val f = "try&via=helper&lang=es"
        assertEquals(Language.Spanish, HelperLink.fromLink("https", "atlas-team12.vercel.app", f)?.language)
        assertNull(HelperLink.fromLink("http", "atlas-team12.vercel.app", f))
        assertNull(HelperLink.fromLink("https", "evil.example", f))
        assertNull(HelperLink.fromLink("https", "atlas-team12.vercel.app.evil.example", f))
    }

    @Test fun bannerMatchesTheWebsite() {
        assertEquals("Someone helping you set this up. You can change anything.", HelperLink.banner(HelperPresets()).text)
        assertEquals("Someone helping you set this up in English for 30310. You can change anything.",
            HelperLink.banner(HelperPresets(Language.English, zip = "30310")).text)
        val es = HelperLink.banner(HelperPresets(Language.Spanish, zip = "30310"))
        assertEquals("Alguien que le ayuda preparó esto en español para el código postal 30310. Puede cambiar cualquier cosa.", es.text)
        assertEquals("es", es.langCode)
        assertEquals("Someone helping you set this up in Spanish for 30310. You can change anything.", es.english)
        // Every localized banner's opening words appear in web/src/lib/helperLink.ts.
        val web = File("../../../web/src/lib/helperLink.ts").readText()
        for (l in Language.entries) {
            val text = HelperLink.banner(HelperPresets(l)).text
            assertTrue("banner for $l drifted: $text", web.contains(text.take(14)))
        }
        for ((l, code) in HelperLink.LANG_CODE) assertTrue(web.contains("${l.name}: \"$code\""))
    }

    @Test fun manifestAndAssetLinksAgree() {
        val manifest = File("src/main/AndroidManifest.xml").readText()
        assertTrue(manifest.contains("android:autoVerify=\"true\""))
        assertTrue(manifest.contains("android:host=\"${HelperLink.HOST}\""))
        val links = Json.parseToJsonElement(File("../../../web/public/.well-known/assetlinks.json").readText()).jsonArray[0].jsonObject
        val target = links["target"]!!.jsonObject
        assertEquals("com.stephensookra.atlas", target["package_name"]!!.jsonPrimitive.content)
        val fp = target["sha256_cert_fingerprints"]!!.jsonArray[0].jsonPrimitive.content
        assertTrue(Regex("^([0-9A-F]{2}:){31}[0-9A-F]{2}$").matches(fp))
    }

    // ---- Outdated plan

    @Test fun planFingerprintIgnoresBarrierOrderButNothingElse() {
        fun fp(ids: List<String> = listOf("a"), b: List<Barrier> = listOf(Barrier.cost, Barrier.transport), lang: Language = Language.English,
               note: String = "", zip: String = "30303", loc: LatLng? = null) =
            StaleGuard.planFingerprint(ids, b, lang, note, StaleGuard.place(loc, zip), loc)
        assertEquals(fp(), fp(b = listOf(Barrier.transport, Barrier.cost)))
        assertNotEquals(fp(), fp(ids = listOf("a", "b")))
        assertNotEquals(fp(), fp(b = listOf(Barrier.cost)))
        assertNotEquals(fp(), fp(lang = Language.Spanish))
        assertNotEquals(fp(), fp(note = "no car"))
        assertNotEquals(fp(), fp(zip = "30310"))
        assertNotEquals(fp(), fp(loc = LatLng(33.7, -84.4)))
        assertEquals(fp(loc = LatLng(33.7, -84.4)), fp(zip = "30310", loc = LatLng(33.7, -84.4)))
        assertNotEquals(StaleGuard.readFingerprint("x", Language.English, ReadingLevel.simple), StaleGuard.readFingerprint("x", Language.English, ReadingLevel.detailed))
    }
}
