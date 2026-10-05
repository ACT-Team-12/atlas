package com.stephensookra.atlas.data

/**
 * "Walk me through it": the steps one at a time, big, for someone who is overwhelmed or reads with low vision. Pure
 * rules, no AI. A port of web/src/lib/walkThrough.ts; WalkThroughTest replays mobile/shared/walk-vectors.json, the
 * website's own answers.
 *
 * - Order is the list's own order (warning signs first, then each time group, earliest first), so "Step 3 of 12" is the
 *   same step as card 3 of the full list.
 * - Pip follows the list's rules (Pip.spot and Pip.quiet), never a second copy of them: quiet on medicine, lab, warning
 *   and flagged steps, and every line is a fixed one from Pip.LINES.
 * - What the screen says around the step is a FIXED line from the table below, never AI text.
 */
object WalkThrough {
    /** Where a step sits in the list: pinned as a warning sign (`group` null), or in a time group. */
    data class Step<T>(val it: T, val group: WhenGroup?) {
        val warning: Boolean get() = group == null
        val key: String get() = group?.name ?: "warning"
    }

    /** walkSteps: warning signs first, then every time group in WhenGroup order, paper order inside each. */
    fun <T> steps(items: List<T>, isWarning: (T) -> Boolean, groupOf: (T) -> WhenGroup): List<Step<T>> {
        val warnings = items.filter(isWarning).map { Step(it, null) }
        val rest = items.filterNot(isWarning).map { it to groupOf(it) }
        return warnings + WhenGroup.entries.flatMap { g -> rest.filter { it.second == g }.map { Step(it.first, g) } }
    }

    /** Pip on the walk-through screen: a marker with its mood and (only when not quiet) a fixed line. */
    data class ShownPip(val mood: Pip.Mood, val line: Pip.Line?)

    /**
     * walkPip: Pip on the step shown, from the list's own spot. A warning sign or a quiet step (medicine, lab, flagged)
     * never gets a cheer or a line: if it is Pip's spot, a quiet Pip; otherwise no Pip. Otherwise Pip shows only where
     * the list would put it. A cheer belongs to the step just marked done, so it never shows on the next step's screen.
     */
    fun pip(spot: Pip.Spot, shownId: String, shownKind: String, check: Check, warning: Boolean): ShownPip? {
        if (warning || Pip.quiet(shownKind, check)) {
            val here = (spot is Pip.Spot.OnStep && spot.id == shownId) || (spot is Pip.Spot.Greet && spot.id == shownId)
            return if (here) ShownPip(Pip.Mood.quiet, null) else null
        }
        if (spot is Pip.Spot.OnStep && spot.id == shownId) return ShownPip(spot.mood, spot.line)
        return null
    }

    /** nextOpen: index of the first step at or after `from` that is not done, wrapping around; -1 when all are done. */
    fun nextOpen(ids: List<String>, done: Map<String, Boolean>, from: Int): Int {
        for (k in ids.indices) {
            val i = (from + k) % ids.size
            if (done[ids[i]] != true) return i
        }
        return -1
    }

    @Suppress("EnumEntryName")
    enum class Line {
        open, openHint, progress, done, doneAlready, undoDone, notYet, askPerson, askTitle,
        askClinicCall, ask211, warningLabel, warningDo, readAloud, stop, back, previous,
        finished, finishedCount, startOver, region,
    }

    private fun table(vararg pairs: Pair<Line, String>) = mapOf(*pairs)

    /**
     * Every fixed line on the walk-through screen, per app language, copied exactly from WALK_LINES in
     * web/src/lib/walkThrough.ts. Only position, progress and where to get help; never what to do about your health
     * (the paper says that). Written by the team, not by a model at runtime. NATIVE REVIEW NEEDED for every language but
     * English (Amharic most of all), as on the website.
     */
    val LINES: Map<Language, Map<Line, String>> = mapOf(
        Language.English to table(
            Line.open to "Walk me through it", Line.openHint to "One step at a time, in big type.", Line.progress to "Step {n} of {total}",
            Line.done to "Done", Line.doneAlready to "Marked done", Line.undoDone to "Not done after all", Line.notYet to "Not yet", Line.askPerson to "Ask a person",
            Line.askTitle to "Ask a person about this step", Line.askClinicCall to "Call your clinic and read them the words from your paper above.",
            Line.ask211 to "For help with rides, food, money or anything else, call 211 (United Way of Greater Atlanta) or your community health worker.",
            Line.warningLabel to "Warning sign from your paper", Line.warningDo to "If you have this right now, do what your paper says: call your clinic, or call 911.",
            Line.readAloud to "Read aloud", Line.stop to "Stop", Line.back to "Back to the full list", Line.previous to "Previous step",
            Line.finished to "You went through every step.", Line.finishedCount to "{done} of {total} marked done.", Line.startOver to "Go through the open steps again",
            Line.region to "One step at a time",
        ),
        // NATIVE REVIEW NEEDED (Spanish).
        Language.Spanish to table(
            Line.open to "Guíeme paso a paso", Line.openHint to "Un paso a la vez, en letra grande.", Line.progress to "Paso {n} de {total}",
            Line.done to "Hecho", Line.doneAlready to "Marcado como hecho", Line.undoDone to "Todavía no está hecho", Line.notYet to "Todavía no", Line.askPerson to "Preguntar a una persona",
            Line.askTitle to "Pregunte a una persona sobre este paso", Line.askClinicCall to "Llame a su clínica y léales las palabras de su papel que están arriba.",
            Line.ask211 to "Para ayuda con transporte, comida, dinero u otra cosa, llame al 211 (United Way of Greater Atlanta) o a su trabajador comunitario de salud.",
            Line.warningLabel to "Señal de alerta de su papel", Line.warningDo to "Si tiene esto ahora mismo, haga lo que dice su papel: llame a su clínica o llame al 911.",
            Line.readAloud to "Leer en voz alta", Line.stop to "Parar", Line.back to "Volver a la lista completa", Line.previous to "Paso anterior",
            Line.finished to "Revisó todos los pasos.", Line.finishedCount to "{done} de {total} marcados como hechos.", Line.startOver to "Revisar otra vez los pasos pendientes",
            Line.region to "Un paso a la vez",
        ),
        // NATIVE REVIEW NEEDED (Vietnamese).
        Language.Vietnamese to table(
            Line.open to "Hướng dẫn tôi từng bước", Line.openHint to "Mỗi lần một bước, chữ lớn.", Line.progress to "Bước {n} / {total}",
            Line.done to "Xong", Line.doneAlready to "Đã đánh dấu xong", Line.undoDone to "Chưa xong", Line.notYet to "Chưa", Line.askPerson to "Hỏi một người",
            Line.askTitle to "Hỏi một người về bước này", Line.askClinicCall to "Gọi phòng khám và đọc cho họ những chữ trong giấy của bạn ở trên.",
            Line.ask211 to "Để được giúp về đi lại, thức ăn, tiền bạc hay việc khác, hãy gọi 211 (United Way of Greater Atlanta) hoặc nhân viên y tế cộng đồng của bạn.",
            Line.warningLabel to "Dấu hiệu cảnh báo trong giấy của bạn", Line.warningDo to "Nếu bạn đang bị như vậy, hãy làm theo giấy của bạn: gọi phòng khám, hoặc gọi 911.",
            Line.readAloud to "Đọc to", Line.stop to "Dừng", Line.back to "Quay lại danh sách đầy đủ", Line.previous to "Bước trước",
            Line.finished to "Bạn đã xem hết mọi bước.", Line.finishedCount to "Đã xong {done} / {total}.", Line.startOver to "Xem lại các bước chưa xong",
            Line.region to "Mỗi lần một bước",
        ),
        // NATIVE REVIEW NEEDED (Korean).
        Language.Korean to table(
            Line.open to "한 단계씩 안내해 주세요", Line.openHint to "한 번에 한 단계씩, 큰 글씨로.", Line.progress to "{total}단계 중 {n}단계",
            Line.done to "완료", Line.doneAlready to "완료로 표시됨", Line.undoDone to "아직 안 했어요", Line.notYet to "아직", Line.askPerson to "사람에게 묻기",
            Line.askTitle to "이 단계에 대해 사람에게 물어보세요", Line.askClinicCall to "병원에 전화해서 위에 있는 서류의 문장을 읽어 주세요.",
            Line.ask211 to "교통, 음식, 돈 등 도움이 필요하면 211(United Way of Greater Atlanta)이나 지역 보건 요원에게 전화하세요.",
            Line.warningLabel to "서류에 있는 위험 신호", Line.warningDo to "지금 이런 증상이 있으면 서류에 적힌 대로 하세요: 병원에 전화하거나 911에 전화하세요.",
            Line.readAloud to "소리 내어 읽기", Line.stop to "멈추기", Line.back to "전체 목록으로 돌아가기", Line.previous to "이전 단계",
            Line.finished to "모든 단계를 다 보았어요.", Line.finishedCount to "{total}개 중 {done}개 완료.", Line.startOver to "남은 단계 다시 보기",
            Line.region to "한 번에 한 단계씩",
        ),
        // NATIVE REVIEW NEEDED (Chinese, Simplified).
        Language.Chinese to table(
            Line.open to "一步一步带我做", Line.openHint to "一次一步，大字显示。", Line.progress to "第 {n} 步，共 {total} 步",
            Line.done to "完成", Line.doneAlready to "已标记完成", Line.undoDone to "其实还没完成", Line.notYet to "还没有", Line.askPerson to "问一个人",
            Line.askTitle to "就这一步问一个人", Line.askClinicCall to "打电话给您的诊所，把上面您文件里的原话读给他们听。",
            Line.ask211 to "如需交通、食物、钱或其他方面的帮助，请拨打 211（United Way of Greater Atlanta）或联系您的社区健康工作者。",
            Line.warningLabel to "您文件里的危险信号", Line.warningDo to "如果您现在有这种情况，请按文件说的做：打电话给诊所，或拨打 911。",
            Line.readAloud to "朗读", Line.stop to "停止", Line.back to "返回完整列表", Line.previous to "上一步",
            Line.finished to "您已经看完每一步。", Line.finishedCount to "共 {total} 步，已完成 {done} 步。", Line.startOver to "再看一遍没完成的步骤",
            Line.region to "一次一步",
        ),
        // NATIVE REVIEW NEEDED (Amharic): highest priority for review.
        Language.Amharic to table(
            Line.open to "ደረጃ በደረጃ አሳዩኝ", Line.openHint to "አንድ ደረጃ በአንድ ጊዜ፣ በትልቅ ፊደል።", Line.progress to "ደረጃ {n} ከ {total}",
            Line.done to "ተጠናቋል", Line.doneAlready to "ተጠናቋል ተብሎ ተመዝግቧል", Line.undoDone to "ገና አልተጠናቀቀም", Line.notYet to "ገና ነው", Line.askPerson to "ሰው ይጠይቁ",
            Line.askTitle to "ስለዚህ ደረጃ ሰው ይጠይቁ", Line.askClinicCall to "ወደ ክሊኒክዎ ይደውሉ እና ከላይ ያሉትን የወረቀትዎን ቃላት ያንብቡላቸው።",
            Line.ask211 to "ለትራንስፖርት፣ ለምግብ፣ ለገንዘብ ወይም ለሌላ እርዳታ ወደ 211 (United Way of Greater Atlanta) ወይም ወደ ማህበረሰብ ጤና ሰራተኛዎ ይደውሉ።",
            Line.warningLabel to "ከወረቀትዎ የአደጋ ምልክት", Line.warningDo to "ይህ አሁን ካለብዎ ወረቀትዎ የሚለውን ያድርጉ፦ ወደ ክሊኒክዎ ወይም ወደ 911 ይደውሉ።",
            Line.readAloud to "ጮክ ብለው ያንብቡ", Line.stop to "አቁም", Line.back to "ወደ ሙሉ ዝርዝሩ ይመለሱ", Line.previous to "ቀዳሚ ደረጃ",
            Line.finished to "ሁሉንም ደረጃዎች አይተዋል።", Line.finishedCount to "ከ {total} ውስጥ {done} ተጠናቀዋል።", Line.startOver to "ያልተጠናቀቁትን ደረጃዎች እንደገና ይመልከቱ",
            Line.region to "አንድ ደረጃ በአንድ ጊዜ",
        ),
        // NATIVE REVIEW NEEDED (French).
        Language.French to table(
            Line.open to "Guidez-moi pas à pas", Line.openHint to "Une étape à la fois, en gros caractères.", Line.progress to "Étape {n} sur {total}",
            Line.done to "Fait", Line.doneAlready to "Marqué comme fait", Line.undoDone to "Pas encore fait finalement", Line.notYet to "Pas encore", Line.askPerson to "Demander à quelqu'un",
            Line.askTitle to "Demandez à quelqu'un pour cette étape", Line.askClinicCall to "Appelez votre clinique et lisez-leur les mots de votre papier ci-dessus.",
            Line.ask211 to "Pour de l'aide pour le transport, la nourriture, l'argent ou autre chose, appelez le 211 (United Way of Greater Atlanta) ou votre agent de santé communautaire.",
            Line.warningLabel to "Signe d'alerte de votre papier", Line.warningDo to "Si vous avez cela en ce moment, faites ce que dit votre papier : appelez votre clinique, ou appelez le 911.",
            Line.readAloud to "Lire à voix haute", Line.stop to "Arrêter", Line.back to "Revenir à la liste complète", Line.previous to "Étape précédente",
            Line.finished to "Vous avez parcouru toutes les étapes.", Line.finishedCount to "{done} sur {total} marquées comme faites.", Line.startOver to "Revoir les étapes non faites",
            Line.region to "Une étape à la fois",
        ),
    )

    private val PLACEHOLDER = Regex("""\{([A-Za-z0-9_]+)\}""")

    /** walkLine: a line in the person's language (English when missing), with `{name}` filled in; unknown names stay. */
    fun line(language: String, line: Line, values: Map<String, Int> = emptyMap()): String {
        val lang = Language.entries.firstOrNull { it.name == language }
        val text = lang?.let { LINES[it]?.get(line) } ?: LINES.getValue(Language.English).getValue(line)
        return PLACEHOLDER.replace(text) { m -> values[m.groupValues[1]]?.toString() ?: m.value }
    }

    fun line(language: Language, line: Line, values: Map<String, Int> = emptyMap()): String = line(language.name, line, values)
}
