import Foundation

/// "Your steps", grouped by when. A line-for-line port of web/src/lib/stepsView.ts (whenFromText, listHeading,
/// stopNowFromPaper, stepWhen), with the same pattern text (SafetyPatterns) and checked against the website's own answers
/// in mobile/shared/safety-vectors.json.
///
/// A step is placed by the time words inside its own quote from the paper. Only a certified step may fall back to the
/// AI's "when" when its quote names no time; an uncertified step whose quote names no time (or two that disagree) goes
/// under "Check the date on your paper". One exception, also read from the paper only: a medicine the paper says to stop
/// ("STOP taking these medications:", "Discontinue", "Do not take") goes under "Right away", because stopping starts now.
enum WhenGroup: String, CaseIterable, Sendable {
    case today, soon, daily, later, unclear

    /// WHEN_GROUP_LABEL in stepsView.ts. Counted from the paper (the visit), never from the day a plan is reopened.
    var label: String {
        switch self {
        case .today: "Right away"
        case .soon: "Within about 2 weeks"
        case .daily: "Every day or every week"
        case .later: "Later (weeks or months away)"
        case .unclear: "Check the date on your paper"
        }
    }

    /// GROUP_NOTE in web/src/ui/CareSteps.tsx.
    var note: String? {
        self == .unclear
            ? "Your paper doesn't give a clear time for these yet, or we couldn't confirm one. Check the date on your paper, or ask your clinic."
            : nil
    }
}

struct TextWhen: Equatable, Sendable {
    let group: WhenGroup
    /// The time words exactly as written, in the order they appear. Empty when nothing was found.
    let words: [String]
}

struct StepWhen: Equatable, Sendable {
    let group: WhenGroup
    let words: [String]
    /// Where the group came from: "paper" (its own words), "explanation" (the AI's "when", certified only) or "none".
    let from: String
}

/// One time group of steps, in paper order.
struct StepGroup: Identifiable, Sendable {
    let group: WhenGroup
    let items: [VerifiedItem]
    var id: WhenGroup { group }
}

enum StepsWhen {
    /// RULES in stepsView.ts, in order: the group each gives ("count" counts days or weeks ahead) and its pattern.
    static let ruleGroups = ["today", "today", "count", "soon", "soon", "later", "later", "daily", "daily"]
    private static let rules: [NSRegularExpression] = [
        SafetyPatterns.WHEN_RULE_0, SafetyPatterns.WHEN_RULE_1, SafetyPatterns.WHEN_RULE_2, SafetyPatterns.WHEN_RULE_3,
        SafetyPatterns.WHEN_RULE_4, SafetyPatterns.WHEN_RULE_5, SafetyPatterns.WHEN_RULE_6, SafetyPatterns.WHEN_RULE_7,
        SafetyPatterns.WHEN_RULE_8,
    ].map { $0.regex() }
    private static let otherLatin = SafetyPatterns.OTHER_LATIN.regex()
    private static let negation = SafetyPatterns.NEGATION.regex()
    private static let stop = SafetyPatterns.STOP.regex()
    private static let notNow = SafetyPatterns.NOT_NOW.regex()
    private static let bullet = SafetyPatterns.BULLET.regex()
    private static let jsSpaces = try! NSRegularExpression(pattern: SafetyPattern.jsSpaceClass + "+")
    private static let jsTrim = try! NSRegularExpression(pattern: "^\(SafetyPattern.jsSpaceClass)+|\(SafetyPattern.jsSpaceClass)+$")
    private static let clauseEnd = try! NSRegularExpression(pattern: "[.;:!?]")

    /// NUM_WORDS in stepsView.ts: number words a paper may use for a count, English and Spanish.
    static let numWords: [String: Int] = [
        "a": 1, "an": 1, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9,
        "ten": 10, "eleven": 11, "twelve": 12, "fourteen": 14, "fifteen": 15, "twenty": 20, "thirty": 30,
        "un": 1, "una": 1, "uno": 1, "dos": 2, "tres": 3, "cuatro": 4, "cinco": 5, "seis": 6, "siete": 7, "ocho": 8,
        "nueve": 9, "diez": 10, "once": 11, "doce": 12, "catorce": 14, "quince": 15, "veinte": 20, "treinta": 30,
    ]

    private static func toNum(_ s: String) -> Int? {
        if !s.isEmpty, s.utf16.allSatisfy({ $0 >= 0x30 && $0 <= 0x39 }) { return Int(s) }
        return numWords[s.lowercased()]
    }

    /// `\s+` to one space, as the website does before reading any words.
    static func spaces(_ s: String) -> String { Regexes.replaceAll(jsSpaces, in: s, with: " ") }

    /// JavaScript's trim().
    static func trim(_ s: String) -> String { Regexes.replaceAll(jsTrim, in: s, with: "") }

    /// The time group a piece of text names, from its own words only (whenFromText).
    static func fromText(_ text: String) -> TextWhen {
        let t = spaces(text)
        let ns = t as NSString
        if Regexes.test(otherLatin, t) { return TextWhen(group: .unclear, words: []) }
        struct Hit { let group: WhenGroup; let text: String; let at: Int; let length: Int; let order: Int }
        var hits: [Hit] = []
        for (i, re) in rules.enumerated() {
            for m in re.matches(in: t, range: NSRange(location: 0, length: ns.length)) {
                let group: WhenGroup?
                if ruleGroups[i] == "count" {
                    let unit = ns.substring(with: m.range(at: 2))
                    if let n = toNum(ns.substring(with: m.range(at: 1))), n >= 1 {
                        let weeks = unit.first.map { "wWsS".contains($0) } ?? false
                        group = (weeks ? n * 7 : n) <= 14 ? .soon : .later
                    } else {
                        group = nil
                    }
                } else {
                    group = WhenGroup(rawValue: ruleGroups[i])
                }
                if let group {
                    hits.append(Hit(group: group, text: ns.substring(with: m.range), at: m.range.location, length: m.range.length, order: hits.count))
                }
            }
        }
        // A phrase inside a longer one is the same words ("now" inside "right now"): keep the longer.
        let sorted = hits.sorted { a, b in
            a.at != b.at ? a.at < b.at : a.length != b.length ? a.length > b.length : a.order < b.order
        }
        let kept = sorted.enumerated().filter { i, h in
            !sorted.enumerated().contains { j, o in
                j != i && o.at <= h.at && o.at + o.length >= h.at + h.length && o.length > h.length
            }
        }.map(\.element)
        var words: [String] = []
        for h in kept where !words.contains(where: { Array($0.utf16) == Array(h.text.utf16) }) { words.append(h.text) }
        // A negation earlier in the same clause: "Do not start this medicine today" is never placed.
        let negated = kept.contains { h in
            let before = ns.substring(to: h.at) as NSString
            let ends = clauseEnd.matches(in: before as String, range: NSRange(location: 0, length: before.length))
            let clause = ends.last.map { before.substring(from: $0.range.location + $0.range.length) } ?? (before as String)
            return Regexes.test(negation, clause)
        }
        if negated { return TextWhen(group: .unclear, words: words) }
        var groups: [WhenGroup] = []
        for h in kept where !groups.contains(h.group) { groups.append(h.group) }
        if groups.isEmpty { return TextWhen(group: .unclear, words: []) }
        if groups.count == 1 { return TextWhen(group: groups[0], words: words) }
        if groups.count == 2 && groups.contains(.today) && groups.contains(.daily) { return TextWhen(group: .today, words: words) }
        return TextWhen(group: .unclear, words: words)
    }

    /// The paper's heading above a listed line (listHeading): walking up from the line the span starts on, past the
    /// other lines of the same list, to the first line that is not a list line, if it ends with ":". Else "".
    static func listHeading(_ paper: String, span: TextSpan?) -> String {
        let ns = paper as NSString
        guard let span, span.start >= 0, span.start <= ns.length else { return "" }
        var lines = (ns.substring(to: span.start) as NSString).components(separatedBy: "\n")
        let rest = (ns.substring(from: span.start) as NSString).components(separatedBy: "\n")
        let own = (lines.popLast() ?? "") + (rest.first ?? "")
        if !Regexes.test(bullet, own) { return "" }
        for line in lines.reversed() {
            let trimmed = trim(line)
            if trimmed.isEmpty { return "" }
            if Regexes.test(bullet, line) { continue }
            return trimmed.hasSuffix(":") ? trimmed : ""
        }
        return ""
    }

    /// True when the PAPER says to stop this medicine now (stopNowFromPaper): its quote, or the list heading it sits
    /// under, has a stop word and nothing that makes the stop not start now. Medicines only, from the paper's words only.
    static func stopNowFromPaper(kind: String, quote: String, span: TextSpan?, paper: String) -> Bool {
        if kind != "medication" { return false }
        let texts = [quote, listHeading(paper, span: span)].map { trim(spaces($0)) }.filter { !$0.isEmpty }
        if Regexes.test(otherLatin, texts.joined(separator: " ")) { return false }
        if texts.contains(where: { Regexes.test(notNow, $0) }) { return false }
        return texts.contains { Regexes.test(stop, $0) }
    }

    /// The time group for one care step (stepWhen). The paper's quote decides; only a certified step may fall back to
    /// its AI "when", and only when the quote names no time at all.
    static func step(quote: String, when: String, kind: String, span: TextSpan?, check: Check, paper: String) -> StepWhen {
        let fromPaper = fromText(quote)
        if fromPaper.group != .unclear { return StepWhen(group: fromPaper.group, words: fromPaper.words, from: "paper") }
        if fromPaper.words.isEmpty && stopNowFromPaper(kind: kind, quote: quote, span: span, paper: paper) {
            return StepWhen(group: .today, words: [], from: "paper")
        }
        if check == .certified && fromPaper.words.isEmpty && !trim(when).isEmpty {
            let ai = fromText(when)
            if ai.group != .unclear { return StepWhen(group: ai.group, words: [], from: "explanation") }
        }
        return StepWhen(group: .unclear, words: fromPaper.words, from: fromPaper.words.isEmpty ? "none" : "paper")
    }

    static func step(_ item: VerifiedItem, check: Check, paper: String) -> StepWhen {
        step(quote: item.source_quote, when: item.when, kind: item.kind, span: item.span, check: check, paper: paper)
    }

    /// The steps as the website shows them (CareSteps.tsx): warning signs pinned on top, then each time group in order,
    /// paper order inside a group. Empty groups are left out.
    static func grouped(_ items: [VerifiedItem], check: (String) -> Check, paper: String)
        -> (warnings: [VerifiedItem], groups: [StepGroup]) {
        let warnings = items.filter(WarningPin.isWarning)
        var by: [WhenGroup: [VerifiedItem]] = [:]
        for it in items where !WarningPin.isWarning(it) { by[step(it, check: check(it.id), paper: paper).group, default: []].append(it) }
        return (warnings, WhenGroup.allCases.compactMap { g in by[g].map { StepGroup(group: g, items: $0) } })
    }
}
