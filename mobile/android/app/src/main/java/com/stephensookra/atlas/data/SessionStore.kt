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
    /** Epoch milliseconds: when the steps or the plan last changed (a read, a plan, a step done or removed). Changing the
     *  language, reading level, ZIP or note, or opening a helper link, keeps it, so "Welcome back" shows when the plan was made. */
    val savedAt: Long,
) {
    /**
     * Older files are missing provenance, and it is never invented. The 1.0 app saved the text, language, reading level,
     * barriers, note and ZIP after every edit and never saved the device location, so they say what was entered last,
     * not what the steps were read from or the plan built from. A missing fingerprint stays missing: AppModel treats it as
     * unknown and shows the steps and plan as outdated until they are read or planned again.
     *
     * The only thing recovered is the steps' language, and only from a read fingerprint that records it (1.1 files kept
     * the fingerprint but not `care.language`). Without one the language stays unknown, so the steps are never read
     * aloud with a guessed voice.
     */
    fun upgraded(): SavedSession {
        val c = care ?: return this
        if (c.language != null) return this
        val recovered = readFingerprint?.let { StaleGuard.languageOf(it) } ?: return this
        return copy(care = c.copy(language = recovered))
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
