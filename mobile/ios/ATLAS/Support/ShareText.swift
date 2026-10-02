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

    static func plan(items: [VerifiedItem], plan: PlanResponse, questions: [String]) -> String {
        var out = ["Plan after the visit (from ATLAS)", "", plan.summary]

        let grounded = items.filter(\.grounded)
        if !grounded.isEmpty {
            out += ["", "WHAT THE PAPER SAYS TO DO"]
            for (n, i) in grounded.enumerated() {
                let when = i.when.trimmingCharacters(in: .whitespaces)
                out.append("\(n + 1). \(kindLabel[i.kind] ?? i.kind): \(i.title)\(when.isEmpty ? "" : " (\(when))")")
                let plain = i.plain_language.trimmingCharacters(in: .whitespaces)
                if !plain.isEmpty { out.append("   \(plain)") }
                out.append("   Paper says: \"\(i.source_quote)\"")
            }
        }

        if !plan.steps.isEmpty {
            out += ["", "THE PLAN"]
            for (n, s) in plan.steps.enumerated() { out.append("\(n + 1). \(s.title). \(s.action)") }
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

        if !questions.isEmpty {
            out += ["", "QUESTIONS FOR THE NEXT VISIT"]
            out += questions.map { "- \($0)" }
        }

        out += ["", "This explains the paper from the visit. It is not medical advice. If something feels urgent, call the clinic or 911."]
        return out.joined(separator: "\n")
    }
}
