package com.stephensookra.atlas

import android.app.Application
import android.net.Uri
import android.util.Log
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.stephensookra.atlas.data.ApiClient
import com.stephensookra.atlas.data.ApiException
import com.stephensookra.atlas.data.Barrier
import com.stephensookra.atlas.data.CarePlanResponse
import com.stephensookra.atlas.data.Check
import com.stephensookra.atlas.data.HelperBanner
import com.stephensookra.atlas.data.HelperLink
import com.stephensookra.atlas.data.HelperPresets
import com.stephensookra.atlas.data.MeaningRequest
import com.stephensookra.atlas.data.MeaningState
import com.stephensookra.atlas.data.MeaningStatus
import com.stephensookra.atlas.data.MissedLines
import com.stephensookra.atlas.data.MissedLinesView
import com.stephensookra.atlas.data.StaleGuard
import com.stephensookra.atlas.data.Language
import com.stephensookra.atlas.data.LatLng
import com.stephensookra.atlas.data.PlanCareInput
import com.stephensookra.atlas.data.PlanRequest
import com.stephensookra.atlas.data.PlanResponse
import com.stephensookra.atlas.data.ReadingLevel
import com.stephensookra.atlas.data.ReadyCue
import com.stephensookra.atlas.data.Sample
import com.stephensookra.atlas.data.SavedSession
import com.stephensookra.atlas.data.SessionStore
import com.stephensookra.atlas.data.VerifiedItem
import com.stephensookra.atlas.data.WarningPin
import com.stephensookra.atlas.services.Reminders
import com.stephensookra.atlas.services.TextReader
import com.stephensookra.atlas.data.AtlasApi
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch

enum class Route { Check, Steps, Barriers, Plan, Reminders, Labs }

/** Where the text on the "Check the text" screen came from. */
enum class TextSource { Scan, Photo, Typed, Sample }

enum class Busy { Recognizing, Reading, Planning }

/**
 * `api` and `workScope` are for tests only (a stand-in server and a scope that runs without Android's main thread); the
 * app uses the live server and viewModelScope.
 */
class AppModel @JvmOverloads constructor(
    app: Application,
    private val api: AtlasApi = ApiClient(),
    private val workScope: CoroutineScope? = null,
) : AndroidViewModel(app) {
    private val scope: CoroutineScope get() = workScope ?: viewModelScope
    private val store = SessionStore(app.filesDir)
    private var restoring = false
    private var task: Job? = null

    // Inputs
    var text by mutableStateOf("")
        private set
    var textSource by mutableStateOf(TextSource.Typed)
        private set
    var language by mutableStateOf(Language.English)
        private set
    var level by mutableStateOf(ReadingLevel.simple)
        private set
    val barriers = mutableStateListOf<Barrier>()
    var zip by mutableStateOf("")
        private set
    var note by mutableStateOf("")
        private set
    /** Device location for the plan request only. Never saved. */
    var location by mutableStateOf<LatLng?>(null)
    /**
     * A device location lookup is running (planPlace's "locating" on the website): the place is changing, so a plan sent
     * before it is stopped, and no plan starts until the lookup ends. Never saved.
     */
    var locating by mutableStateOf(false)
        private set

    /**
     * Moved by every lookup started and by every other change of place (a ZIP typed, a helper link's ZIP, Clear), so a
     * late lookup result never overwrites a newer choice.
     */
    private var locationRun = 0

    fun updateLocating(v: Boolean) { locating = v; stopStaleWork() }

    /** "Use my location" started. Returns the lookup's number, to hand back with its result. */
    fun beginLocating(): Int {
        locationRun++
        updateLocating(true)
        return locationRun
    }

    /**
     * A lookup ended, with a point in the service area, or null and why not. Applied only if no newer lookup or place
     * replaced it: a replaced lookup's failure is not shown either.
     */
    fun finishLocating(run: Int, point: LatLng?, failure: String? = null) {
        if (run != locationRun) return
        updateLocating(false)
        if (failure != null) error = failure
        if (point != null) useLocation(point)
    }

    // Results
    var care by mutableStateOf<CarePlanResponse?>(null)
        private set
    var plan by mutableStateOf<PlanResponse?>(null)
        private set
    val done = mutableStateMapOf<String, Boolean>()
    val removed = mutableStateMapOf<String, Boolean>()
    var restoredAt by mutableStateOf<Long?>(null)
        private set
    /** The second-model double-check of `care` (paper first: only a certified explanation may lead). */
    var meaning by mutableStateOf(MeaningState.IDLE)
        private set
    /** What `care` was read from and what `plan` was built from (StaleGuard). Null when unknown. */
    private var readFp by mutableStateOf<String?>(null)
    private var planFp by mutableStateOf<String?>(null)
    /**
     * Counts the readings in this run of the app, so a screen can reset per-reading state (Pip's greeting and cheer) when
     * "Read my paper again" replaces the steps in place, as the website does by keying its steps on the run. Not saved.
     */
    var readingCount by mutableStateOf(0)
        private set
    /** When the steps or the plan last changed (SavedSession.savedAt). Input changes and helper links keep it. */
    private var planChangedAt: Long? = null

    // Helper link: the banner, and whether the next plan counts as one built from the link. Never saved.
    var helperBanner by mutableStateOf<HelperBanner?>(null)
        private set
    private var fromHelperLink = false

    // The meaning check runs beside the read; every Clear, new read or restore moves this fence, so an older
    // reply is never applied to a newer paper (web/src/lib/meaningRun.ts RunFence).
    private var meaningRunId = 0
    private var meaningJob: Job? = null

    // Work in progress
    val path = mutableStateListOf<Route>()
    var busy by mutableStateOf<Busy?>(null)
        private set
    var error by mutableStateOf<String?>(null)
    /** Why a read or plan was stopped because its inputs changed while it ran (readNote / planNote on the website). */
    var notice by mutableStateOf<String?>(null)
    /**
     * The inputs the read or plan now running was sent with (StaleGuard fingerprints). Its reply is applied only while
     * the inputs on screen still give the same fingerprint.
     */
    private var inFlightReadFp: String? = null
    private var inFlightPlanFp: String? = null

    companion object {
        /** The words the website shows when it stops a read or plan whose inputs changed (stopStaleRead, stopStalePlan). */
        const val READ_STOPPED = "You changed your paper or settings, so we stopped reading. Press Read my paper again when ready."
        const val PLAN_STOPPED = "You changed your answers, so we stopped building the plan. Press Make my plan again when ready."
    }

    /** A read or plan in flight whose inputs changed is stopped and its late reply ignored, with a short note why. */
    private fun stopStaleWork() {
        if (restoring) return
        val read = inFlightReadFp
        val planFpSent = inFlightPlanFp
        if (busy == Busy.Reading && read != null && read != StaleGuard.readFingerprint(text, language, level)) {
            cancel(); notice = READ_STOPPED
        } else if (busy == Busy.Planning && planFpSent != null && planFpSent != currentPlanFingerprint()) {
            cancel(); notice = PLAN_STOPPED
        }
    }

    /**
     * The person chose to look around while a read or plan runs (the busy card is put away). When the result lands they
     * are not moved; the ready cue offers the way there instead. Not saved.
     */
    var lookingAround by mutableStateOf(false)
    /** The result that raised the ready cue (ReadyCue), if any. Not saved. */
    var readyMark by mutableStateOf<ReadyCue.Mark?>(null)
        private set
    /** Counts the plans built in this run of the app, so the cue belongs to one exact plan. Not saved. */
    var planCount by mutableStateOf(0)
        private set

    /** The ready cue to float on screen now (cueFor on the website), or null. */
    val readyCue: ReadyCue.What?
        get() = ReadyCue.shown(readyMark, readingCount, planCount, care != null && !careOutdated, plan != null && !planOutdated, path.lastOrNull())

    /** "Show me" on the ready cue. */
    fun showReady() {
        val what = readyCue ?: return
        readyMark = null
        val next = ReadyCue.path(what, path.toList())
        path.clear(); path.addAll(next)
    }

    /** The person opened the result themselves: the cue is no longer needed. */
    fun clearReady() { readyMark = null }

    /**
     * A read or plan landed. If the person stayed with it, take them there, as before. If they chose to look around,
     * leave them where they are and raise the ready cue for this exact result instead.
     */
    private fun arrived(what: ReadyCue.What, run: Int) {
        val route = ReadyCue.route(what)
        if (lookingAround && path.lastOrNull() != route) {
            readyMark = ReadyCue.Mark(what, run)
        } else {
            readyMark = null
            push(route)
        }
        lookingAround = false
    }

    init {
        restore()
    }

    // ---- Derived

    val items: List<VerifiedItem> get() = care?.items.orEmpty().filter { removed[it.id] != true }
    val removedItems: List<VerifiedItem> get() = care?.items.orEmpty().filter { removed[it.id] == true }
    /** The shown steps the website pins as warning signs (WarningPin, isWarning in warningPin.ts). */
    val warningItems: List<VerifiedItem> get() = items.filter { WarningPin.isWarning(it) }
    /** The reading's warning flag, or any shown step the paper's own words pin as a warning (CareSteps.tsx). */
    val hasWarnings: Boolean get() = care?.has_warning_signs == true || warningItems.isNotEmpty()
    val careById: Map<String, VerifiedItem> get() = care?.items.orEmpty().associateBy { it.id }
    val canRead: Boolean get() = text.trim().length > 20 && busy == null
    val canPlan: Boolean get() = busy == null && !locating && !(barriers.isEmpty() && items.isEmpty()) && !careOutdated
    fun checkFor(id: String): Check = meaning.checkFor(id)

    /** "Lines on your paper we didn't turn into steps", for the steps still kept: follows every Remove and Undo. */
    val missedLines: MissedLinesView get() = MissedLines.forCare(care, items.map { it.id })

    /**
     * The language the steps on screen were written in, for reading them aloud. While the steps are outdated it is still
     * theirs, not the language just picked, so a Spanish plan is never read with a Vietnamese voice. Null when an older
     * file did not record it: then the steps are not read aloud at all rather than with a guessed voice.
     */
    val stepsLanguage: Language? get() = care?.language

    /** The steps were saved by an older app that did not record what they were read from: unknown, so outdated. */
    val careProvenanceUnknown: Boolean get() = care != null && readFp == null

    /** The plan was saved by an older app that did not record what it was built from: unknown, so outdated. */
    val planProvenanceUnknown: Boolean get() = plan != null && planFp == null

    /** The steps on screen were read from different text, language or reading level than what is entered now, or from unknown inputs. */
    val careOutdated: Boolean get() = care != null && (readFp == null || readFp != StaleGuard.readFingerprint(text, language, level))

    /** The plan on screen was built from different (or unknown) inputs than what is entered now; its actions are turned off. */
    val planOutdated: Boolean get() = plan != null && (planFp == null || careOutdated || planFp != currentPlanFingerprint())

    private fun currentPlanFingerprint(): String = StaleGuard.planFingerprint(
        items.map { it.id }, barriers.toList(), language, note, if (locating) "locating" else StaleGuard.place(location, validZip()), location,
    )

    private fun validZip(): String = if (Regex("^\\d{5}$").matches(zip)) zip else ""

    // ---- Setters that save

    fun updateText(v: String) { text = v; persist(); stopStaleWork() }
    fun updateLanguage(v: Language) { language = v; persist(); stopStaleWork() }
    fun updateLevel(v: ReadingLevel) { level = v; persist(); stopStaleWork() }
    fun updateNote(v: String) { note = v; persist(); stopStaleWork() }
    /** Opened from a helper link: apply the presets (each one is optional) and show the banner. Nothing is sent. */
    fun applyHelperLink(p: HelperPresets) {
        p.language?.let { language = it }
        p.level?.let { level = it }
        p.zip?.let { locationRun++; locating = false; zip = it; location = null }
        helperBanner = HelperLink.banner(p)
        fromHelperLink = true
        // Show the first screen, where the banner is. Nothing saved is touched; "Open it" still brings it back.
        if (busy == null) path.clear()
        persist()
        stopStaleWork()
    }

    fun dismissHelperBanner() { helperBanner = null }

    fun updateZip(v: String) {
        // A ZIP typed replaces the device location and any lookup still running.
        locationRun++
        locating = false
        zip = v.filter { it.isDigit() }.take(5)
        location = null
        persist()
        stopStaleWork()
    }
    fun useLocation(point: LatLng) { location = point; zip = ""; persist(); stopStaleWork() }
    fun toggle(b: Barrier) {
        if (barriers.contains(b)) barriers.remove(b) else barriers.add(b)
        persist()
        stopStaleWork()
    }
    fun setDone(id: String, value: Boolean) { done[id] = value; persist(planChanged = true) }
    fun remove(id: String) { removed[id] = true; persist(planChanged = true); stopStaleWork() }
    fun undoRemove(id: String) { removed.remove(id); persist(planChanged = true); stopStaleWork() }

    // ---- Navigation

    fun push(route: Route) { if (path.lastOrNull() != route) path.add(route) }
    fun back(): Boolean = if (path.isEmpty()) false else { path.removeAt(path.lastIndex); true }

    // ---- Text in

    fun useSample() {
        textSource = TextSource.Sample
        updateText(Sample.TEXT)
        path.clear(); path.add(Route.Check)
    }

    fun startTyping() {
        textSource = TextSource.Typed
        path.clear(); path.add(Route.Check)
    }

    /** OCR on the phone. Pages never leave the device; only the text the person confirms is sent later. */
    fun recognize(pages: List<Uri>, source: TextSource) {
        if (pages.isEmpty()) return
        cancel()
        error = null
        busy = Busy.Recognizing
        task = scope.launch {
            try {
                val result = TextReader.read(getApplication(), pages)
                busy = null
                if (result.isBlank()) {
                    error = "We could not find any words in that picture. Try again in good light, or type the text."
                    return@launch
                }
                textSource = source
                updateText(result)
                path.clear(); path.add(Route.Check)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Log.w("AtlasOCR", "OCR failed", e)
                busy = null
                error = "We could not read that picture. Try again, or type the text."
            }
        }
    }

    // ---- Server calls

    fun readPaper() {
        if (!canRead) return
        cancel()
        readyMark = null
        error = null
        notice = null
        busy = Busy.Reading
        val text = text; val level = level; val language = language
        val sentFp = StaleGuard.readFingerprint(text, language, level)
        inFlightReadFp = sentFp
        task = scope.launch {
            try {
                // An older server leaves out the language; the steps were still written in the one asked for.
                val result = api.extract(text, level, language)
                // Changed after sending: the reply is for inputs no longer on screen, so nothing of it is applied.
                if (sentFp != StaleGuard.readFingerprint(this@AppModel.text, this@AppModel.language, this@AppModel.level)) {
                    cancel(); notice = READ_STOPPED
                    return@launch
                }
                applyRead(result, text, language, level)
                busy = null
                startMeaningCheck(care ?: result, language)
                persist(planChanged = true)
                arrived(ReadyCue.What.steps, readingCount)
            } catch (e: CancellationException) {
                throw e
            } catch (e: ApiException) {
                busy = null
                lookingAround = false
                error = e.message
            }
        }
    }

    /** A read came back for `text` at `language` and `level`: it replaces the steps, drops the plan, and records where it came from. */
    internal fun applyRead(response: CarePlanResponse, text: String, language: Language, level: ReadingLevel) {
        // An older server leaves out the language; the steps were still written in the one asked for.
        care = if (response.language == null) response.copy(language = language) else response
        plan = null
        planFp = null
        readFp = StaleGuard.readFingerprint(text, language, level)
        done.clear(); removed.clear()
        readingCount++
        restoredAt = null
    }

    fun makePlan() {
        if (!canPlan) return
        cancel()
        readyMark = null
        error = null
        notice = null
        busy = Busy.Planning
        val validZip = Regex("^\\d{5}$").matches(zip)
        val fingerprint = currentPlanFingerprint()
        inFlightPlanFp = fingerprint
        val viaHelper = fromHelperLink
        val request = PlanRequest(
            care = items.map { PlanCareInput(it) },
            barriers = barriers.toList(),
            zip = if (location == null && validZip) zip else null,
            location = location,
            language = language,
            note = note,
        )
        task = scope.launch {
            try {
                val result = api.plan(request, fromHelperLink = viaHelper)
                // Changed after sending: the reply is for inputs no longer on screen, so nothing of it is applied.
                if (fingerprint != currentPlanFingerprint()) {
                    cancel(); notice = PLAN_STOPPED
                    return@launch
                }
                plan = result
                planFp = fingerprint
                planCount++
                // One link counts at most one plan (helperLink.ts consumeHelperSession).
                if (viaHelper) fromHelperLink = false
                busy = null
                persist(planChanged = true)
                arrived(ReadyCue.What.plan, planCount)
            } catch (e: CancellationException) {
                throw e
            } catch (e: ApiException) {
                busy = null
                lookingAround = false
                error = e.message
            }
        }
    }

    /** "Ask my paper" (AskPaperSection): one question about the paper on screen. Nothing is saved, not the question and not the answer. */
    suspend fun askPaper(sourceText: String, language: Language, question: String): ApiClient.AskOutcome =
        api.ask(sourceText, language, question)

    /** Runs the second check for `forCare`. Its reply is applied only while the run is current and `care` is still that read. */
    private fun startMeaningCheck(forCare: CarePlanResponse, language: Language?) {
        cancelMeaning()
        val run = meaningRunId
        val request = MeaningRequest.of(forCare.items, forCare.language ?: language)
        if (request == null) { meaning = MeaningState.IDLE; return }
        meaning = MeaningState(MeaningStatus.loading)
        meaningJob = scope.launch {
            val next = try {
                MeaningState.done(request, api.meaning(request))
            } catch (e: CancellationException) {
                throw e
            } catch (e: ApiException) {
                MeaningState(MeaningStatus.error)
            }
            if (run != meaningRunId || care !== forCare) return@launch // cleared, re-read or replaced meanwhile
            meaning = next
            persist()
        }
    }

    private fun cancelMeaning() {
        meaningRunId++
        meaningJob?.cancel()
        meaningJob = null
    }

    fun cancel() {
        task?.cancel()
        task = null
        busy = null
        lookingAround = false
        inFlightReadFp = null
        inFlightPlanFp = null
    }

    // ---- Saved on this phone

    private fun restore() {
        val saved = store.load()?.upgraded() ?: return
        restoring = true
        text = saved.text; language = saved.language; level = saved.level
        care = saved.care; barriers.clear(); barriers.addAll(saved.barriers)
        zip = saved.zip; note = saved.note; plan = saved.plan
        done.clear(); done.putAll(saved.done); removed.clear(); removed.putAll(saved.removed)
        readFp = saved.readFingerprint; planFp = saved.planFingerprint
        planChangedAt = saved.savedAt
        meaning = if (saved.meaning.status == MeaningStatus.done) saved.meaning else MeaningState.IDLE
        restoring = false
        if (saved.care != null || saved.plan != null) restoredAt = saved.savedAt
        // A check that was still running when the app closed is run again; until it answers, every step is unchecked.
        val c = saved.care
        // Only for steps whose language is known: a check in a guessed language could certify the wrong explanation.
        if (c?.language != null && saved.meaning.status == MeaningStatus.loading) startMeaningCheck(c, c.language)
    }

    /** `planChanged`: a read, a plan, or a step done or removed, which moves the saved time "Welcome back" shows. */
    private fun persist(planChanged: Boolean = false) {
        if (restoring || (care == null && plan == null)) return
        val at = planChangedAt.takeUnless { planChanged } ?: System.currentTimeMillis()
        planChangedAt = at
        val session = SavedSession(
            text = text, language = language, level = level, care = care, barriers = barriers.toList(),
            zip = zip, note = note, plan = plan, done = done.toMap(), removed = removed.toMap(),
            meaning = meaning, readFingerprint = readFp, planFingerprint = planFp,
            savedAt = at,
        )
        try {
            store.save(session)
        } catch (e: Exception) {
            Log.w("AtlasStore", "Could not save", e)
        }
    }

    fun openSaved() {
        path.clear()
        path.add(Route.Steps)
        if (plan != null) path.add(Route.Plan)
    }

    /** "Clear from this phone": saved plan, typed text and ATLAS reminders. */
    fun clearFromPhone() {
        cancel()
        cancelMeaning()
        meaning = MeaningState.IDLE
        readFp = null; planFp = null; planChangedAt = null
        helperBanner = null; fromHelperLink = false
        readyMark = null
        store.clear()
        restoring = true
        text = ""; care = null; plan = null; barriers.clear(); zip = ""; note = ""; done.clear(); removed.clear()
        restoring = false
        location = null
        locationRun++
        locating = false
        restoredAt = null
        path.clear()
        Reminders.removeAll(getApplication())
    }
}
