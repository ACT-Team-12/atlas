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
        let model = AppModel(store: try Self.legacyStore())
        #expect(model.stepsLanguage == .Spanish)
        model.applyHelperLink(HelperPresets(language: .Vietnamese))
        #expect(model.careOutdated)
        #expect(model.stepsLanguage == .Spanish, "the Spanish steps are still read in Spanish")
        #expect(model.language == .Vietnamese)
    }

    @Test func planReadAloudIsOffWhileThePlanIsOutdated() throws {
        let model = AppModel(store: try Self.legacyStore(withPlan: true))
        #expect(model.planCanReadAloud)
        model.applyHelperLink(HelperPresets(language: .Vietnamese))
        #expect(model.planOutdated)
        #expect(!model.planCanReadAloud, "a Spanish plan is not read with the newly picked language")
        model.language = .Spanish
        #expect(model.planCanReadAloud, "back to what it was built in")
    }
}
