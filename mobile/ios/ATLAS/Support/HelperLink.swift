import Foundation

/// The choices a helper link carries. Each one is optional.
struct HelperPresets: Equatable, Sendable {
    var language: Language?
    var level: ReadingLevel?
    var zip: String?
}

/// The note shown after opening a helper link: in the person's language, and in English for whoever is with them.
struct HelperBanner: Equatable, Sendable {
    let text: String
    let langCode: String
    let english: String?
}

/// Helper links: a community health worker, navigator, nurse or family member makes a link that opens ATLAS with the
/// language, reading level and ZIP already picked. A port of web/src/lib/helperLink.ts (parseHelperFragment,
/// helperBanner), with the same allow-lists:
///
///   https://atlas-team12.vercel.app/#try&via=helper&lang=es&level=simple&zip=30310
///
/// `via=helper` marks it as a helper link; the other three are optional. Anything that does not match is ignored,
/// so a broken or tampered link just opens the normal app. Values are compared as raw text (no URL decoding).
enum HelperLink {
    static let host = "atlas-team12.vercel.app"

    static let langCode: [Language: String] = [
        .English: "en", .Spanish: "es", .Vietnamese: "vi", .Korean: "ko", .Chinese: "zh", .Amharic: "am", .French: "fr",
    ]
    private static let codeLang: [String: Language] = Dictionary(uniqueKeysWithValues: langCode.map { ($1, $0) })

    /// A real helper link is about 60 characters after the #. Anything far longer is not one of ours.
    static let maxFragment = 120
    private static let keys: Set<String> = ["via", "lang", "level", "zip"]

    /// Sent on the plan built from a helper link, so the server can count it (web/src/lib/db.ts entryOf).
    static let entryHeader = "x-atlas-entry"
    static let helperEntry = "helper-link"

    static func isZip(_ z: String) -> Bool {
        z.utf8.count == 5 && z.utf8.allSatisfy { $0 >= 48 && $0 <= 57 } && z != "00000"
    }

    /// Reads presets from a URL fragment (with or without the leading #). Nil unless this is a helper link (exactly
    /// one `via=helper`). Unknown keys, repeated keys and values outside the allow-lists are dropped.
    static func parseFragment(_ hash: String?) -> HelperPresets? {
        // JavaScript's string length counts UTF-16 code units, so the cap does too.
        guard let hash, !hash.isEmpty, hash.utf16.count <= maxFragment + 1 else { return nil }
        let body = hash.hasPrefix("#") ? String(hash.dropFirst()) : hash
        var seen: [String: [String]] = [:]
        for part in body.components(separatedBy: "&") {
            guard let eq = part.firstIndex(of: "="), eq != part.startIndex else { continue } // "try" (the section anchor) or junk
            let key = String(part[..<eq])
            let value = String(part[part.index(after: eq)...])
            guard keys.contains(key) else { continue }
            seen[key, default: []].append(value)
        }
        // A repeated key is ambiguous, so it counts as absent.
        func one(_ k: String) -> String? {
            guard let v = seen[k], v.count == 1 else { return nil }
            return v[0]
        }
        guard one("via") == "helper" else { return nil }
        var out = HelperPresets()
        if let l = one("lang") { out.language = codeLang[l] }
        if let l = one("level") { out.level = ReadingLevel(rawValue: l) }
        if let z = one("zip"), isZip(z) { out.zip = z }
        return out
    }

    /// Presets from a link the app was opened with. Only https links to our own host count; the fragment is read raw
    /// (still percent-encoded), exactly as the browser's location.hash.
    static func fromLink(_ url: URL) -> HelperPresets? {
        guard url.scheme?.lowercased() == "https", url.host(percentEncoded: true)?.lowercased() == host else { return nil }
        return parseFragment(url.fragment(percentEncoded: true))
    }

    private static func localized(_ language: Language, zip: String?) -> String {
        switch language {
        case .English: "Someone helping you set this up in English\(zip.map { " for \($0)" } ?? ""). You can change anything."
        case .Spanish: "Alguien que le ayuda preparó esto en español\(zip.map { " para el código postal \($0)" } ?? ""). Puede cambiar cualquier cosa."
        case .Vietnamese: "Một người đang giúp bạn đã cài sẵn bằng tiếng Việt\(zip.map { " cho mã ZIP \($0)" } ?? ""). Bạn có thể thay đổi bất cứ điều gì."
        case .Korean: "도와주시는 분이 한국어로 설정해 두었습니다\(zip.map { " (우편번호 \($0))" } ?? ""). 무엇이든 바꿀 수 있습니다."
        case .Chinese: "帮助您的人已将这里设置为中文\(zip.map { "（邮编 \($0)）" } ?? "")。您可以更改任何内容。"
        case .Amharic: "የሚረዳዎት ሰው ይህንን በአማርኛ አዘጋጅቶልዎታል\(zip.map { " (ዚፕ ኮድ \($0))" } ?? "")። ማንኛውንም ነገር መቀየር ይችላሉ።"
        case .French: "Une personne qui vous aide a préparé ceci en français\(zip.map { " pour le code postal \($0)" } ?? ""). Vous pouvez tout modifier."
        }
    }

    /// helperBanner in helperLink.ts.
    static func banner(_ p: HelperPresets) -> HelperBanner {
        let zip = p.zip.flatMap { isZip($0) ? $0 : nil }
        guard let language = p.language else {
            return HelperBanner(text: "Someone helping you set this up\(zip.map { " for \($0)" } ?? ""). You can change anything.", langCode: "en", english: nil)
        }
        let english = "Someone helping you set this up in \(language.rawValue)\(zip.map { " for \($0)" } ?? ""). You can change anything."
        if language == .English { return HelperBanner(text: english, langCode: "en", english: nil) }
        return HelperBanner(text: localized(language, zip: zip), langCode: langCode[language] ?? "en", english: english)
    }
}
