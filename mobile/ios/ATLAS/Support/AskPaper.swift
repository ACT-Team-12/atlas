import Foundation

/// "Ask my paper": a question answered only with the paper's own words. The server (POST /api/ask, web/src/lib/ask.ts)
/// checks every quote with no AI; this file is the phone's side, a port of web/src/lib/askText.ts and onThisPaper in
/// web/src/ui/AskPaper.tsx. AskPaperTests replays mobile/shared/ask-vectors.json, the website's own answers.
///
/// - An urgent question is caught here and never sent: the screen shows 911 / 211 guidance and the paper's own warning
///   lines instead of an answer.
/// - A quote is shown only when its words are exactly this paper's text at its span; if none is left, the answer is the
///   fixed refusal plus a ready question built only from the person's own words.
/// - Every fixed string is in the person's language. The server's own error words are English, so they are never shown.
enum AskPaper {
    /// The longest question the route accepts (MAX_QUESTION in askText.ts).
    static let maxQuestion = 300

    struct Strings: Sendable {
        let title, intro, label, placeholder, button, asking, refusal, readyLabel, readyHint: String
        let readyQuestion: @Sendable (String) -> String
        let copy, copied, urgentTitle, urgentBody, urgentPaper, paperLabel, leadNote: String
        let about: @Sendable (String) -> String
        let held: @Sendable (Int) -> String
        let error, busy, unavailable, today: String
    }

    /// ASK_TEXT in web/src/lib/askText.ts, copied exactly. Written by the team, not by a model at runtime. NATIVE REVIEW
    /// NEEDED for every language but English (Amharic most of all), as on the website.
    static let text: [Language: Strings] = [
        .English: Strings(
            title: "Ask my paper",
            intro: "Ask a question. ATLAS answers only with your paper's own words, checked word for word. If your paper doesn't say, we tell you.",
            label: "Your question",
            placeholder: "e.g. When do I stop ibuprofen?",
            button: "Ask my paper",
            asking: "Looking in your paper and checking every word...",
            refusal: "Your paper doesn't say. Ask your clinic or pharmacist.",
            readyLabel: "A question ready to ask",
            readyHint: "Show or read this to your clinic or pharmacist. It uses only your own question.",
            readyQuestion: { q in "I couldn't find the answer to this in my visit paper: \"\(q)\" Can you help me?" },
            copy: "Copy question",
            copied: "Copied",
            urgentTitle: "This may be an emergency",
            urgentBody: "If this is happening now, call 911 or go to the nearest emergency room. ATLAS does not answer emergency questions. For help that is not an emergency, call 211 (United Way of Greater Atlanta) or your clinic.",
            urgentPaper: "What your paper says about warning signs:",
            paperLabel: "Copied word for word from your paper",
            leadNote: "Plain words (not double-checked yet)",
            about: { x in "Your paper says this about \"\(x)\":" },
            held: { n in "\(n) \(n == 1 ? "quote" : "quotes") from the AI held back because the words were not found on your paper." },
            error: "Something went wrong. Try again.",
            busy: "Too many questions right now. Wait a few minutes and try again, or ask your clinic or pharmacist.",
            unavailable: "Ask my paper is not available right now. Ask your clinic or pharmacist.",
            today: "Ask my paper has answered as many questions as it can today. Try again tomorrow, or ask your clinic or pharmacist."
        ),
        // NATIVE REVIEW NEEDED (Spanish).
        .Spanish: Strings(
            title: "Pregúntele a su papel",
            intro: "Haga una pregunta. ATLAS responde solo con las palabras de su papel, revisadas palabra por palabra. Si su papel no lo dice, se lo decimos.",
            label: "Su pregunta",
            placeholder: "p. ej. ¿Cuándo dejo el ibuprofeno?",
            button: "Preguntarle a mi papel",
            asking: "Buscando en su papel y revisando cada palabra...",
            refusal: "Su papel no lo dice. Pregunte en su clínica o a su farmacéutico.",
            readyLabel: "Una pregunta lista para hacer",
            readyHint: "Muestre o lea esto en su clínica o a su farmacéutico. Usa solo su propia pregunta.",
            readyQuestion: { q in "No encontré la respuesta a esto en mi papel de la visita: \"\(q)\" ¿Me puede ayudar?" },
            copy: "Copiar pregunta",
            copied: "Copiada",
            urgentTitle: "Esto puede ser una emergencia",
            urgentBody: "Si esto está pasando ahora, llame al 911 o vaya a la sala de emergencias más cercana. ATLAS no responde preguntas de emergencia. Para ayuda que no es una emergencia, llame al 211 (United Way of Greater Atlanta) o a su clínica.",
            urgentPaper: "Lo que dice su papel sobre señales de alarma:",
            paperLabel: "Copiado palabra por palabra de su papel",
            leadNote: "En palabras sencillas (todavía sin doble revisión)",
            about: { x in "Su papel dice esto sobre \"\(x)\":" },
            held: { n in "\(n) \(n == 1 ? "cita" : "citas") de la IA no se mostraron porque esas palabras no están en su papel." },
            error: "Algo salió mal. Inténtelo de nuevo.",
            busy: "Demasiadas preguntas por ahora. Espere unos minutos e inténtelo de nuevo, o pregunte en su clínica o a su farmacéutico.",
            unavailable: "Preguntarle a su papel no está disponible ahora. Pregunte en su clínica o a su farmacéutico.",
            today: "Hoy ya se respondieron todas las preguntas que se pueden. Inténtelo mañana, o pregunte en su clínica o a su farmacéutico."
        ),
        // NATIVE REVIEW NEEDED (Vietnamese).
        .Vietnamese: Strings(
            title: "Hỏi giấy của tôi",
            intro: "Hãy đặt câu hỏi. ATLAS chỉ trả lời bằng chính lời trong giấy của bạn, được kiểm tra từng chữ. Nếu giấy không nói, chúng tôi sẽ cho bạn biết.",
            label: "Câu hỏi của bạn",
            placeholder: "vd. Khi nào tôi ngưng ibuprofen?",
            button: "Hỏi giấy của tôi",
            asking: "Đang tìm trong giấy của bạn và kiểm tra từng chữ...",
            refusal: "Giấy của bạn không nói về điều này. Hãy hỏi phòng khám hoặc dược sĩ của bạn.",
            readyLabel: "Câu hỏi soạn sẵn",
            readyHint: "Đưa hoặc đọc câu này cho phòng khám hoặc dược sĩ. Câu này chỉ dùng câu hỏi của chính bạn.",
            readyQuestion: { q in "Tôi không tìm thấy câu trả lời cho điều này trong giấy khám bệnh của tôi: \"\(q)\" Bạn có thể giúp tôi không?" },
            copy: "Sao chép câu hỏi",
            copied: "Đã sao chép",
            urgentTitle: "Đây có thể là trường hợp cấp cứu",
            urgentBody: "Nếu việc này đang xảy ra, hãy gọi 911 hoặc đến phòng cấp cứu gần nhất. ATLAS không trả lời câu hỏi cấp cứu. Để được giúp đỡ không khẩn cấp, hãy gọi 211 (United Way of Greater Atlanta) hoặc phòng khám của bạn.",
            urgentPaper: "Giấy của bạn nói gì về các dấu hiệu nguy hiểm:",
            paperLabel: "Chép nguyên văn từ giấy của bạn",
            leadNote: "Lời giải thích đơn giản (chưa được kiểm tra lại)",
            about: { x in "Giấy của bạn nói điều này về \"\(x)\":" },
            held: { n in "\(n) trích dẫn của AI đã bị giữ lại vì không tìm thấy những chữ đó trong giấy của bạn." },
            error: "Đã có lỗi. Hãy thử lại.",
            busy: "Hiện có quá nhiều câu hỏi. Hãy đợi vài phút rồi thử lại, hoặc hỏi phòng khám hay dược sĩ của bạn.",
            unavailable: "Hiện chưa thể hỏi giấy của bạn. Hãy hỏi phòng khám hoặc dược sĩ của bạn.",
            today: "Hôm nay đã trả lời hết số câu hỏi có thể. Hãy thử lại vào ngày mai, hoặc hỏi phòng khám hay dược sĩ của bạn."
        ),
        // NATIVE REVIEW NEEDED (Korean).
        .Korean: Strings(
            title: "내 서류에 물어보기",
            intro: "질문하세요. ATLAS는 서류에 있는 말 그대로만, 한 단어씩 확인해서 답합니다. 서류에 없으면 없다고 알려 드립니다.",
            label: "질문",
            placeholder: "예: 이부프로펜은 언제 끊나요?",
            button: "내 서류에 물어보기",
            asking: "서류에서 찾고 모든 단어를 확인하는 중...",
            refusal: "서류에 나와 있지 않습니다. 병원이나 약사에게 문의하세요.",
            readyLabel: "바로 쓸 수 있는 질문",
            readyHint: "병원이나 약사에게 보여 주거나 읽어 주세요. 본인의 질문만 사용합니다.",
            readyQuestion: { q in "제 진료 서류에서 이 질문의 답을 찾지 못했습니다: \"\(q)\" 도와주실 수 있나요?" },
            copy: "질문 복사",
            copied: "복사됨",
            urgentTitle: "응급 상황일 수 있습니다",
            urgentBody: "지금 일어나고 있다면 911에 전화하거나 가장 가까운 응급실로 가세요. ATLAS는 응급 질문에 답하지 않습니다. 응급이 아닌 도움은 211(United Way of Greater Atlanta)이나 병원에 전화하세요.",
            urgentPaper: "위험 신호에 대해 서류에 적힌 내용:",
            paperLabel: "서류에서 그대로 옮긴 말",
            leadNote: "쉬운 설명 (아직 다시 확인되지 않음)",
            about: { x in "서류에 \"\(x)\"에 대해 이렇게 적혀 있습니다:" },
            held: { n in "서류에서 찾을 수 없는 AI 인용 \(n)개는 보여 드리지 않았습니다." },
            error: "문제가 생겼습니다. 다시 시도하세요.",
            busy: "지금은 질문이 너무 많습니다. 몇 분 뒤에 다시 시도하거나 병원이나 약사에게 문의하세요.",
            unavailable: "지금은 서류에 물어볼 수 없습니다. 병원이나 약사에게 문의하세요.",
            today: "오늘 답할 수 있는 질문 수를 모두 채웠습니다. 내일 다시 시도하거나 병원이나 약사에게 문의하세요."
        ),
        // NATIVE REVIEW NEEDED (Chinese, Simplified).
        .Chinese: Strings(
            title: "问我的文件",
            intro: "请提问。ATLAS 只用您文件里的原话回答，并逐字核对。如果文件里没有写，我们会告诉您。",
            label: "您的问题",
            placeholder: "例如：我什么时候停用布洛芬？",
            button: "问我的文件",
            asking: "正在文件中查找并逐字核对……",
            refusal: "您的文件里没有写。请询问您的诊所或药剂师。",
            readyLabel: "可以直接问的问题",
            readyHint: "把这句话给诊所或药剂师看或读给他们听。它只用了您自己的问题。",
            readyQuestion: { q in "我在就诊文件里没有找到这个问题的答案：\"\(q)\" 您能帮我吗？" },
            copy: "复制问题",
            copied: "已复制",
            urgentTitle: "这可能是紧急情况",
            urgentBody: "如果现在正在发生，请拨打 911 或去最近的急诊室。ATLAS 不回答紧急问题。非紧急的帮助，请拨打 211（United Way of Greater Atlanta）或联系您的诊所。",
            urgentPaper: "您的文件中关于危险信号的内容：",
            paperLabel: "逐字摘自您的文件",
            leadNote: "简单说明（尚未二次核对）",
            about: { x in "您的文件关于\"\(x)\"是这样写的：" },
            held: { n in "有 \(n) 条 AI 引文因为在您的文件中找不到而未显示。" },
            error: "出了点问题。请再试一次。",
            busy: "现在问题太多。请过几分钟再试，或询问您的诊所或药剂师。",
            unavailable: "现在无法询问您的文件。请询问您的诊所或药剂师。",
            today: "今天能回答的问题已经用完了。请明天再试，或询问您的诊所或药剂师。"
        ),
        // NATIVE REVIEW NEEDED (Amharic): highest priority for review.
        .Amharic: Strings(
            title: "ወረቀቴን ልጠይቅ",
            intro: "ጥያቄ ይጠይቁ። ATLAS የሚመልሰው በወረቀትዎ ቃላት ብቻ ነው፣ ቃል በቃል ተረጋግጦ። ወረቀትዎ ካልገለጸ እንነግርዎታለን።",
            label: "ጥያቄዎ",
            placeholder: "ለምሳሌ፦ ኢቡፕሮፌን መቼ ላቁም?",
            button: "ወረቀቴን ልጠይቅ",
            asking: "በወረቀትዎ ውስጥ እየፈለግን እያንዳንዱን ቃል እያረጋገጥን ነው...",
            refusal: "ወረቀትዎ ይህን አይገልጽም። ክሊኒክዎን ወይም ፋርማሲስትዎን ይጠይቁ።",
            readyLabel: "ለመጠየቅ የተዘጋጀ ጥያቄ",
            readyHint: "ይህን ለክሊኒክዎ ወይም ለፋርማሲስትዎ ያሳዩ ወይም ያንብቡ። የራስዎን ጥያቄ ብቻ ይጠቀማል።",
            readyQuestion: { q in "ለዚህ ጥያቄ መልሱን በጉብኝት ወረቀቴ ላይ ማግኘት አልቻልኩም፦ \"\(q)\" ሊረዱኝ ይችላሉ?" },
            copy: "ጥያቄውን ቅዳ",
            copied: "ተቀድቷል",
            urgentTitle: "ይህ ድንገተኛ ሊሆን ይችላል",
            urgentBody: "ይህ አሁን እየሆነ ከሆነ 911 ይደውሉ ወይም በአቅራቢያ ወዳለው ድንገተኛ ክፍል ይሂዱ። ATLAS የድንገተኛ ጥያቄዎችን አይመልስም። ድንገተኛ ላልሆነ እርዳታ 211 (United Way of Greater Atlanta) ወይም ክሊኒክዎን ይደውሉ።",
            urgentPaper: "ወረቀትዎ ስለ አደገኛ ምልክቶች የሚለው፦",
            paperLabel: "ከወረቀትዎ ቃል በቃል የተገለበጠ",
            leadNote: "ቀላል ማብራሪያ (ገና ድጋሚ አልተረጋገጠም)",
            about: { x in "ወረቀትዎ ስለ \"\(x)\" ይህን ይላል፦" },
            held: { n in "በወረቀትዎ ላይ ስላልተገኙ \(n) የAI ጥቅሶች አልታዩም።" },
            error: "ችግር ተፈጥሯል። እንደገና ይሞክሩ።",
            busy: "አሁን በጣም ብዙ ጥያቄዎች አሉ። ጥቂት ደቂቃዎች ጠብቀው እንደገና ይሞክሩ፣ ወይም ክሊኒክዎን ወይም ፋርማሲስትዎን ይጠይቁ።",
            unavailable: "አሁን ወረቀትዎን መጠየቅ አይቻልም። ክሊኒክዎን ወይም ፋርማሲስትዎን ይጠይቁ።",
            today: "ዛሬ ሊመለሱ የሚችሉት ጥያቄዎች በሙሉ ተመልሰዋል። ነገ እንደገና ይሞክሩ፣ ወይም ክሊኒክዎን ወይም ፋርማሲስትዎን ይጠይቁ።"
        ),
        // NATIVE REVIEW NEEDED (French).
        .French: Strings(
            title: "Interroger mon document",
            intro: "Posez une question. ATLAS répond uniquement avec les mots de votre document, vérifiés mot pour mot. Si votre document ne le dit pas, nous vous le disons.",
            label: "Votre question",
            placeholder: "ex. Quand dois-je arrêter l'ibuprofène ?",
            button: "Interroger mon document",
            asking: "Recherche dans votre document et vérification de chaque mot...",
            refusal: "Votre document ne le dit pas. Demandez à votre clinique ou à votre pharmacien.",
            readyLabel: "Une question prête à poser",
            readyHint: "Montrez ou lisez ceci à votre clinique ou à votre pharmacien. Elle reprend seulement votre propre question.",
            readyQuestion: { q in "Je n'ai pas trouvé la réponse à ceci dans mon document de visite : \"\(q)\" Pouvez-vous m'aider ?" },
            copy: "Copier la question",
            copied: "Copiée",
            urgentTitle: "Cela peut être une urgence",
            urgentBody: "Si cela se produit maintenant, appelez le 911 ou allez aux urgences les plus proches. ATLAS ne répond pas aux questions urgentes. Pour une aide qui n'est pas urgente, appelez le 211 (United Way of Greater Atlanta) ou votre clinique.",
            urgentPaper: "Ce que dit votre document sur les signes d'alerte :",
            paperLabel: "Copié mot pour mot de votre document",
            leadNote: "En mots simples (pas encore vérifié une seconde fois)",
            about: { x in "Votre document dit ceci sur \"\(x)\" :" },
            held: { n in "\(n) \(n == 1 ? "citation" : "citations") de l'IA retenue\(n == 1 ? "" : "s") car ces mots ne sont pas dans votre document." },
            error: "Un problème est survenu. Réessayez.",
            busy: "Trop de questions en ce moment. Attendez quelques minutes et réessayez, ou demandez à votre clinique ou à votre pharmacien.",
            unavailable: "Interroger votre document n'est pas disponible pour le moment. Demandez à votre clinique ou à votre pharmacien.",
            today: "Le nombre de questions possibles pour aujourd'hui est atteint. Réessayez demain, ou demandez à votre clinique ou à votre pharmacien."
        ),
    ]

    /// The strings in the person's language (English when missing, as on the website).
    static func strings(_ language: Language) -> Strings { text[language] ?? text[.English]! }
    static func strings(_ language: String) -> Strings { Language(rawValue: language).map(strings) ?? text[.English]! }

    // MARK: Urgent questions (isUrgentQuestion in askText.ts)

    private static let S = #"\s+"#

    /// ASKED_URGENT: how people ASK about an emergency that a paper's warning line would not say. Whole words with
    /// letter-aware edges, the same pattern text as the website.
    private static let askedUrgent = SafetyPattern(source: #"(?<![\p{L}\p{N}])(?:"# + [
        // English
        "chest\(S)(?:hurts|is\(S)hurting)|heart\(S)attack|overdos\\p{L}*|took\(S)too\(S)(?:many|much)|took\(S)(?:all|the\(S)whole)|swallowed\(S)(?:all|the\(S)whole|a\(S)bottle)|whole\(S)bottle",
        "not\(S)breathing|stopped\(S)breathing|chok(?:ing|ed)|unconscious|won['’]?t\(S)wake\(S)up|bleeding\(S)(?:a\(S)lot|heavily)|won['’]?t\(S)stop\(S)bleeding",
        "kill\(S)(?:my|him|her)self|end\(S)my\(S)life|hurt\(S)myself|want\(S)to\(S)die|took\(S)\\d+\(S)(?:pills|tablets|capsules)",
        "throat\(S)(?:is\(S))?(?:closing|swelling|swollen)|(?:coughing|cough|vomiting|throwing)\(S)(?:up\(S))?blood|blood\(S)in\(S)(?:my\(S))?(?:vomit|stool)",
        "face\(S)(?:is\(S))?drooping|slurred\(S)speech|speech\(S)is\(S)slurred|can['’]?t\(S)(?:talk|speak)\(S)(?:right|properly)",
        // Spanish
        "me\(S)duele\(S)el\(S)pecho|ataque\(S)al\(S)coraz[oó]n|sobredosis|no\(S)puedo\(S)respirar|no\(S)respira|inconsciente|quitarme\(S)la\(S)vida",
        "quiero\(S)morir(?:me)?|se\(S)me\(S)cierra\(S)la\(S)garganta|(?:tosiendo|tos[oó]?|vomitando|vomit[oó])\(S)(?:con\(S))?sangre",
        // French
        "crise\(S)cardiaque|surdose|je\(S)ne\(S)peux\(S)(?:pas\(S))?respirer|inconscient\\p{L}*",
        "(?:ma\(S))?gorge\(S)se\(S)(?:ferme|serre)|(?:je\(S))?(?:crache|tousse|vomis)\(S)du\(S)sang|je\(S)veux\(S)mourir",
        // Vietnamese
        "đau\(S)tim|không\(S)thở\(S)được|quá\(S)liều|bất\(S)tỉnh|ho\(S)ra\(S)máu|nôn\(S)ra\(S)máu|muốn\(S)chết",
    ].joined(separator: "|") + #")(?![\p{L}\p{N}])"#, flags: "iu").regex()

    /// ASKED_URGENT_CJK_AM: Korean, Chinese and Amharic, matched as substrings (no word edges).
    private static let askedUrgentCJKAm = SafetyPattern(
        source: #"심장\s*마비|과다\s*복용|숨을\s*못\s*쉬|숨이\s*막|피를\s*토|각혈|목이\s*부|죽고\s*싶|心脏病发作|心臟病發作|服药过量|服藥過量|喘不上气|不能呼吸|咳血|吐血|喉咙肿|喉嚨腫|想死|የልብ\s*ድካም|መተንፈስ\s*አልችልም|ደም\s*(?:እያስታወከኝ|አስታወከኝ|ማስመለስ|እየተፋሁ)|መሞት\s*እፈልጋለሁ"#,
        flags: "u").regex()

    private static let jsSpaces = try! NSRegularExpression(pattern: SafetyPattern.jsSpaceClass + "+")

    /// True when the question looks like an emergency happening now: the paper's warning words (WarningPin, all seven
    /// languages) plus the asking forms above. Errs toward caution.
    static func isUrgentQuestion(_ question: String) -> Bool {
        let t = Regexes.replaceAll(jsSpaces, in: question.precomposedStringWithCanonicalMapping, with: " ")
        return WarningPin.fromPaper(t) || Regexes.test(askedUrgent, t) || Regexes.test(askedUrgentCJKAm, t)
    }

    // MARK: The ready question (askAboutQuestion)

    /// The person's own question inside fixed words, for their clinic or pharmacist. No AI and no paper text.
    static func askAboutQuestion(_ question: String, language: String) -> PaperFirst.AskPerson {
        let t = strings(language)
        let q = StepsWhen.trim(StepsWhen.spaces(question)) as NSString
        let cut = q.substring(to: min(q.length, maxQuestion))
        return PaperFirst.AskPerson(who: "clinic", label: t.readyLabel, question: t.readyQuestion(cut))
    }

    /// The question as sent: runs of spaces as one, trimmed (AskPaper.tsx).
    static func cleanQuestion(_ question: String) -> String { StepsWhen.trim(StepsWhen.spaces(question)) }

    // MARK: The server's answer

    struct Span: Codable, Equatable, Sendable {
        /// Read as numbers, so a span that is not a whole number is refused instead of failing the whole answer.
        let start: Double
        let end: Double
    }

    struct Quote: Codable, Equatable, Sendable {
        let text: String
        let span: Span
    }

    /// AskResponse in web/src/lib/ask.ts.
    enum Response: Equatable, Sendable {
        case answer(quotes: [Quote], topic: String?, dropped: [String])
        case notInPaper(dropped: [String])
        case urgent
    }

    private struct Wire: Decodable {
        let kind: String
        let quotes: [Quote]?
        let topic: String?
        let dropped: [String]?
    }

    /// Reads the server's JSON. Anything that is not one of the three kinds is an error, as on the website.
    static func decode(_ data: Data) -> Response? {
        guard let w = try? JSONDecoder().decode(Wire.self, from: data) else { return nil }
        switch w.kind {
        case "answer": return .answer(quotes: w.quotes ?? [], topic: w.topic, dropped: w.dropped ?? [])
        case "not_in_paper": return .notInPaper(dropped: w.dropped ?? [])
        case "urgent": return .urgent
        default: return nil
        }
    }

    /// onThisPaper in AskPaper.tsx: keeps only quotes whose words are exactly this paper's text at their span (the
    /// same span Show on my paper would mark), so the words shown and the place they come from can never be two different
    /// texts. If none is left, the answer becomes the fixed refusal. A dropped quote also drops the topic.
    static func onThisPaper(_ res: Response, source: String) -> Response {
        guard case let .answer(quotes, topic, dropped) = res else { return res }
        let ns = source as NSString
        func ok(_ q: Quote) -> Bool {
            let s = q.span.start, e = q.span.end
            guard s.rounded() == s, e.rounded() == e, s >= 0, e <= Double(ns.length), s < e else { return false }
            let range = NSRange(location: Int(s), length: Int(e) - Int(s))
            return Array(ns.substring(with: range).utf16) == Array(q.text.utf16)
        }
        let kept = quotes.filter(ok)
        let lost = dropped + Array(repeating: "not_in_paper", count: quotes.count - kept.count)
        if kept.isEmpty { return .notInPaper(dropped: lost) }
        return .answer(quotes: kept, topic: kept.count == quotes.count ? topic : nil, dropped: lost)
    }

    /// How many quotes were held back (shown as one small line under the answer).
    static func held(_ res: Response) -> Int {
        switch res {
        case let .answer(_, _, dropped), let .notInPaper(dropped): dropped.count
        case .urgent: 0
        }
    }

    /// The person sees fixed words in their language, never the server's English: the shared daily cap says try
    /// tomorrow, any other 429 says wait, 503 says not available, anything else says try again.
    static func errorMessage(status: Int, limitHeader: String?, language: Language) -> String {
        let t = strings(language)
        if status == 429 { return limitHeader == "shared-daily" ? t.today : t.busy }
        if status == 503 { return t.unavailable }
        return t.error
    }

    /// The paper's own warning lines for the urgent card: only steps whose OWN words are warning language (the
    /// model's "warning_sign" kind is not evidence).
    static func warningLines(_ items: [VerifiedItem]) -> [VerifiedItem] {
        items.filter { $0.grounded && WarningPin.fromPaper($0.source_quote) }
    }
}
