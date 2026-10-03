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

    /// What a loaded file can honestly say about where its steps and plan came from. Provenance is never invented: a
    /// file saved by the 1.0 app has no fingerprints, and 1.0 saved the text, language and reading level after every
    /// edit, so the saved inputs may be later than the ones the steps were read with. Such a file keeps its missing
    /// fingerprints, and AppModel treats missing provenance as outdated until the person reads (and plans) again.
    /// The only thing recovered is the steps' language, and only from a read fingerprint that encodes it (a 1.1 file
    /// whose server did not send the language). Otherwise it stays unknown, so the steps are never read in a wrong voice.
    func upgraded() -> SavedSession {
        var s = self
        if var c = s.care, c.language == nil, let fp = readFingerprint, let lang = StaleGuard.language(inReadFingerprint: fp) {
            c.language = lang
            s.care = c
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
