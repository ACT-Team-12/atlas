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
     * An id the payload does not know adds nothing; repeats count once. `sourceLength`: the UTF-16 length of the
     * response's source_text when known, which every offset must stay within.
     *
     * A payload that breaks any rule in [valid] is hidden as "invalid": no list, no "every line is in a step", nothing
     * announced. One bad range (say [-1, 2147483647], which overlaps every sentence) would otherwise make the safety
     * claim for the whole paper.
     */
    fun view(payload: MissedLinesPayload?, keptIds: Iterable<String>, sourceLength: Int? = null): MissedLinesView {
        if (payload == null) return MissedLinesView.Hidden("missing")
        if (!payload.show) return MissedLinesView.Hidden(payload.why)
        if (!valid(payload, sourceLength)) return MissedLinesView.Hidden(INVALID)

        val ranges = ArrayList<IntArray>()
        for (id in LinkedHashSet(keptIds.toList())) {
            for (r in payload.quotes[id].orEmpty()) ranges.add(intArrayOf(r[0], r[1]))
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
            val criticalHeld = s.critical.all { c -> merged.any { it[0] <= c[0] && it[1] >= c[1] } }
            if (overlaps && criticalHeld) matchedGroups.add(s.group)
        }
        val lines = payload.sentences.filter { it.group !in matchedGroups }
        val total = payload.sentences.size
        return MissedLinesView.Shown(payload.languages, total, total - lines.size, lines)
    }

    /**
     * The section for a read: its payload checked against its own paper. The server always sends source_text with
     * missed_lines, so a show:true payload without it (empty string, the decoder's default) has no paper to bound its
     * offsets and is hidden as invalid rather than trusted.
     */
    fun forCare(care: CarePlanResponse?, keptIds: Iterable<String>): MissedLinesView =
        view(care?.missed_lines, keptIds, care?.source_text?.length ?: 0)

    /** `why` of a show:true payload that breaks a rule in [valid]. */
    const val INVALID = "invalid"

    /**
     * missedLinesPayloadValid in web/src/lib/missedLines.ts, the same rules on every client:
     *  - at least one sentence (with none, "every line is in a step" would be vacuous);
     *  - every range is two integers with 0 <= start < end, and end <= sourceLength when it is known;
     *  - each sentence's critical ranges sit inside that sentence;
     *  - each group points at an earlier-or-same sentence that is its own group's first (group(group) == group).
     */
    fun valid(payload: MissedLinesPayload, sourceLength: Int? = null): Boolean {
        val limit = sourceLength ?: Int.MAX_VALUE
        fun ok(start: Int, end: Int) = start in 0 until end && end <= limit
        fun ok(r: List<Int>) = r.size == 2 && ok(r[0], r[1])
        val sentences = payload.sentences
        if (sentences.isEmpty()) return false
        for ((i, s) in sentences.withIndex()) {
            if (!ok(s.start, s.end)) return false
            if (!s.critical.all { ok(it) && it[0] >= s.start && it[1] <= s.end }) return false
            if (s.group !in 0..i || sentences[s.group].group != s.group) return false
        }
        return payload.quotes.values.all { ranges -> ranges.all { ok(it) } }
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
