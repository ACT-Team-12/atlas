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
///   leads, labelled "Your paper says:", and the explanation is visibly secondary with a note.
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

    static let noteUnchecked = "Explanation, not double-checked. If it and your paper differ, follow your paper."
    static let noteFlagged = "Explanation that our second check says may not match your paper. Follow your paper, and ask your clinic."
    static let leftOutUnchecked = "(The plain-words explanation is left out here because it was not double-checked.)"
    static let leftOutFlagged = "(The plain-words explanation is left out here because a second check says it may not match.)"

    struct StepView: Equatable, Sendable {
        /// True only when certified: the explanation leads.
        let explanationLeads: Bool
        let quoteLabel: String
        let quote: String
        let explanation: String?
        let note: String?
    }

    static func view(quote: String, explanation: [String?], check: Check, source: String = "paper") -> StepView {
        let q = quote.trimmingCharacters(in: .whitespacesAndNewlines)
        let words = explanation.map { ($0 ?? "").trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
            .joined(separator: " · ")
        let label = "Your \(source) says:"
        if q.isEmpty { return StepView(explanationLeads: false, quoteLabel: label, quote: "", explanation: nil, note: nil) }
        if check == .certified && !words.isEmpty {
            return StepView(explanationLeads: true, quoteLabel: label, quote: q, explanation: words, note: nil)
        }
        let note: String? = words.isEmpty ? nil : (check == .flagged ? noteFlagged : noteUnchecked)
        return StepView(explanationLeads: false, quoteLabel: label, quote: q, explanation: words.isEmpty ? nil : words, note: note)
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
