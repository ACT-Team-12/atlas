package com.stephensookra.atlas.data

/**
 * Helper links: a community health worker, navigator, nurse or family member makes a link that opens ATLAS with the
 * language, reading level and ZIP already picked. A port of web/src/lib/helperLink.ts (parseHelperFragment,
 * helperBanner), with the same allow-lists:
 *
 *   https://atlas-team12.vercel.app/#try&via=helper&lang=es&level=simple&zip=30310
 *
 * `via=helper` marks it as a helper link; the other three are optional. Anything that does not match is ignored,
 * so a broken or tampered link just opens the normal app. Values are compared as raw text (no URL decoding).
 */
data class HelperPresets(val language: Language? = null, val level: ReadingLevel? = null, val zip: String? = null)

data class HelperBanner(val text: String, val langCode: String, val english: String?)

object HelperLink {
    const val HOST = "atlas-team12.vercel.app"

    val LANG_CODE: Map<Language, String> = mapOf(
        Language.English to "en", Language.Spanish to "es", Language.Vietnamese to "vi", Language.Korean to "ko",
        Language.Chinese to "zh", Language.Amharic to "am", Language.French to "fr",
    )
    private val CODE_LANG = LANG_CODE.entries.associate { (l, c) -> c to l }

    /** A real helper link is about 60 characters after the #. Anything far longer is not one of ours. */
    const val MAX_FRAGMENT = 120
    private val KEYS = setOf("via", "lang", "level", "zip")
    private val ZIP_RE = Regex("^[0-9]{5}$")

    /** Sent on the plan built from a helper link, so the judge funnel can count it (web/src/lib/db.ts entryOf). */
    const val ENTRY_HEADER = "x-atlas-entry"
    const val HELPER_ENTRY = "helper-link"

    fun isZip(z: String): Boolean = ZIP_RE.matches(z) && z != "00000"

    /**
     * Reads presets from a URL fragment (with or without the leading #). Null unless this is a helper link (exactly
     * one `via=helper`). Unknown keys, repeated keys and values outside the allow-lists are dropped.
     */
    fun parseFragment(hash: String?): HelperPresets? {
        if (hash.isNullOrEmpty() || hash.length > MAX_FRAGMENT + 1) return null
        val body = if (hash.startsWith("#")) hash.substring(1) else hash
        val seen = mutableMapOf<String, MutableList<String>>()
        for (part in body.split("&")) {
            val eq = part.indexOf('=')
            if (eq <= 0) continue // "try" (the section anchor) or junk
            val key = part.substring(0, eq)
            val value = part.substring(eq + 1)
            if (key !in KEYS) continue
            seen.getOrPut(key) { mutableListOf() }.add(value)
        }
        // A repeated key is ambiguous, so it counts as absent.
        fun one(k: String): String? = seen[k]?.takeIf { it.size == 1 }?.first()
        if (one("via") != "helper") return null
        val language = one("lang")?.let { CODE_LANG[it] }
        val level = one("level")?.let { v -> ReadingLevel.entries.firstOrNull { it.name == v } }
        val zip = one("zip")?.takeIf { isZip(it) }
        return HelperPresets(language, level, zip)
    }

    /**
     * Presets from a link the app was opened with. Only https links to our own host count; the fragment is read
     * raw (still percent-encoded), exactly as the browser's location.hash.
     */
    fun fromLink(scheme: String?, host: String?, rawFragment: String?): HelperPresets? {
        if (scheme != "https" || host != HOST) return null
        return parseFragment(rawFragment)
    }

    private fun localized(language: Language, zip: String?): String = when (language) {
        Language.English -> "Someone helping you set this up in English${zip?.let { " for $it" } ?: ""}. You can change anything."
        Language.Spanish -> "Alguien que le ayuda preparó esto en español${zip?.let { " para el código postal $it" } ?: ""}. Puede cambiar cualquier cosa."
        Language.Vietnamese -> "Một người đang giúp bạn đã cài sẵn bằng tiếng Việt${zip?.let { " cho mã ZIP $it" } ?: ""}. Bạn có thể thay đổi bất cứ điều gì."
        Language.Korean -> "도와주시는 분이 한국어로 설정해 두었습니다${zip?.let { " (우편번호 $it)" } ?: ""}. 무엇이든 바꿀 수 있습니다."
        Language.Chinese -> "帮助您的人已将这里设置为中文${zip?.let { "（邮编 $it）" } ?: ""}。您可以更改任何内容。"
        Language.Amharic -> "የሚረዳዎት ሰው ይህንን በአማርኛ አዘጋጅቶልዎታል${zip?.let { " (ዚፕ ኮድ $it)" } ?: ""}። ማንኛውንም ነገር መቀየር ይችላሉ።"
        Language.French -> "Une personne qui vous aide a préparé ceci en français${zip?.let { " pour le code postal $it" } ?: ""}. Vous pouvez tout modifier."
    }

    /** The banner the person sees: in their language, and in English for whoever is with them. */
    fun banner(p: HelperPresets): HelperBanner {
        val zip = p.zip?.takeIf { isZip(it) }
        val language = p.language
        if (language == null) {
            return HelperBanner("Someone helping you set this up${zip?.let { " for $it" } ?: ""}. You can change anything.", "en", null)
        }
        val english = "Someone helping you set this up in ${language.name}${zip?.let { " for $it" } ?: ""}. You can change anything."
        if (language == Language.English) return HelperBanner(english, "en", null)
        return HelperBanner(localized(language, zip), LANG_CODE.getValue(language), english)
    }
}
