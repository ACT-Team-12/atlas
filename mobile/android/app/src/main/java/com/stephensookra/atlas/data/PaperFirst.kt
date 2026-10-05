package com.stephensookra.atlas.data

/**
 * Paper first: the one rule every screen uses to show an AI explanation next to the paper's own words.
 * A line-for-line port of web/src/lib/paperFirst.ts, planQuotes.ts and speechText.ts (speechLines).
 *
 * - Certified (the second check said "same" and every number checks out): the explanation may lead, and the
 *   paper's verbatim quote is shown right with it.
 * - Anything else (still checking, check failed, unclear, flagged, never checked): the paper's verbatim quote
 *   leads, labelled "Copied word for word from your paper" on screen, and the explanation is visibly secondary
 *   under "Plain words (not double-checked yet)".
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

    const val NOTE_UNCHECKED = "Plain words (not double-checked yet)"
    const val NOTE_FLAGGED = "Explanation that our second check says may not match your paper. Follow your paper, and ask your clinic."
    const val LEFT_OUT_UNCHECKED = "(The plain-words explanation is left out here because it was not double-checked yet.)"
    /** SEAL_TEXT.once in web/src/lib/stepsView.ts: shown behind "Why?" on a step that was checked once. */
    const val CHECKED_ONCE = "Checked once: the words in quotes were found on your paper, word for word. The plain words under them were not double-checked yet, so your paper's words come first."
    const val LEFT_OUT_FLAGGED = "(The plain-words explanation is left out here because a second check says it may not match.)"

    data class View(
        /** True only when certified: the explanation leads. */
        val explanationLeads: Boolean,
        val quoteLabel: String,
        val quote: String,
        val explanation: String?,
        val note: String?,
        /** The on-screen label when the quote leads: a reassurance, not an instruction. */
        val screenLabel: String = "Copied word for word from your paper",
    )

    fun view(quote: String, explanation: List<String?>, check: Check, source: String = "paper"): View {
        val q = quote.trim()
        val words = explanation.map { (it ?: "").trim() }.filter { it.isNotEmpty() }.joinToString(" · ")
        val label = "Your $source says:"
        val screen = "Copied word for word from your $source"
        if (q.isEmpty()) return View(false, label, "", null, null, screen)
        if (check == Check.certified && words.isNotEmpty()) return View(true, label, q, words, null, screen)
        val note = if (words.isEmpty()) null else if (check == Check.flagged) NOTE_FLAGGED else NOTE_UNCHECKED
        return View(false, label, q, words.ifEmpty { null }, note, screen)
    }

    /**
     * askPerson in web/src/lib/askPerson.ts: "Ask your pharmacist" (a medicine step) or "Ask your clinic" (any other
     * step) while the explanation is not double-checked. The question is the paper's own words plus fixed wording,
     * never the AI's title, when or explanation. Nothing for a certified step, a warning sign or an empty quote.
     */
    data class AskPerson(val who: String, val label: String, val question: String)

    private val ASK_SPACES = Regex(SafetyPattern.JS_SPACE_CLASS + "+")

    fun askPerson(kind: String, quote: String, check: Check): AskPerson? {
        // JS \s as an explicit class: Android's ICU regex rejects the inline Unicode-class flag (a crash on the steps screen).
        val q = quote.split(ASK_SPACES).filter { it.isNotEmpty() }.joinToString(" ")
        if (check == Check.certified || q.isEmpty() || kind == "warning_sign") return null
        if (kind == "medication") return AskPerson("pharmacist", "Ask your pharmacist", "My paper says: \"$q\" Can you confirm what I should take?")
        return AskPerson("clinic", "Ask your clinic", "My paper says: \"$q\" Can you help me understand what I should do?")
    }

    /**
     * visitQuestions in web/src/lib/visitQuestions.ts: "Questions for the next visit", paper first. A step's own clinic
     * question is AI-written, so it goes only when certified; otherwise the askPerson question (the paper's own words)
     * goes in its place, and a warning sign adds none. A general question equal to any step's own question is dropped,
     * so an unchecked one cannot leak through questions_for_doctor and a certified one is not listed twice.
     */
    fun questionKey(q: String): String {
        val out = StringBuilder()
        var gap = false
        for (ch in q.lowercase()) {
            if (ch.isLetterOrDigit() || Character.getType(ch) == Character.LETTER_NUMBER.toInt() || Character.getType(ch) == Character.OTHER_NUMBER.toInt()) {
                if (gap && out.isNotEmpty()) out.append(' ')
                gap = false
                out.append(ch)
            } else {
                gap = true
            }
        }
        return out.toString()
    }

    fun stepVisitQuestion(step: VerifiedItem, check: Check): String? {
        val own = step.question_for_clinic.trim()
        if (!step.needs_clarification || own.isEmpty()) return null
        if (check == Check.certified) return own
        return askPerson(step.kind, step.source_quote, check)?.question
    }

    fun generalVisitQuestions(general: List<String>, steps: List<VerifiedItem>): List<String> {
        val own = steps.map { questionKey(it.question_for_clinic) }.filter { it.isNotEmpty() }.toSet()
        return general.filter { val k = questionKey(it); k.isNotEmpty() && k !in own }
    }

    /**
     * readingGeneralQuestions in visitQuestions.ts: the reading's general list with every step's own question taken
     * out, held-back (refused) steps included, since a saved reading's list can repeat any of them.
     */
    fun readingGeneralQuestions(care: CarePlanResponse): List<String> = generalVisitQuestions(care.questions_for_doctor, care.items + care.refused)

    /** `also`: steps not listed (removed ones) whose own questions must still stay out of the general list. */
    fun visitQuestions(items: List<VerifiedItem>, general: List<String>, also: List<VerifiedItem> = emptyList(), check: (String) -> Check): List<String> {
        val out = mutableListOf<String>()
        val seen = mutableSetOf<String>()
        fun add(q: String) {
            val k = questionKey(q)
            if (k.isEmpty() || !seen.add(k)) return
            out += q.trim()
        }
        for (step in items) stepVisitQuestion(step, check(step.id))?.let { q -> add(q) }
        for (q in generalVisitQuestions(general, items + also)) add(q)
        return out
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
    const val PLAN_IS_A_SUGGESTION = "This plan is a suggestion from ATLAS. If anything differs from your paper, follow your paper."

    /** speechLines in speechText.ts: what "Read it out loud" says for a plan. */
    fun planSpeechLines(plan: PlanResponse, items: List<VerifiedItem>): List<String> =
        listOf(PLAN_IS_A_SUGGESTION, plan.summary) + plan.steps.flatMapIndexed { i, s ->
            listOf("${i + 1}. ${s.title}. ${s.action}") + planStepQuotes(s, items).map { "Your paper says: \"$it\"" }
        }
}
