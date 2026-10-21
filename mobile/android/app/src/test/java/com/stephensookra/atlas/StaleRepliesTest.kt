package com.stephensookra.atlas

import android.app.Application
import com.stephensookra.atlas.data.ApiClient
import com.stephensookra.atlas.data.ApiException
import com.stephensookra.atlas.data.AtlasApi
import com.stephensookra.atlas.data.Barrier
import com.stephensookra.atlas.data.CarePlanResponse
import com.stephensookra.atlas.data.Language
import com.stephensookra.atlas.data.MeaningRequest
import com.stephensookra.atlas.data.MeaningResponse
import com.stephensookra.atlas.data.PlanRequest
import com.stephensookra.atlas.data.PlanResponse
import com.stephensookra.atlas.data.ReadingLevel
import com.stephensookra.atlas.data.ReadyCue
import com.stephensookra.atlas.data.SavedSession
import com.stephensookra.atlas.data.SessionStore
import com.stephensookra.atlas.data.StaleGuard
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.nio.file.Files

/**
 * A read or plan whose inputs change while it runs (possible while the person looks around) is stopped and its late
 * reply never applied, as on the website (stopStaleRead / stopStalePlan in web/src/ui/CarePlanTool.tsx). These run the
 * real AppModel against a stand-in server whose replies wait until the test releases them.
 */
class StaleRepliesTest {
    private class TestApp(private val dir: File) : Application() {
        override fun getFilesDir(): File = dir
        override fun getApplicationContext() = this
    }

    /** A server that holds each read and plan until the test answers it. */
    private class HeldApi : AtlasApi {
        val read = CompletableDeferred<CarePlanResponse>()
        val planned = CompletableDeferred<PlanResponse>()
        var reads = 0
        var plans = 0
        override suspend fun extract(text: String, level: ReadingLevel, language: Language): CarePlanResponse { reads++; return read.await() }
        override suspend fun plan(request: PlanRequest, fromHelperLink: Boolean): PlanResponse { plans++; return planned.await() }
        override suspend fun meaning(request: MeaningRequest): MeaningResponse = throw ApiException("not in this test")
        override suspend fun ask(sourceText: String, language: Language, question: String): ApiClient.AskOutcome = throw ApiException("not in this test")
    }

    private val text = "Take metformin 500 mg twice a day with meals. Call 911 for chest pain."

    /** A saved, current reading and plan (fingerprints made from the saved inputs), so both a read and a plan can start. */
    private fun model(api: HeldApi): AppModel {
        val dir = Files.createTempDirectory("atlas-stale").toFile().apply { deleteOnExit() }
        val care = Fixture.care.copy(language = Language.Spanish)
        SessionStore(dir).save(
            SavedSession(
                text = text, language = Language.Spanish, level = ReadingLevel.simple, care = care, barriers = listOf(Barrier.cost),
                zip = "30303", note = "", plan = Fixture.plan, done = mapOf("kept" to true),
                readFingerprint = StaleGuard.readFingerprint(text, Language.Spanish, ReadingLevel.simple),
                planFingerprint = StaleGuard.planFingerprint(care.items.map { it.id }, listOf(Barrier.cost), Language.Spanish, "", "30303", null),
                savedAt = 1_000L,
            ),
        )
        // Unconfined: a reply released by the test is applied right there, on the test's thread.
        return AppModel(TestApp(dir), api, CoroutineScope(Dispatchers.Unconfined))
    }

    /** A reply the server would send: different from what is on screen, so applying it would show. */
    private val freshCare get() = Fixture.care.copy(language = Language.French, source_text = "a newer reading")
    private val freshPlan get() = Fixture.plan.copy(summary = "a newer plan")

    private fun readWhile(change: (AppModel) -> Unit) {
        val api = HeldApi()
        val m = model(api)
        val care = m.care; val plan = m.plan
        assertTrue(m.canRead)
        m.readPaper()
        m.lookingAround = true
        assertEquals(Busy.Reading, m.busy)
        change(m)
        assertNull("the read stops as soon as an input changes", m.busy)
        assertEquals(AppModel.READ_STOPPED, m.notice)
        api.read.complete(freshCare) // the late reply
        assertEquals("the late reply replaced nothing", care, m.care)
        assertEquals(plan, m.plan)
        assertEquals("and cleared nothing", mapOf("kept" to true), m.done.toMap())
        assertEquals(0, m.readingCount)
        assertNull(m.readyCue)
        assertNull(m.error)
    }

    @Test fun aReadWhoseTextChangesAppliesNothing() = readWhile { it.updateText("$text Drink water.") }
    @Test fun aReadWhoseLanguageChangesAppliesNothing() = readWhile { it.updateLanguage(Language.French) }
    @Test fun aReadWhoseLevelChangesAppliesNothing() = readWhile { it.updateLevel(ReadingLevel.detailed) }

    private fun planWhile(change: (AppModel) -> Unit) {
        val api = HeldApi()
        val m = model(api)
        val care = m.care; val plan = m.plan
        assertTrue(m.canPlan)
        m.makePlan()
        m.lookingAround = true
        assertEquals(Busy.Planning, m.busy)
        change(m)
        assertNull("the plan stops as soon as an input changes", m.busy)
        assertEquals(AppModel.PLAN_STOPPED, m.notice)
        api.planned.complete(freshPlan) // the late reply
        assertEquals("the late reply replaced nothing", plan, m.plan)
        assertEquals(care, m.care)
        assertEquals(0, m.planCount)
        assertNull(m.readyCue)
        assertNull(m.error)
    }

    @Test fun aPlanWhoseBarriersChangeAppliesNothing() = planWhile { it.toggle(Barrier.food) }
    @Test fun aPlanWhoseZipChangesAppliesNothing() = planWhile { it.updateZip("30310") }
    @Test fun aPlanWhoseNoteChangesAppliesNothing() = planWhile { it.updateNote("I work nights") }
    @Test fun aPlanWhoseStepsChangeAppliesNothing() = planWhile { it.remove(it.items.first().id) }
    /** "Use my location" started: the new place is not known yet, and the old place's plan must not land as current. */
    @Test fun aPlanWhoseLocationLookupStartsAppliesNothing() = planWhile { it.updateLocating(true) }

    @Test fun noPlanStartsWhileTheLocationIsBeingFound() {
        val api = HeldApi()
        val m = model(api)
        assertTrue(m.canPlan)
        m.updateLocating(true)
        assertTrue(!m.canPlan)
        m.makePlan()
        assertEquals(0, api.plans)
        m.updateLocating(false)
        assertTrue(m.canPlan)
    }

    /** A ZIP typed while "Use my location" runs wins: the late location result changes nothing. */
    @Test fun aZipTypedDuringALookupWinsOverItsLateResult() {
        val m = model(HeldApi())
        val run = m.beginLocating()
        assertTrue(m.locating)
        m.updateZip("30310")
        assertTrue("typing a ZIP ends the lookup", !m.locating)
        m.finishLocating(run, com.stephensookra.atlas.data.LatLng(33.75, -84.39))
        assertEquals("the late result did not overwrite the ZIP", "30310", m.zip)
        assertNull(m.location)
        assertTrue(!m.locating)
    }

    /** A newer lookup replaces an older one: only the newest result is applied. */
    @Test fun onlyTheNewestLookupApplies() {
        val m = model(HeldApi())
        val first = m.beginLocating()
        val second = m.beginLocating()
        m.finishLocating(first, com.stephensookra.atlas.data.LatLng(33.0, -84.0))
        assertNull(m.location)
        assertTrue(m.locating)
        m.finishLocating(second, com.stephensookra.atlas.data.LatLng(33.75, -84.39))
        assertEquals(com.stephensookra.atlas.data.LatLng(33.75, -84.39), m.location)
        assertEquals("", m.zip)
        assertTrue(!m.locating)
    }

    /** A replaced lookup's failure is not shown: the ZIP typed meanwhile (or a newer lookup) is what counts. */
    @Test fun aReplacedLookupsFailureIsNotShown() {
        val m = model(HeldApi())
        val old = m.beginLocating()
        m.updateZip("30310")
        m.finishLocating(old, null, "outside")
        assertNull(m.error)
        assertEquals("30310", m.zip)
        val first = m.beginLocating()
        val second = m.beginLocating()
        m.finishLocating(first, null, "unavailable")
        assertNull(m.error)
        assertTrue(m.locating)
        m.finishLocating(second, null, "outside")
        assertEquals("the current lookup's failure is shown", "outside", m.error)
        assertTrue(!m.locating)
    }

    @Test fun aChangeTheReadDoesNotUseLeavesItRunningAndItLands() {
        val api = HeldApi()
        val m = model(api)
        m.readPaper()
        m.lookingAround = true
        m.updateZip("30310") // a plan input: never stops a read
        assertEquals(Busy.Reading, m.busy)
        api.read.complete(freshCare)
        assertNull(m.notice)
        assertEquals(1, m.readingCount)
        assertEquals("the newer reading landed", "a newer reading", m.care?.source_text)
        assertEquals("and, looked around, it raised the cue", ReadyCue.What.steps, m.readyCue)
    }
}
