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

    fun plan(items: List<VerifiedItem>, plan: PlanResponse, questions: List<String>): String {
        val out = mutableListOf("Plan after the visit (from ATLAS)", "", plan.summary)

        val grounded = items.filter { it.grounded }
        if (grounded.isNotEmpty()) {
            out += listOf("", "WHAT THE PAPER SAYS TO DO")
            grounded.forEachIndexed { n, i ->
                val whenText = i.`when`.trim()
                out += "${n + 1}. ${KIND_LABEL[i.kind] ?: i.kind}: ${i.title}${if (whenText.isEmpty()) "" else " ($whenText)"}"
                val plain = i.plain_language.trim()
                if (plain.isNotEmpty()) out += "   $plain"
                // The phone app has no second-model double-check, so every explanation says so.
                out += "   (Not double-checked. If this and the paper differ, follow the paper.)"
                out += "   Paper says: \"${i.source_quote}\""
            }
        }

        if (plan.steps.isNotEmpty()) {
            out += listOf("", "THE PLAN (suggestions from ATLAS; if anything differs from the paper, follow the paper)")
            plan.steps.forEachIndexed { n, s -> out += "${n + 1}. ${s.title}. ${s.action}" }
        }

        // Only the verified resources the plan actually uses, in a stable order.
        val used = plan.steps.flatMap { it.resource_ids }.toSet()
        val help = plan.resources.filterKeys { it in used }.toSortedMap().values
        if (help.isNotEmpty()) {
            out += listOf("", "WHO CAN HELP (checked numbers)")
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

        if (questions.isNotEmpty()) {
            out += listOf("", "QUESTIONS FOR THE NEXT VISIT")
            out += questions.map { "- $it" }
        }

        out += listOf("", "This explains the paper from the visit. It is not medical advice. If something feels urgent, call the clinic or 911.")
        return out.joinToString("\n")
    }
}
