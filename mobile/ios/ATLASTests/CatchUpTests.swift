import Foundation
import Testing
@testable import ATLAS

/// Tests for the features the phone apps gained to match the website on Oct 2: lab results, Send to family,
/// nationwide clinics, and Add to my calendar. Fixtures are real responses captured from the live API.
struct CatchUpTests {
    @Test func decodesLiveLabResults() throws {
        let r = try JSONDecoder().decode(ResultsResponse.self, from: Fixture.data("results_sample_live"))
        #expect(r.counts.outside == 5 && r.counts.inside == 5 && r.counts.unknown == 0)
        #expect(r.rows.count == 10)
        // Every row quotes a line that is really in the labeled sample report.
        for row in r.rows { #expect(LabSample.text.contains(row.quote)) }
        let glucose = try #require(r.rows.first { $0.test.hasPrefix("Glucose") })
        #expect(glucose.status == "outside" && glucose.direction == "high")
    }

    @Test func labSampleMatchesWebSource() throws {
        let here = URL(fileURLWithPath: #filePath)
        let web = here.deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().appendingPathComponent("web/src/lib/sampleLabs.ts")
        let src = try String(contentsOf: web, encoding: .utf8)
        #expect(src.contains(LabSample.text))
    }

    @Test func decodesNationwidePlanOutsideGeorgia() throws {
        let p = try JSONDecoder().decode(PlanResponse.self, from: Fixture.data("plan_sample_43215_live"))
        #expect(p.located.label == "Near ZIP 43215")
        var clinics = 0
        for card in p.resources.values {
            switch card {
            case let .clinic(_, km, c):
                clinics += 1
                #expect(c.city.hasSuffix(", OH"))
                #expect((km ?? 999) <= 60)
                // Directions keep the clinic's own state, never Georgia.
                let url = Links.transit(to: c).absoluteString.removingPercentEncoding ?? ""
                #expect(url.contains("Columbus, OH") && !url.contains(", GA "))
            case let .program(id, _):
                #expect(!id.hasPrefix("marta") && !id.hasPrefix("georgia") && !id.hasPrefix("grady"))
            }
        }
        #expect(clinics >= 1)
    }

    @Test func shareTextCarriesTheLineFromThePaperAndOnlyUsedResources() throws {
        let care = try JSONDecoder().decode(CarePlanResponse.self, from: Fixture.data("extract_sample_live"))
        let plan = try JSONDecoder().decode(PlanResponse.self, from: Fixture.data("plan_sample_43215_live"))
        let text = ShareText.plan(items: care.items, plan: plan, questions: care.questions_for_doctor)
        let groundedCount = care.items.filter(\.grounded).count
        // Each grounded step carries its line once in the paper part; plan steps carry their own quotes after it.
        let paperPart = try #require(text.components(separatedBy: "WHAT THE PAPER SAYS TO DO").last?
            .components(separatedBy: "THE PLAN (").first)
        #expect(paperPart.components(separatedBy: "Your paper says: \"").count - 1 == groundedCount)
        for item in care.items where item.grounded { #expect(text.contains(item.source_quote)) }
        let used = Set(plan.steps.flatMap(\.resource_ids))
        for (id, card) in plan.resources {
            if case let .clinic(_, _, c) = card { #expect(text.contains(c.name) == used.contains(id)) }
        }
        #expect(text.hasSuffix("If something feels urgent, call the clinic or 911."))
    }

    @Test func calendarDraftCarriesQuoteAndTwoReminders() {
        let start = Date(timeIntervalSince1970: 1_800_000_000)
        let d = CalendarDraft(title: "Fasting blood test", start: start, quote: "Return for basic metabolic panel within 2 weeks.", detail: "Call the clinic to book.")
        #expect(d.end.timeIntervalSince(start) == 3600)
        #expect(d.notes.contains("Your paper says: \"Return for basic metabolic panel within 2 weeks.\""))
        #expect(d.alarmOffsets == [-86400, -7200])
        let noQuote = CalendarDraft(title: "Apply", start: start, quote: "", detail: "")
        #expect(!noQuote.notes.contains("Your paper says"))
    }

    @Test func labHeadlineNeverClaimsAnAllClearWithoutFullCoverage() throws {
        func r(_ json: String) throws -> ResultsResponse { try JSONDecoder().decode(ResultsResponse.self, from: Data(json.utf8)) }
        let row = #"{"test":"Sodium","value":"139","unit":"mmol/L","range_text":"136-145","quote":"Sodium 139","plain_name":"x","ask":"y","status":"inside","direction":null,"reason":"z"}"#
        let base = #""dropped":[],"model":"m","ms":1,"counts":{"outside":0,"inside":1,"unknown":0}"#
        #expect(try r(#"{"rows":[],"dropped":[],"model":"m","ms":1,"counts":{"outside":0,"inside":0,"unknown":0}}"#).headline.hasPrefix("We couldn't read any results"))
        #expect(try r("{\"rows\":[\(row)],\(base)}").headline.hasPrefix("None of the results we read")) // older server, no coverage
        #expect(try r("{\"rows\":[\(row)],\(base),\"coverage\":{\"candidates\":3,\"checked\":1,\"unchecked\":[\"a\",\"b\"]}}").headline == "We checked 1 of 3 result lines. None of the ones we checked is outside its range.")
        #expect(try r("{\"rows\":[\(row)],\(base),\"coverage\":{\"candidates\":1,\"checked\":1,\"unchecked\":[]}}").headline == "Nothing on this report is marked or printed as outside its range.")
    }

    @Test func serviceAreaIsTheWholeUS() {
        #expect(LatLng(lat: 39.96, lng: -83.0).isInServiceArea) // Columbus, OH
        #expect(LatLng(lat: 13.44, lng: 144.79).isInServiceArea) // Guam
        #expect(!LatLng(lat: 80, lng: 0).isInServiceArea)
    }
}
