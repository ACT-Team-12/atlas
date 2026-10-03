import Foundation

/// `missed_lines` on the /api/extract response: MissedLinesPayload in web/src/lib/missedLines.ts. The server finds the
/// instruction-like sentences on the paper and each step's quoted stretches; the phone only compares numbers, so the
/// "Lines on your paper we didn't turn into steps" section follows the person's removed steps without matching text.
///
/// Offsets are UTF-16 [start, end) into source_text. They are compared, never used to slice: a line is shown from `text`.
/// One flat type for both shapes ({show:false, why} and {show:true, languages, quotes, sentences}).
///
/// Decoding never throws, so a bad `missed_lines` never costs the steps that came with it: a shape this app cannot read
/// (show not a bool, a fractional or string offset, a range that is not a list, a missing field, a language that is
/// not a string) becomes `unreadable`, which `MissedLines.view` hides as "invalid", the answer missedLinesPayloadValid
/// gives on the web (Android: LenientMissedLinesSerializer).
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

    /// show:true with nothing to show: always invalid, and saved and read back as the same thing.
    static let unreadable = MissedLinesPayload(show: true)

    init(from decoder: Decoder) throws {
        do {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            let show = try c.decode(Bool.self, forKey: .show)
            if show {
                // Every field must be there and of its JSON type (missedLinesPayloadValid).
                self.init(show: true, why: try c.decodeIfPresent(String.self, forKey: .why) ?? "",
                          languages: try c.decode([String].self, forKey: .languages),
                          quotes: try c.decode([String: [[Int]]].self, forKey: .quotes),
                          sentences: try c.decode([MissedSentence].self, forKey: .sentences))
            } else {
                self.init(show: false, why: try c.decodeIfPresent(String.self, forKey: .why) ?? "")
            }
        } catch {
            self = .unreadable
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
        // Every coordinate is checked before any is used: one bad range could otherwise "cover" every line and claim
        // "Every instruction-like line on your paper is in a step." for a paper nobody checked.
        guard isValid(payload, sourceLength: sourceLength) else { return .hidden(why: invalid) }

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

    /// `why` of a show:true payload that breaks a rule in `isValid`.
    static let invalid = "invalid"

    /// The section for a read: its payload checked against its own paper. The server always sends source_text with
    /// missed_lines, so a show:true payload without it (empty, the decoder's default) has no paper to bound its offsets
    /// and is hidden as invalid rather than trusted.
    static func forCare(_ care: CarePlanResponse?, keptIDs: [String]) -> MissedLinesView {
        view(care?.missed_lines, keptIDs: keptIDs, sourceLength: care?.source_text.utf16.count ?? 0)
    }

    /// missedLinesPayloadValid in web/src/lib/missedLines.ts (Android: MissedLines.valid), the same rules on every client:
    ///  - at least one sentence (with none, "every line is in a step" would be vacuous);
    ///  - every range is two integers with 0 <= start < end <= 2^31 - 1, and end <= sourceLength when it is known;
    ///  - each sentence's critical ranges sit inside that sentence;
    ///  - each group points at an earlier-or-same sentence that is its own group's first (group(group) == group);
    ///  - every sentence reads the same as its group's first once normalized: a covered line can only vouch for a
    ///    word-for-word repeat of itself, never for an unrelated line put in its group.
    static func isValid(_ payload: MissedLinesPayload, sourceLength: Int? = nil) -> Bool {
        let bound = min(sourceLength ?? Int(Int32.max), Int(Int32.max))
        func ok(_ a: Int, _ b: Int) -> Bool { a >= 0 && a < b && b <= bound }
        func ok(_ r: [Int]) -> Bool { r.count == 2 && ok(r[0], r[1]) }
        let sentences = payload.sentences
        guard !sentences.isEmpty else { return false }
        for (i, s) in sentences.enumerated() {
            guard ok(s.start, s.end) else { return false }
            guard s.critical.allSatisfy({ ok($0) && $0[0] >= s.start && $0[1] <= s.end }) else { return false }
            guard (0...i).contains(s.group), sentences[s.group].group == s.group else { return false }
            if s.group != i, !sameText(s.text, sentences[s.group].text) { return false }
        }
        return payload.quotes.values.allSatisfy { $0.allSatisfy(ok) }
    }

    /// Equal once normalized, compared as UTF-16 code units like JavaScript's ===. Swift's String == would also treat
    /// canonically equivalent text (a precomposed and a decomposed é) as equal, which the web does not.
    static func sameText(_ a: String, _ b: String) -> Bool { Array(normalize(a).utf16) == Array(normalize(b).utf16) }

    // normalize in web/src/lib/verify.ts. JavaScript's \s, spelled out.
    private static let jsSpace = try! NSRegularExpression(
        pattern: "[\\t\\n\\u000B\\f\\r \\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF]+")
    private static let singleQuotes = try! NSRegularExpression(pattern: "[\\u2018\\u2019\\u201B\\u2032]")
    private static let doubleQuotes = try! NSRegularExpression(pattern: "[\\u201C\\u201D\\u2033]")
    private static let dashes = try! NSRegularExpression(pattern: "[\\u2010-\\u2015\\u2212]")
    private static let bullets = try! NSRegularExpression(pattern: "[\\u2022\\u25CF\\u25AA\\u00B7]")

    /// The website's text normalization (verify.ts normalize), used to check that a group's lines really repeat.
    static func normalize(_ s: String) -> String {
        func replace(_ re: NSRegularExpression, _ with: String, _ in: String) -> String {
            re.stringByReplacingMatches(in: `in`, range: NSRange(`in`.startIndex..., in: `in`), withTemplate: with)
        }
        var t = s.lowercased().replacingOccurrences(of: "\u{03C2}", with: "\u{03C3}")
        t = replace(singleQuotes, "'", t)
        t = replace(doubleQuotes, "\"", t)
        t = replace(dashes, "-", t)
        t = replace(bullets, " ", t)
        t = replace(jsSpace, " ", t)
        // After the line above every JavaScript space is " ", so trim() is trimming " ".
        var u = Array(t.utf16)
        while u.first == 0x20 { u.removeFirst() }
        while u.last == 0x20 { u.removeLast() }
        return String(decoding: u, as: UTF16.self)
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
