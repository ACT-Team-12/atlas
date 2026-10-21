import Foundation
import Testing
@testable import ATLAS

/// A read or plan whose inputs change while it runs (possible while the person looks around) is stopped and its late
/// reply never applied, as on the website (stopStaleRead / stopStalePlan in web/src/ui/CarePlanTool.tsx). These run the
/// real AppModel against the URL stub with a slow reply, in SessionFixesTests' serialized suite (the stub is shared).
extension SessionFixesTests {
    /// Waits long enough for the slow stubbed reply (0.4 s) to have landed, had it not been stopped.
    static func waitPastTheReply() async throws { try await Task.sleep(for: .milliseconds(900)) }

    @Test(arguments: ["text", "language", "level"])
    func aReadWhoseInputsChangeAppliesNothing(change: String) async throws {
        let model = AppModel(api: try Self.stubbedAPI(delay: 0.4), store: try Self.currentStore(withPlan: true))
        let care = model.care, plan = model.plan, fingerprint = model.readFingerprint
        model.done = ["kept": true]
        model.readPaper()
        model.lookingAround = true
        #expect(model.busy == .reading)
        try await Task.sleep(for: .milliseconds(100))
        switch change {
        case "text": model.text += " Drink water."
        case "language": model.language = .French
        default: model.level = .detailed
        }
        #expect(model.busy == nil, "the read stops as soon as an input changes")
        #expect(model.notice == AppModel.readStopped)
        try await Self.waitPastTheReply()
        #expect(model.care == care && model.plan == plan, "the late reply replaced nothing")
        #expect(model.done == ["kept": true], "and cleared nothing")
        #expect(model.readFingerprint == fingerprint && model.readingCount == 0)
        #expect(model.readyCue == nil && model.error == nil)
    }

    @Test(arguments: ["barriers", "zip", "note", "removed", "locating"])
    func aPlanWhoseInputsChangeAppliesNothing(change: String) async throws {
        let model = AppModel(api: try Self.stubbedAPI(delay: 0.4), store: try Self.currentStore(withPlan: true))
        let plan = model.plan, care = model.care
        #expect(model.canPlan)
        model.makePlan()
        model.lookingAround = true
        #expect(model.busy == .planning)
        try await Task.sleep(for: .milliseconds(100))
        switch change {
        case "barriers": model.toggle(.food)
        case "zip": model.zip = "30310"
        case "note": model.note = "I work nights"
        case "locating": model.locating = true // "Use my location" started; the new place is not known yet
        default: model.removed[try #require(care?.items.first?.id)] = true
        }
        #expect(model.busy == nil, "the plan stops as soon as an input changes")
        #expect(model.notice == AppModel.planStopped)
        try await Self.waitPastTheReply()
        #expect(model.plan == plan && model.care == care, "the late reply replaced nothing")
        #expect(model.planCount == 0 && model.readyCue == nil && model.error == nil)
    }

    /// A change to an input the read does not use (a plan input) leaves the read running, and its reply lands as usual.
    @Test func aRepliedReadAfterNoChangeStillApplies() async throws {
        let model = AppModel(api: try Self.stubbedAPI(delay: 0.2), store: try Self.currentStore())
        model.readPaper()
        model.lookingAround = true
        model.zip = "30310" // a plan input: never stops a read
        for _ in 0..<400 where model.busy != nil { try await Task.sleep(for: .milliseconds(25)) }
        #expect(model.notice == nil && model.readingCount == 1, "the read landed")
        #expect(model.readyCue == .steps, "and, looked around, it raised the cue")
    }
}

extension SessionFixesTests {
    @Test func noPlanStartsWhileTheLocationIsBeingFound() throws {
        let model = AppModel(api: try Self.stubbedAPI(), store: try Self.currentStore())
        model.barriers = [.cost]
        #expect(model.canPlan)
        model.locating = true
        #expect(!model.canPlan)
        model.makePlan()
        #expect(model.busy == nil)
        model.locating = false
        #expect(model.canPlan)
    }
}

extension SessionFixesTests {
    /// A ZIP typed while "Use my location" runs wins: the late location result changes nothing.
    @Test func aZipTypedDuringALookupWinsOverItsLateResult() throws {
        let model = AppModel(api: try Self.stubbedAPI(), store: try Self.currentStore())
        let run = model.beginLocating()
        #expect(model.locating)
        model.typeZip("30310")
        #expect(!model.locating, "typing a ZIP ends the lookup")
        model.finishLocating(run, point: LatLng(lat: 33.75, lng: -84.39))
        #expect(model.zip == "30310" && model.location == nil, "the late result did not overwrite the ZIP")
        #expect(!model.locating)
    }

    /// A newer lookup replaces an older one: only the newest result is applied.
    @Test func onlyTheNewestLookupApplies() throws {
        let model = AppModel(api: try Self.stubbedAPI(), store: try Self.currentStore())
        let first = model.beginLocating()
        let second = model.beginLocating()
        model.finishLocating(first, point: LatLng(lat: 33.0, lng: -84.0))
        #expect(model.location == nil && model.locating)
        model.finishLocating(second, point: LatLng(lat: 33.75, lng: -84.39))
        #expect(model.location == LatLng(lat: 33.75, lng: -84.39) && model.zip.isEmpty && !model.locating)
    }
}

extension SessionFixesTests {
    /// A replaced lookup's failure is not shown: the ZIP typed meanwhile (or a newer lookup) is what counts.
    @Test func aReplacedLookupsFailureIsNotShown() throws {
        let model = AppModel(api: try Self.stubbedAPI(), store: try Self.currentStore())
        let old = model.beginLocating()
        model.typeZip("30310")
        model.finishLocating(old, point: nil, failure: "outside")
        #expect(model.error == nil && model.zip == "30310")
        let first = model.beginLocating()
        let second = model.beginLocating()
        model.finishLocating(first, point: nil, failure: "unavailable")
        #expect(model.error == nil && model.locating)
        model.finishLocating(second, point: nil, failure: "outside")
        #expect(model.error == "outside" && !model.locating, "the current lookup's failure is shown")
    }
}
