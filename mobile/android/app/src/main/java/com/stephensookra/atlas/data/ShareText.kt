package com.stephensookra.atlas.data

/**
 * "Send to family": the plan as plain text for a text message or email. Mirrors planShareText in
 * web/src/lib/shareText.ts so the phone and the website send the same thing. Built on the phone and handed to
 * Android's share sheet; ATLAS never sees or stores it.
 */
object ShareText {
    const val TITLE = "Plan after the visit"

    private val KIND_LABEL = mapOf(
        "medication" to "Medicine", "lab_test" to "Lab test", "referral" to "Referral", "follow_up_visit" to "Follow-up visit",
        "self_care" to "Self care", "warning_sign" to "Warning sign",
    )

    /**
     * The double-check travels with it: an explanation is sent only when the second check certified it; otherwise the
     * paper's own words are sent in its place (PaperFirst), so a text message never carries an unchecked paraphrase.
     * `planItems`: every grounded step the plan could point at, removed or not, so a plan step's quote never drops out.
     */
    fun plan(items: List<VerifiedItem>, plan: PlanResponse, questions: List<String>, meaning: MeaningState = MeaningState.IDLE,
             planItems: List<VerifiedItem>? = null): String {
        val out = mutableListOf("Plan after the visit (from ATLAS)", "", "Suggestion from ATLAS (follow your paper first): ${plan.summary}")

        val grounded = items.filter { it.grounded }
        if (grounded.isNotEmpty()) {
            out += listOf("", "WHAT THE PAPER SAYS TO DO")
            grounded.forEachIndexed { n, i ->
                val check = meaning.checkFor(i.id)
                val whenText = i.`when`.trim()
                val head = if (check == Check.certified) ": ${i.title}${if (whenText.isEmpty()) "" else " ($whenText)"}" else ""
                out += "${n + 1}. ${KIND_LABEL[i.kind] ?: i.kind}$head"
                if (check == Check.flagged) out += "   Double-check this one with your clinic: our second check found the explanation may not match the paper."
                for (l in PaperFirst.lines(PaperFirst.careStep(i, check))) out += "   $l"
            }
        }

        if (plan.steps.isNotEmpty()) {
            out += listOf("", "THE PLAN (suggestions from ATLAS; if anything differs from the paper, follow the paper)")
            plan.steps.forEachIndexed { n, s ->
                out += "${n + 1}. ${s.title}. ${s.action}"
                for (q in PaperFirst.planStepQuotes(s, planItems ?: grounded)) out += "   Your paper says: \"$q\""
            }
        }

        // Only the verified resources the plan actually uses, in a stable order.
        val used = plan.steps.flatMap { it.resource_ids }.toSet()
        val help = plan.resources.filterKeys { it in used }.toSortedMap().values
        if (help.isNotEmpty()) {
            out += listOf("", "WHO CAN HELP (suggested by ATLAS from checked records; follow the paper first)")
            for (r in help) {
                when (r) {
                    is ResourceCard.ClinicCard -> {
                        val c = r.clinic
                        out += "- ${c.name}${c.phone.nonEmpty()?.let { ": $it" } ?: ""}, ${c.address}, ${c.city} ${c.zip}"
                    }
                    is ResourceCard.ProgramCard -> {
                        val p = r.program
                        val phone = p.access.phone.nonEmpty()
                        val text = p.access.text.nonEmpty()
                        val url = p.access.url.nonEmpty()
                        var line = "- ${p.name}"
                        if (phone != null) line += ": $phone"
                        if (text != null) line += " ($text)"
                        if (phone == null && text == null && url != null) line += ": $url"
                        out += line
                    }
                }
            }
        }

        if (plan.ask_a_person) out += listOf("", "This needs a person too: ${plan.ask_a_person_reason} Call 211 or a community health worker.")

        // `questions` is the reading's general list; each step's own question joins it paper first (visitQuestions).
        val nextVisit = PaperFirst.visitQuestions(grounded, questions, planItems.orEmpty()) { meaning.checkFor(it) }
        if (nextVisit.isNotEmpty()) {
            out += listOf("", "QUESTIONS FOR THE NEXT VISIT")
            out += nextVisit.map { "- $it" }
        }

        out += listOf("", "This explains the paper from the visit. It is not medical advice. If something feels urgent, call the clinic or 911.")
        return out.joinToString("\n")
    }
}
