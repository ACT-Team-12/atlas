import Foundation
import Testing
@testable import ATLAS

/// "Your medicine changes" on iPhone, checked against the website. mobile/shared/medicine-changes-vectors.json (a test
/// resource referenced from project.yml, the same file the web suite and Android replay) holds the expected row, reason,
/// medicine name and old and new dose for every case, in all seven app languages.
struct MedicineChangesTests {
    struct Vectors: Decodable {
        let cases: [Case]
        struct Dose: Decodable, Equatable { let was: String; let now: String }
        struct Expect: Decodable {
            let row: String
            let reason: String?
            let dose: Dose??
            let medicine_name: String??

            enum CodingKeys: String, CodingKey { case row, reason, dose, medicine_name }
            init(from decoder: Decoder) throws {
                let c = try decoder.container(keyedBy: CodingKeys.self)
                row = try c.decode(String.self, forKey: .row)
                reason = try c.decodeIfPresent(String.self, forKey: .reason)
                // Present-and-null and absent are different: absent means "not checked in this case".
                dose = c.contains(.dose) ? .some(try c.decodeNil(forKey: .dose) ? nil : try c.decode(Dose.self, forKey: .dose)) : nil
                medicine_name = c.contains(.medicine_name)
                    ? .some(try c.decodeNil(forKey: .medicine_name) ? nil : try c.decode(String.self, forKey: .medicine_name)) : nil
            }
        }
        struct Case: Decodable { let name: String; let language: String; let kind: String; let quote: String; let paper: String?; let expect: Expect }
    }

    final class Token {}

    static func load() throws -> Vectors {
        let url = try #require(Bundle(for: Token.self).url(forResource: "medicine-changes-vectors", withExtension: "json"))
        return try JSONDecoder().decode(Vectors.self, from: Data(contentsOf: url))
    }

    static func span(_ c: Vectors.Case) -> TextSpan? {
        guard let paper = c.paper else { return nil }
        let r = (paper as NSString).range(of: c.quote)
        guard r.location != NSNotFound else { return nil }
        return TextSpan(start: r.location, end: r.location + r.length)
    }

    @Test func everyCaseMatchesTheWebsite() throws {
        let v = try Self.load()
        #expect(v.cases.count >= 60)
        #expect(Set(v.cases.map(\.language)) == Set(Language.allCases.map(\.rawValue)))
        var passed = 0
        for c in v.cases {
            let span = Self.span(c)
            if c.paper != nil { #expect(span != nil, "quote not in its paper: \(c.name)") }
            let got = MedicineChanges.change(id: "x", kind: c.kind, quote: c.quote, span: span, paper: c.paper ?? "")
            var ok = true
            if c.expect.row == "none" {
                ok = got == nil
            } else if let got {
                ok = got.row.rawValue == c.expect.row
                // Every Stop on the card is also a stop the list's "Right away" rule accepts.
                if got.row == .stop {
                    ok = ok && StepsWhen.stopNowFromPaper(kind: c.kind, quote: c.quote, span: span, paper: c.paper ?? "")
                }
                if let reason = c.expect.reason { ok = ok && got.reason == reason }
                if let dose = c.expect.dose { ok = ok && got.dose.map { Vectors.Dose(was: $0.was, now: $0.now) } == dose }
                if let name = c.expect.medicine_name { ok = ok && got.name == name }
                ok = ok && got.quote == StepsWhen.trim(StepsWhen.spaces(c.quote))
                if let d = got.dose { ok = ok && c.quote.contains(d.was) && c.quote.contains(d.now) }
            } else {
                ok = false
            }
            #expect(ok, "\(c.language): \(c.name) got \(String(describing: got))")
            if ok { passed += 1 }
        }
        // ios-ci reads this line to prove the shared vectors ran.
        print("medicine vectors: \(passed) of \(v.cases.count) equal to the web reference")
    }

    @Test func groupsComeStopFirstAndLeaveOutEmptyRows() {
        let paper = "START taking these medications:\n- metformin 500 mg tablet. Take 1 tablet daily.\nSTOP taking these medications:\n- ibuprofen 200 mg tablet.\nWalk daily."
        let ns = paper as NSString
        func item(_ id: String, _ kind: String, _ quote: String) -> VerifiedItem {
            let r = ns.range(of: quote)
            return VerifiedItem(id: id, kind: kind, title: id, plain_language: id, source_quote: quote,
                                span: TextSpan(start: r.location, end: r.location + r.length))
        }
        let items = [item("met", "medication", "metformin 500 mg tablet. Take 1 tablet daily."),
                     item("ibu", "medication", "ibuprofen 200 mg tablet."), item("walk", "self_care", "Walk daily.")]
        let groups = MedicineChanges.groups(items, paper: paper)
        #expect(groups.map(\.row) == [.stop, .start])
        #expect(groups.flatMap(\.list).map(\.id) == ["ibu", "met"])
        #expect(MedicineChanges.doseWords(.init(was: "10 mg", now: "20 mg")) == "was 10 mg, now 20 mg")
    }

    @Test func englishNumberWordsAndReadingsMatchTheWebsitesExamples() {
        #expect(DoseReadings.englishNumbers("take two tablets") == ["2"])
        #expect(DoseReadings.englishNumbers("one hundred twenty") == ["120"])
        #expect(DoseReadings.englishNumbers("call a doctor").isEmpty)
        #expect(DoseReadings.englishNumbers("a tablet") == ["1"])
        let r = DoseReadings.doseReadings("Take 2 tablets (20 mg total) by mouth once daily. Previously 10 mg once daily.")
        #expect(r.map(\.value) == ["2", "20", "10"])
        #expect(r.map(\.unit) == ["dose", "mass", "mass"])
        #expect(r.last?.previously == true)
    }
}
