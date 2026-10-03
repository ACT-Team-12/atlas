import Foundation

/// What is kept on this phone between launches. Location is never saved.
struct SavedSession: Codable, Equatable, Sendable {
    var text: String
    var language: Language
    var level: ReadingLevel
    var care: CarePlanResponse?
    var barriers: [Barrier]
    var zip: String
    var note: String
    var plan: PlanResponse?
    var done: [String: Bool]
    var removed: [String: Bool]
    /// The second-model double-check for `care`. Nil in files saved by older versions: then every step is unchecked.
    var meaning: MeaningState?
    /// What the steps were read from and what the plan was built from (StaleGuard). Nil in older files.
    var readFingerprint: String?
    var planFingerprint: String?
    /// When the steps or the plan last changed (a read, a plan, a step done, removed or restored). Changing the language,
    /// reading level, ZIP, note or barriers, or opening a helper link, keeps it, so "Welcome back" shows when the plan
    /// was made.
    var savedAt: Date

    /// A file saved by the 1.0 app has no fingerprints and its steps carry no language, so the outdated note could never
    /// show. Rebuild both from what was saved: the steps were read from the saved text at the saved language and reading
    /// level (1.0 saved the inputs every time they changed, so these are the last ones entered, the best record there
    /// is), and the plan from the steps still kept, the barriers, the note and the ZIP (the device location is never
    /// saved). Files that already carry fingerprints come back unchanged.
    func upgraded() -> SavedSession {
        var s = self
        if var c = s.care, c.language == nil {
            c.language = language
            s.care = c
        }
        if s.readFingerprint == nil, let c = s.care {
            s.readFingerprint = StaleGuard.readFingerprint(text: text, language: c.language ?? language, level: level)
        }
        if s.planFingerprint == nil, s.plan != nil {
            let kept = (s.care?.items ?? []).filter { removed[$0.id] != true }.map(\.id)
            s.planFingerprint = StaleGuard.planFingerprint(careIds: kept, barriers: barriers, language: s.care?.language ?? language,
                                                           note: note, place: StaleGuard.place(location: nil, zip: zip), location: nil)
        }
        return s
    }
}

/// Codable JSON in Application Support, excluded from iCloud backup, protected while the phone is locked.
struct SessionStore: Sendable {
    let url: URL

    init(directory: URL? = nil) {
        let dir = directory ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("ATLAS", isDirectory: true)
        url = dir.appendingPathComponent("session-v1.json")
    }

    func load() -> SavedSession? {
        guard let data = try? Data(contentsOf: url) else { return nil }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return try? decoder.decode(SavedSession.self, from: data)
    }

    func save(_ session: SavedSession) throws {
        let dir = url.deletingLastPathComponent()
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        let data = try encoder.encode(session)
        try data.write(to: url, options: [.atomic, .completeFileProtection])
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        var u = url
        try? u.setResourceValues(values)
    }

    func clear() {
        try? FileManager.default.removeItem(at: url)
    }
}
