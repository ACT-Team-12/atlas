package com.stephensookra.atlas.data

/**
 * "Your steps", grouped by when. A line-for-line port of web/src/lib/stepsView.ts (whenFromText, listHeading,
 * stopNowFromPaper, stepWhen), with the same pattern text (SafetyPatterns) and checked against the website's own answers
 * in mobile/shared/safety-vectors.json.
 *
 * A step is placed by the time words inside its own quote from the paper. Only a certified step may fall back to the
 * AI's "when" when its quote names no time; an uncertified step whose quote names no time (or two that disagree) goes
 * under "Check the date on your paper". One exception, also read from the paper only: a medicine the paper says to stop
 * ("STOP taking these medications:", "Discontinue", "Do not take") goes under "Right away", because stopping starts now.
 */
enum class WhenGroup(val label: String) {
    // WHEN_GROUP_LABEL in stepsView.ts. Counted from the paper (the visit), never from the day a plan is reopened.
    today("Right away"),
    soon("Within about 2 weeks"),
    daily("Every day or every week"),
    later("Later (weeks or months away)"),
    unclear("Check the date on your paper");

    /** GROUP_NOTE in web/src/ui/CareSteps.tsx. */
    val note: String?
        get() = if (this == unclear) "Your paper doesn't give a clear time for these yet, or we couldn't confirm one. Check the date on your paper, or ask your clinic." else null
}

data class TextWhen(val group: WhenGroup, val words: List<String>)

/** `from`: "paper" (its own words), "explanation" (the AI's "when", certified only) or "none". */
data class StepWhen(val group: WhenGroup, val words: List<String>, val from: String)

object StepsWhen {
    /** RULES in stepsView.ts, in order: the group each gives ("count" counts days or weeks ahead). */
    val RULE_GROUPS = listOf("today", "today", "count", "soon", "soon", "later", "later", "daily", "daily")
    private val RULES = listOf(
        SafetyPatterns.WHEN_RULE_0, SafetyPatterns.WHEN_RULE_1, SafetyPatterns.WHEN_RULE_2, SafetyPatterns.WHEN_RULE_3,
        SafetyPatterns.WHEN_RULE_4, SafetyPatterns.WHEN_RULE_5, SafetyPatterns.WHEN_RULE_6, SafetyPatterns.WHEN_RULE_7,
        SafetyPatterns.WHEN_RULE_8,
    ).map { it.regex() }
    private val OTHER_LATIN = SafetyPatterns.OTHER_LATIN.regex()
    private val NEGATION = SafetyPatterns.NEGATION.regex()
    private val STOP = SafetyPatterns.STOP.regex()
    private val NOT_NOW = SafetyPatterns.NOT_NOW.regex()
    private val BULLET = SafetyPatterns.BULLET.regex()
    private val JS_SPACES = Regex(SafetyPattern.JS_SPACE_CLASS + "+")
    private val JS_TRIM = Regex("^${SafetyPattern.JS_SPACE_CLASS}+|${SafetyPattern.JS_SPACE_CLASS}+$")
    private val CLAUSE_END = Regex("[.;:!?]")

    /** NUM_WORDS in stepsView.ts: number words a paper may use for a count, English and Spanish. */
    val NUM_WORDS: Map<String, Int> = mapOf(
        "a" to 1, "an" to 1, "one" to 1, "two" to 2, "three" to 3, "four" to 4, "five" to 5, "six" to 6, "seven" to 7,
        "eight" to 8, "nine" to 9, "ten" to 10, "eleven" to 11, "twelve" to 12, "fourteen" to 14, "fifteen" to 15,
        "twenty" to 20, "thirty" to 30,
        "un" to 1, "una" to 1, "uno" to 1, "dos" to 2, "tres" to 3, "cuatro" to 4, "cinco" to 5, "seis" to 6, "siete" to 7,
        "ocho" to 8, "nueve" to 9, "diez" to 10, "once" to 11, "doce" to 12, "catorce" to 14, "quince" to 15,
        "veinte" to 20, "treinta" to 30,
    )

    private fun toNum(s: String): Int? =
        if (s.isNotEmpty() && s.all { it in '0'..'9' }) s.toIntOrNull() else NUM_WORDS[s.lowercase(java.util.Locale.ROOT)]

    /** `\s+` to one space, as the website does before reading any words. */
    fun spaces(s: String): String = s.replace(JS_SPACES, " ")

    /** JavaScript's trim(). */
    fun trim(s: String): String = s.replace(JS_TRIM, "")

    private data class Hit(val group: WhenGroup, val text: String, val at: Int)

    /** The time group a piece of text names, from its own words only (whenFromText). */
    fun fromText(text: String): TextWhen {
        val t = spaces(text)
        if (OTHER_LATIN.containsMatchIn(t)) return TextWhen(WhenGroup.unclear, emptyList())
        val hits = mutableListOf<Hit>()
        RULES.forEachIndexed { i, re ->
            for (m in re.findAll(t)) {
                val group = if (RULE_GROUPS[i] == "count") {
                    val n = toNum(m.groupValues[1])
                    if (n == null || n < 1) null
                    else {
                        val weeks = m.groupValues[2].firstOrNull()?.let { it in "wWsS" } ?: false
                        if ((if (weeks) n * 7 else n) <= 14) WhenGroup.soon else WhenGroup.later
                    }
                } else WhenGroup.valueOf(RULE_GROUPS[i])
                if (group != null) hits += Hit(group, m.value, m.range.first)
            }
        }
        // A phrase inside a longer one is the same words ("now" inside "right now"): keep the longer. (Stable sort.)
        val sorted = hits.sortedWith(compareBy<Hit> { it.at }.thenByDescending { it.text.length })
        val kept = sorted.filterIndexed { i, h ->
            sorted.withIndex().none { (j, o) ->
                j != i && o.at <= h.at && o.at + o.text.length >= h.at + h.text.length && o.text.length > h.text.length
            }
        }
        val words = kept.map { it.text }.distinct()
        // A negation earlier in the same clause: "Do not start this medicine today" is never placed.
        val negated = kept.any { h ->
            val before = t.substring(0, h.at)
            val end = CLAUSE_END.findAll(before).lastOrNull()
            NEGATION.containsMatchIn(if (end == null) before else before.substring(end.range.last + 1))
        }
        if (negated) return TextWhen(WhenGroup.unclear, words)
        val groups = kept.map { it.group }.distinct()
        return when {
            groups.isEmpty() -> TextWhen(WhenGroup.unclear, emptyList())
            groups.size == 1 -> TextWhen(groups[0], words)
            groups.size == 2 && WhenGroup.today in groups && WhenGroup.daily in groups -> TextWhen(WhenGroup.today, words)
            else -> TextWhen(WhenGroup.unclear, words)
        }
    }

    /**
     * The paper's heading above a listed line (listHeading): walking up from the line the span starts on, past the
     * other lines of the same list, to the first line that is not a list line, if it ends with ":". Else "".
     */
    fun listHeading(paper: String, span: TextSpan?): String {
        if (span == null || span.start < 0 || span.start > paper.length) return ""
        val lines = paper.substring(0, span.start).split("\n").toMutableList()
        val own = lines.removeAt(lines.size - 1) + paper.substring(span.start).split("\n")[0]
        if (!BULLET.containsMatchIn(own)) return ""
        for (line in lines.asReversed()) {
            val trimmed = trim(line)
            if (trimmed.isEmpty()) return ""
            if (BULLET.containsMatchIn(line)) continue
            return if (trimmed.endsWith(":")) trimmed else ""
        }
        return ""
    }

    /**
     * True when the PAPER says to stop this medicine now (stopNowFromPaper): its quote, or the list heading it sits
     * under, has a stop word and nothing that makes the stop not start now. Medicines only, from the paper's words only.
     */
    fun stopNowFromPaper(kind: String, quote: String, span: TextSpan?, paper: String): Boolean {
        if (kind != "medication") return false
        val texts = listOf(quote, listHeading(paper, span)).map { trim(spaces(it)) }.filter { it.isNotEmpty() }
        if (OTHER_LATIN.containsMatchIn(texts.joinToString(" "))) return false
        if (texts.any { NOT_NOW.containsMatchIn(it) }) return false
        return texts.any { STOP.containsMatchIn(it) }
    }

    /**
     * The time group for one care step (stepWhen). The paper's quote decides; only a certified step may fall back to
     * its AI "when", and only when the quote names no time at all.
     */
    fun step(quote: String, `when`: String, kind: String, span: TextSpan?, check: Check, paper: String): StepWhen {
        val fromPaper = fromText(quote)
        if (fromPaper.group != WhenGroup.unclear) return StepWhen(fromPaper.group, fromPaper.words, "paper")
        if (fromPaper.words.isEmpty() && stopNowFromPaper(kind, quote, span, paper)) return StepWhen(WhenGroup.today, emptyList(), "paper")
        if (check == Check.certified && fromPaper.words.isEmpty() && trim(`when`).isNotEmpty()) {
            val ai = fromText(`when`)
            if (ai.group != WhenGroup.unclear) return StepWhen(ai.group, emptyList(), "explanation")
        }
        return StepWhen(WhenGroup.unclear, fromPaper.words, if (fromPaper.words.isEmpty()) "none" else "paper")
    }

    fun step(item: VerifiedItem, check: Check, paper: String): StepWhen =
        step(item.source_quote, item.`when`, item.kind, item.span, check, paper)

    /** One time group of steps, in paper order. */
    data class Group(val group: WhenGroup, val items: List<VerifiedItem>)

    /**
     * The steps as the website shows them (CareSteps.tsx): warning signs pinned on top, then each time group in order,
     * paper order inside a group. Empty groups are left out.
     */
    fun grouped(items: List<VerifiedItem>, check: (String) -> Check, paper: String): Pair<List<VerifiedItem>, List<Group>> {
        val warnings = items.filter { WarningPin.isWarning(it) }
        val by = items.filterNot { WarningPin.isWarning(it) }.groupBy { step(it, check(it.id), paper).group }
        return warnings to WhenGroup.entries.mapNotNull { g -> by[g]?.let { Group(g, it) } }
    }
}
