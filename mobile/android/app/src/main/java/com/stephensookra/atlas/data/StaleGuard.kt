package com.stephensookra.atlas.data

import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive

/**
 * The outdated-plan guard from web/src/lib/staleGuard.ts. A plan remembers a fingerprint of what was sent; when the
 * inputs change afterwards (a step removed, a barrier, the language, the note, the place), the plan on screen no
 * longer matches them, so its actions are turned off until it is updated.
 */
object StaleGuard {
    /** "device" when the device location is used, otherwise the ZIP sent (or ""). */
    fun place(location: LatLng?, zip: String): String = if (location != null) "device" else zip

    /** Order-free for barriers, exact everywhere else (planFingerprint). */
    fun planFingerprint(careIds: List<String>, barriers: List<Barrier>, language: Language, note: String, place: String, location: LatLng?): String =
        JsonArray(listOf(
            JsonArray(careIds.map { JsonPrimitive(it) }),
            JsonArray(barriers.map { it.name }.sorted().map { JsonPrimitive(it) }),
            JsonPrimitive(language.name),
            JsonPrimitive(note),
            JsonPrimitive(place),
            location?.let { JsonArray(listOf(num(it.lat), num(it.lng))) } ?: JsonNull,
        )).toString()

    /** Read fingerprint: the steps on screen came from this text, language and reading level. */
    fun readFingerprint(text: String, language: Language, level: ReadingLevel): String =
        AtlasJson.encodeToString(ListSerializer(String.serializer()), listOf(text, language.name, level.name))

    private fun num(x: Double) = if (x.isFinite()) JsonPrimitive(x + 0.0) else JsonNull
}
