import Foundation
import SwiftUI
import Testing
@testable import ATLAS

/// Pip on iPhone, checked against the website. mobile/shared/pip-vectors.json (a test resource referenced from
/// project.yml, the same file Android replays) holds web/src/lib/pip.ts's own answers: the fixed lines, the quiet kinds,
/// and where Pip goes for 618 cases, with where the one Pip is drawn.
struct PipTests {
    struct Vectors: Decodable {
        let lines: [String: [String: String]]
        let quiet_kinds: [String]
        let cases: [Case]
        struct Step: Decodable { let id: String; let kind: String }
        struct Spot: Decodable { let at: String; let id: String?; let mood: String?; let line: String? }
        struct Card: Decodable { let id: String; let mood: String; let line: String? }
        struct Case: Decodable {
            let name: String
            let steps: [Step]
            let done: [String]
            let checks: [String: String]
            let cheering: String?
            let greet: Bool
            let spot: Spot
            let card: Card?
            let heading: String?
        }
    }

    final class Token {}

    static func load() throws -> Vectors {
        let url = try #require(Bundle(for: Token.self).url(forResource: "pip-vectors", withExtension: "json"))
        return try JSONDecoder().decode(Vectors.self, from: Data(contentsOf: url))
    }

    static func expected(_ s: Vectors.Spot) -> Pip.Spot? {
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

    static func run(_ c: Vectors.Case) -> Pip.Spot {
        let done = Dictionary(uniqueKeysWithValues: c.done.map { ($0, true) })
        return Pip.spot(c.steps.map { Pip.Step(id: $0.id, kind: $0.kind) }, done: done,
                        check: { Check(rawValue: c.checks[$0] ?? "unchecked") ?? .unchecked }, cheering: c.cheering, greet: c.greet)
    }

    @Test func fixedLinesAreTheWebsitesInAllSevenLanguages() throws {
        let v = try Self.load()
        #expect(Set(v.lines.keys) == Set(Language.allCases.map(\.rawValue)))
        for language in Language.allCases {
            let web = try #require(v.lines[language.rawValue])
            #expect(Set(web.keys) == Set(Pip.Line.allCases.map(\.rawValue)))
            for line in Pip.Line.allCases {
                // Compared as UTF-16 code units, as JavaScript would.
                #expect(Array(Pip.line(language, line).utf16) == Array((web[line.rawValue] ?? "").utf16), "\(language) \(line)")
            }
        }
    }

    @Test func quietKindsAreTheWebsites() throws {
        #expect(Set(try Self.load().quiet_kinds) == Pip.quietKinds)
    }

    @Test func placementMatchesTheWebsite() throws {
        let v = try Self.load()
        var passed = 0
        for c in v.cases {
            let want = try #require(Self.expected(c.spot), "unreadable expected spot in \(c.name)")
            let got = Self.run(c)
            let drawn = Pip.drawn(got)
            let card = c.card.map { Pip.Drawn.Card(id: $0.id, mood: Pip.Mood(rawValue: $0.mood)!, line: $0.line.flatMap(Pip.Line.init(rawValue:))) }
            #expect(got == want, "\(c.name)")
            #expect(drawn.card == card, "card in \(c.name)")
            #expect(drawn.heading == c.heading.flatMap(Pip.Mood.init(rawValue:)), "heading in \(c.name)")
            if got == want && drawn.card == card { passed += 1 }
        }
        #expect(v.cases.count > 600)
        print("pip vectors: \(passed) of \(v.cases.count) equal to the web reference")
    }

    @Test func exactlyOnePipOnScreenInEveryState() throws {
        for c in try Self.load().cases {
            let spot = Self.run(c)
            let drawn = Pip.drawn(spot)
            #expect(drawn.count == (spot == .none ? 0 : 1), "\(c.name)")
            // During the greeting no card shows Pip: his card's slot stays empty.
            if spot.isGreet { #expect(drawn.card == nil && drawn.heading == .arrive, "\(c.name)") }
        }
    }

    @Test func quietOnMedicineLabsWarningsAndFlaggedSteps() {
        let steps = [Pip.Step(id: "eye", kind: "referral"), Pip.Step(id: "met", kind: "medication"),
                     Pip.Step(id: "a1c", kind: "lab_test"), Pip.Step(id: "walk", kind: "self_care")]
        let unchecked: (String) -> Check = { _ in .unchecked }
        // Medicine is the current step: quiet, no line, no motion and no blink, calm or not.
        let med = Pip.spot(steps, done: ["eye": true], check: unchecked, cheering: nil)
        #expect(med == .step(id: "met", mood: .quiet, line: nil))
        #expect(med.line == nil)
        #expect(Pip.motion(.quiet, calm: false) == .still && Pip.motion(.quiet, calm: true) == .still)
        #expect(!Pip.blinks(.quiet, calm: false))
        // Medicine just marked done: no cheer there.
        #expect(Pip.spot(steps, done: ["eye": true, "met": true], check: unchecked, cheering: "met") == .step(id: "a1c", mood: .quiet, line: nil))
        // A step the check flagged: quiet, and never cheered.
        let flagged: (String) -> Check = { $0 == "eye" ? .flagged : .unchecked }
        #expect(Pip.spot(steps, done: ["eye": true], check: flagged, cheering: "eye") == .step(id: "met", mood: .quiet, line: nil))
        #expect(Pip.quiet(kind: "warning_sign", check: .certified))
        #expect(!Pip.quiet(kind: "self_care", check: .unchecked))
    }

    @Test func greetingIsOnlyAFirstView() {
        #expect(Pip.greetAllowed(greetOver: false, done: [:]))
        #expect(!Pip.greetAllowed(greetOver: true, done: [:]))
        // A done mark on a step since removed (or a warning sign) still means this is not a first view.
        #expect(!Pip.greetAllowed(greetOver: false, done: ["removed-step": true]))
        #expect(Pip.greetAllowed(greetOver: false, done: ["unticked": false]))
    }

    @Test func reduceMotionAndCalmModeFadeWithNoBlink() {
        #expect(Pip.calm(reduceMotion: true, saved: false))
        #expect(Pip.calm(reduceMotion: false, saved: true))
        #expect(!Pip.calm(reduceMotion: false, saved: false))
        #expect(Pip.motion(.arrive, calm: false) == .hop)
        #expect(Pip.motion(.cheer, calm: false) == .bounce)
        #expect(Pip.motion(.arrive, calm: true) == .fade)
        #expect(Pip.motion(.cheer, calm: true) == .fade)
        #expect(!Pip.blinks(.arrive, calm: true) && Pip.blinks(.arrive, calm: false))
        #expect(Pip.calmKey == "atlas.pipCalm")
    }

    @Test func blinkFollowsTheRigsKeyframes() {
        #expect(Pip.blinkScale(at: 0) == 1)
        #expect(Pip.blinkScale(at: 0.5 * 4.2) == 1)
        #expect(abs(Pip.blinkScale(at: 0.97 * 4.2) - 0.1) < 0.01)
        #expect(abs(Pip.blinkScale(at: 4.2 - 0.0001) - 1) < 0.01)
    }

    @Test func announcementKeyReadsARepeatedCheerAgainButNotAMovedGreeting() {
        #expect(Pip.announceKey(.step(id: "a", mood: .cheer, line: .done)) != Pip.announceKey(.step(id: "b", mood: .cheer, line: .done)))
        #expect(Pip.announceKey(.greet(id: "a")) == Pip.announceKey(.step(id: "a", mood: .arrive, line: .start)))
    }

    /// The drawing is the rig's own geometry: the peach body spans x 6 to 58 and y 4 (top of the arc) to 78 (the tip).
    @Test func rigBodyParsesToTheRigsShape() {
        let box = SVGPath.parse(PipRig.body).boundingRect
        #expect(abs(box.minX - 6) < 0.5 && abs(box.maxX - 58) < 0.5)
        #expect(abs(box.minY - 4) < 0.5 && abs(box.maxY - 78) < 0.5)
        // The shine arc stays on the body (center about 32.8, 28.8; radius 20).
        let shine = SVGPath.parse(PipRig.shine).boundingRect
        #expect(shine.minX >= 13.5 && shine.maxX <= 26.5 && shine.minY >= 9.5 && shine.maxY <= 22.5)
        #expect(SVGPath.tokenize("M23 28 q3 -4 6 0").count == 7)
    }
}
