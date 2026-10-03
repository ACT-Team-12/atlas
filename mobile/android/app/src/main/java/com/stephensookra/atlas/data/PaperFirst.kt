package com.stephensookra.atlas.data

/**
 * Paper first: the one rule every screen uses to show an AI explanation next to the paper's own words.
 * A line-for-line port of web/src/lib/paperFirst.ts, planQuotes.ts and speechText.ts (speechLines).
 *
 * - Certified (the second check said "same" and every number checks out): the explanation may lead, and the
 *   paper's verbatim quote is shown right with it.
 * - Anything else (still checking, check failed, unclear, flagged, never checked): the paper's verbatim quote
 *   leads, labelled "Your paper says:", and the explanation is visibly secondary with a note.
 * - Text that leaves the screen (read aloud, share, reminders, calendar) carries the explanation ONLY when
 *   certified. Otherwise it carries the quote alone, plus the note.
 * - No quote, no explanation.
 */
enum class Check { certified, flagged, unchecked }

object PaperFirst {
    /** checkOf in paperFirst.ts: missing means it never ran or has not finished. */
    fun checkOf(m: MeaningResult?): Check = when {
        m?.flagged == true -> Check.flagged
        m?.certified == true -> Check.certified
        else -> Check.unchecked
    }

    const val NOTE_UNCHECKED = "Explanation, not double-checked. If it and your paper differ, follow your paper."
    const val NOTE_FLAGGED = "Explanation that our second check says may not match your paper. Follow your paper, and ask your clinic."
    const val LEFT_OUT_UNCHECKED = "(The plain-words explanation is left out here because it was not double-checked.)"
    const val LEFT_OUT_FLAGGED = "(The plain-words explanation is left out here because a second check says it may not match.)"

    data class View(
        /** True only when certified: the explanation leads. */
        val explanationLeads: Boolean,
        val quoteLabel: String,
        val quote: String,
        val explanation: String?,
        val note: String?,
    )

    fun view(quote: String, explanation: List<String?>, check: Check, source: String = "paper"): View {
        val q = quote.trim()
        val words = explanation.map { (it ?: "").trim() }.filter { it.isNotEmpty() }.joinToString(" · ")
        val label = "Your $source says:"
        if (q.isEmpty()) return View(false, label, "", null, null)
        if (check == Check.certified && words.isNotEmpty()) return View(true, label, q, words, null)
        val note = if (words.isEmpty()) null else if (check == Check.flagged) NOTE_FLAGGED else NOTE_UNCHECKED
        return View(false, label, q, words.ifEmpty { null }, note)
    }

    /** The lines a surface may read aloud, share or print for one step: the explanation only when certified. */
    fun lines(v: View): List<String> {
        if (v.quote.isEmpty()) return emptyList()
        val quoteLine = "${v.quoteLabel} \"${v.quote}\""
        if (v.explanationLeads && v.explanation != null) return listOf(v.explanation, quoteLine)
        if (v.note == null) return listOf(quoteLine)
        return listOf(quoteLine, if (v.note == NOTE_FLAGGED) LEFT_OUT_FLAGGED else LEFT_OUT_UNCHECKED)
    }

    /** One care step. Certified: the plain words lead. Otherwise the AI's title and when are secondary too. */
    fun careStep(it: VerifiedItem, check: Check): View =
        view(it.source_quote, if (check == Check.certified) listOf(it.plain_language) else listOf(it.title, it.`when`, it.plain_language), check)

    /** One lab row: the report's own line leads; the AI's plain name for the test is never checked. */
    fun labRow(r: ResultRow): View = view(r.quote, listOf(r.plain_name), Check.unchecked, source = "report")

    /** What the meaning check is asked about: every AI string a certified card shows, the title included. */
    fun checkedText(title: String, plain: String): String = listOf(title.trim(), plain.trim()).filter { it.isNotEmpty() }.joinToString(". ")

    private val BOOK_TITLE = mapOf(
        "medication" to "Medicine", "lab_test" to "Lab test", "referral" to "Referral", "follow_up_visit" to "Follow-up visit",
        "self_care" to "Self care", "warning_sign" to "Warning sign",
    )

    /** bookSafe in paperFirst.ts: a reminder or calendar event never carries the AI's title; its "when" only if certified. */
    fun bookTitle(kind: String): String = "${BOOK_TITLE[kind] ?: "Appointment"} from your paper"
    fun bookWhen(it: VerifiedItem, check: Check): String = if (check == Check.certified) it.`when` else ""

    /** planStepQuotes in planQuotes.ts: the paper's own words behind one plan step, grounded items only, de-duplicated. */
    fun planStepQuotes(step: PlanStep, items: List<VerifiedItem>): List<String> {
        val byId = items.filter { it.grounded }.associate { it.id to it.source_quote.trim() }
        return step.care_ids.map { byId[it] ?: "" }.filter { it.isNotEmpty() }.distinct()
    }

    /** PLAN_IS_A_SUGGESTION in speechText.ts. */
    const val PLAN_IS_A_SUGGESTION = "This plan is a suggestion from ATLAS, not your paper. If anything differs, follow your paper."

    /** speechLines in speechText.ts: what "Read it out loud" says for a plan. */
    fun planSpeechLines(plan: PlanResponse, items: List<VerifiedItem>): List<String> =
        listOf(PLAN_IS_A_SUGGESTION, plan.summary) + plan.steps.flatMapIndexed { i, s ->
            listOf("${i + 1}. ${s.title}. ${s.action}") + planStepQuotes(s, items).map { "Your paper says: \"$it\"" }
        }
}
