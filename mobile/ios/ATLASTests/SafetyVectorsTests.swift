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
        struct Pattern: Decodable { let source: String; let flags: String }
        struct Warning: Decodable { let quote: String; let kind: String; let paper: Bool; let pinned: Bool }
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

    @Test func aStepTheModelMislabeledIsStillStyledAndPinnedAsAWarning() {
        let item = VerifiedItem(id: "a", kind: "self_care", title: "Rest", plain_language: "Rest.",
                                source_quote: "Call 911 or go to the nearest emergency room if you have chest pain.")
        #expect(WarningPin.isWarning(item))
        let plain = VerifiedItem(id: "b", kind: "self_care", title: "Walk", plain_language: "Walk.", source_quote: "Walk 30 minutes a day.")
        #expect(!WarningPin.isWarning(plain))
    }
}
