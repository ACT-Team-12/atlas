import Foundation

/// `missed_lines` on the /api/extract response: MissedLinesPayload in web/src/lib/missedLines.ts. The server finds the
/// instruction-like sentences on the paper and each step's quoted stretches; the phone only compares numbers, so the
/// "Lines on your paper we didn't turn into steps" section follows the person's removed steps without matching text.
///
/// Offsets are UTF-16 [start, end) into source_text. They are compared, never used to slice: a line is shown from `text`.
/// One flat type for both shapes ({show:false, why} and {show:true, languages, quotes, sentences}); missing fields
/// decode to empty, and `MissedLines.view` fails closed on a payload that says show but carries nothing to show.
struct MissedLinesPayload: Codable, Hashable, Sendable {
    var show = false
    /// "empty" | "unsupported_language" | "no_instructions" when show is false.
    var why = ""
    var languages: [String] = []
    /// Item id to that item's quoted [start, end) ranges.
    var quotes: [String: [[Int]]] = [:]
    var sentences: [MissedSentence] = []

    init(show: Bool = false, why: String = "", languages: [String] = [], quotes: [String: [[Int]]] = [:],
         sentences: [MissedSentence] = []) {
        self.show = show; self.why = why; self.languages = languages; self.quotes = quotes; self.sentences = sentences
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        show = try c.decodeIfPresent(Bool.self, forKey: .show) ?? false
        why = try c.decodeIfPresent(String.self, forKey: .why) ?? ""
        if show {
            // A payload that says show must carry every field (missedLinesPayloadValid in the web reference); a missing
            // one fails the decode, which drops the payload and hides the section.
            languages = try c.decode([String].self, forKey: .languages)
            quotes = try c.decode([String: [[Int]]].self, forKey: .quotes)
            sentences = try c.decode([MissedSentence].self, forKey: .sentences)
        } else {
            languages = []; quotes = [:]; sentences = []
        }
    }
}

struct MissedSentence: Codable, Hashable, Sendable {
    var text: String
    var start: Int
    var end: Int
    var reason = ""
    /// Numbers and stop / not / never / avoid words: each must sit inside ONE merged kept range.
    var critical: [[Int]] = []
    /// Index of the first sentence with the same normalized text (its own index if none earlier).
    var group: Int

    init(text: String, start: Int, end: Int, reason: String = "", critical: [[Int]] = [], group: Int) {
        self.text = text; self.start = start; self.end = end; self.reason = reason; self.critical = critical; self.group = group
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        text = try c.decode(String.self, forKey: .text)
        start = try c.decode(Int.self, forKey: .start)
        end = try c.decode(Int.self, forKey: .end)
        reason = try c.decodeIfPresent(String.self, forKey: .reason) ?? ""
        // Required: a sentence with no critical list would be held by any overlapping quote at all.
        critical = try c.decode([[Int]].self, forKey: .critical)
        group = try c.decode(Int.self, forKey: .group)
    }
}

/// missedLinesView, rebuilt on the phone.
enum MissedLinesView: Equatable, Sendable {
    /// Show nothing and announce nothing. `why` is "missing" when the server sent no payload (older server or saved plan).
    case hidden(why: String)
    case shown(languages: [String], total: Int, covered: Int, lines: [MissedSentence])
}

enum MissedLines {
    static let title = "Lines on your paper we didn't turn into steps"
    static let allInAStep = "Every instruction-like line on your paper is in a step."
    static let allInAStepNote = "(we check for lines that look like instructions; it can miss some)"
    static let readThese = "Read these yourself or ask your helper. They might matter."
    static let canMiss = "We check for lines that look like instructions; it can miss some."

    /// missedFromPayload in web/src/lib/missedLines.ts. `keptIDs`: the ids of the steps the person still has (not
    /// removed). An id the payload does not know adds nothing; repeats count once. `sourceLength`: the UTF-16 length
    /// of the paper's text when known, the bound every offset must sit inside.
    static func view(_ payload: MissedLinesPayload?, keptIDs: [String], sourceLength: Int? = nil) -> MissedLinesView {
        guard let payload else { return .hidden(why: "missing") }
        guard payload.show else { return .hidden(why: payload.why) }
        // The server never sends show:true without sentences; if it ever did, "every line is in a step" would be vacuous.
        guard !payload.sentences.isEmpty else { return .hidden(why: "no_instructions") }
        // Every coordinate is checked before any is used: one bad range could otherwise "cover" every line and claim
        // "Every instruction-like line on your paper is in a step." for a paper nobody checked.
        guard isValid(payload, sourceLength: sourceLength) else { return .hidden(why: "invalid") }

        var ranges: [(start: Int, end: Int)] = []
        var seen = Set<String>()
        for id in keptIDs where seen.insert(id).inserted {
            for r in payload.quotes[id] ?? [] { ranges.append((r[0], r[1])) }
        }
        ranges.sort { $0.start < $1.start }
        var merged: [(start: Int, end: Int)] = []
        for r in ranges {
            if let last = merged.last, r.start <= last.end {
                merged[merged.count - 1].end = max(last.end, r.end)
            } else {
                merged.append(r)
            }
        }

        var matchedGroups = Set<Int>()
        for s in payload.sentences {
            let overlaps = merged.contains { $0.start < s.end && $0.end > s.start }
            let criticalHeld = s.critical.allSatisfy { c in merged.contains { $0.start <= c[0] && $0.end >= c[1] } }
            if overlaps && criticalHeld { matchedGroups.insert(s.group) }
        }
        let lines = payload.sentences.filter { !matchedGroups.contains($0.group) }
        let total = payload.sentences.count
        return .shown(languages: payload.languages, total: total, covered: total - lines.count, lines: lines)
    }

    /// missedLinesPayloadValid in web/src/lib/missedLines.ts (Android: MissedLines.valid). Every range is two
    /// non-negative integers with start < end, and end <= the paper's UTF-16 length when known; every critical range lies
    /// inside its sentence; every group points at a sentence at or before its own that is its own group's first
    /// (group(group) == group). Anything else hides the section.
    static func isValid(_ payload: MissedLinesPayload, sourceLength: Int? = nil) -> Bool {
        let bound = sourceLength ?? Int.max
        func ok(_ a: Int, _ b: Int) -> Bool { a >= 0 && a < b && b <= bound }
        for ranges in payload.quotes.values {
            for r in ranges where !(r.count == 2 && ok(r[0], r[1])) { return false }
        }
        for (i, s) in payload.sentences.enumerated() {
            guard ok(s.start, s.end), (0...i).contains(s.group), payload.sentences[s.group].group == s.group else { return false }
            for c in s.critical where !(c.count == 2 && c[0] >= s.start && c[0] < c[1] && c[1] <= s.end) { return false }
        }
        return true
    }

    /// missedLinesAnnouncement: what VoiceOver says (politely) when the result arrives or changes. Empty when hidden.
    static func announcement(_ view: MissedLinesView) -> String {
        guard case let .shown(_, _, _, lines) = view else { return "" }
        let n = lines.count
        if n == 0 { return allInAStep }
        let one = n == 1
        return "\(one ? "1 line" : "\(n) lines") on your paper \(one ? "looks" : "look") like instructions but "
            + "\(one ? "is" : "are") not in a step. Open \"\(title)\" to read \(one ? "it" : "them")."
    }

    /// "1 line" / "3 lines", for the collapsed heading's badge.
    static func lineCountLabel(_ n: Int) -> String { "\(n) \(n == 1 ? "line" : "lines")" }
}
