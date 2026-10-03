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
    var savedAt: Date
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
