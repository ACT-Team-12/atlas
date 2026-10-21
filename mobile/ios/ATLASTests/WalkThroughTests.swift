import Foundation
import Testing
@testable import ATLAS

/// "Walk me through it" on iPhone, checked against the website. mobile/shared/walk-vectors.json (a test resource
/// referenced from project.yml, the same file Android replays) holds web/src/lib/walkThrough.ts's own answers: the fixed
/// lines in all seven languages, the order, where Pip shows on the step on screen, and the next open step.
struct WalkThroughTests {
    struct Vectors: Decodable {
        let lines: [String: [String: String]]
        let line_keys: [String]
        let filled: [Filled]
        let order: [Order]
        let pip: [PipCase]
        let next_open: [NextOpen]

        struct Filled: Decodable { let language: String; let line: String; let values: [String: Int]; let text: String }
        struct OrderItem: Decodable { let id: String; let warning: Bool; let group: String }
        struct Order: Decodable { let items: [OrderItem]; let ids: [String]; let groups: [String] }
        struct Spot: Decodable { let at: String; let id: String?; let mood: String?; let line: String? }
        struct Shown: Decodable { let id: String; let kind: String }
        struct Expected: Decodable { let mood: String; let line: String? }
        struct PipCase: Decodable { let spot: Spot; let shown: Shown; let check: String; let warning: Bool; let expected: Expected? }
        struct NextOpen: Decodable { let ids: [String]; let done: [String]; let from: Int; let expected: Int }
    }

    final class Token {}

    static func load() throws -> Vectors {
        let url = try #require(Bundle(for: Token.self).url(forResource: "walk-vectors", withExtension: "json"))
        return try JSONDecoder().decode(Vectors.self, from: Data(contentsOf: url))
    }

    static func spot(_ s: Vectors.Spot) -> Pip.Spot? {
        switch s.at {
        case "none": return Pip.Spot.none
        case "header": return .header
        case "greet": return s.id.map { .greet(id: $0) }
        case "step":
            guard let id = s.id, let mood = s.mood.flatMap(Pip.Mood.init(rawValue:)) else { return nil }
            return .step(id: id, mood: mood, line: s.line.flatMap(Pip.Line.init(rawValue:)))
        default: return nil
        }
    }

    @Test func fixedLinesAreTheWebsitesInAllSevenLanguages() throws {
        let v = try Self.load()
        #expect(Set(v.lines.keys) == Set(Language.allCases.map(\.rawValue)))
        #expect(Set(v.line_keys) == Set(WalkThrough.Line.allCases.map(\.rawValue)))
        for language in Language.allCases {
            let web = try #require(v.lines[language.rawValue])
            for line in WalkThrough.Line.allCases {
                // Compared as UTF-16 code units, as JavaScript would. No values: placeholders stay as written.
                #expect(Array(WalkThrough.line(language, line).utf16) == Array((web[line.rawValue] ?? "").utf16), "\(language) \(line)")
            }
        }
    }

    @Test func filledLinesMatchTheWebsite() throws {
        let v = try Self.load()
        for f in v.filled {
            let line = try #require(WalkThrough.Line(rawValue: f.line))
            #expect(Array(WalkThrough.line(f.language, line, f.values).utf16) == Array(f.text.utf16), "\(f.language) \(f.line) \(f.values)")
        }
    }

    @Test func orderAndPipAndNextOpenMatchTheWebsite() throws {
        let v = try Self.load()
        var passed = 0
        var total = 0
        for o in v.order {
            total += 1
            let got = WalkThrough.steps(o.items, isWarning: { $0.warning }, groupOf: { WhenGroup(rawValue: $0.group) ?? .unclear })
            let ok = got.map(\.it.id) == o.ids && got.map(\.group.key) == o.groups
            #expect(ok, "order \(o.items.map(\.id))")
            if ok { passed += 1 }
        }
        for c in v.pip {
            total += 1
            let spot = try #require(Self.spot(c.spot))
            let check = try #require(Check(rawValue: c.check))
            let got = WalkThrough.pip(spot, shownID: c.shown.id, shownKind: c.shown.kind, check: check, warning: c.warning)
            let want = c.expected.map { WalkThrough.ShownPip(mood: Pip.Mood(rawValue: $0.mood)!, line: $0.line.flatMap(Pip.Line.init(rawValue:))) }
            #expect(got == want, "pip \(c.spot) \(c.shown.id)")
            if got == want { passed += 1 }
        }
        for n in v.next_open {
            total += 1
            let done = Dictionary(uniqueKeysWithValues: n.done.map { ($0, true) })
            let got = WalkThrough.nextOpen(n.ids, done: done, from: n.from)
            #expect(got == n.expected, "nextOpen \(n.ids) \(n.done) \(n.from)")
            if got == n.expected { passed += 1 }
        }
        #expect(total > 600)
        // ios-ci reads this line to prove the shared vectors ran.
        print("walk vectors: \(passed) of \(total) equal to the web reference")
    }

    @Test func unknownLanguageFallsBackToEnglish() {
        #expect(WalkThrough.line("Klingon", .open) == "Walk me through it")
        #expect(WalkThrough.line(.Spanish, .progress, ["n": 2, "total": 5]) == "Paso 2 de 5")
    }

    @Test func noEmDashesInAnyLine() {
        for (_, table) in WalkThrough.lines {
            for (_, text) in table { #expect(!text.contains("\u{2014}") && !text.contains("\u{2013}")) }
        }
    }
}
