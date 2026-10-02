import Foundation
import Testing
@testable import ATLAS

/// Fixtures are real responses CAPTURED FROM THE LIVE API (https://atlas-team12.vercel.app) on 2026-10-02
/// with the labeled sample paper, by mobile/ios/scripts/capture_fixtures.py. They are not hand-written.
enum Fixture {
    static func data(_ name: String) throws -> Data {
        let url = try #require(Bundle(for: BundleToken.self).url(forResource: name, withExtension: "json"))
        return try Data(contentsOf: url)
    }
    final class BundleToken {}
}

struct DecodingTests {
    @Test func decodesLiveExtractResponse() throws {
        let care = try JSONDecoder().decode(CarePlanResponse.self, from: Fixture.data("extract_sample_live"))
        #expect(care.source_kind == "text")
        #expect(care.items.count == care.stats.grounded)
        #expect(care.items.count == 12)
        #expect(care.refused.count == care.stats.refused)
        #expect(care.has_warning_signs)
        #expect(care.items.allSatisfy { $0.grounded && !$0.source_quote.isEmpty })
        #expect(care.items.allSatisfy { $0.itemKind != nil })
        #expect(care.items.contains { $0.itemKind == .warning_sign })

        // Every quote the server kept is found word for word in the text that was sent, at its span.
        for item in care.items {
            let span = try #require(item.span)
            let chars = Array(care.source_text.utf16)
            let slice = String(utf16CodeUnits: Array(chars[span.start..<span.end]), count: span.end - span.start)
            #expect(slice == item.source_quote, "span mismatch for \(item.id)")
        }
        // The text sent was the labeled sample, unchanged.
        #expect(care.source_text == Sample.text)
    }

    @Test func decodesLivePlanResponse() throws {
        let plan = try JSONDecoder().decode(PlanResponse.self, from: Fixture.data("plan_sample_30303_live"))
        #expect(plan.located.by == "zip")
        #expect(plan.located.label == "Near ZIP 30303")
        #expect(plan.steps.count == plan.stats.steps)
        #expect(plan.resources.count == plan.stats.candidates)
        // Every resource a step points to is one the server sent (the server's grounding check).
        for step in plan.steps {
            for id in step.resource_ids { #expect(plan.resources[id] != nil, "missing \(id)") }
        }
        let clinics = plan.resources.values.compactMap { if case let .clinic(_, km, c) = $0 { (km, c) } else { nil } }
        let programs = plan.resources.values.compactMap { if case let .program(_, p) = $0 { p } else { nil } }
        #expect(clinics.count == 4)
        #expect(!programs.isEmpty)
        #expect(clinics.allSatisfy { !$0.1.phone.isEmpty && $0.0 != nil })
        #expect(programs.allSatisfy { !$0.evidence_quote.isEmpty && !$0.source_url.isEmpty })
    }

    @Test func planStepsCiteCareItemsFromTheSameRun() throws {
        let care = try JSONDecoder().decode(CarePlanResponse.self, from: Fixture.data("extract_sample_live"))
        let plan = try JSONDecoder().decode(PlanResponse.self, from: Fixture.data("plan_sample_30303_live"))
        let ids = Set(care.items.map(\.id))
        for step in plan.steps { for id in step.care_ids { #expect(ids.contains(id)) } }
    }

    @Test func resourceCardRoundTrips() throws {
        let plan = try JSONDecoder().decode(PlanResponse.self, from: Fixture.data("plan_sample_30303_live"))
        let again = try JSONDecoder().decode(PlanResponse.self, from: JSONEncoder().encode(plan))
        #expect(again == plan)
    }

    @Test func toleratesExtraAndDefaultedFields() throws {
        let json = """
        {"source_text":"x","items":[{"id":"item-0","kind":"self_care","title":"Walk","plain_language":"Walk daily",
        "source_quote":"Walk 30 minutes","grounded":true,"span":null,"brand_new_field":42}],
        "stats":{"extracted":1,"grounded":1,"refused":0,"ms":5},"unknown":{"a":1}}
        """
        let care = try JSONDecoder().decode(CarePlanResponse.self, from: Data(json.utf8))
        #expect(care.items.first?.why == "")
        #expect(care.items.first?.needs_clarification == false)
        #expect(care.refused.isEmpty)
        #expect(care.has_warning_signs == false)
    }

    @Test func planRequestOmitsMissingLocation() throws {
        let req = PlanRequest(care: [], barriers: [.transport, .cost], zip: "30303", location: nil, language: .English, note: "")
        let obj = try #require(JSONSerialization.jsonObject(with: JSONEncoder().encode(req)) as? [String: Any])
        #expect(obj["zip"] as? String == "30303")
        #expect(obj["location"] == nil)
        #expect(obj["barriers"] as? [String] == ["transport", "cost"])
    }

    @Test func serverErrorsBecomePlainWords() {
        #expect(APIError.from(status: 429, data: Data(#"{"error":"rate"}"#.utf8)) == .message("Too many tries, wait a few minutes."))
        #expect(APIError.from(status: 400, data: Data(#"{"error":"Provide the after-visit summary as text."}"#.utf8))
                == .message("Provide the after-visit summary as text."))
        #expect(APIError.from(status: 502, data: Data("<html>".utf8)) == .message("ATLAS had a problem on its side. Try again in a minute."))
    }

    @Test func serviceAreaMatchesServerBounds() {
        #expect(LatLng(lat: 33.749, lng: -84.388).isInServiceArea)
        #expect(!LatLng(lat: 37.33, lng: -122.03).isInServiceArea)
    }
}
