import Foundation
import Testing
@testable import ATLAS

/// mobile/shared/safety-vectors.json (a test resource referenced from project.yml, the same file Android replays) holds
/// the website's own answers for the safety rules and the exact text of every pattern they use. This checks that the
/// app runs the same patterns and gives the same answer for every case.
struct SafetyVectorsTests {
    struct Vectors: Decodable {
        let patterns: [String: Pattern]
        let warning: [Warning]
        let when_rule_groups: [String]
        let num_words: [String: Int]
        let group_labels: [[String]]
        let when: [When]
        let papers: [String: String]
        let heading: [Heading]
        let step: [Step]
        struct Pattern: Decodable { let source: String; let flags: String }
        struct Warning: Decodable { let quote: String; let kind: String; let paper: Bool; let pinned: Bool }
        struct When: Decodable { let text: String; let group: String; let words: [String] }
        struct Heading: Decodable { let paper: String; let span: TextSpan?; let heading: String }
        struct Expected: Decodable { let group: String; let words: [String]; let from: String }
        struct Step: Decodable {
            let paper: String; let quote: String; let span: TextSpan?; let kind: String; let check: String; let when: String
            let expected: Expected
        }
    }

    final class Token {}

    static func load() throws -> Vectors {
        let url = try #require(Bundle(for: Token.self).url(forResource: "safety-vectors", withExtension: "json"))
        return try JSONDecoder().decode(Vectors.self, from: Data(contentsOf: url))
    }

    @Test func patternsAreTheWebsitesWordForWord() throws {
        let v = try Self.load()
        #expect(Set(v.patterns.keys) == Set(SafetyPatterns.all.keys))
        for (name, p) in v.patterns {
            let mine = try #require(SafetyPatterns.all[name], "\(name) is missing on iOS")
            // Compared as UTF-16 code units, as JavaScript would: no Unicode equivalence hides a changed letter.
            #expect(Array(mine.source.utf16) == Array(p.source.utf16), "\(name) differs from the website")
            #expect(mine.flags == p.flags, "\(name) flags differ from the website")
            _ = mine.regex() // every pattern compiles here (a bad one would trap)
        }
        print("safety patterns: \(v.patterns.count) of \(SafetyPatterns.all.count) equal to the web reference")
    }

    @Test func warningPinsMatchTheWebsite() throws {
        let v = try Self.load()
        var passed = 0
        for w in v.warning {
            let paper = WarningPin.fromPaper(w.quote), pinned = WarningPin.isWarning(kind: w.kind, quote: w.quote)
            #expect(paper == w.paper, "warningFromPaper(\(w.quote))")
            #expect(pinned == w.pinned, "isWarning(\(w.kind), \(w.quote))")
            if paper == w.paper && pinned == w.pinned { passed += 1 }
        }
        #expect(v.warning.count > 100)
        #expect(v.warning.contains { $0.paper } && v.warning.contains { !$0.paper })
        print("safety vectors: warning \(passed) of \(v.warning.count) equal to the web reference")
    }

    @Test func timeTablesAreTheWebsites() throws {
        let v = try Self.load()
        #expect(StepsWhen.ruleGroups == v.when_rule_groups)
        #expect(StepsWhen.numWords == v.num_words)
        #expect(v.group_labels.map { $0[0] } == WhenGroup.allCases.map(\.rawValue))
        for pair in v.group_labels { #expect(WhenGroup(rawValue: pair[0])?.label == pair[1], "label of \(pair[0])") }
    }

    @Test func byWhenGroupsMatchTheWebsite() throws {
        let v = try Self.load()
        var passed = 0, total = 0
        for w in v.when {
            let got = StepsWhen.fromText(w.text)
            #expect(got.group.rawValue == w.group && got.words == w.words, "whenFromText(\(w.text)): \(got)")
            if got.group.rawValue == w.group && got.words == w.words { passed += 1 }
            total += 1
        }
        for h in v.heading {
            let got = StepsWhen.listHeading(try #require(v.papers[h.paper]), span: h.span)
            #expect(got == h.heading, "listHeading(\(h.paper), \(String(describing: h.span)))")
            if got == h.heading { passed += 1 }
            total += 1
        }
        var stopNow = 0
        for s in v.step {
            let got = StepsWhen.step(quote: s.quote, when: s.when, kind: s.kind, span: s.span, check: try #require(Check(rawValue: s.check)),
                                     paper: try #require(v.papers[s.paper]))
            let same = got.group.rawValue == s.expected.group && got.words == s.expected.words && got.from == s.expected.from
            #expect(same, "stepWhen(\(s.quote), \(s.kind), \(s.check), \(s.when)) on \(s.paper): \(got)")
            if same { passed += 1 }
            if s.expected.group == "today" && s.expected.words.isEmpty && s.expected.from == "paper" { stopNow += 1 }
            total += 1
        }
        #expect(v.step.count > 1000 && stopNow > 10)
        print("safety vectors: when \(passed) of \(total) equal to the web reference")
    }

    @Test func groupedPutsWarningsFirstAndStopNowUnderRightAway() {
        let paper = "STOP taking these medications:\n- ibuprofen 200 mg tablet.\nCall 911 if you have chest pain.\nWalk daily."
        let ns = paper as NSString
        func item(_ id: String, _ kind: String, _ quote: String) -> VerifiedItem {
            let r = ns.range(of: quote)
            return VerifiedItem(id: id, kind: kind, title: id, plain_language: id, source_quote: quote,
                                span: TextSpan(start: r.location, end: r.location + r.length))
        }
        let items = [item("walk", "self_care", "Walk daily."), item("stop", "medication", "ibuprofen 200 mg tablet."),
                     item("call", "self_care", "Call 911 if you have chest pain.")]
        let l = StepsWhen.grouped(items, check: { _ in .unchecked }, paper: paper)
        #expect(l.warnings.map(\.id) == ["call"])
        #expect(l.groups.map(\.group) == [.today, .daily])
        #expect(l.groups.map { $0.items.map(\.id) } == [["stop"], ["walk"]])
    }

    @Test func aStepTheModelMislabeledIsStillStyledAndPinnedAsAWarning() {
        let item = VerifiedItem(id: "a", kind: "self_care", title: "Rest", plain_language: "Rest.",
                                source_quote: "Call 911 or go to the nearest emergency room if you have chest pain.")
        #expect(WarningPin.isWarning(item))
        let plain = VerifiedItem(id: "b", kind: "self_care", title: "Walk", plain_language: "Walk.", source_quote: "Walk 30 minutes a day.")
        #expect(!WarningPin.isWarning(plain))
    }
}
