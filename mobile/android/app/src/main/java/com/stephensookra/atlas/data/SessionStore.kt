package com.stephensookra.atlas.data

import kotlinx.serialization.Serializable
import java.io.File

/** What is kept on this phone between launches. Location is never saved. */
@Serializable
data class SavedSession(
    val text: String,
    val language: Language,
    val level: ReadingLevel,
    val care: CarePlanResponse? = null,
    val barriers: List<Barrier> = emptyList(),
    val zip: String = "",
    val note: String = "",
    val plan: PlanResponse? = null,
    val done: Map<String, Boolean> = emptyMap(),
    val removed: Map<String, Boolean> = emptyMap(),
    /** The second-model double-check for `care`. Missing in files saved by older versions: then every step is unchecked. */
    val meaning: MeaningState = MeaningState.IDLE,
    /** What the steps were read from and what the plan was built from (StaleGuard). Null in older files. */
    val readFingerprint: String? = null,
    val planFingerprint: String? = null,
    /** Epoch milliseconds. */
    val savedAt: Long,
) {
    /**
     * A file saved by the 1.0 app has no fingerprints and its steps carry no language, so the outdated note could never show.
     * Rebuild both from what was saved: the steps were read from the saved text at the saved language and reading level
     * (1.0 saved the inputs every time they changed, so these are the last ones entered, the best record there is), and the
     * plan from the steps still kept, the barriers, the note and the ZIP (the device location is never saved). Files that
     * already carry fingerprints come back unchanged.
     */
    fun upgraded(): SavedSession {
        val care = care?.let { if (it.language == null) it.copy(language = language) else it }
        val readFp = readFingerprint ?: care?.let { StaleGuard.readFingerprint(text, it.language ?: language, level) }
        val planFp = planFingerprint ?: plan?.let {
            val kept = care?.items.orEmpty().filter { removed[it.id] != true }.map { it.id }
            val zip = if (Regex("^\\d{5}$").matches(zip)) zip else ""
            StaleGuard.planFingerprint(kept, barriers, care?.language ?: language, note, StaleGuard.place(null, zip), null)
        }
        return copy(care = care, readFingerprint = readFp, planFingerprint = planFp)
    }
}

/**
 * JSON in the app's private files directory. The manifest turns off backup and device transfer for
 * every app file (allowBackup=false plus data_extraction_rules.xml), so this never leaves the phone.
 */
class SessionStore(directory: File) {
    val file = File(directory, "session-v1.json")

    fun load(): SavedSession? = try {
        if (file.exists()) AtlasJson.decodeFromString(SavedSession.serializer(), file.readText()) else null
    } catch (_: Exception) {
        null
    }

    fun save(session: SavedSession) {
        file.parentFile?.mkdirs()
        val tmp = File(file.parentFile, file.name + ".tmp")
        tmp.writeText(AtlasJson.encodeToString(SavedSession.serializer(), session))
        if (!tmp.renameTo(file)) {
            file.delete()
            tmp.renameTo(file)
        }
    }

    fun clear() {
        file.delete()
    }
}
