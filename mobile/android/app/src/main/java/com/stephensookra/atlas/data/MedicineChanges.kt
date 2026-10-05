package com.stephensookra.atlas.data

import java.text.Normalizer

/**
 * "Your medicine changes": every medicine step sorted into STOP, CHANGE, START (and KEEP when the paper says to
 * continue), read from the PAPER'S OWN WORDS only. Pure, no AI. A line-for-line port of web/src/lib/medicineChanges.ts
 * with the same pattern text; MedicineChangesTest replays mobile/shared/medicine-changes-vectors.json, the cases the
 * website's own suite replays.
 *
 * - STOP only when the "Right away" stop rule (StepsWhen.stopNowFromPaper) also says so, so the card never shows a Stop
 *   the list does not. A stop line the card is unsure of goes to "Ask your pharmacist", still on the card.
 * - Anything the words do not settle goes to "Ask your pharmacist", never to a guessed row: a negated action, a
 *   condition or a later moment, a description or history, a hold, two different actions on one line, a line that
 *   disagrees with its heading, a stop word the stop rule does not accept, or no action word at all.
 * - A CHANGE row shows the old and new dose only when both are written in the quote and every check agrees (doseChange).
 *   The doses shown are the paper's characters, copied, never computed.
 *
 * NATIVE-SPEAKER REVIEW NEEDED for every non-English list, as on the website; Amharic is the least certain.
 */
object MedicineChanges {
    @Suppress("EnumEntryName")
    enum class Row(val label: String) {
        // MED_ROW_LABEL in medicineChanges.ts, in the card's order (Stop first).
        stop("Stop"), change("Change"), start("Start"), keep("Keep taking"), ask("Ask your pharmacist")
    }

    data class Dose(val was: String, val now: String)

    /** One medicine step on the card. `reason` (MedReason) is read by tests, not shown. */
    data class Change(val id: String, val row: Row, val reason: String, val name: String?, val quote: String, val dose: Dose?)

    // ---- Word lists

    private const val S = """\s+"""
    /** Whole-word alternatives with letter-aware edges (English, Spanish, French, Vietnamese). */
    private fun edged(src: String) = jsRegex("""(?<![\p{L}\p{N}\p{M}])(?:""" + src + """)(?![\p{L}\p{N}\p{M}])""")
    /** Substring alternatives (Korean, Chinese, Amharic). */
    private fun bare(src: String) = jsRegex(src)

    private class Lists(val start: Regex, val change: Regex, val keep: Regex, val hold: Regex, val neg: Regex, val cond: Regex, val history: Regex)

    private val EN = Lists(
        start = edged("""start|started|starting|begin|begins|beginning|restart|resume|new$S(?:medicines?|medications?|prescriptions?)"""),
        change = edged(listOf(
            """(?:increase|decrease|reduce|lower|raise|adjust|change)[sd]?$S(?:(?:your|the|this)$S)?(?:dose|dosage|how${S}you${S}take)""",
            """dose$S(?:was$S|is$S)?(?:increased|decreased|changed|reduced|lowered|adjusted)|new${S}dose|previously|formerly""",
            """(?:changed?|switch(?:ed)?)${S}to""",
            """(?:increase|decrease|reduce|lower|raise|adjust|change)[sd]?(?:$S[\p{L}()]+){1,2}$S(?:dose|dosage)""",
            """(?:increase|decrease|reduce|lower|raise)[sd]?(?:$S[\p{L}()]+){0,3}${S}to$S\d""",
        ).joinToString("|")),
        keep = edged("""continue|continuing|keep$S(?:taking|using)"""),
        hold = edged("""hold|held|holding|pause|paused|temporarily"""),
        neg = edged("""(?:do${S}not|don['’]t|never|not|no${S}longer)(?:$S\p{L}+){0,2}$S(?:stop|discontinue|start|begin|increase|decrease|reduce|lower|raise|change|continue|restart|resume|keep|hold|switch)|no${S}changes?|no${S}need${S}to|need${S}not|needn['’]t|not${S}necessary|unnecessary|without${S}stopping"""),
        cond = edged("""if|unless|in${S}case|until|when|whenever|while|after(?!$S(?:meals?|breakfast|lunch|dinner|supper|eating|food))|before(?!$S(?:meals?|breakfast|lunch|dinner|supper|eating|food|bed|bedtime|sleep))"""),
        history = edged("""you(?:${S}have)?$S(?:stopped|started|began|took|were|used)|last$S(?:year|month|week)|ago|already|in${S}the${S}past|may|might|could|yesterday""" +
            """|(?:was|were|has${S}been|have${S}been|had${S}been)$S(?:\p{L}+$S)?(?:started|stopped|discontinued|increased|decreased|changed|reduced|lowered|raised|adjusted|begun|held)|(?:19|20)\d\d(?!$S?(?:mg|mcg|units?|iu|ml|g)(?![\p{L}]))"""),
    )
    private val ES = Lists(
        start = edged("""empiece|empezar|comience|comenzar|inicie|iniciar|reanude|reanudar|reinicie|reiniciar|vuelva${S}a$S(?:tomar|empezar)|nuevos?${S}medicamentos?|nuevas?${S}medicinas?"""),
        change = edged("""(?:aumente|disminuya|reduzca|baje|cambie|ajuste)(?:$S(?:la|su))?${S}dosis|nueva${S}dosis|anteriormente|cambi[eó]${S}a"""),
        keep = edged("""contin[uú]e|continuar|siga${S}tomando|seguir${S}tomando"""),
        hold = edged("""temporalmente|pausa|pause"""),
        neg = edged("""(?:no|nunca)(?:$S\p{L}+){0,2}$S(?:deje|dejar|suspenda|suspender|empiece|empezar|comience|comenzar|inicie|aumente|disminuya|reduzca|cambie|contin[uú]e|reanude)|sin${S}cambios?|no$S(?:hay$S(?:necesidad|que)|es${S}necesario|necesita)"""),
        cond = edged("""si|a${S}menos${S}que|en${S}caso${S}de|hasta${S}que|cuando|mientras|despu[eé]s${S}de(?!$S(?:las$S)?(?:comidas?|desayun\p{L}*|cenar?|almorzar|comer))|antes${S}de(?!$S(?:las$S)?(?:comidas?|desayun\p{L}*|cenar?|almorzar|comer|acostarse|dormir))"""),
        history = edged("""puede|pueden|podr[ií]a|el${S}año${S}pasado|usted$S(?:dej[oó]|empez[oó]|tomaba)|ayer|fue$S(?:suspendid[oa]|iniciad[oa]|aumentad[oa]|cambiad[oa]|empezad[oa]|disminuid[oa])"""),
    )
    private val FR = Lists(
        start = edged("""commencez|commencer|débutez|débuter|reprenez|reprendre|recommencez|recommencer|nouveaux?${S}médicaments?"""),
        change = edged("""(?:augmentez|diminuez|réduisez|baissez|changez|modifiez|ajustez)$S(?:la|votre)$S(?:dose|posologie)|nouvelle${S}dose|auparavant|anciennement"""),
        keep = edged("""continuez|continuer|poursuivez|poursuivre"""),
        hold = edged("""temporairement|pause"""),
        neg = jsRegex("""(?<![\p{L}\p{N}])(?:ne$S(?:\p{L}+$S){0,2}|n['’]\s*)(?:commencez|augmentez|diminuez|réduisez|changez|modifiez|continuez|poursuivez|reprenez|arrêtez|arretez|cessez|interrompez|suspendez)(?![\p{L}\p{N}])|(?<![\p{L}\p{N}])(?:aucun${S}changement|pas$S(?:nécessaire|besoin)|inutile)(?![\p{L}\p{N}])"""),
        cond = edged("""si|s['’]ils?|sauf${S}si|en${S}cas|jusqu['’]à|quand|lorsque|lorsqu['’]\p{L}+|pendant${S}que|après(?!$S(?:les$S)?(?:repas|manger))|avant(?!$S(?:les$S)?(?:repas|manger|le${S}coucher|de${S}dormir))"""),
        history = edged("""peut|peuvent|pourrait|l['’]an${S}dernier|vous${S}avez$S(?:arrêté|commencé|pris)|hier|a${S}été$S(?:arrêtée?|commencée?|augmentée?|modifiée?|diminuée?)"""),
    )
    private val VI = Lists(
        start = edged("""bắt${S}đầu|thuốc${S}mới|dùng${S}lại|uống${S}lại"""),
        change = edged("""tăng${S}liều|giảm${S}liều|đổi${S}liều|thay${S}đổi${S}liều|điều${S}chỉnh${S}liều|liều${S}mới|đổi${S}sang|trước${S}đây"""),
        keep = edged("""tiếp${S}tục|vẫn$S(?:dùng|uống)"""),
        hold = edged("""tạm$S(?:ngưng|ngừng|dừng|thời)"""),
        neg = edged("""(?:không|đừng|chớ)(?:$S\p{L}+){0,3}$S(?:ngưng|ngừng|dừng|bắt${S}đầu|tăng|giảm|đổi|tiếp${S}tục)|không${S}thay${S}đổi|không${S}cần"""),
        // A look-behind needs a bounded length here; the text has runs of spaces as one by then, so \s{1,9} reads the same.
        cond = edged("""nếu|trừ${S}khi|trường${S}hợp|cho${S}đến${S}khi|(?:sau|trước)${S}khi(?!$S(?:ăn|ngủ))|(?<!(?:sau|trước)\s{1,9})khi"""),
        history = edged("""có${S}thể|năm${S}ngoái|hôm${S}qua|đã${S}được|đã$S(?:ngưng|ngừng|dừng|bắt${S}đầu|uống|dùng)"""),
    )
    private val KO = Lists(
        start = bare("""시작|새로\s*처방|새\s*약|새로운\s*약|재개"""),
        change = bare("""증량|감량|용량\s*(?:을\s*)?(?:늘리|늘려|줄이|줄여|변경|조정)|이전\s*용량|(?:으로|로)\s*변경"""),
        keep = bare("""계속"""),
        hold = bare("""일시\s*중단|잠시\s*중단|일시적으로"""),
        neg = bare("""(?:중단|중지|멈추|끊|시작|증량|감량|늘리|줄이|변경|계속)\p{L}*?지\s*(?:마|말|않)|변경\s*없|필요\s*(?:가|는)?\s*없|않아도"""),
        cond = bare("""경우|만약|만일|때까지|(?<!식)후|(?<!식)전에|때(?!문)"""),
        history = bare("""수\s*있|작년|어제"""),
    )
    private val ZH = Lists(
        start = bare("""开始|開始|新药|新藥|新处方|新處方|加用|恢复服用|恢復服用|重新服用"""),
        change = bare("""增加剂量|增加劑量|剂量增加|劑量增加|减少剂量|減少劑量|剂量减少|劑量減少|加量|减量|減量|改为|改為|改成|调整剂量|調整劑量|更改剂量|更改劑量|增至|减至|減至|原来|原來|此前"""),
        keep = bare("""继续|繼續"""),
        hold = bare("""暂停|暫停|暂时|暫時"""),
        neg = bare("""(?:不要|不可|不能|不得|请勿|請勿|勿|别|別|切勿)\p{L}{0,6}?(?:停|开始|開始|增加|减少|減少|加量|减量|減量|改|继续|繼續|恢复|恢復)|不变|不變|不需要|不必|无需|無需|不用"""),
        cond = bare("""如果|如若|假如|一旦|如有|直到|(?<![\p{L}])若|(?<![饭飯餐])[后後]|之前|以前|(?<![小暂暫同按及准準])[时時]"""),
        history = bare("""可能|去年|昨天|曾经|曾經|已经|已經|已于|已於"""),
    )
    private val AM = Lists(
        start = bare("""ይጀምሩ|ጀምሩ|አዲስ\s*መድ[ሀሃሐ]ኒት|አዲስ\s*መድኃኒት|እንደገና"""),
        change = bare("""ይጨምሩ|ይቀንሱ|ይቀይሩ"""),
        keep = bare("""ይቀጥሉ"""),
        hold = bare("""ለጊዜው"""),
        neg = bare("""አይጀምሩ|አይጨምሩ|አይቀንሱ|አይቀይሩ|አያቁሙ|አያቋርጡ|አይቀጥሉ|አያስፈልግም"""),
        cond = bare("""ከሆነ|ካለብዎት|ካጋጠመዎት|ቢያጋጥምዎ|እስከ|በኋላ|በፊት"""),
        history = bare("""ይችላል|ትናንት"""),
    )
    private val LANG_LISTS = listOf(EN, ES, FR, VI, KO, ZH, AM)

    /** Stop words of all seven languages (the very patterns StepsWhen and SafetyWords use). */
    private val STOP_WORDS: List<Regex> = listOf(
        SafetyPatterns.STOP, SafetyPatterns.STOP_VI, SafetyPatterns.STOP_FR, SafetyPatterns.STOP_KO,
        SafetyPatterns.STOP_ZH, SafetyPatterns.STOP_AM,
    ).map { it.regex() }

    /** "from 10 mg to 20 mg" in the Latin-script languages; the doses must carry the same unit word. */
    private const val AMOUNT = """(?<![\d.,])(\d+(?:[.,]\d+)?\s*(mg|mcg|µg|g|ml|units?|unidades?|unités?|đơn\s+vị|IU|UI)(?![\p{L}\p{M}]))"""
    private val AMOUNT_RE = jsRegex(AMOUNT, "giu")
    private val FROM_TO = jsRegex("""(?<![\p{L}\p{N}])(?:from|de|desde|từ)\s+""" + AMOUNT + """\s+(?:to|a|hasta|à|lên|xuống|thành|đến|tới)\s+""" + AMOUNT + """(?![\p{L}\p{N}])""", "giu")
    /** "Previously 10 mg" (English): the paper's own word for the old dose. */
    private val PREVIOUSLY = jsRegex("""(?<![\p{L}\p{N}])(?:previously|formerly)[:,]?\s+""" + AMOUNT + """(?![\p{L}\p{N}])""", "giu")

    /** A verb that changes a dose. A "from 10 mg to 20 mg" counts as a change only next to one. */
    private const val CHANGE_VERB_SOURCE = """(?<![\p{L}\p{N}\p{M}])(?:increase[sd]?|decrease[sd]?|reduce[sd]?|lower(?:ed)?|raise[sd]?|change[sd]?|switch(?:ed)?|adjust(?:ed)?|aumente|disminuya|reduzca|baje|cambie|ajuste|augmentez|diminuez|réduisez|baissez|changez|modifiez|ajustez|tăng|giảm|đổi|thay\s+đổi|điều\s+chỉnh)(?![\p{L}\p{N}\p{M}])"""
    private val CHANGE_VERB = jsRegex(CHANGE_VERB_SOURCE)
    /** The verb must GOVERN the from-to: it opens the clause, with at most five words before "from", none of them range words. */
    private val GOVERNS = jsRegex("""^(?:[-*•‣–]\s*)?(?:""" + CHANGE_VERB_SOURCE + """)((?:\s+[\p{L}\p{M}()'’-]+){0,5})\s*$""")
    private val RANGE_WORDS = edged("""ranges?|ranging|across|between|strengths?|available|rango|entre|disponibles?|gamme|khoảng""")
    private val SPACE_RUN = jsRegex("""\s+""", "")

    /** NFC, runs of spaces as one, trimmed. */
    fun prepare(t: String): String = StepsWhen.trim(StepsWhen.spaces(Normalizer.normalize(t, Normalizer.Form.NFC)))

    private fun fromToWithVerb(t: String): List<MatchResult> {
        val ends = listOf(".", ";", ":", "!", "?", ",", "(", "\n", "。", "；", "：")
        return FROM_TO.findAll(t).filter { m ->
            val before = t.substring(0, m.range.first)
            val cut = ends.maxOf { before.lastIndexOf(it) }
            val clause = StepsWhen.trim(before.substring(cut + 1))
            val g = GOVERNS.find(clause) ?: return@filter false
            !RANGE_WORDS.containsMatchIn(g.groups[1]?.value ?: "")
        }.toList()
    }

    /** A negation earlier in the same clause than the first action word ("No need to stop", "不需要停止"). */
    private val NEG_TOKEN = jsRegex("""(?<![\p{L}])(?:not|no|never|without|nunca|sin|ne|pas|jamais|sans|không|đừng|chớ|chưa)(?![\p{L}])|n['’]|[不别別勿无無未没沒]""", "giu")
    private val CLAUSE_SPLIT = Regex("[.;:!?,。；：，]")
    private val SENTENCE_SPLIT = Regex("[.;!?。；\n]")

    private fun negatedBeforeAction(t: String, actions: List<Regex>): Boolean {
        for (clause in t.split(CLAUSE_SPLIT)) {
            val at = actions.mapNotNull { it.find(clause)?.range?.first }.minOrNull() ?: continue
            if (NEG_TOKEN.findAll(clause).any { it.range.first < at }) return true
        }
        return false
    }

    data class Signals(
        val stop: Boolean, val change: Boolean, val start: Boolean, val keep: Boolean,
        val hold: Boolean, val neg: Boolean, val cond: Boolean, val history: Boolean,
    )

    fun signals(text: String): Signals {
        val t = prepare(text)
        fun any(pick: (Lists) -> Regex) = LANG_LISTS.any { pick(it).containsMatchIn(t) }
        val actions = STOP_WORDS + LANG_LISTS.flatMap { listOf(it.start, it.change, it.keep, it.hold) } + CHANGE_VERB
        // A negation, condition, hold or history word changes an action only in the sentence that holds the action.
        val sentences = t.split(SENTENCE_SPLIT).filter { x -> actions.any { it.containsMatchIn(x) } || fromToWithVerb(x).isNotEmpty() }
        fun inAction(pick: (Lists) -> Regex) = sentences.any { x -> LANG_LISTS.any { pick(it).containsMatchIn(x) } }
        return Signals(
            stop = STOP_WORDS.any { it.containsMatchIn(t) },
            change = any { it.change } || fromToWithVerb(t).isNotEmpty(),
            start = any { it.start },
            keep = any { it.keep },
            hold = inAction { it.hold },
            neg = inAction { it.neg } || negatedBeforeAction(t, actions),
            cond = inAction { it.cond },
            history = inAction { it.history },
        )
    }

    private fun rows(s: Signals): List<Row> =
        listOf(Row.stop to s.stop, Row.change to s.change, Row.start to s.start, Row.keep to s.keep).filter { it.second }.map { it.first }

    /** Which row one medicine step goes in, and why. Non-medicine steps are not sorted (null). */
    fun classify(kind: String, quote: String, span: TextSpan?, paper: String): Pair<Row, String>? {
        if (kind != "medication") return null
        val heading = StepsWhen.listHeadingAny(paper, span)
        val q = signals(quote)
        val h = if (heading.isEmpty()) null else signals(heading)
        val both = listOfNotNull(q, h)
        if (both.any { it.neg }) return Row.ask to "negated"
        if (both.any { it.cond }) return Row.ask to "conditional"
        if (both.any { it.hold }) return Row.ask to "hold"
        if (both.any { it.history }) return Row.ask to "not_an_instruction"
        // A stop word counts only where the "Right away" rule accepts it: every Stop on the card is under "Right away" too.
        if (both.any { it.stop } && !StepsWhen.stopNowFromPaper(kind, quote, span, paper)) return Row.ask to "stop_not_now"
        val qr = rows(q)
        val hr = h?.let { rows(it) } ?: emptyList()
        if (qr.size > 1 || hr.size > 1) return Row.ask to "mixed"
        if (qr.size == 1 && hr.size == 1 && qr[0] != hr[0]) return Row.ask to "heading_disagrees"
        if (qr.size == 1) return qr[0] to (if (hr.isEmpty()) "words" else "words_and_heading")
        if (hr.size == 1) return hr[0] to "heading"
        return Row.ask to "no_action_words"
    }

    // ---- Doses

    /** Words that may follow a dose without naming what it is for ("20 mg total", "10 mg once daily"). */
    private val AFTER_DOSE_OK = (
        "tablet tablets tab tabs pill pills capsule capsules total by mouth orally po once twice daily a an per each every day days " +
            "in the morning evening night bedtime at with meals meal food as needed and for weekly qd bid tid " +
            "tableta tabletas pastilla pastillas cápsula cápsulas al día diario diaria por vía oral boca cada una vez veces con comida comidas " +
            "comprimé comprimés gélule gélules par jour fois une le matin soir avec repas " +
            "viên mỗi ngày lần uống sáng tối"
        ).split(" ").toSet()
    /** Words skipped before that check: "20 mg of aspirin" looks at "aspirin". */
    private val AFTER_DOSE_SKIP = setOf("of", "de", "du", "des", "d", "của")
    private val WORD_RUN = jsRegex("""[\p{L}\p{M}]+""", "gu")
    private val VALUE_RE = jsRegex("""\d+(?:[.,]\d+)?""", "")
    private val LEADING_NUMBER = jsRegex("""^[\d.,\s]+""", "")
    private val AFTER_SPLIT = Regex("[.;!?\n]")

    /** True when the words right after this dose (up to the end of its sentence) never name something else. */
    private fun nothingNamedAfter(text: String, end: Int): Boolean {
        val rest = text.substring(end).split(AFTER_SPLIT)[0]
        return WORD_RUN.findAll(rest).all { val w = it.value.lowercase(); w in AFTER_DOSE_SKIP || w in AFTER_DOSE_OK }
    }

    private fun valueOf(amount: String): String = (VALUE_RE.find(amount)?.value ?: "").replaceFirst(",", ".")
    private fun unitWord(amount: String): String = amount.replace(LEADING_NUMBER, "").replace(SPACE_RUN, " ").lowercase()

    private val FILLER = setOf("from", "de", "desde", "từ", "previously", "formerly", "increase", "decrease", "reduce", "change", "to", "a",
        "à", "hasta", "lên", "xuống", "thành", "đến", "tới")

    /** The old and new dose, as written in the quote, or null. Never computed, never filled in from anywhere else. */
    fun doseChange(quote: String): Dose? {
        val t = quote.replace(SPACE_RUN, " ")
        val ft = fromToWithVerb(t)
        val prev = PREVIOUSLY.findAll(t).toList()
        if (ft.size + prev.size != 1) return null
        val was: String
        val now: String
        val nowEnd: Int
        var joined = -1 to -1
        if (ft.size == 1) {
            val m = ft[0]
            was = m.groups[1]?.value ?: ""
            now = m.groups[3]?.value ?: ""
            if (unitWord(was) != unitWord(now)) return null
            nowEnd = m.range.last + 1
            joined = m.range.first to nowEnd
        } else {
            was = prev[0].groups[1]?.value ?: ""
            // The new dose: the one other value with the same unit word on the line, written out.
            val unit = unitWord(was)
            val others = AMOUNT_RE.findAll(t).filter { val a = it.groups[1]?.value ?: ""; unitWord(a) == unit && valueOf(a) != valueOf(was) }.toList()
            if (others.map { valueOf(it.groups[1]?.value ?: "") }.toSet().size != 1) return null
            now = others[0].groups[1]?.value ?: ""
            nowEnd = others[0].range.last + 1
        }
        if (valueOf(was) == valueOf(now)) return null
        if (!nothingNamedAfter(t, nowEnd)) return null
        // The meaning check's own reading: exactly these two values of that kind of dose on the line, and their naming
        // words do not point at two different medicines.
        val readings = DoseReadings.doseReadings(t)
        fun dot(s: String) = s.replaceFirst(",", ".")
        val wasR = readings.filter { dot(it.value) == valueOf(was) }
        val nowR = readings.filter { dot(it.value) == valueOf(now) }
        // The new dose written once: two medicines on the same new value can't be told apart.
        if (wasR.isEmpty() || nowR.size != 1) return null
        val unitKind = nowR[0].unit
        if (wasR.any { it.unit != unitKind } || nowR.any { it.unit != unitKind }) return null
        if (readings.filter { it.unit == unitKind }.map { dot(it.value) }.toSet().size != 2) return null
        // Each dose also must not be followed by a name, and the words before them must agree.
        fun names(rs: List<DoseReadings.Reading>) = rs.flatMap { it.names }.filter { it !in FILLER }.toSet()
        val a = names(wasR)
        val b = names(nowR)
        if (a.isNotEmpty() && b.isNotEmpty() && a.none { it in b }) return null
        for (m in AMOUNT_RE.findAll(t)) {
            val at = m.range.first
            if (at >= joined.first && at < joined.second) continue
            if (!nothingNamedAfter(t, m.range.last + 1)) return null
        }
        return Dose(StepsWhen.trim(was), StepsWhen.trim(now))
    }

    // ---- The medicine's name

    /** Words that mean the start of a line is an instruction, not a medicine's name. */
    private val INSTRUCTION = jsRegex("""(?<![\p{L}])(?:take|takes|taking|tome|tomar|prenez|prendre|uống|dùng|use|apply|increase|decrease|reduce|lower|raise|adjust|change|switch|aumente|disminuya|reduzca|baje|cambie|ajuste|augmentez|diminuez|réduisez|baissez|changez|modifiez|ajustez|tăng|giảm|đổi|from|desde|từ|to|dose|dosis|liều)(?![\p{L}])|복용|드시|용량|服用|剂量|劑量|ይውሰዱ""")
    private val NAME_AT_START = jsRegex("""^([\p{L}][\p{L}\p{M}\s()'’/.-]*?)\s*\d""", "u")
    private val NAME_TAIL = jsRegex("""[\s,:;-]+$""", "u")

    /**
     * The medicine's name as the paper writes it: the words at the very start of the quote, up to its first number. Null
     * when the line starts with an instruction instead, or the start is too long to be a name. Copied, never rewritten.
     */
    fun medicineName(quote: String): String? {
        val t = StepsWhen.trim(StepsWhen.spaces(quote))
        val raw = NAME_AT_START.find(t)?.groups?.get(1)?.value ?: return null
        val name = StepsWhen.trim(raw).replace(NAME_TAIL, "")
        if (name.isEmpty() || name.length > 48 || name.split(" ").size > 6) return null
        val s = signals(name)
        if (s.stop || s.change || s.start || s.keep || s.hold || INSTRUCTION.containsMatchIn(name)) return null
        return name
    }

    // ---- The card

    fun change(id: String, kind: String, quote: String, span: TextSpan?, paper: String): Change? {
        val (row, reason) = classify(kind, quote, span, paper) ?: return null
        return Change(id, row, reason, medicineName(quote), StepsWhen.trim(StepsWhen.spaces(quote)),
            if (row == Row.change) doseChange(quote) else null)
    }

    fun change(it: VerifiedItem, paper: String): Change? = change(it.id, it.kind, it.source_quote, it.span, paper)

    /** Every medicine step, by row (Stop first), in paper order inside each row. Rows with nothing are left out. */
    fun groups(items: List<VerifiedItem>, paper: String): List<Pair<Row, List<Change>>> {
        val all = items.mapNotNull { change(it, paper) }
        return Row.entries.mapNotNull { row -> all.filter { it.row == row }.takeIf { it.isNotEmpty() }?.let { row to it } }
    }

    /** "was 10 mg, now 20 mg": the words a screen reader hears, not a strike-through. */
    fun doseWords(d: Dose): String = "was ${d.was}, now ${d.now}"
}
