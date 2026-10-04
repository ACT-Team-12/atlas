import Foundation

/// "Send to family": the plan as plain text for a text message or email. Mirrors planShareText in
/// web/src/lib/shareText.ts so the phone and the website send the same thing. Built on the phone and handed to the
/// share sheet; ATLAS never sees or stores it.
enum ShareText {
    static let title = "Plan after the visit"

    private static let kindLabel: [String: String] = [
        "medication": "Medicine", "lab_test": "Lab test", "referral": "Referral", "follow_up_visit": "Follow-up visit",
        "self_care": "Self care", "warning_sign": "Warning sign",
    ]

    /// The double-check travels with it: an explanation is sent only when the second check certified it; otherwise the
    /// paper's own words are sent in its place (PaperFirst), so a text message never carries an unchecked paraphrase.
    /// `planItems`: every grounded step the plan could point at, removed or not, so a plan step's quote never drops out.
    static func plan(items: [VerifiedItem], plan: PlanResponse, questions: [String], meaning: MeaningState = .idle,
                     planItems: [VerifiedItem]? = nil) -> String {
        var out = ["Plan after the visit (from ATLAS)", "", "Suggestion from ATLAS, not the paper: \(plan.summary)"]

        let grounded = items.filter(\.grounded)
        if !grounded.isEmpty {
            out += ["", "WHAT THE PAPER SAYS TO DO"]
            for (n, i) in grounded.enumerated() {
                let check = meaning.check(for: i.id)
                let when = i.when.trimmingCharacters(in: .whitespacesAndNewlines)
                let head = check == .certified ? ": \(i.title)\(when.isEmpty ? "" : " (\(when))")" : ""
                out.append("\(n + 1). \(kindLabel[i.kind] ?? i.kind)\(head)")
                if check == .flagged {
                    out.append("   Double-check this one with your clinic: our second check found the explanation may not match the paper.")
                }
                for l in PaperFirst.lines(PaperFirst.careStep(i, check: check)) { out.append("   \(l)") }
            }
        }

        if !plan.steps.isEmpty {
            out += ["", "THE PLAN (suggestions from ATLAS; if anything differs from the paper, follow the paper)"]
            for (n, s) in plan.steps.enumerated() {
                out.append("\(n + 1). \(s.title). \(s.action)")
                // Every step the plan was built from, even one removed from the list since: its quote never drops out.
                for q in PaperFirst.planStepQuotes(s, items: planItems ?? grounded) { out.append("   Your paper says: \"\(q)\"") }
            }
        }

        // Only the verified resources the plan actually uses, in a stable order.
        let used = Set(plan.steps.flatMap(\.resource_ids))
        let help = plan.resources.filter { used.contains($0.key) }.sorted { $0.key < $1.key }.map(\.value)
        if !help.isEmpty {
            out += ["", "WHO CAN HELP (checked numbers)"]
            for r in help {
                switch r {
                case let .clinic(_, _, c):
                    out.append("- \(c.name)\(c.phone.isEmpty ? "" : ": \(c.phone)"), \(c.address), \(c.city) \(c.zip)")
                case let .program(_, p):
                    let phone = p.access.phone.nonEmpty, text = p.access.text.nonEmpty, url = p.access.url.nonEmpty
                    var line = "- \(p.name)"
                    if let phone { line += ": \(phone)" }
                    if let text { line += " (\(text))" }
                    if phone == nil, text == nil, let url { line += ": \(url)" }
                    out.append(line)
                }
            }
        }

        if plan.ask_a_person { out += ["", "This needs a person too: \(plan.ask_a_person_reason) Call 211 or a community health worker."] }

        // `questions` is the reading's general list; each step's own question joins it paper first (visitQuestions).
        let nextVisit = PaperFirst.visitQuestions(items: grounded, general: questions, also: planItems ?? [],
                                                  check: { meaning.check(for: $0) })
        if !nextVisit.isEmpty {
            out += ["", "QUESTIONS FOR THE NEXT VISIT"]
            out += nextVisit.map { "- \($0)" }
        }

        out += ["", "This explains the paper from the visit. It is not medical advice. If something feels urgent, call the clinic or 911."]
        return out.joined(separator: "\n")
    }
}
