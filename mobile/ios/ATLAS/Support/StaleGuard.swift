import Foundation

/// The outdated-plan guard from web/src/lib/staleGuard.ts. A read and a plan remember a fingerprint of what was sent;
/// when the inputs change afterwards (the text, a step removed, a barrier, the language, the note, the place), what
/// is on screen no longer matches them, so its actions are turned off until it is updated.
enum StaleGuard {
    /// "device" when the device location is used, otherwise the valid ZIP sent (or "").
    static func place(location: LatLng?, zip: String) -> String {
        if location != nil { return "device" }
        return zip.range(of: #"^\d{5}$"#, options: .regularExpression) != nil ? zip : ""
    }

    /// Order-free for barriers, exact everywhere else (planFingerprint).
    static func planFingerprint(careIds: [String], barriers: [Barrier], language: Language, note: String, place: String,
                                location: LatLng?) -> String {
        let loc: Any = location.map { [num($0.lat), num($0.lng)] as [Any] } ?? NSNull()
        let parts: [Any] = [careIds, barriers.map(\.rawValue).sorted(), language.rawValue, note, place, loc]
        return json(parts)
    }

    /// The steps on screen came from this text, language and reading level.
    static func readFingerprint(text: String, language: Language, level: ReadingLevel) -> String {
        json([text, language.rawValue, level.rawValue])
    }

    /// -0 is 0 and anything not a finite number is null, like normalLocation in staleGuard.ts.
    private static func num(_ x: Double) -> Any { x.isFinite ? (x + 0.0) as Any : NSNull() }

    private static func json(_ parts: [Any]) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: parts, options: [.sortedKeys]),
              let s = String(data: data, encoding: .utf8) else { return UUID().uuidString } // never equal: shows as outdated
        return s
    }
}
