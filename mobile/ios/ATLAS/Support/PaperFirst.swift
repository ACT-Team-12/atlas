import Foundation

/// The second check's verdict for one step (checkOf in web/src/lib/paperFirst.ts).
enum Check: String, Sendable {
    case certified, flagged, unchecked
}

/// Paper first: the one rule every screen uses to show an AI explanation next to the paper's own words.
/// A line-for-line port of web/src/lib/paperFirst.ts, planQuotes.ts and speechText.ts (speechLines).
///
/// - Certified (the second check said "same" and every number checks out): the explanation may lead, and the
///   paper's verbatim quote is shown right with it.
/// - Anything else (still checking, check failed, unclear, flagged, never checked): the paper's verbatim quote
///   leads, labelled "Copied word for word from your paper" on screen, and the explanation is visibly secondary
///   under "Plain words (not double-checked yet)".
/// - Text that leaves the screen (read aloud, share, reminders, calendar) carries the explanation ONLY when
///   certified. Otherwise it carries the quote alone, plus the note.
/// - No quote, no explanation.
enum PaperFirst {
    /// checkOf in paperFirst.ts: missing means it never ran or has not finished.
    static func checkOf(_ m: MeaningResult?) -> Check {
        if m?.flagged == true { return .flagged }
        if m?.certified == true { return .certified }
        return .unchecked
    }

    static let noteUnchecked = "Plain words (not double-checked yet)"
    static let noteFlagged = "Explanation that our second check says may not match your paper. Follow your paper, and ask your clinic."
    static let leftOutUnchecked = "(The plain-words explanation is left out here because it was not double-checked yet.)"
    /// SEAL_TEXT.once in web/src/lib/stepsView.ts: shown behind "Why?" on a step that was checked once.
    static let checkedOnce = "Checked once: the words in quotes were found on your paper, word for word. The plain words under them were not double-checked yet, so your paper's words come first."
    static let leftOutFlagged = "(The plain-words explanation is left out here because a second check says it may not match.)"

    struct StepView: Equatable, Sendable {
        /// True only when certified: the explanation leads.
        let explanationLeads: Bool
        let quoteLabel: String
        /// The on-screen label when the quote leads: a reassurance, not an instruction.
        let screenLabel: String
        let quote: String
        let explanation: String?
        let note: String?
    }

    static func view(quote: String, explanation: [String?], check: Check, source: String = "paper") -> StepView {
        let q = quote.trimmingCharacters(in: .whitespacesAndNewlines)
        let words = explanation.map { ($0 ?? "").trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
            .joined(separator: " · ")
        let label = "Your \(source) says:"
        let screen = "Copied word for word from your \(source)"
        if q.isEmpty { return StepView(explanationLeads: false, quoteLabel: label, screenLabel: screen, quote: "", explanation: nil, note: nil) }
        if check == .certified && !words.isEmpty {
            return StepView(explanationLeads: true, quoteLabel: label, screenLabel: screen, quote: q, explanation: words, note: nil)
        }
        let note: String? = words.isEmpty ? nil : (check == .flagged ? noteFlagged : noteUnchecked)
        return StepView(explanationLeads: false, quoteLabel: label, screenLabel: screen, quote: q, explanation: words.isEmpty ? nil : words, note: note)
    }

    /// The lines a surface may read aloud, share or print for one step: the explanation only when certified.
    static func lines(_ v: StepView) -> [String] {
        if v.quote.isEmpty { return [] }
        let quoteLine = "\(v.quoteLabel) \"\(v.quote)\""
        if v.explanationLeads, let e = v.explanation { return [e, quoteLine] }
        guard let note = v.note else { return [quoteLine] }
        return [quoteLine, note == noteFlagged ? leftOutFlagged : leftOutUnchecked]
    }

    /// One care step. Certified: the plain words lead. Otherwise the AI's title and when are secondary too.
    static func careStep(_ it: VerifiedItem, check: Check) -> StepView {
        view(quote: it.source_quote, explanation: check == .certified ? [it.plain_language] : [it.title, it.when, it.plain_language], check: check)
    }

    /// askPerson in web/src/lib/askPerson.ts: "Ask your pharmacist" (a medicine step) or "Ask your clinic" (any other
    /// step) while the explanation is not double-checked. The question is the paper's own words plus fixed wording,
    /// never the AI's title, when or explanation. Nothing for a certified step, a warning sign or an empty quote.
    struct AskPerson: Equatable, Sendable {
        let who: String
        let label: String
        let question: String
    }

    static func askPerson(kind: String, quote raw: String, check: Check) -> AskPerson? {
        let quote = raw.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
        if check == .certified || quote.isEmpty || kind == "warning_sign" { return nil }
        if kind == "medication" {
            return AskPerson(who: "pharmacist", label: "Ask your pharmacist",
                             question: "My paper says: \"\(quote)\" Can you confirm what I should take?")
        }
        return AskPerson(who: "clinic", label: "Ask your clinic",
                         question: "My paper says: \"\(quote)\" Can you help me understand what I should do?")
    }

    /// visitQuestions in web/src/lib/visitQuestions.ts: "Questions for the next visit", paper first. A step's own
    /// clinic question is AI-written, so it goes only when certified; otherwise the askPerson question (the paper's own
    /// words) goes in its place, and a warning sign adds none. A general question equal to any step's own question is
    /// dropped, so an unchecked one cannot leak through questions_for_doctor and a certified one is not listed twice.
    static func questionKey(_ q: String) -> String {
        var out = ""
        var gap = false
        for ch in q.lowercased() {
            if ch.isLetter || ch.isNumber {
                if gap && !out.isEmpty { out.append(" ") }
                gap = false
                out.append(ch)
            } else {
                gap = true
            }
        }
        return out
    }

    static func stepVisitQuestion(_ it: VerifiedItem, check: Check) -> String? {
        let own = it.question_for_clinic.trimmingCharacters(in: .whitespacesAndNewlines)
        guard it.needs_clarification, !own.isEmpty else { return nil }
        if check == .certified { return own }
        return askPerson(kind: it.kind, quote: it.source_quote, check: check)?.question
    }

    static func generalVisitQuestions(_ general: [String], steps: [VerifiedItem]) -> [String] {
        let own = Set(steps.map { questionKey($0.question_for_clinic) }.filter { !$0.isEmpty })
        return general.filter { let k = questionKey($0); return !k.isEmpty && !own.contains(k) }
    }

    /// `also`: steps not listed (removed ones) whose own questions must still stay out of the general list.
    static func visitQuestions(items: [VerifiedItem], general: [String], also: [VerifiedItem] = [],
                               check: (String) -> Check) -> [String] {
        var out: [String] = []
        var seen = Set<String>()
        func add(_ q: String) {
            let k = questionKey(q)
            if k.isEmpty || seen.contains(k) { return }
            seen.insert(k)
            out.append(q.trimmingCharacters(in: .whitespacesAndNewlines))
        }
        for it in items { if let q = stepVisitQuestion(it, check: check(it.id)) { add(q) } }
        for q in generalVisitQuestions(general, steps: items + also) { add(q) }
        return out
    }

    /// One lab row: the report's own line leads; the AI's plain name for the test is never checked.
    static func labRow(_ r: ResultRow) -> StepView {
        view(quote: r.quote, explanation: [r.plain_name], check: .unchecked, source: "report")
    }

    /// What the meaning check is asked about: every AI string a certified card shows, the title included.
    static func checkedText(title: String, plain: String) -> String {
        [title, plain].map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }.joined(separator: ". ")
    }

    private static let bookTitles: [String: String] = [
        "medication": "Medicine", "lab_test": "Lab test", "referral": "Referral", "follow_up_visit": "Follow-up visit",
        "self_care": "Self care", "warning_sign": "Warning sign",
    ]

    /// bookSafe in paperFirst.ts: a reminder or calendar event never carries the AI's title; its "when" only if certified.
    static func bookTitle(kind: String) -> String { "\(bookTitles[kind] ?? "Appointment") from your paper" }
    static func bookWhen(_ it: VerifiedItem, check: Check) -> String { check == .certified ? it.when : "" }

    /// planStepQuotes in planQuotes.ts: the paper's own words behind one plan step, grounded items only, de-duplicated.
    static func planStepQuotes(_ step: PlanStep, items: [VerifiedItem]) -> [String] {
        var byId: [String: String] = [:]
        for i in items where i.grounded { byId[i.id] = i.source_quote.trimmingCharacters(in: .whitespacesAndNewlines) }
        var seen = Set<String>(), out: [String] = []
        for id in step.care_ids {
            let q = byId[id] ?? ""
            if !q.isEmpty && seen.insert(q).inserted { out.append(q) }
        }
        return out
    }

    /// PLAN_IS_A_SUGGESTION in speechText.ts.
    static let planIsASuggestion = "This plan is a suggestion from ATLAS, not your paper. If anything differs, follow your paper."

    /// speechLines in speechText.ts: what "Read it out loud" says for a plan.
    static func planSpeechLines(_ plan: PlanResponse, items: [VerifiedItem]) -> [String] {
        [planIsASuggestion, plan.summary] + plan.steps.enumerated().flatMap { i, s in
            ["\(i + 1). \(s.title). \(s.action)"] + planStepQuotes(s, items: items).map { "Your paper says: \"\($0)\"" }
        }
    }
}
