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

    @Test(arguments: ["barriers", "zip", "note", "removed"])
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
