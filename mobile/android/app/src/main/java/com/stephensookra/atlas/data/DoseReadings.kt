package com.stephensookra.atlas.data

import java.text.Normalizer

/** Compiles a pattern with the website's meaning of \s, \d and the "i" flag (SafetyPattern does the rewriting). */
internal fun jsRegex(source: String, flags: String = "iu"): Regex = SafetyPattern(source, flags).regex()

/**
 * The number readings the medicine card's dose rule depends on, ported from web/src/lib/textReading.ts (readable),
 * web/src/lib/numberWords.ts (English number words) and web/src/lib/meaning.ts (numberUnits, doseReadings). Only the
 * English reading is ported, because doseReadings reads English only. MedicineChangesTest checks the result through the
 * shared medicine vectors.
 */
object DoseReadings {
    // ---- readable (textReading.ts)

    /** Unicode compatibility form, no-break spaces as spaces, curly apostrophes and quotes as straight ones, dashes as "-". */
    fun readable(text: String): String {
        val sb = StringBuilder()
        Normalizer.normalize(text, Normalizer.Form.NFKC).codePoints().forEach { c ->
            when (c) {
                0x00A0, 0x2007, 0x202F -> sb.append(' ')
                0x2018, 0x2019, 0x201B, 0x2032, 0x02BC, 0xFF07 -> sb.append('\'')
                0x201C, 0x201D, 0x2033 -> sb.append('"')
                in 0x2010..0x2015, 0x2212 -> sb.append('-')
                else -> sb.appendCodePoint(c)
            }
        }
        return sb.toString()
    }

    // ---- English number words (numberWords.ts, readLatin with EN_LEX)

    private sealed interface Tok {
        data class N(val v: Int, val article: Boolean) : Tok
        data class Mul(val v: Int) : Tok
        data object Conn : Tok
    }

    private val EN: Map<String, Int> = mapOf(
        "zero" to 0, "one" to 1, "two" to 2, "three" to 3, "four" to 4, "five" to 5, "six" to 6, "seven" to 7, "eight" to 8,
        "nine" to 9, "ten" to 10, "eleven" to 11, "twelve" to 12, "thirteen" to 13, "fourteen" to 14, "fifteen" to 15,
        "sixteen" to 16, "seventeen" to 17, "eighteen" to 18, "nineteen" to 19, "twenty" to 20, "thirty" to 30, "forty" to 40,
        "fifty" to 50, "sixty" to 60, "seventy" to 70, "eighty" to 80, "ninety" to 90, "once" to 1, "twice" to 2,
    )

    /** NAME_BEFORE_LETTER: words before a letter that is a name, not "a" ("vitamin A", "type A"). */
    val NAME_BEFORE_LETTER = jsRegex("""^(?:vitamin|vitamins|hepatitis|hep|type|class|grade|stage|group|plan|part|step|schedule|category|level|phase|section|form|option|list|blood|strep|influenza|flu|size|ward|wing|building|suite|room|floor|zone|area|track|lot)$""", "")
    private val EN_COUNT = jsRegex("""^(?:tablets?|pills?|capsules?|doses?|times?|drops?|puffs?|minutes?|seconds?|hours?|days?|weeks?|months?|years?|mg|mcg|g|ml|l|grams?|liters?|litres?|ounces?|oz|units?|patch(?:es)?|injections?|cups?|glasses?|bottles?|packets?|spoons?|teaspoons?|tablespoons?)$""", "")
    private val NOT_ARTICLE_AFTER = jsRegex("""^(?:once|twice|times?|half|quarter|per|every|each|and)$""", "")
    private val LETTERS = jsRegex("""\p{L}+""", "u")
    private val JOINER = jsRegex("""^[\s\-–]*$""", "u")

    private fun enWord(w: String, prev: String?, next: String?): Tok? {
        if (w == "hundred") return Tok.Mul(100)
        if (w == "thousand") return Tok.Mul(1000)
        if (w == "and") return Tok.Conn
        if (w == "a" && (next == "hundred" || next == "thousand")) return Tok.N(1, false)
        if ((w == "a" || w == "an") && !NOT_ARTICLE_AFTER.containsMatchIn(prev ?: "") && !NAME_BEFORE_LETTER.containsMatchIn(prev ?: "")) {
            return Tok.N(1, true)
        }
        return EN[w]?.let { Tok.N(it, false) }
    }

    /** The smallest non-zero place of n (120 gives 10, 200 gives 100, 7 gives 1). */
    private fun place(n: Int): Int { var p = 1; while (n > 0 && n % (p * 10) == 0) p *= 10; return p }

    private fun compose(toks: List<Tok>): Int? {
        var total = 0; var cur = 0; var any = false
        for (t in toks) {
            when (t) {
                Tok.Conn -> continue
                is Tok.Mul -> {
                    if (t.v == 1000) { total += (if (cur == 0) 1 else cur) * 1000; cur = 0; any = true; continue }
                    val low = cur % t.v
                    cur = cur - low + (if (low == 0) 1 else low) * t.v
                    any = true
                }
                is Tok.N -> {
                    if (!any) { cur = t.v; any = true; continue }
                    if (!(cur == 0 || t.v < place(cur))) return null
                    cur += t.v
                }
            }
        }
        return if (any) total + cur else null
    }

    /** The English number words in `text`, as digit strings, in the order first read, each once. */
    fun englishNumbers(text: String): List<String> {
        val t = text.lowercase()
        data class W(val w: String, val at: Int, val end: Int)
        val words = LETTERS.findAll(t).map { W(it.value, it.range.first, it.range.last + 1) }.toList()
        val out = LinkedHashSet<String>()
        var i = 0
        while (i < words.size) {
            val prev = if (i > 0) words[i - 1].w else null
            val first = enWord(words[i].w, prev, words.getOrNull(i + 1)?.w)
            if (first == null || first == Tok.Conn) { i++; continue }
            val run = mutableListOf(first)
            var j = i + 1
            while (j < words.size && JOINER.containsMatchIn(t.substring(words[j - 1].end, words[j].at))) {
                val tok = enWord(words[j].w, words[j - 1].w, words.getOrNull(j + 1)?.w) ?: break
                run.add(tok)
                j++
            }
            while (run.isNotEmpty() && run.last() == Tok.Conn) { run.removeAt(run.lastIndex); j-- }
            val nextWord = words.getOrNull(j)?.w ?: ""
            val single = run.singleOrNull() as? Tok.N
            if (single?.article == true && !EN_COUNT.containsMatchIn(nextWord)) { i = j; continue }
            compose(run)?.let { out.add(it.toString()) }
            i = j
        }
        return out.toList()
    }

    // ---- numberUnits and doseReadings (meaning.ts)

    private val UNIT_CLASSES: List<Pair<String, Regex>> = listOf(
        "dose" to """^(?:tablets?|pills?|capsules?|puffs?|drops?|doses?|patch(?:es)?|injections?|units?|sprays?|tabletas?|pastillas?|c[áa]psulas?|comprimidos?|gotas?|inhalaci[óo]n|inhalaciones|unidades|unidad|parches?|comprim[ée]s?|pilules?|g[ée]lules?|cachets?|gouttes?|bouff[ée]es?|unit[ée]s?|viên|giọt|nhát|liều|miếng)$""",
        "mass" to """^(?:mg|mcg|g|grams?|milligrams?|micrograms?|gramos?|miligramos?|grammes?|milligrammes?|gam)$""",
        "volume" to """^(?:ml|l|oz|ounces?|cups?|glass(?:es)?|liters?|litres?|teaspoons?|tablespoons?|tsp|tbsp|tazas?|vasos?|onzas?|litros?|cucharadas?|cucharaditas?|verres?|tasses?|onces?|cuill[èe]res?|cốc|ly|lít|muỗng|thìa)$""",
        "minute" to """^(?:minutes?|mins?|minutos?|phút)$""",
        "hour" to """^(?:hours?|hrs?|horas?|heures?|giờ)$""",
        "day" to """^(?:days?|d[íi]as?|jours?|ngày)$""",
        "week" to """^(?:weeks?|semanas?|semaines?|tuần)$""",
        "month" to """^(?:months?|mes|meses|mois|tháng)$""",
        "times" to """^(?:times?|x|vez|veces|fois|lần)$""",
        "ratio" to """^(?:parts?|partes?|parties?|phần)$""",
        "clock" to """^(?:am|pm|a\.m\.?|p\.m\.?|o'clock|o’clock|h)$""",
    ).map { it.first to jsRegex(it.second, "u") }
    private val CJK_UNIT_CLASSES: List<Pair<String, Regex>> = listOf(
        "dose" to "^(?:片|粒|颗|顆|알|정|캡슐|방울)", "mass" to "^(?:毫克|밀리그램)", "volume" to "^(?:毫升|杯|밀리리터|컵|잔)",
        "minute" to "^(?:分钟|分鐘|분)", "hour" to "^(?:小时|小時|시간)", "day" to "^(?:天|日|일)", "week" to "^(?:周|週|星期|주)",
        "month" to "^(?:个月|個月|개월|달)", "times" to "^(?:次|회|번)", "clock" to "^(?:点|點|시)",
    ).map { it.first to jsRegex(it.second, "u") }

    fun unitClass(word: String?): String? {
        if (word.isNullOrEmpty()) return null
        val w = word.lowercase()
        UNIT_CLASSES.firstOrNull { it.second.containsMatchIn(w) }?.let { return it.first }
        CJK_UNIT_CLASSES.firstOrNull { it.second.containsMatchIn(w) }?.let { return it.first }
        return null
    }

    private val CONTEXT_STOP = setOf(
        "take", "use", "give", "apply", "inhale", "drink", "eat", "the", "a", "an", "and", "or", "of", "with", "by", "at", "to",
        "for", "your", "then", "also", "every", "each", "per", "total", "daily", "once", "twice", "mouth", "in", "on", "is",
        "it", "you", "should", "please", "do", "not", "start", "stop", "continue", "keep", "inject", "swallow", "chew",
        "spray", "insert", "place", "put", "mix", "dissolve", "measure", "now",
    )
    private val SAME_NAME = mapOf("pill" to "tablet", "pills" to "tablet", "tablet" to "tablet", "tablets" to "tablet",
        "previously" to "previously", "formerly" to "previously")
    val ALIAS_NAMES: Set<String> = SAME_NAME.values.toSet()
    private val PERSON = setOf("you", "i", "we", "they", "he", "she")

    private fun nameOf(w: String, prev: String?, next: String?): String =
        if (w == "used" && next?.lowercase() == "to" && (prev?.lowercase() ?: "") in PERSON) "previously" else SAME_NAME[w] ?: w

    private val TOKENS = jsRegex("""\d{3}[-.]\d{3}[-.]\d{4}|\d{1,2}:\d{2}|\d+(?:st|nd|rd|th)(?![\p{L}\p{M}])|\d+(?:[.,]\d+)*(?:\s*[/⁄∕]\s*\d+)?|[ap]\.\s?m\.?|[\p{L}\p{M}]+""", "giu")
    private val STARTS_DIGIT = jsRegex("""^\d""", "")
    private val CLOCK_TOK = jsRegex("""^\d{1,2}:\d{2}$""", "")
    private val PHONE_TOK = jsRegex("""^\d{3}[-.]\d{3}[-.]\d{4}$""", "")
    private val HALF_WORD = jsRegex("""^(?:half|halves|medio|media|medias|mitad|demi|demie|demis|moitié|nửa|半|반)$""", "iu")
    private val QUARTER_WORD = jsRegex("""^(?:quarter|quarters|cuarto|cuartos|cuarta|quart|quarts)$""", "iu")
    private val ORDINAL_TOK = jsRegex("""^\d+(?:st|nd|rd|th)$""", "i")
    private val ONCE_TWICE = jsRegex("""^(?:once|twice)$""", "i")
    private val ARTICLE_TOK = jsRegex("""^an?$""", "i")
    private val ARTICLE_AFTER = jsRegex("""^(?:once|twice|times?|half|quarter|per|every|each|and)$""", "i")
    private val SPACE_RUN = jsRegex("""\s+""", "")
    private val FRACTION_SLASH = Regex("[⁄∕]")
    private val THOUSANDS_COMMA = Regex(",(?=[0-9]{3}(?![A-Za-z0-9_]))")
    private val TRAILING_NON_DIGITS = Regex("[^0-9]+$")
    private val PART_SPLIT = Regex("[:.-]")

    data class Pair2(val value: String, val unit: String?, val context: List<String>)

    /** Each number in `text` with the kind of unit right after it, and the naming words just before it (English). */
    fun numberUnits(text: String): List<Pair2> {
        val toks = TOKENS.findAll(text).map { it.value }.toList()
        val pairs = mutableListOf<Pair2>()
        fun isNumberTok(t: String?): Boolean = t != null && (STARTS_DIGIT.containsMatchIn(t) || englishNumbers(t).isNotEmpty())
        fun ctxBefore(i: Int, cls: String?): List<String> {
            val out = mutableListOf<String>()
            var k = i - 1
            while (k >= 0 && out.size < 3) {
                val t = toks[k]
                if (STARTS_DIGIT.containsMatchIn(t)) break
                val w = t.lowercase()
                val u = unitClass(w)
                if (!((u != null && (u == cls || cls == null)) || w in CONTEXT_STOP)) {
                    if (englishNumbers(w).isNotEmpty()) break
                    out.add(nameOf(w, toks.getOrNull(k - 1), toks.getOrNull(k + 1)))
                }
                k--
            }
            return out
        }
        fun unitAfter(i: Int): String? {
            var k = i + 1
            while (k <= i + 3 && k < toks.size) {
                unitClass(toks[k])?.let { return it }
                if (isNumberTok(toks[k])) return null
                k++
            }
            return null
        }
        fun push(v: String, c: String?, i: Int) { pairs.add(Pair2(v, c, ctxBefore(i, c))) }

        for (i in toks.indices) {
            val tok = toks[i]
            val next = toks.getOrNull(i + 1)
            if (CLOCK_TOK.containsMatchIn(tok) || PHONE_TOK.containsMatchIn(tok)) {
                tok.split(PART_SPLIT).forEachIndexed { k, part ->
                    push(part, if (':' in tok) (if (k == 0) "clock" else "clockmin") else "phone", i)
                }
                continue
            }
            if (HALF_WORD.containsMatchIn(tok) || QUARTER_WORD.containsMatchIn(tok)) {
                push(if (HALF_WORD.containsMatchIn(tok)) "1/2" else "1/4", unitAfter(i) ?: "portion", i)
                continue
            }
            var value: String? = null
            var cls: String? = null
            if (ORDINAL_TOK.containsMatchIn(tok)) {
                value = tok.replace(TRAILING_NON_DIGITS, "")
                cls = "ordinal"
            } else if (STARTS_DIGIT.containsMatchIn(tok)) {
                value = tok.replace(SPACE_RUN, "").replace(FRACTION_SLASH, "/").replace(THOUSANDS_COMMA, "")
                cls = unitAfter(i)
            } else if (ONCE_TWICE.containsMatchIn(tok)) {
                value = if (tok.lowercase() == "once") "1" else "2"
                cls = "times"
            } else {
                val prev = toks.getOrNull(i - 1) ?: ""
                if (ARTICLE_TOK.containsMatchIn(tok) && ARTICLE_AFTER.containsMatchIn(prev)) continue
                if (ARTICLE_TOK.containsMatchIn(tok) && NAME_BEFORE_LETTER.containsMatchIn(prev.lowercase())) continue
                val both = englishNumbers("$tok ${next ?: ""}")
                if (both.size == 1 && englishNumbers(next ?: "").isEmpty()) value = both[0]
                if (value != null) cls = unitAfter(i)
            }
            if (value == null) continue
            push(value, cls, i)
        }
        return pairs
    }

    data class Reading(val value: String, val unit: String, val previously: Boolean, val names: List<String>)

    /** doseReadings: every dose amount on the line (mass, dose count or volume), with the words that name what it is for. */
    fun doseReadings(text: String): List<Reading> {
        val doseUnits = setOf("mass", "dose", "volume")
        return numberUnits(readable(text)).mapNotNull { p ->
            val unit = p.unit
            if (unit == null || unit !in doseUnits || !STARTS_DIGIT.containsMatchIn(p.value)) return@mapNotNull null
            Reading(p.value, unit, "previously" in p.context, p.context.filter { it !in ALIAS_NAMES && unitClass(it) == null })
        }
    }
}
