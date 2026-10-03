package com.stephensookra.atlas.data

import kotlinx.serialization.Serializable

/**
 * `missed_lines` on the /api/extract response: MissedLinesPayload in web/src/lib/missedLines.ts. The server finds the
 * instruction-like sentences on the paper and each step's quoted stretches; the phone only compares numbers, so the
 * "Lines on your paper we didn't turn into steps" section follows the person's removed steps without matching text.
 *
 * Offsets are UTF-16 [start, end) into source_text. They are compared, never used to slice: a line is shown from `text`.
 * One flat class for both shapes ({show:false, why} and {show:true, languages, quotes, sentences}); missing fields
 * decode to empty, and `MissedLines.view` fails closed on a payload that says show but carries nothing to show.
 */
@Serializable
data class MissedLinesPayload(
    val show: Boolean = false,
    /** "empty" | "unsupported_language" | "no_instructions" when show is false. */
    val why: String = "",
    val languages: List<String> = emptyList(),
    /** Item id to that item's quoted [start, end) ranges. */
    val quotes: Map<String, List<List<Int>>> = emptyMap(),
    val sentences: List<MissedSentence> = emptyList(),
)

@Serializable
data class MissedSentence(
    val text: String,
    val start: Int,
    val end: Int,
    val reason: String = "",
    /** Numbers and stop / not / never / avoid words: each must sit inside ONE merged kept range. */
    val critical: List<List<Int>> = emptyList(),
    /** Index of the first sentence with the same normalized text (its own index if none earlier). */
    val group: Int,
)

/** missedLinesView, rebuilt on the phone. */
sealed interface MissedLinesView {
    /** Show nothing and announce nothing. `why` is "missing" when the server sent no payload (older server or saved plan). */
    data class Hidden(val why: String) : MissedLinesView

    data class Shown(val languages: List<String>, val total: Int, val covered: Int, val lines: List<MissedSentence>) : MissedLinesView
}

object MissedLines {
    const val TITLE = "Lines on your paper we didn't turn into steps"
    const val ALL_IN_A_STEP = "Every instruction-like line on your paper is in a step."
    const val ALL_IN_A_STEP_NOTE = "(we check for lines that look like instructions; it can miss some)"
    const val READ_THESE = "Read these yourself or ask your helper. They might matter."
    const val CAN_MISS = "We check for lines that look like instructions; it can miss some."

    /**
     * missedFromPayload in web/src/lib/missedLines.ts. `keptIds`: the ids of the steps the person still has (not removed).
     * An id the payload does not know adds nothing; repeats count once.
     */
    fun view(payload: MissedLinesPayload?, keptIds: Iterable<String>): MissedLinesView {
        if (payload == null) return MissedLinesView.Hidden("missing")
        if (!payload.show) return MissedLinesView.Hidden(payload.why)
        // The server never sends show:true without sentences; if it ever did, "every line is in a step" would be vacuous.
        if (payload.sentences.isEmpty()) return MissedLinesView.Hidden("no_instructions")

        val ranges = ArrayList<IntArray>()
        for (id in LinkedHashSet(keptIds.toList())) {
            for (r in payload.quotes[id].orEmpty()) if (r.size == 2) ranges.add(intArrayOf(r[0], r[1]))
        }
        ranges.sortBy { it[0] }
        val merged = ArrayList<IntArray>()
        for (r in ranges) {
            val last = merged.lastOrNull()
            if (last != null && r[0] <= last[1]) last[1] = maxOf(last[1], r[1]) else merged.add(intArrayOf(r[0], r[1]))
        }

        val matchedGroups = HashSet<Int>()
        for (s in payload.sentences) {
            val overlaps = merged.any { it[0] < s.end && it[1] > s.start }
            // A malformed critical range can never be held, so its sentence stays on the list (fail toward showing it).
            val criticalHeld = s.critical.all { c -> c.size == 2 && merged.any { it[0] <= c[0] && it[1] >= c[1] } }
            if (overlaps && criticalHeld) matchedGroups.add(s.group)
        }
        val lines = payload.sentences.filter { it.group !in matchedGroups }
        val total = payload.sentences.size
        return MissedLinesView.Shown(payload.languages, total, total - lines.size, lines)
    }

    /** missedLinesAnnouncement: what a screen reader hears (politely) when the result arrives or changes. */
    fun announcement(view: MissedLinesView): String {
        if (view !is MissedLinesView.Shown) return ""
        val n = view.lines.size
        if (n == 0) return ALL_IN_A_STEP
        val one = n == 1
        return "${if (one) "1 line" else "$n lines"} on your paper ${if (one) "looks" else "look"} like instructions but " +
            "${if (one) "is" else "are"} not in a step. Open \"$TITLE\" to read ${if (one) "it" else "them"}."
    }

    /** "1 line" / "3 lines", for the collapsed heading's badge. */
    fun lineCountLabel(n: Int): String = "$n ${if (n == 1) "line" else "lines"}"
}
