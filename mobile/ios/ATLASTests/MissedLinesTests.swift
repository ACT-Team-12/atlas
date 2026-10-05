import Foundation
import Testing
@testable import ATLAS

/// The phone rebuilds "Lines on your paper we didn't turn into steps" from `missed_lines` and the ids of the steps still
/// kept. mobile/shared/missed-lines-vectors.json (a test resource referenced from project.yml, the same file Android
/// replays) holds the website's own answer (missedLinesView) for every fixture and kept set; this replays each one
/// through MissedLines.view and asserts the same result.
struct MissedLinesTests {
    private struct Vectors: Decodable {
        let fixtures: [Fixture]
        struct Fixture: Decodable {
            let name: String
            let payload: MissedLinesPayload
            let source_length: Int?
            let cases: [Case]
        }
        struct Case: Decodable {
            let kept: [String]
            let expected: Expected
        }
        struct Expected: Decodable {
            let show: Bool
            let why: String?
            let languages: [String]?
            let total: Int?
            let covered: Int?
            let lines: [String]?
        }
    }

    static func vectorsData() throws -> Data {
        let url = try #require(Bundle(for: Fixture.BundleToken.self).url(forResource: "missed-lines-vectors", withExtension: "json"))
        return try Data(contentsOf: url)
    }

    private static func summary(_ e: Vectors.Expected) -> String {
        e.show ? "show \(e.languages ?? []) \(e.total ?? -1) \(e.covered ?? -1) \(e.lines ?? [])" : "hidden \(e.why ?? "")"
    }

    private static func summary(_ v: MissedLinesView) -> String {
        switch v {
        case let .shown(languages, total, covered, lines): "show \(languages) \(total) \(covered) \(lines.map(\.text))"
        case let .hidden(why): "hidden \(why)"
        }
    }

    @Test func matchesTheWebReferenceForEveryVector() throws {
        // The payload goes through the app's own decoder, exactly as a response or a saved plan is read, so the
        // malformed shapes (string or fractional offsets, ranges that are not lists, missing fields) are checked too.
        let vectors = try JSONDecoder().decode(Vectors.self, from: Self.vectorsData())
        var cases = 0, passed = 0, shownWithLines = 0
        for f in vectors.fixtures {
            for c in f.cases {
                let got = MissedLines.view(f.payload, keptIDs: c.kept, sourceLength: f.source_length)
                let want = Self.summary(c.expected), have = Self.summary(got)
                #expect(have == want, "\(f.name) kept=\(c.kept)")
                if have == want { passed += 1 }
                if case let .shown(_, _, _, lines) = got, !lines.isEmpty { shownWithLines += 1 }
                cases += 1
            }
        }
        #expect(vectors.fixtures.count == 42)
        #expect(cases == 753)
        #expect(passed == 753)
        #expect(vectors.fixtures.filter { $0.name.hasPrefix("malformed:") }.count == 19)
        #expect(shownWithLines > 400, "too few cases with missed lines: \(shownWithLines)")
        print("missed_lines vectors: \(vectors.fixtures.count) fixtures, \(passed) of \(cases) kept sets equal to the web reference")
    }

    // MARK: Beyond the vectors

    private func s(_ text: String, _ start: Int, _ end: Int, group: Int, critical: [[Int]] = []) -> MissedSentence {
        MissedSentence(text: text, start: start, end: end, reason: "imperative", critical: critical, group: group)
    }

    private func lineCount(_ v: MissedLinesView) -> Int? {
        if case let .shown(_, _, _, lines) = v { return lines.count }
        return nil
    }

    @Test func absentFieldHidesTheSectionAndOldResponsesStillDecode() throws {
        let old = try JSONDecoder().decode(CarePlanResponse.self, from: Data(#"{"items":[],"stats":{"extracted":0,"grounded":0,"refused":0,"ms":1}}"#.utf8))
        #expect(old.missed_lines == nil)
        let v = MissedLines.view(old.missed_lines, keptIDs: [])
        #expect(v == .hidden(why: "missing"))
        #expect(MissedLines.announcement(v) == "")
    }

    @Test func decodesTheServerShape() throws {
        let care = try JSONDecoder().decode(CarePlanResponse.self, from: Data(#"""
            {"items":[],"stats":{"extracted":0,"grounded":0,"refused":0,"ms":1},
             "missed_lines":{"show":true,"languages":["en"],"quotes":{"a":[[0,10]]},
             "sentences":[{"text":"Take 1 tablet daily.","start":0,"end":20,"reason":"imperative","critical":[[5,6]],"group":0}]}}
            """#.utf8))
        let p = try #require(care.missed_lines)
        #expect(p.quotes["a"] == [[0, 10]])
        #expect(MissedLines.view(p, keptIDs: ["a"]) == .shown(languages: ["en"], total: 1, covered: 1, lines: []))
        #expect(lineCount(MissedLines.view(p, keptIDs: [])) == 1)
        let hidden = try JSONDecoder().decode(MissedLinesPayload.self, from: Data(#"{"show":false,"why":"unsupported_language"}"#.utf8))
        #expect(MissedLines.view(hidden, keptIDs: ["a"]) == .hidden(why: "unsupported_language"))
        // Saved and loaded again (a saved plan keeps the check).
        let again = try JSONDecoder().decode(CarePlanResponse.self, from: JSONEncoder().encode(care))
        #expect(again.missed_lines == p)
    }

    @Test func aPayloadThisAppCannotReadHidesTheSectionButKeepsTheRead() throws {
        let care = try JSONDecoder().decode(CarePlanResponse.self, from: Data(#"""
            {"items":[],"stats":{"extracted":0,"grounded":0,"refused":0,"ms":1},
             "missed_lines":{"show":true,"languages":["en"],"quotes":{},"sentences":[{"text":"Take it.","start":"zero","end":8,"group":0}]}}
            """#.utf8))
        #expect(care.items.isEmpty && care.stats.ms == 1, "the read itself decodes")
        #expect(care.missed_lines == .unreadable)
        #expect(MissedLines.view(care.missed_lines, keptIDs: []) == .hidden(why: "invalid"))
        // Saved and read back, it is still unreadable (and still hidden).
        let again = try JSONDecoder().decode(CarePlanResponse.self, from: JSONEncoder().encode(care))
        #expect(again.missed_lines == .unreadable)
        // Shapes beyond the shared vectors: show not a bool, not an object at all.
        for json in [#"{"show":1,"languages":["en"],"quotes":{},"sentences":[]}"#, #"{"show":"true"}"#, #"[1,2]"#, #"{"why":"empty"}"#] {
            let p = try JSONDecoder().decode(MissedLinesPayload.self, from: Data(json.utf8))
            #expect(p == .unreadable, "\(json)")
            #expect(MissedLines.view(p, keptIDs: []) == .hidden(why: "invalid"))
        }
    }

    @Test func showWithoutSentencesNeverClaimsAllCovered() {
        #expect(MissedLines.view(MissedLinesPayload(show: true, languages: ["en"]), keptIDs: ["a"]) == .hidden(why: "invalid"))
    }

    @Test func touchingRangesMergeAndMalformedRangesNeverCoverALine() {
        // A number split across two quotes: only the two together hold it.
        let p = MissedLinesPayload(show: true, languages: ["en"],
                                   quotes: ["a": [[0, 18]], "b": [[18, 25]]],
                                   sentences: [s("Take 1 tablet for 10 days.", 0, 26, group: 0, critical: [[17, 19]])])
        func missed(_ ids: String...) -> Int? { lineCount(MissedLines.view(p, keptIDs: ids)) }
        #expect(missed("a") == 1)
        #expect(missed("b") == 1)
        #expect(missed("a", "b") == 0)
        #expect(missed("a", "b", "a", "nope") == 0)
    }

    /// Any bad coordinate anywhere in the payload hides the whole section: no lines, no all-covered claim, no announcement.
    @Test func malformedCoordinatesHideTheSection() {
        let line = s("Take 1 tablet for 10 days.", 0, 26, group: 0, critical: [[17, 19]])
        let good = MissedLinesPayload(show: true, languages: ["en"], quotes: ["a": [[0, 26]]], sentences: [line])
        #expect(MissedLines.view(good, keptIDs: ["a"], sourceLength: 30) == .shown(languages: ["en"], total: 1, covered: 1, lines: []))

        func hidden(_ p: MissedLinesPayload, sourceLength: Int? = nil, _ note: Comment) {
            for kept in [["a"], ["a", "x"], []] {
                let v = MissedLines.view(p, keptIDs: kept, sourceLength: sourceLength)
                #expect(v == .hidden(why: "invalid"), note)
                #expect(MissedLines.announcement(v) == "", note)
            }
        }
        var p = good
        // The case from review: one kept range spanning everything must not claim every line is in a step.
        p.quotes = ["a": [[-1, 2147483647]]]
        hidden(p, "range [-1, Int32.max]")
        p.quotes = ["a": [[0, 26]], "x": [[-1, 2147483647]]]
        hidden(p, "a bad range on a step that is not kept still hides it")
        p.quotes = ["a": [[0]]]; hidden(p, "one number")
        p.quotes = ["a": [[0, 10, 20]]]; hidden(p, "three numbers")
        p.quotes = ["a": [[5, 5]]]; hidden(p, "empty range")
        p.quotes = ["a": [[10, 5]]]; hidden(p, "backwards range")
        p.quotes = ["a": [[0, 31]]]; hidden(p, sourceLength: 30, "past the paper's length")
        p = good
        p.sentences = [s(line.text, -1, 26, group: 0)]; hidden(p, "negative sentence start")
        p.sentences = [s(line.text, 26, 26, group: 0)]; hidden(p, "empty sentence")
        p.sentences = [s(line.text, 0, 40, group: 0)]; hidden(p, sourceLength: 30, "sentence past the paper's length")
        p.sentences = [s(line.text, 0, 26, group: 0, critical: [[17]])]; hidden(p, "critical with one number")
        p.sentences = [s(line.text, 0, 26, group: 0, critical: [[20, 30]])]; hidden(p, "critical outside its sentence")
        p.sentences = [s(line.text, 0, 26, group: 0, critical: [[19, 17]])]; hidden(p, "backwards critical")
        p.sentences = [s(line.text, 0, 26, group: 1)]; hidden(p, "group after itself")
        p.sentences = [s(line.text, 0, 26, group: -1)]; hidden(p, "negative group")
        // A group must point at its group's first sentence, not along a chain (0 <- 1 <- 2 is not a group).
        p.sentences = [line, s("Call 911.", 27, 36, group: 0), s("Call 911.", 37, 46, group: 1)]
        hidden(p, sourceLength: 50, "chained group")
        p.sentences = [line, s("Call 911.", 27, 36, group: 1), s("Call 911.", 37, 46, group: 1)]
        #expect(MissedLines.isValid(p, sourceLength: 50), "a real repeat: both copies point at the first")
        // Out of range for Int (or not a number at all): the payload does not decode, so the section is hidden too.
        let huge = try? JSONDecoder().decode(MissedLinesPayload.self, from: Data(#"""
            {"show":true,"languages":["en"],"quotes":{"a":[[0,1e30]]},"sentences":[{"text":"x","start":0,"end":1,"group":0}]}
            """#.utf8))
        #expect(huge == .unreadable)
        p = good
        p.quotes = ["a": [[0, 2147483648]]]; hidden(p, "offset past 32 bits")
        p.sentences = [line, s("Call 911.", 27, 36, group: 0)]; hidden(p, sourceLength: 50, "an unrelated line in the first line's group")
        // show:true missing a field it needs, or a sentence without its critical list: dropped, so the section hides.
        for json in [
            #"{"show":true,"languages":["en"],"quotes":{"a":[[0,26]]},"sentences":[{"text":"Take 1 tablet for 10 days.","start":0,"end":26,"group":0}]}"#,
            #"{"show":true,"languages":["en"],"sentences":[{"text":"x","start":0,"end":1,"critical":[],"group":0}]}"#,
            #"{"show":true,"quotes":{},"sentences":[{"text":"x","start":0,"end":1,"critical":[],"group":0}]}"#,
            #"{"show":true,"languages":["en"],"quotes":{}}"#,
        ] {
            let care = try? JSONDecoder().decode(CarePlanResponse.self, from: Data(
                #"{"items":[],"stats":{"extracted":0,"grounded":0,"refused":0,"ms":1},"missed_lines":"#.utf8 + Data(json.utf8) + Data("}".utf8)))
            #expect(care != nil, "the read itself still decodes")
            #expect(MissedLines.view(care?.missed_lines, keptIDs: ["a"]) == .hidden(why: "invalid"), "\(json)")
        }
        let hiddenOnly = try? JSONDecoder().decode(MissedLinesPayload.self, from: Data(#"{"show":false,"why":"empty"}"#.utf8))
        #expect(hiddenOnly == MissedLinesPayload(show: false, why: "empty"))
    }

    /// verify.ts normalize, ported: a group may only join word-for-word repeats once normalized, nothing else.
    @Test func groupsJoinOnlyRepeatsOfTheSameLine() {
        #expect(MissedLines.normalize("  Call\u{00A0}911 \u{2014} NOW\u{2019}s  \u{2022} \u{201C}ok\u{201D}\n") == "call 911 - now's \"ok\"")
        #expect(MissedLines.normalize("\u{039F}\u{0394}\u{039F}\u{03A3}") == "\u{03BF}\u{03B4}\u{03BF}\u{03C3}")
        #expect(MissedLines.sameText("Call 911 if you have chest pain.", "CALL  911 if you have chest pain."))
        #expect(!MissedLines.sameText("Call 911 if you have chest pain.", "Take 1 tablet daily."))
        // Like JavaScript ===, not Swift ==: a precomposed and a decomposed letter are different text.
        #expect(!MissedLines.sameText("caf\u{00E9}", "cafe\u{0301}"))
        let a = s("Call 911 if you have chest pain.", 0, 32, group: 0)
        let repeatLine = s("call 911 if you have  chest pain.", 33, 66, group: 0)
        let other = s("Take 1 tablet daily.", 33, 53, group: 0)
        let ok = MissedLinesPayload(show: true, languages: ["en"], quotes: ["x": [[0, 32]]], sentences: [a, repeatLine])
        #expect(MissedLines.view(ok, keptIDs: ["x"], sourceLength: 70) == .shown(languages: ["en"], total: 2, covered: 2, lines: []))
        var bad = ok
        bad.sentences = [a, other]
        let v = MissedLines.view(bad, keptIDs: ["x"], sourceLength: 70)
        #expect(v == .hidden(why: "invalid"), "quoting one line must not vouch for an unrelated line put in its group")
        #expect(MissedLines.announcement(v) == "")
    }

    /// A show:true payload whose read has no source_text has no paper to bound its offsets: hidden, not trusted.
    @Test func aReadWithoutItsTextHidesTheSection() throws {
        let care = try JSONDecoder().decode(CarePlanResponse.self, from: Data(#"""
            {"items":[],"stats":{"extracted":0,"grounded":0,"refused":0,"ms":1},
             "missed_lines":{"show":true,"languages":["en"],"quotes":{"a":[[0,20]]},
             "sentences":[{"text":"Take 1 tablet daily.","start":0,"end":20,"reason":"imperative","critical":[],"group":0}]}}
            """#.utf8))
        #expect(care.source_text.isEmpty)
        #expect(MissedLines.forCare(care, keptIDs: ["a"]) == .hidden(why: "invalid"))
        #expect(MissedLines.view(care.missed_lines, keptIDs: ["a"], sourceLength: 20) == .shown(languages: ["en"], total: 1, covered: 1, lines: []))
    }

    @Test func announcementAndBadgeMatchTheWebsiteWording() {
        let one = MissedLinesView.shown(languages: ["en"], total: 2, covered: 1, lines: [s("Call 911.", 0, 9, group: 0)])
        let two = MissedLinesView.shown(languages: ["en"], total: 2, covered: 0, lines: [s("Call 911.", 0, 9, group: 0), s("Take it.", 10, 18, group: 1)])
        #expect(MissedLines.announcement(one) == "1 line on your paper looks like instructions but is not in a step. Open \"Lines on your paper we didn't turn into steps\" to read it.")
        #expect(MissedLines.announcement(two) == "2 lines on your paper look like instructions but are not in a step. Open \"Lines on your paper we didn't turn into steps\" to read them.")
        #expect(MissedLines.announcement(.shown(languages: ["en"], total: 2, covered: 2, lines: [])) == "Every instruction-like line on your paper is in a step.")
        #expect(MissedLines.lineCountLabel(1) == "1 line")
        #expect(MissedLines.lineCountLabel(3) == "3 lines")
        #expect(MissedLines.announcement(.hidden(why: "empty")) == "")
    }

    @Test func webWordingIsCopiedExactly() throws {
        let web = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("web/src/ui/MissedLines.tsx")
        // The website's English now lives in lib/uiText.ts (the UI in 7 languages, PR 93); the component draws it from there.
        let uiText = web.deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("lib/uiText.ts")
        let src = try String(contentsOf: web, encoding: .utf8).replacingOccurrences(of: "&apos;", with: "'")
            + (try String(contentsOf: uiText, encoding: .utf8))
        for text in [MissedLines.title, MissedLines.allInAStep, MissedLines.allInAStepNote, MissedLines.readThese, MissedLines.canMiss] {
            #expect(src.contains(text), "not in MissedLines.tsx or uiText.ts: \(text)")
        }
        let lib = web.deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("lib/missedLines.ts")
        let ts = try String(contentsOf: lib, encoding: .utf8)
        #expect(ts.contains("Open \"Lines on your paper we didn't turn into steps\" to read"))
    }

    /// Recomputed from the kept steps on every Remove and Undo, through the real AppModel on a saved file.
    @MainActor @Test func missedLinesFollowRemoveAndUndo() throws {
        var care = try #require(JSONSerialization.jsonObject(with: Fixture.data("extract_sample_live")) as? [String: Any])
        // Built by the server (PR 66) for this exact response; taken from the shared vectors so it is the real payload.
        let vectors = try #require(JSONSerialization.jsonObject(with: Self.vectorsData()) as? [String: Any])
        let fixtures = try #require(vectors["fixtures"] as? [[String: Any]])
        let live = try #require(fixtures.first { $0["name"] as? String == "live-12-items" })
        care["missed_lines"] = live["payload"]
        let saved: [String: Any] = ["text": "x", "language": "English", "level": "simple", "care": care, "barriers": [String](),
                                    "zip": "", "note": "", "done": [String: Bool](), "removed": [String: Bool](),
                                    "savedAt": "2026-10-01T12:00:00Z"]
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let store = SessionStore(directory: dir)
        try JSONSerialization.data(withJSONObject: saved).write(to: store.url)

        let model = AppModel(store: store)
        #expect(model.care?.missed_lines != nil)
        let all = model.missedLines
        let allCount = try #require(lineCount(all))
        var changed = 0
        for id in model.items.map(\.id) {
            model.removed[id] = true
            let after = try #require(lineCount(model.missedLines))
            #expect(after >= allCount, "removing a step can only add lines")
            if after > allCount { changed += 1 }
            model.removed[id] = nil
            #expect(model.missedLines == all, "Undo restores the section exactly")
        }
        #expect(changed > 0, "some removal must surface a line")
    }
}
