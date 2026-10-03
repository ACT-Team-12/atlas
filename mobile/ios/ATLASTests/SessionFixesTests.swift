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

    // MARK: Bug 1: a 1.0 plan never looked outdated

    @Test func legacyPlanIsUpToDateUntilAHelperLinkChangesTheLanguage() throws {
        let model = AppModel(store: try Self.legacyStore())
        #expect(model.care != nil)
        #expect(!model.careOutdated, "nothing changed yet")
        model.applyHelperLink(HelperPresets(language: .Vietnamese))
        #expect(model.careOutdated, "the helper link picked another language, so the Spanish steps are outdated")
    }

    @Test func legacyPlanTurnsOutdatedOnAReadingLevelChangeToo() throws {
        let model = AppModel(store: try Self.legacyStore())
        model.applyHelperLink(HelperPresets(level: .detailed))
        #expect(model.careOutdated)
        model.applyHelperLink(HelperPresets(level: .simple))
        #expect(!model.careOutdated, "back to what it was read at")
    }

    @Test func legacyPlanGetsAPlanFingerprintSoAChangedLanguageTurnsItsActionsOff() throws {
        let model = AppModel(store: try Self.legacyStore(withPlan: true))
        #expect(model.plan != nil)
        #expect(!model.planOutdated)
        model.note = "bring my list"
        #expect(model.planOutdated, "a plan input changed after the plan")
        model.note = ""
        #expect(!model.planOutdated)
        model.language = .Korean
        #expect(model.planOutdated)
    }

    @Test func upgradeLeavesNewFilesAloneAndRecordsTheLanguageOnTheSteps() throws {
        let up = try #require(try Self.legacyStore().load()).upgraded()
        #expect(up.care?.language == .Spanish)
        #expect(up.readFingerprint == StaleGuard.readFingerprint(text: up.text, language: .Spanish, level: .simple))
        #expect(up.planFingerprint == nil, "no plan was saved")
        var already = up
        already.readFingerprint = "kept as is"
        already.planFingerprint = "this too"
        #expect(already.upgraded() == already)
        let empty = SavedSession(text: "", language: .English, level: .simple, care: nil, barriers: [], zip: "", note: "",
                                 plan: nil, done: [:], removed: [:], savedAt: Date(timeIntervalSince1970: 1))
        #expect(empty.upgraded() == empty)
    }
}
