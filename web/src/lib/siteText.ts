/**
 * The SITE's own words (nav, hero, How it works, Why, Trust, footer, intro) in every app language. Pure, no AI.
 *
 * Why this exists: a tester's friend tried the site in Spanish (Oct 5) and liked it, but wished the language choice
 * covered the whole website, not only the paper-reading tool, "for people who don't know that much English".
 * lib/uiText.ts already translates the tools; this file does the same for the pages around them, and the language
 * picker in the nav (ui/SiteLang.tsx) sets both at once.
 *
 * Same rules as lib/uiText.ts:
 * - Quotes from the sample paper stay exactly as written (the paper-first rule); only the words around them change.
 * - Numbers, names and sources stay as they are: ATLAS, MARTA, HRSA, 211, 911, study and agency names, every figure.
 * - Register: the polite form a clinic uses with a patient or family (UI_REGISTER in lib/uiText.ts).
 * - Every non-English entry is a MACHINE DRAFT (SITE_REVIEWED). Nothing here claims native review.
 */

import type { Lang } from "./uiText";

/** Review status of these translations. Machine drafts until a native speaker checks them. */
export const SITE_REVIEWED: Record<Lang, string | false> = {
  English: "source", Spanish: false, Vietnamese: false, Korean: false, Chinese: false, Amharic: false, French: false,
};

type Row = Record<Lang, string>;

export const SITE_TEXT = {
  "nav.how": {
    English: "How it works", Spanish: "Cómo funciona", Vietnamese: "Cách hoạt động", Korean: "사용 방법", Chinese: "如何使用",
    Amharic: "እንዴት እንደሚሰራ", French: "Comment ça marche",
  },
  "nav.try": {
    English: "Try it", Spanish: "Pruébelo", Vietnamese: "Dùng thử", Korean: "사용해 보기", Chinese: "试一试", Amharic: "ይሞክሩት",
    French: "Essayez",
  },
  "nav.why": {
    English: "Why it matters", Spanish: "Por qué importa", Vietnamese: "Vì sao quan trọng", Korean: "왜 중요한가요", Chinese: "为什么重要",
    Amharic: "ለምን አስፈላጊ ነው", French: "Pourquoi c'est important",
  },
  "nav.trust": {
    English: "Trust & data", Spanish: "Confianza y datos", Vietnamese: "Tin cậy và dữ liệu", Korean: "신뢰와 데이터", Chinese: "可信与数据",
    Amharic: "እምነት እና መረጃ", French: "Confiance et données",
  },
  "nav.tests": {
    English: "Our tests", Spanish: "Nuestras pruebas", Vietnamese: "Kiểm tra của chúng tôi", Korean: "우리의 테스트", Chinese: "我们的测试",
    Amharic: "የእኛ ሙከራዎች", French: "Nos tests",
  },
  "nav.language": {
    English: "Language", Spanish: "Idioma", Vietnamese: "Ngôn ngữ", Korean: "언어", Chinese: "语言", Amharic: "ቋንቋ", French: "Langue",
  },
  "nav.languageHint": {
    English: "Shows this website and ATLAS's explanations in your language. Your paper's own words never change.",
    Spanish: "Muestra este sitio web y las explicaciones de ATLAS en su idioma. Las palabras de su hoja nunca cambian.",
    Vietnamese: "Hiển thị trang web này và phần giải thích của ATLAS bằng ngôn ngữ của quý vị. Lời trên giấy của quý vị không bao giờ thay đổi.",
    Korean: "이 웹사이트와 ATLAS의 설명을 원하시는 언어로 보여 드립니다. 서류에 적힌 원래 문장은 바뀌지 않습니다.",
    Chinese: "用您的语言显示本网站和 ATLAS 的解释。您文件上的原文永远不会改变。",
    Amharic: "ይህንን ድረ ገጽ እና የ ATLAS ማብራሪያዎችን በቋንቋዎ ያሳያል። በሰነድዎ ላይ ያሉት ቃላት በጭራሽ አይቀየሩም።",
    French: "Affiche ce site et les explications d'ATLAS dans votre langue. Les mots de votre document ne changent jamais.",
  },
  "hero.note": {
    English: "for whoever is helping someone after a clinic visit",
    Spanish: "para quien ayuda a alguien después de una cita médica",
    Vietnamese: "dành cho người đang giúp ai đó sau buổi khám bệnh",
    Korean: "진료 후 누군가를 돕고 계신 분을 위해",
    Chinese: "献给在就诊后照顾他人的每一个人",
    Amharic: "ከክሊኒክ ጉብኝት በኋላ ሌላ ሰውን ለሚረዱ ሁሉ",
    French: "pour toute personne qui aide quelqu'un après une consultation",
  },
  "hero.title": {
    English: "Your visit, turned into a plan you can actually finish.",
    Spanish: "Su cita, convertida en un plan que de verdad puede terminar.",
    Vietnamese: "Buổi khám của quý vị, thành một kế hoạch quý vị thật sự làm xong được.",
    Korean: "진료 내용을, 끝까지 해낼 수 있는 계획으로.",
    Chinese: "把您的就诊，变成一个真正能完成的计划。",
    Amharic: "ጉብኝትዎ፣ በእርግጥ ሊጨርሱት ወደሚችሉት እቅድ ተቀይሯል።",
    French: "Votre consultation, transformée en un plan que vous pouvez vraiment mener à bout.",
  },
  "hero.sub": {
    English: "Snap the after-visit summary. ATLAS explains every step in your language and shows the exact line it came from. Then it plans around what gets in the way, like a ride, the cost or the language, using verified Atlanta health centers and programs. If it can't point to it, it won't say it.",
    Spanish: "Tómele una foto al resumen de su cita. ATLAS explica cada paso en su idioma y le muestra la línea exacta de donde viene. Luego hace un plan según lo que se lo complica, como el transporte, el costo o el idioma, con centros de salud y programas verificados de Atlanta. Si no puede señalarlo en su hoja, no lo dice.",
    Vietnamese: "Chụp ảnh bản tóm tắt sau buổi khám. ATLAS giải thích từng bước bằng ngôn ngữ của quý vị và chỉ ra đúng dòng mà bước đó lấy từ đâu. Sau đó, ATLAS lập kế hoạch dựa trên những gì gây khó khăn, như phương tiện đi lại, chi phí hoặc ngôn ngữ, với các trung tâm y tế và chương trình đã được xác minh ở Atlanta. Nếu không chỉ ra được trên giấy, ATLAS sẽ không nói.",
    Korean: "진료 후 요약지를 사진으로 찍으세요. ATLAS가 모든 단계를 원하시는 언어로 설명하고, 그 내용이 나온 정확한 줄을 보여 드립니다. 그다음 교통편, 비용, 언어처럼 어려운 점에 맞춰 확인된 애틀랜타 보건소와 프로그램으로 계획을 세웁니다. 서류에서 찾을 수 없는 내용은 말하지 않습니다.",
    Chinese: "拍下就诊总结。ATLAS 用您的语言解释每一个步骤，并指出它出自哪一行原文。然后，它会针对交通、费用或语言等困难，利用经过核实的亚特兰大社区医疗中心和项目来制定计划。如果在原文中找不到依据，它就不会说。",
    Amharic: "የጉብኝት ማጠቃለያውን ፎቶ ያንሱ። ATLAS እያንዳንዱን እርምጃ በቋንቋዎ ያብራራል እና የመጣበትን ትክክለኛ መስመር ያሳያል። ከዚያም እንደ መጓጓዣ፣ ወጪ ወይም ቋንቋ ያሉ እንቅፋቶችን ከግምት ውስጥ በማስገባት በተረጋገጡ የአትላንታ የጤና ማዕከላት እና ፕሮግራሞች እቅድ ያወጣል። በሰነዱ ላይ ሊያሳየው ካልቻለ አይናገረውም።",
    French: "Prenez en photo le résumé de votre consultation. ATLAS explique chaque étape dans votre langue et montre la ligne exacte d'où elle vient. Puis il fait un plan selon ce qui vous bloque, comme le transport, le coût ou la langue, avec des centres de santé et des programmes vérifiés d'Atlanta. S'il ne peut pas le montrer sur votre document, il ne le dit pas.",
  },
  "hero.try": {
    English: "Try it with a sample", Spanish: "Pruébelo con un ejemplo", Vietnamese: "Dùng thử với giấy mẫu", Korean: "예시로 사용해 보기",
    Chinese: "用示例试一试", Amharic: "በምሳሌ ይሞክሩት", French: "Essayez avec un exemple",
  },
  "hero.noAccount": {
    English: "no account needed", Spanish: "sin crear cuenta", Vietnamese: "không cần tài khoản", Korean: "계정 필요 없음",
    Chinese: "无需注册账号", Amharic: "አካውንት አያስፈልግም", French: "sans créer de compte",
  },
  "loop.yourPlan": {
    English: "Your plan", Spanish: "Su plan", Vietnamese: "Kế hoạch của quý vị", Korean: "나의 계획", Chinese: "您的计划", Amharic: "የእርስዎ እቅድ",
    French: "Votre plan",
  },
  "loop.sample": {
    English: "sample", Spanish: "ejemplo", Vietnamese: "mẫu", Korean: "예시", Chinese: "示例", Amharic: "ምሳሌ", French: "exemple",
  },
  "loop.0.chip": {
    English: "From your paper", Spanish: "De su hoja", Vietnamese: "Từ giấy của quý vị", Korean: "서류에서", Chinese: "来自您的文件",
    Amharic: "ከሰነድዎ", French: "De votre document",
  },
  "loop.0.title": {
    English: "Start metformin 500 mg", Spanish: "Empiece metformina 500 mg", Vietnamese: "Bắt đầu dùng metformin 500 mg",
    Korean: "메트포르민 500 mg 시작", Chinese: "开始服用二甲双胍 500 mg", Amharic: "ሜትፎርሚን 500 mg ይጀምሩ", French: "Commencez la metformine 500 mg",
  },
  "loop.0.body": {
    English: "1 tablet, 2 times a day, with meals.", Spanish: "1 tableta, 2 veces al día, con las comidas.",
    Vietnamese: "1 viên, 2 lần mỗi ngày, uống trong bữa ăn.", Korean: "1정씩, 하루 2번, 식사와 함께.", Chinese: "每次 1 片，每天 2 次，随餐服用。",
    Amharic: "1 ኪኒን፣ በቀን 2 ጊዜ፣ ከምግብ ጋር።", French: "1 comprimé, 2 fois par jour, pendant les repas.",
  },
  "loop.1.chip": {
    English: "Ask your clinic", Spanish: "Pregunte en su clínica", Vietnamese: "Hỏi phòng khám", Korean: "병원에 물어보세요", Chinese: "询问诊所",
    Amharic: "ክሊኒክዎን ይጠይቁ", French: "Demandez à votre clinique",
  },
  "loop.1.title": {
    English: "Fasting blood test", Spanish: "Análisis de sangre en ayunas", Vietnamese: "Xét nghiệm máu lúc đói", Korean: "공복 혈액 검사",
    Chinese: "空腹验血", Amharic: "የጾም የደም ምርመራ", French: "Prise de sang à jeun",
  },
  "loop.1.body": {
    English: "Within 2 weeks. The paper doesn't say how many hours to fast.",
    Spanish: "En las próximas 2 semanas. La hoja no dice cuántas horas de ayuno.",
    Vietnamese: "Trong vòng 2 tuần. Giấy không ghi phải nhịn ăn bao nhiêu giờ.",
    Korean: "2주 이내. 몇 시간 금식해야 하는지는 서류에 없습니다.",
    Chinese: "2 周内完成。文件上没有写要空腹多少小时。",
    Amharic: "በ 2 ሳምንት ውስጥ። ሰነዱ ስንት ሰዓት መጾም እንዳለብዎ አይገልጽም።",
    French: "D'ici 2 semaines. Le document ne dit pas combien d'heures de jeûne.",
  },
  "loop.2.chip": {
    English: "Getting there", Spanish: "Cómo llegar", Vietnamese: "Đi lại", Korean: "가는 방법", Chinese: "交通", Amharic: "መድረሻ",
    French: "Pour y aller",
  },
  "loop.2.title": {
    English: "Closest health center", Spanish: "Centro de salud más cercano", Vietnamese: "Trung tâm y tế gần nhất", Korean: "가장 가까운 보건소",
    Chinese: "最近的社区医疗中心", Amharic: "በጣም ቅርብ የሆነ የጤና ማዕከል", French: "Centre de santé le plus proche",
  },
  "loop.2.body": {
    English: "Sliding fee by law. Nearest MARTA stop shown on the plan.",
    Spanish: "Por ley cobra según sus ingresos. La parada de MARTA más cercana aparece en el plan.",
    Vietnamese: "Theo luật, phí tính theo thu nhập. Trạm MARTA gần nhất có trong kế hoạch.",
    Korean: "법에 따라 소득별 요금 적용. 가장 가까운 MARTA 정류장이 계획에 나옵니다.",
    Chinese: "依法按收入浮动收费。计划中会显示最近的 MARTA 站点。",
    Amharic: "በሕግ መሠረት ክፍያው በገቢ ላይ የተመሠረተ ነው። በጣም ቅርብ የሆነው የ MARTA ማቆሚያ በእቅዱ ላይ ይታያል።",
    French: "Tarif selon les revenus, prévu par la loi. L'arrêt MARTA le plus proche figure sur le plan.",
  },
  "how.title": {
    English: "How it works", Spanish: "Cómo funciona", Vietnamese: "Cách hoạt động", Korean: "사용 방법", Chinese: "如何使用",
    Amharic: "እንዴት እንደሚሰራ", French: "Comment ça marche",
  },
  "how.note": {
    English: "built for community health workers, nonprofits and the people they help",
    Spanish: "hecho para promotores de salud, organizaciones sin fines de lucro y las personas a quienes ayudan",
    Vietnamese: "dành cho nhân viên y tế cộng đồng, tổ chức phi lợi nhuận và những người họ giúp đỡ",
    Korean: "지역 보건 요원, 비영리 단체, 그리고 그들이 돕는 분들을 위해 만들었습니다",
    Chinese: "为社区卫生工作者、非营利组织以及他们帮助的人而打造",
    Amharic: "ለማህበረሰብ ጤና ሠራተኞች፣ ለትርፍ ላልተቋቋሙ ድርጅቶች እና ለሚረዷቸው ሰዎች የተሰራ",
    French: "conçu pour les agents de santé communautaires, les associations et les personnes qu'ils aident",
  },
  "how.step": {
    English: "Step {n}", Spanish: "Paso {n}", Vietnamese: "Bước {n}", Korean: "{n}단계", Chinese: "第 {n} 步", Amharic: "ደረጃ {n}",
    French: "Étape {n}",
  },
  "how.1.chip": { English: "CAMERA", Spanish: "CÁMARA", Vietnamese: "MÁY ẢNH", Korean: "카메라", Chinese: "拍照", Amharic: "ካሜራ", French: "PHOTO" },
  "how.1.title": {
    English: "Snap the paper", Spanish: "Fotografíe la hoja", Vietnamese: "Chụp ảnh tờ giấy", Korean: "서류 찍기", Chinese: "拍下文件",
    Amharic: "ሰነዱን ፎቶ ያንሱ", French: "Photographiez le document",
  },
  "how.1.body": {
    English: "Take a photo of the after-visit summary, or paste it. No account, nothing saved unless you choose.",
    Spanish: "Tómele una foto al resumen de la cita, o péguelo. Sin cuenta, y no se guarda nada a menos que usted lo decida.",
    Vietnamese: "Chụp ảnh bản tóm tắt sau buổi khám, hoặc dán chữ vào. Không cần tài khoản, không lưu gì trừ khi quý vị muốn.",
    Korean: "진료 후 요약지를 사진으로 찍거나 붙여 넣으세요. 계정이 필요 없고, 원하실 때만 저장됩니다.",
    Chinese: "拍下就诊总结，或粘贴文字。无需账号，除非您选择，否则不会保存任何内容。",
    Amharic: "የጉብኝት ማጠቃለያውን ፎቶ ያንሱ ወይም ይለጥፉት። አካውንት አያስፈልግም፤ እርስዎ ካልመረጡ ምንም አይቀመጥም።",
    French: "Prenez une photo du résumé de consultation, ou collez-le. Pas de compte, rien n'est gardé sauf si vous le choisissez.",
  },
  "how.1.note": {
    English: "the paper you already have", Spanish: "la hoja que ya tiene", Vietnamese: "tờ giấy quý vị đã có", Korean: "이미 갖고 계신 서류",
    Chinese: "您手上已有的文件", Amharic: "ቀድሞውንም ያለዎት ሰነድ", French: "le document que vous avez déjà",
  },
  "how.2.chip": { English: "GROUNDED", Spanish: "CON FUENTE", Vietnamese: "CÓ CĂN CỨ", Korean: "근거 있음", Chinese: "有据可查", Amharic: "በማስረጃ", French: "SOURCÉ" },
  "how.2.title": {
    English: "Only what's written", Spanish: "Solo lo que está escrito", Vietnamese: "Chỉ những gì đã viết", Korean: "적힌 내용만",
    Chinese: "只说写了的内容", Amharic: "የተጻፈውን ብቻ", French: "Seulement ce qui est écrit",
  },
  "how.2.body": {
    English: "Every medicine, lab, referral and warning sign is explained in your language and tied to the exact line it came from.",
    Spanish: "Cada medicina, análisis, referido y señal de alarma se explica en su idioma y se une a la línea exacta de donde viene.",
    Vietnamese: "Mỗi loại thuốc, xét nghiệm, giấy giới thiệu và dấu hiệu cảnh báo đều được giải thích bằng ngôn ngữ của quý vị và gắn với đúng dòng mà nó lấy từ đó.",
    Korean: "모든 약, 검사, 의뢰, 위험 신호를 원하시는 언어로 설명하고, 그 내용이 나온 정확한 줄과 연결합니다.",
    Chinese: "每一种药物、检查、转诊和危险信号都用您的语言解释，并与它出自的那一行原文对应。",
    Amharic: "እያንዳንዱ መድኃኒት፣ ምርመራ፣ ሪፈራል እና የአደጋ ምልክት በቋንቋዎ ይብራራል፣ ከመጣበት ትክክለኛ መስመር ጋርም ይያያዛል።",
    French: "Chaque médicament, analyse, orientation et signe d'alerte est expliqué dans votre langue et relié à la ligne exacte d'où il vient.",
  },
  "how.2.note": {
    English: "if it can't point to it, it won't say it", Spanish: "si no puede señalarlo, no lo dice",
    Vietnamese: "không chỉ ra được thì không nói", Korean: "찾을 수 없으면 말하지 않습니다", Chinese: "找不到依据，就不说",
    Amharic: "ሊያሳየው ካልቻለ አይናገረውም", French: "s'il ne peut pas le montrer, il ne le dit pas",
  },
  "how.3.chip": { English: "VERIFIED", Spanish: "VERIFICADO", Vietnamese: "ĐÃ XÁC MINH", Korean: "확인됨", Chinese: "已核实", Amharic: "የተረጋገጠ", French: "VÉRIFIÉ" },
  "how.3.title": {
    English: "Plan around what's in the way", Spanish: "Un plan según lo que se lo complica", Vietnamese: "Lập kế hoạch quanh những trở ngại",
    Korean: "어려운 점에 맞춘 계획", Chinese: "围绕困难制定计划", Amharic: "እንቅፋቶችን ያገናዘበ እቅድ", French: "Un plan autour de ce qui vous bloque",
  },
  "how.3.body": {
    English: "Tell us what makes it hard: a ride, the cost, coverage, language. We match verified health centers, MARTA stops and programs.",
    Spanish: "Díganos qué se lo complica: el transporte, el costo, el seguro, el idioma. Le buscamos centros de salud, paradas de MARTA y programas verificados.",
    Vietnamese: "Cho chúng tôi biết điều gì gây khó khăn: đi lại, chi phí, bảo hiểm, ngôn ngữ. Chúng tôi tìm trung tâm y tế, trạm MARTA và chương trình đã xác minh.",
    Korean: "교통편, 비용, 보험, 언어 등 어려운 점을 알려 주세요. 확인된 보건소, MARTA 정류장, 프로그램을 찾아 드립니다.",
    Chinese: "告诉我们您的困难：交通、费用、保险、语言。我们为您匹配经过核实的社区医疗中心、MARTA 站点和项目。",
    Amharic: "ምን እንደሚያስቸግርዎ ይንገሩን፦ መጓጓዣ፣ ወጪ፣ ኢንሹራንስ፣ ቋንቋ። የተረጋገጡ የጤና ማዕከላትን፣ የ MARTA ማቆሚያዎችን እና ፕሮግራሞችን እናገናኝልዎታለን።",
    French: "Dites-nous ce qui est difficile : le transport, le coût, l'assurance, la langue. Nous trouvons des centres de santé, des arrêts MARTA et des programmes vérifiés.",
  },
  "how.3.note": {
    English: "real places, real phone numbers", Spanish: "lugares reales, teléfonos reales", Vietnamese: "nơi có thật, số điện thoại thật",
    Korean: "실제 장소, 실제 전화번호", Chinese: "真实的地点，真实的电话", Amharic: "እውነተኛ ቦታዎች፣ እውነተኛ ስልክ ቁጥሮች",
    French: "de vrais lieux, de vrais numéros",
  },
  "how.4.chip": {
    English: "FOLLOW-THROUGH", Spanish: "SEGUIMIENTO", Vietnamese: "THEO DÕI ĐẾN CÙNG", Korean: "끝까지 관리", Chinese: "跟进到底", Amharic: "ክትትል",
    French: "SUIVI",
  },
  "how.4.title": {
    English: "Bring it back", Spanish: "Para la próxima cita", Vietnamese: "Mang theo lần sau", Korean: "다음 진료에 가져가기",
    Chinese: "带回下次就诊", Amharic: "ለሚቀጥለው ጉብኝት", French: "Pour la prochaine fois",
  },
  "how.4.body": {
    English: "Check things off, keep questions for the next visit, and hand off to a community health worker when it needs a person.",
    Spanish: "Marque lo que ya hizo, guarde preguntas para la próxima cita y pase el caso a un promotor de salud cuando haga falta una persona.",
    Vietnamese: "Đánh dấu việc đã làm, ghi câu hỏi cho buổi khám sau, và chuyển cho nhân viên y tế cộng đồng khi cần một người giúp.",
    Korean: "한 일을 체크하고, 다음 진료 때 물어볼 질문을 모아 두고, 사람의 도움이 필요할 땐 지역 보건 요원에게 넘기세요.",
    Chinese: "完成后打勾，把问题留到下次就诊，需要有人帮忙时转交给社区卫生工作者。",
    Amharic: "የሠሩትን ምልክት ያድርጉ፣ ለሚቀጥለው ጉብኝት ጥያቄዎችን ያስቀምጡ፣ ሰው ሲያስፈልግ ደግሞ ለማህበረሰብ ጤና ሠራተኛ ያስተላልፉ።",
    French: "Cochez ce qui est fait, gardez vos questions pour la prochaine visite, et passez le relais à un agent de santé communautaire quand il faut une personne.",
  },
  "how.4.note": {
    English: "a person when it needs one", Spanish: "una persona cuando hace falta", Vietnamese: "có người giúp khi cần",
    Korean: "필요할 땐 사람이", Chinese: "需要时有人帮忙", Amharic: "ሲያስፈልግ ሰው", French: "une personne quand il le faut",
  },
  "why.title": {
    English: "Why this exists", Spanish: "Por qué existe", Vietnamese: "Vì sao có ATLAS", Korean: "왜 만들었나요", Chinese: "为什么要做这个",
    Amharic: "ይህ ለምን አስፈለገ", French: "Pourquoi ce projet existe",
  },
  "why.lead": {
    English: "The visit ends. The hard part starts in the parking lot.",
    Spanish: "La cita termina. Lo difícil empieza en el estacionamiento.",
    Vietnamese: "Buổi khám kết thúc. Phần khó bắt đầu ngay ở bãi đậu xe.",
    Korean: "진료는 끝났습니다. 어려운 일은 주차장에서 시작됩니다.",
    Chinese: "就诊结束了。难的部分，从停车场就开始了。",
    Amharic: "ጉብኝቱ ያበቃል። ከባዱ ነገር የሚጀምረው መኪና ማቆሚያው ላይ ነው።",
    French: "La consultation se termine. Le plus dur commence sur le parking.",
  },
  "why.0": {
    English: "of US adults have Basic or Below Basic health literacy. Below Basic is about double the national rate among Medicaid recipients (30%) and the uninsured (28%).",
    Spanish: "de los adultos en EE. UU. tienen un nivel Básico o Inferior al Básico de alfabetización en salud. El nivel Inferior al Básico es casi el doble del promedio nacional entre quienes reciben Medicaid (30%) y quienes no tienen seguro (28%).",
    Vietnamese: "người trưởng thành ở Mỹ có mức hiểu biết về sức khỏe Cơ bản hoặc Dưới Cơ bản. Tỷ lệ Dưới Cơ bản gần gấp đôi mức trung bình cả nước ở người nhận Medicaid (30%) và người không có bảo hiểm (28%).",
    Korean: "의 미국 성인이 기초 수준 또는 기초 미만의 건강 문해력을 가지고 있습니다. 기초 미만 비율은 Medicaid 수혜자(30%)와 무보험자(28%)에서 전국 평균의 약 두 배입니다.",
    Chinese: "的美国成年人健康素养处于基础或基础以下水平。在 Medicaid 受益人（30%）和无保险者（28%）中，基础以下的比例约为全国平均水平的两倍。",
    Amharic: "የአሜሪካ አዋቂዎች መሠረታዊ ወይም ከመሠረታዊ በታች የሆነ የጤና እውቀት አላቸው። ከመሠረታዊ በታች ያለው መጠን በ Medicaid ተጠቃሚዎች (30%) እና ኢንሹራንስ በሌላቸው (28%) መካከል ከብሔራዊ አማካይ በእጥፍ ገደማ ይበልጣል።",
    French: "des adultes aux États-Unis ont un niveau de littératie en santé Basique ou Inférieur au basique. Le niveau Inférieur au basique est environ le double de la moyenne nationale chez les bénéficiaires de Medicaid (30%) et les personnes sans assurance (28%).",
  },
  "why.1": {
    English: "of 103,737 referral scheduling attempts in one large health system ended in a documented completed appointment.",
    Spanish: "de 103,737 intentos de agendar un referido en un gran sistema de salud terminaron en una cita completada y registrada.",
    Vietnamese: "trong 103,737 lần cố gắng đặt lịch theo giấy giới thiệu ở một hệ thống y tế lớn kết thúc bằng một buổi hẹn đã hoàn tất có ghi nhận.",
    Korean: "한 대형 의료 시스템에서 의뢰 예약 시도 103,737건 중 기록상 진료 완료로 끝난 비율입니다.",
    Chinese: "在一个大型医疗系统的 103,737 次转诊预约尝试中，有记录显示最终完成就诊的比例。",
    Amharic: "በአንድ ትልቅ የጤና ሥርዓት ውስጥ ከተደረጉ 103,737 የሪፈራል ቀጠሮ ሙከራዎች መካከል በተመዘገበ የተጠናቀቀ ቀጠሮ ያበቁት።",
    French: "des 103,737 tentatives de prise de rendez-vous après une orientation, dans un grand système de santé, ont abouti à un rendez-vous terminé et documenté.",
  },
  "why.2": {
    English: "people in the US delayed medical care in 2017 because they did not have transportation.",
    Spanish: "personas en EE. UU. retrasaron su atención médica en 2017 porque no tenían transporte.",
    Vietnamese: "người ở Mỹ đã trì hoãn việc khám chữa bệnh trong năm 2017 vì không có phương tiện đi lại.",
    Korean: "명의 미국인이 2017년에 교통편이 없어 진료를 미뤘습니다.",
    Chinese: "名美国人在 2017 年因为没有交通工具而推迟就医。",
    Amharic: "በአሜሪካ ያሉ ሰዎች በ 2017 መጓጓዣ ስላልነበራቸው የሕክምና እንክብካቤን አዘግይተዋል።",
    French: "personnes aux États-Unis ont retardé des soins en 2017 faute de moyen de transport.",
  },
  "why.source": {
    English: "Source:", Spanish: "Fuente:", Vietnamese: "Nguồn:", Korean: "출처:", Chinese: "来源：", Amharic: "ምንጭ፦", French: "Source :",
  },
  "trust.title": {
    English: "How we keep it honest", Spanish: "Cómo lo mantenemos honesto", Vietnamese: "Cách chúng tôi giữ sự trung thực",
    Korean: "정직함을 지키는 방법", Chinese: "我们如何保证诚实", Amharic: "ታማኝነቱን እንዴት እንጠብቃለን", French: "Comment nous restons honnêtes",
  },
  "trust.lead": {
    English: "It shows its work, and it holds back when it can't.",
    Spanish: "Muestra de dónde saca todo, y se detiene cuando no puede.",
    Vietnamese: "ATLAS cho thấy căn cứ, và dừng lại khi không chắc chắn.",
    Korean: "근거를 보여 주고, 확인할 수 없으면 말을 아낍니다.",
    Chinese: "它会展示依据，做不到时就不说。",
    Amharic: "ሥራውን ያሳያል፣ ማረጋገጥ ሲያቅተው ደግሞ ይቆጠባል።",
    French: "Il montre ses sources, et il se retient quand il ne peut pas.",
  },
  "trust.grounded.chip": {
    English: "Grounded", Spanish: "Con fuente", Vietnamese: "Có căn cứ", Korean: "근거 있음", Chinese: "有据可查", Amharic: "በማስረጃ", French: "Sourcé",
  },
  "trust.grounded": {
    English: "Every care step must quote your paper word for word. Our own checker (not the AI) confirms the quote is really there. Anything it can't find is held back to protect you.",
    Spanish: "Cada paso debe citar su hoja palabra por palabra. Nuestro propio verificador (no la IA) confirma que la cita de verdad está ahí. Lo que no encuentra se retiene para protegerle.",
    Vietnamese: "Mỗi bước chăm sóc phải trích nguyên văn từ giấy của quý vị. Bộ kiểm tra riêng của chúng tôi (không phải AI) xác nhận câu trích đó thật sự có ở đó. Điều gì không tìm thấy sẽ được giữ lại để bảo vệ quý vị.",
    Korean: "모든 단계는 서류의 문장을 그대로 인용해야 합니다. AI가 아닌 저희의 자체 검사기가 그 문장이 실제로 있는지 확인합니다. 찾을 수 없는 내용은 보호를 위해 보여 드리지 않습니다.",
    Chinese: "每个护理步骤都必须逐字引用您的文件。由我们自己的检查程序（不是 AI）确认引文确实存在。找不到的内容会被保留不显示，以保护您。",
    Amharic: "እያንዳንዱ የእንክብካቤ እርምጃ ሰነድዎን ቃል በቃል መጥቀስ አለበት። የራሳችን መፈተሻ (AI አይደለም) ጥቅሱ በእርግጥ እንዳለ ያረጋግጣል። ሊያገኘው ያልቻለው ማንኛውም ነገር እርስዎን ለመጠበቅ ይቆያል።",
    French: "Chaque étape doit citer votre document mot pour mot. Notre propre vérificateur (pas l'IA) confirme que la citation s'y trouve vraiment. Ce qu'il ne trouve pas est retenu pour vous protéger.",
  },
  "trust.verified.chip": {
    English: "Verified", Spanish: "Verificado", Vietnamese: "Đã xác minh", Korean: "확인됨", Chinese: "已核实", Amharic: "የተረጋገጠ", French: "Vérifié",
  },
  "trust.verified": {
    English: "The AI can only recommend places from our verified list: {clinics} community health centers and {programs} programs in {area}, and outside Atlanta the nearest of {national} HRSA health center sites nationwide plus {federal} federal programs. Phone numbers and addresses come from the record, never from the AI.",
    Spanish: "La IA solo puede recomendar lugares de nuestra lista verificada: {clinics} centros de salud comunitarios y {programs} programas en {area}, y fuera de Atlanta el más cercano de {national} sitios de centros de salud de HRSA en todo el país, más {federal} programas federales. Los teléfonos y las direcciones vienen del registro, nunca de la IA.",
    Vietnamese: "AI chỉ được đề xuất những nơi trong danh sách đã xác minh của chúng tôi: {clinics} trung tâm y tế cộng đồng và {programs} chương trình ở {area}, và ngoài Atlanta là nơi gần nhất trong {national} điểm trung tâm y tế HRSA trên toàn quốc, cùng {federal} chương trình liên bang. Số điện thoại và địa chỉ lấy từ hồ sơ, không bao giờ từ AI.",
    Korean: "AI는 저희의 확인된 목록에 있는 곳만 추천할 수 있습니다. {area}의 지역 보건소 {clinics}곳과 프로그램 {programs}개, 그리고 애틀랜타 밖에서는 전국 HRSA 보건소 {national}곳 중 가장 가까운 곳과 연방 프로그램 {federal}개입니다. 전화번호와 주소는 AI가 아니라 기록에서 가져옵니다.",
    Chinese: "AI 只能推荐我们核实名单上的地点：{area}的 {clinics} 家社区医疗中心和 {programs} 个项目；在亚特兰大以外，则是全美 {national} 个 HRSA 医疗中心站点中最近的一个，外加 {federal} 个联邦项目。电话和地址都来自记录，绝不来自 AI。",
    Amharic: "AI ሊመክር የሚችለው ከተረጋገጠ ዝርዝራችን ውስጥ ያሉትን ቦታዎች ብቻ ነው፦ በ {area} ውስጥ {clinics} የማህበረሰብ ጤና ማዕከላት እና {programs} ፕሮግራሞች፣ ከአትላንታ ውጭ ደግሞ በአገር አቀፍ ደረጃ ካሉ {national} የ HRSA ጤና ማዕከል ቦታዎች በጣም ቅርብ የሆነው እና {federal} የፌዴራል ፕሮግራሞች። ስልክ ቁጥሮችና አድራሻዎች የሚመጡት ከመዝገቡ እንጂ ከ AI በጭራሽ አይደለም።",
    French: "L'IA ne peut recommander que des lieux de notre liste vérifiée : {clinics} centres de santé communautaires et {programs} programmes à {area}, et hors d'Atlanta le plus proche des {national} sites de centres de santé HRSA du pays, plus {federal} programmes fédéraux. Les numéros et les adresses viennent du registre, jamais de l'IA.",
  },
  "trust.private.chip": {
    English: "Private by default", Spanish: "Privado desde el inicio", Vietnamese: "Riêng tư mặc định", Korean: "기본적으로 비공개",
    Chinese: "默认保护隐私", Amharic: "በነባሪ የግል", French: "Privé par défaut",
  },
  "trust.private": {
    English: "No account. Nothing is stored on our side: your paper goes to our server and the AI provider only to be read. Your plan is saved in this browser so you can come back, and you can clear it anytime. ATLAS explains paperwork and is not medical advice.",
    Spanish: "Sin cuenta. No guardamos nada de nuestro lado: su hoja va a nuestro servidor y al proveedor de IA solo para leerla. Su plan se guarda en este navegador para que pueda volver, y puede borrarlo cuando quiera. ATLAS explica sus papeles y no es consejo médico.",
    Vietnamese: "Không cần tài khoản. Chúng tôi không lưu gì: giấy của quý vị được gửi đến máy chủ của chúng tôi và nhà cung cấp AI chỉ để đọc. Kế hoạch được lưu trong trình duyệt này để quý vị quay lại, và quý vị có thể xóa bất cứ lúc nào. ATLAS giải thích giấy tờ và không phải là lời khuyên y tế.",
    Korean: "계정이 필요 없습니다. 저희 쪽에는 아무것도 저장하지 않습니다. 서류는 읽기 위해서만 저희 서버와 AI 제공업체로 갑니다. 계획은 다시 보실 수 있도록 이 브라우저에 저장되며 언제든 지울 수 있습니다. ATLAS는 서류를 설명할 뿐 의학적 조언이 아닙니다.",
    Chinese: "无需账号。我们这边不保存任何内容：您的文件发送到我们的服务器和 AI 服务商只是为了读取。您的计划保存在这个浏览器里，方便您回来查看，也可以随时清除。ATLAS 解释文件内容，不构成医疗建议。",
    Amharic: "አካውንት አያስፈልግም። በእኛ በኩል ምንም አይቀመጥም፦ ሰነድዎ ወደ አገልጋያችን እና ወደ AI አቅራቢው የሚሄደው ለንባብ ብቻ ነው። ተመልሰው እንዲመጡ እቅድዎ በዚህ አሳሽ ውስጥ ይቀመጣል፣ በማንኛውም ጊዜም ሊያጠፉት ይችላሉ። ATLAS ወረቀቶችን ያብራራል እንጂ የሕክምና ምክር አይደለም።",
    French: "Pas de compte. Rien n'est conservé chez nous : votre document va à notre serveur et au fournisseur d'IA seulement pour être lu. Votre plan est enregistré dans ce navigateur pour que vous puissiez revenir, et vous pouvez l'effacer à tout moment. ATLAS explique vos papiers et ne remplace pas un avis médical.",
  },
  "trust.proof": {
    English: "Want proof?", Spanish: "¿Quiere pruebas?", Vietnamese: "Muốn có bằng chứng?", Korean: "증거가 필요하신가요?", Chinese: "想要证据？",
    Amharic: "ማረጋገጫ ይፈልጋሉ?", French: "Vous voulez des preuves ?",
  },
  "trust.proofLink": {
    English: "See our tests", Spanish: "Vea nuestras pruebas", Vietnamese: "Xem kiểm tra của chúng tôi", Korean: "테스트 보기", Chinese: "查看我们的测试",
    Amharic: "ሙከራዎቻችንን ይመልከቱ", French: "Voir nos tests",
  },
  "trust.proofRest": {
    English: ": a live check that our quote checker catches planted fakes, and a measured run on labeled sample papers.",
    Spanish: ": una prueba en vivo de que nuestro verificador detecta citas falsas puestas a propósito, y una medición con hojas de ejemplo etiquetadas.",
    Vietnamese: ": một bài kiểm tra trực tiếp cho thấy bộ kiểm tra bắt được các câu trích giả được cài vào, và một lần đo trên các giấy mẫu có ghi nhãn.",
    Korean: ": 저희 인용 검사기가 일부러 넣은 가짜 인용을 잡아내는 실시간 검사와, 표시된 예시 서류로 측정한 결과입니다.",
    Chinese: "：一个实时检测，证明我们的引文检查程序能抓出故意放入的假引文，以及在已标注的示例文件上的实测结果。",
    Amharic: "፦ የጥቅስ መፈተሻችን ሆን ተብለው የገቡ የሐሰት ጥቅሶችን እንደሚይዝ የሚያሳይ የቀጥታ ምርመራ፣ እና በተሰየሙ የምሳሌ ሰነዶች ላይ የተደረገ ልኬት።",
    French: " : une vérification en direct que notre contrôleur de citations repère les fausses citations ajoutées exprès, et une mesure sur des documents d'exemple étiquetés.",
  },
  "trust.sources": {
    English: "Data sources (retrieved {date})", Spanish: "Fuentes de datos (consultadas el {date})", Vietnamese: "Nguồn dữ liệu (lấy ngày {date})",
    Korean: "데이터 출처 ({date} 수집)", Chinese: "数据来源（获取于 {date}）", Amharic: "የመረጃ ምንጮች ({date} የተወሰደ)",
    French: "Sources des données (consultées le {date})",
  },
  "footer.title": {
    English: "Leave the visit with a plan, not a pile of paper.",
    Spanish: "Salga de su cita con un plan, no con un montón de papeles.",
    Vietnamese: "Ra về sau buổi khám với một kế hoạch, không phải một chồng giấy.",
    Korean: "진료를 마치고 서류 더미가 아닌 계획을 가지고 나오세요.",
    Chinese: "看完病，带走的是一个计划，而不是一叠纸。",
    Amharic: "ከጉብኝትዎ በወረቀት ክምር ሳይሆን በእቅድ ይውጡ።",
    French: "Repartez de votre consultation avec un plan, pas une pile de papiers.",
  },
  "footer.try": {
    English: "Try it now", Spanish: "Pruébelo ahora", Vietnamese: "Dùng thử ngay", Korean: "지금 사용해 보기", Chinese: "现在就试试",
    Amharic: "አሁን ይሞክሩት", French: "Essayez maintenant",
  },
  "footer.judges": {
    English: "For judges", Spanish: "Para el jurado", Vietnamese: "Dành cho ban giám khảo", Korean: "심사위원용", Chinese: "评委专区",
    Amharic: "ለዳኞች", French: "Pour le jury",
  },
  "footer.step": { English: "STEP", Spanish: "PASO", Vietnamese: "BƯỚC", Korean: "단계", Chinese: "步骤", Amharic: "ደረጃ", French: "ÉTAPE" },
  "footer.done": { English: "DONE ✓", Spanish: "LISTO ✓", Vietnamese: "XONG ✓", Korean: "완료 ✓", Chinese: "完成 ✓", Amharic: "ተጠናቋል ✓", French: "FAIT ✓" },
  "footer.doneNote": {
    English: "lab booked, ride planned", Spanish: "análisis agendado, transporte listo", Vietnamese: "đã hẹn xét nghiệm, đã lo xe đi",
    Korean: "검사 예약, 교통편 준비 완료", Chinese: "验血已预约，交通已安排", Amharic: "ምርመራ ተይዟል፣ መጓጓዣ ተዘጋጅቷል",
    French: "analyse réservée, trajet prévu",
  },
  "footer.privacy": {
    English: "Privacy", Spanish: "Privacidad", Vietnamese: "Quyền riêng tư", Korean: "개인정보", Chinese: "隐私", Amharic: "ግላዊነት",
    French: "Confidentialité",
  },
  "footer.apps": {
    English: "Get the apps", Spanish: "Descargue las apps", Vietnamese: "Tải ứng dụng", Korean: "앱 받기", Chinese: "下载应用",
    Amharic: "መተግበሪያዎቹን ያግኙ", French: "Télécharger les applis",
  },
  "footer.helper": {
    English: "Make a link for someone you help", Spanish: "Cree un enlace para alguien a quien ayuda",
    Vietnamese: "Tạo đường dẫn cho người quý vị giúp", Korean: "도와주시는 분을 위한 링크 만들기", Chinese: "为您帮助的人生成链接",
    Amharic: "ለሚረዱት ሰው ሊንክ ይፍጠሩ", French: "Créer un lien pour la personne que vous aidez",
  },
  "intro.word": {
    English: "only what's written", Spanish: "solo lo que está escrito", Vietnamese: "chỉ những gì đã viết", Korean: "적힌 내용만",
    Chinese: "只说写了的内容", Amharic: "የተጻፈውን ብቻ", French: "seulement ce qui est écrit",
  },
} satisfies Record<string, Row>;

export type SiteKey = keyof typeof SITE_TEXT;

/** One of the site's own lines in this language, with any `{name}` filled in. Falls back to English. */
export function site(lang: Lang, key: SiteKey, vars?: Record<string, string | number>): string {
  const row = SITE_TEXT[key] as Row;
  const text = row[lang] || row.English;
  return vars ? text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : text;
}
