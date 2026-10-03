import Foundation
import Testing
@testable import ATLAS

/// Bugs found on Android's emulator in 1.1 and confirmed in the iPhone code, each run through the real AppModel against
/// a saved file on disk (no network: a file without a running double-check starts none).
@MainActor
struct SessionFixesTests {
    static let legacySavedAt = "2026-09-01T12:00:00Z"
    static var legacyDate: Date { ISO8601DateFormatter().date(from: legacySavedAt)! }

    /// A care response as the live server sends it, minus `language` and `missed_lines` (the 1.0 app's model had
    /// neither field, so it never saved them).
    static func legacyCare() throws -> [String: Any] {
        var care = try #require(JSONSerialization.jsonObject(with: Fixture.data("extract_sample_live")) as? [String: Any])
        care["language"] = nil
        care["missed_lines"] = nil
        return care
    }

    /// What the 1.0 app wrote: no fingerprints, no meaning state, care without a language.
    static func legacyStore(withPlan: Bool = false) throws -> SessionStore {
        var saved: [String: Any] = [
            "text": "Take metformin 500 mg twice a day with meals. Call 911 for chest pain.",
            "language": "Spanish", "level": "simple", "care": try legacyCare(), "barriers": ["cost"], "zip": "30303",
            "note": "", "done": [String: Bool](), "removed": [String: Bool](), "savedAt": legacySavedAt,
        ]
        if withPlan {
            saved["plan"] = try JSONSerialization.jsonObject(with: Fixture.data("plan_sample_30303_live"))
        }
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let store = SessionStore(directory: dir)
        try JSONSerialization.data(withJSONObject: saved).write(to: store.url)
        #expect(store.load()?.readFingerprint == nil, "really a 1.0-shaped file")
        return store
    }

    /// What 1.1 and later write: fingerprints for the read and the plan, made from the inputs at that moment.
    static func currentStore(withPlan: Bool = false, careLanguage: Language? = .Spanish, readFingerprint: String? = nil) throws -> SessionStore {
        var careJSON = try legacyCare()
        if let careLanguage { careJSON["language"] = careLanguage.rawValue }
        let care = try JSONDecoder().decode(CarePlanResponse.self, from: JSONSerialization.data(withJSONObject: careJSON))
        let text = "Take metformin 500 mg twice a day with meals. Call 911 for chest pain."
        let plan = withPlan ? try JSONDecoder().decode(PlanResponse.self, from: Fixture.data("plan_sample_30303_live")) : nil
        let session = SavedSession(
            text: text, language: .Spanish, level: .simple, care: care, barriers: [.cost], zip: "30303", note: "",
            plan: plan, done: [:], removed: [:], meaning: nil,
            readFingerprint: readFingerprint ?? StaleGuard.readFingerprint(text: text, language: .Spanish, level: .simple),
            planFingerprint: withPlan ? StaleGuard.planFingerprint(careIds: care.items.map(\.id), barriers: [.cost], language: .Spanish,
                                                                   note: "", place: "30303", location: nil) : nil,
            savedAt: legacyDate)
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let store = SessionStore(directory: dir)
        try store.save(session)
        return store
    }

    // MARK: Bug 1: a 1.0 plan never looked outdated. It now loads outdated: its provenance is unknown, never invented.

    @Test func legacyFileLoadsOutdated() throws {
        let model = AppModel(store: try Self.legacyStore(withPlan: true))
        #expect(model.care != nil && model.plan != nil)
        #expect(model.provenanceUnknown)
        #expect(model.careOutdated, "1.0 kept no record of what the steps were read from")
        #expect(model.planOutdated)
        #expect(!model.planCanReadAloud, "plan read aloud off")
        #expect(!model.canPlan, "plan actions off until the paper is read again")
        #expect(model.stepsLanguage == nil, "unknown language: no voice rather than a wrong one")
    }

    @Test func legacyFileStaysOutdatedWhateverTheInputsBecome() throws {
        let store = try Self.legacyStore(withPlan: true)
        let model = AppModel(store: store)
        model.applyHelperLink(HelperPresets(language: .Vietnamese, level: .detailed))
        #expect(model.careOutdated && model.planOutdated)
        model.language = .Spanish
        model.level = .simple
        #expect(model.careOutdated && model.planOutdated, "back to the saved inputs is still not proof of what was read")
        let saved = try #require(store.load())
        #expect(saved.readFingerprint == nil && saved.planFingerprint == nil, "no invented provenance is written to disk")
        #expect(saved.care?.language == nil)
        #expect(AppModel(store: store).careOutdated, "and the next launch still says so")
    }

    @Test func readingAgainClearsIt() async throws {
        StubProtocol.extract = try Fixture.data("extract_sample_live")
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [StubProtocol.self]
        let store = try Self.legacyStore(withPlan: true)
        let model = AppModel(api: APIClient(session: URLSession(configuration: config)), store: store)
        #expect(model.careOutdated)
        model.readPaper()
        for _ in 0..<400 where model.busy != nil { try await Task.sleep(for: .milliseconds(25)) }
        #expect(model.busy == nil && model.error == nil)
        #expect(!model.careOutdated && !model.provenanceUnknown)
        #expect(model.plan == nil, "a new read clears the old plan")
        #expect(model.stepsLanguage == .Spanish, "the language it was read in")
        let saved = try #require(store.load())
        #expect(saved.readFingerprint == StaleGuard.readFingerprint(text: model.text, language: .Spanish, level: .simple))
        #expect(saved.care?.language == .Spanish)
    }

    @Test func aFileWithAReadFingerprintRecoversTheStepsLanguageFromIt() throws {
        // A 1.1 file whose server sent no language; the person then picked Vietnamese (saved after the read).
        let store = try Self.currentStore(careLanguage: nil)
        var s = try #require(store.load())
        s.language = .Vietnamese
        try store.save(s)
        let model = AppModel(store: store)
        #expect(model.stepsLanguage == .Spanish, "from the fingerprint, not the later saved language")
        #expect(model.careOutdated)
        #expect(!model.provenanceUnknown)
    }

    @Test func aFingerprintThatEncodesNoKnownLanguageLeavesItUnknown() throws {
        let model = AppModel(store: try Self.currentStore(careLanguage: nil, readFingerprint: "[\"x\",\"Klingon\",\"simple\"]"))
        #expect(model.stepsLanguage == nil)
        #expect(model.careOutdated)
        #expect(StaleGuard.language(inReadFingerprint: "not json") == nil)
        #expect(StaleGuard.language(inReadFingerprint: StaleGuard.readFingerprint(text: "t", language: .Korean, level: .detailed)) == .Korean)
    }

    @Test func upgradeNeverInventsFingerprints() throws {
        let legacy = try #require(try Self.legacyStore(withPlan: true).load())
        let up = legacy.upgraded()
        #expect(up == legacy, "nothing is reconstructed from the latest saved inputs")
        let current = try #require(try Self.currentStore(withPlan: true).load())
        #expect(current.upgraded() == current)
    }

    // MARK: Bug 2: opening a helper link moved the saved time

    @Test func helperLinkAndInputChangesKeepTheSavedTime() throws {
        let store = try Self.legacyStore()
        let model = AppModel(store: store)
        #expect(model.restoredAt == Self.legacyDate)
        model.applyHelperLink(HelperPresets(language: .Vietnamese, level: .standard, zip: "30310"))
        model.note = "bring my list"
        model.toggle(.transport)
        let saved = try #require(store.load())
        #expect(saved.language == .Vietnamese, "the presets were saved")
        #expect(saved.zip == "30310" && saved.note == "bring my list" && saved.barriers.contains(.transport))
        #expect(saved.savedAt == Self.legacyDate, "but the plan's time was not touched")
        #expect(AppModel(store: store).restoredAt == Self.legacyDate, "the next launch still says when the plan was made")
    }

    @Test func aRealPlanChangeMovesTheSavedTime() throws {
        let store = try Self.legacyStore()
        let model = AppModel(store: store)
        let id = try #require(model.items.first?.id)
        model.removed[id] = true
        let afterRemove = try #require(store.load()).savedAt
        #expect(afterRemove > Self.legacyDate, "removing a step moves it")
        model.removed[id] = nil
        #expect(try #require(store.load()).savedAt >= afterRemove, "restoring it moves it too")
        let other = try #require(model.items.last?.id)
        let doneStore = try Self.legacyStore()
        AppModel(store: doneStore).done[other] = true
        #expect(try #require(doneStore.load()).savedAt > Self.legacyDate, "marking a step done moves it")
    }

    // MARK: Bug 3: read aloud followed the new language

    @Test func readAloudUsesTheLanguageTheStepsWereWrittenIn() throws {
        let model = AppModel(store: try Self.currentStore())
        #expect(!model.careOutdated)
        #expect(model.stepsLanguage == .Spanish)
        model.applyHelperLink(HelperPresets(language: .Vietnamese))
        #expect(model.careOutdated)
        #expect(model.stepsLanguage == .Spanish, "the Spanish steps are still read in Spanish")
        #expect(model.language == .Vietnamese)
    }

    @Test func planReadAloudIsOffWhileThePlanIsOutdated() throws {
        let model = AppModel(store: try Self.currentStore(withPlan: true))
        #expect(model.planCanReadAloud)
        model.applyHelperLink(HelperPresets(language: .Vietnamese))
        #expect(model.planOutdated)
        #expect(!model.planCanReadAloud, "a Spanish plan is not read with the newly picked language")
        model.language = .Spanish
        #expect(model.planCanReadAloud, "back to what it was built in")
    }
}

/// Answers /api/extract with a captured live response and everything else (the double-check) with 503. No network.
final class StubProtocol: URLProtocol, @unchecked Sendable {
    nonisolated(unsafe) static var extract = Data()

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        let isExtract = request.url?.path == "/api/extract"
        let response = HTTPURLResponse(url: request.url!, statusCode: isExtract ? 200 : 503, httpVersion: nil,
                                       headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: isExtract ? Self.extract : Data("{}".utf8))
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}
