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
import com.stephensookra.atlas.data.Language
import com.stephensookra.atlas.data.LatLng
import com.stephensookra.atlas.data.PlanCareInput
import com.stephensookra.atlas.data.PlanRequest
import com.stephensookra.atlas.data.PlanResponse
import com.stephensookra.atlas.data.ReadingLevel
import com.stephensookra.atlas.data.Sample
import com.stephensookra.atlas.data.SavedSession
import com.stephensookra.atlas.data.SessionStore
import com.stephensookra.atlas.data.VerifiedItem
import com.stephensookra.atlas.services.Reminders
import com.stephensookra.atlas.services.TextReader
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch

enum class Route { Check, Steps, Barriers, Plan, Reminders }

/** Where the text on the "Check the text" screen came from. */
enum class TextSource { Scan, Photo, Typed, Sample }

enum class Busy { Recognizing, Reading, Planning }

class AppModel(app: Application) : AndroidViewModel(app) {
    private val api = ApiClient()
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

    // Results
    var care by mutableStateOf<CarePlanResponse?>(null)
        private set
    var plan by mutableStateOf<PlanResponse?>(null)
        private set
    val done = mutableStateMapOf<String, Boolean>()
    val removed = mutableStateMapOf<String, Boolean>()
    var restoredAt by mutableStateOf<Long?>(null)
        private set

    // Work in progress
    val path = mutableStateListOf<Route>()
    var busy by mutableStateOf<Busy?>(null)
        private set
    var error by mutableStateOf<String?>(null)

    init {
        restore()
    }

    // ---- Derived

    val items: List<VerifiedItem> get() = care?.items.orEmpty().filter { removed[it.id] != true }
    val removedItems: List<VerifiedItem> get() = care?.items.orEmpty().filter { removed[it.id] == true }
    val careById: Map<String, VerifiedItem> get() = care?.items.orEmpty().associateBy { it.id }
    val canRead: Boolean get() = text.trim().length > 20 && busy == null
    val canPlan: Boolean get() = busy == null && !(barriers.isEmpty() && items.isEmpty())

    // ---- Setters that save

    fun updateText(v: String) { text = v; persist() }
    fun updateLanguage(v: Language) { language = v; persist() }
    fun updateLevel(v: ReadingLevel) { level = v; persist() }
    fun updateNote(v: String) { note = v; persist() }
    fun updateZip(v: String) {
        zip = v.filter { it.isDigit() }.take(5)
        location = null
        persist()
    }
    fun useLocation(point: LatLng) { location = point; zip = ""; persist() }
    fun toggle(b: Barrier) {
        if (barriers.contains(b)) barriers.remove(b) else barriers.add(b)
        persist()
    }
    fun setDone(id: String, value: Boolean) { done[id] = value; persist() }
    fun remove(id: String) { removed[id] = true; persist() }
    fun undoRemove(id: String) { removed.remove(id); persist() }

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
        task = viewModelScope.launch {
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
        error = null
        busy = Busy.Reading
        val text = text; val level = level; val language = language
        task = viewModelScope.launch {
            try {
                val result = api.extract(text, level, language)
                care = result
                plan = null
                done.clear(); removed.clear()
                restoredAt = null
                busy = null
                persist()
                push(Route.Steps)
            } catch (e: CancellationException) {
                throw e
            } catch (e: ApiException) {
                busy = null
                error = e.message
            }
        }
    }

    fun makePlan() {
        if (!canPlan) return
        cancel()
        error = null
        busy = Busy.Planning
        val validZip = Regex("^\\d{5}$").matches(zip)
        val request = PlanRequest(
            care = items.map { PlanCareInput(it) },
            barriers = barriers.toList(),
            zip = if (location == null && validZip) zip else null,
            location = location,
            language = language,
            note = note,
        )
        task = viewModelScope.launch {
            try {
                val result = api.plan(request)
                plan = result
                busy = null
                persist()
                push(Route.Plan)
            } catch (e: CancellationException) {
                throw e
            } catch (e: ApiException) {
                busy = null
                error = e.message
            }
        }
    }

    fun cancel() {
        task?.cancel()
        task = null
        busy = null
    }

    // ---- Saved on this phone

    private fun restore() {
        val saved = store.load() ?: return
        restoring = true
        text = saved.text; language = saved.language; level = saved.level
        care = saved.care; barriers.clear(); barriers.addAll(saved.barriers)
        zip = saved.zip; note = saved.note; plan = saved.plan
        done.clear(); done.putAll(saved.done); removed.clear(); removed.putAll(saved.removed)
        restoring = false
        if (saved.care != null || saved.plan != null) restoredAt = saved.savedAt
    }

    private fun persist() {
        if (restoring || (care == null && plan == null)) return
        val session = SavedSession(
            text = text, language = language, level = level, care = care, barriers = barriers.toList(),
            zip = zip, note = note, plan = plan, done = done.toMap(), removed = removed.toMap(),
            savedAt = System.currentTimeMillis(),
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
        store.clear()
        restoring = true
        text = ""; care = null; plan = null; barriers.clear(); zip = ""; note = ""; done.clear(); removed.clear()
        restoring = false
        location = null
        restoredAt = null
        path.clear()
        Reminders.removeAll(getApplication())
    }
}
