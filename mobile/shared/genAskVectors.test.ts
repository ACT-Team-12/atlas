/**
 * Generates mobile/shared/ask-vectors.json: the website's own answer for the parts of "Ask my paper" that decide what a
 * person may see without any AI (web/src/lib/askText.ts and web/src/ui/AskPaper.tsx), so the iPhone and Android apps are
 * checked against the same cases as the web.
 *
 * - "text": every fixed string per app language (ASK_TEXT), with the sentence-building ones filled in for fixed inputs.
 * - "max_question": the longest question the route accepts.
 * - "urgent": questions and isUrgentQuestion's answer. An urgent question is never sent; the screen shows 911 / 211
 *   guidance and the paper's own warning lines instead.
 * - "ready": askAboutQuestion, the ready question built only from the person's own words.
 * - "on_this_paper": onThisPaper, which keeps a quote only when its words are exactly the paper's text at its span.
 *
 * Not part of the web suite. CI regenerates it with mobile/shared/check-vectors.sh (web-ci) and fails when the
 * committed file differs. To regenerate by hand:
 *   cp mobile/shared/genAskVectors.test.ts web/src/lib/
 *   cd web && VECTORS_OUT=../mobile/shared/ask-vectors.json pnpm exec vitest run src/lib/genAskVectors.test.ts
 *   rm src/lib/genAskVectors.test.ts
 */
import { writeFileSync } from "node:fs";
import { expect, it } from "vitest";
import type { AskResponse } from "./ask";
import { ASK_TEXT, askAboutQuestion, isUrgentQuestion, MAX_QUESTION } from "./askText";
import { onThisPaper } from "../ui/AskPaper";

const QUESTIONS = [
  // Urgent, in every app language (the web's own tests).
  "I have chest pain right now", "my chest hurts", "I can't breathe", "I think I took too many pills", "I swallowed the whole bottle",
  "my throat is closing", "my throat is swelling up", "I am coughing up blood", "I'm vomiting blood",
  "my face is drooping and my speech is slurred", "I took 20 pills", "I want to die", "he is not breathing", "she won't wake up",
  "I think it's a heart attack", "overdosed on tylenol", "bleeding a lot from the cut", "I want to kill myself",
  "when should I call 911?", "should I go to the emergency room?", "Call 9-1-1?",
  "se me cierra la garganta", "estoy tosiendo sangre", "quiero morir", "tengo dolor en el pecho", "no puedo respirar",
  "me duele el pecho", "creo que es una sobredosis", "ma gorge se ferme", "je crache du sang", "j'ai une douleur thoracique",
  "je ne peux pas respirer", "je veux mourir", "crise cardiaque ?", "tôi ho ra máu", "tôi bị đau ngực", "tôi khó thở", "tôi muốn chết",
  "목이 붓고 숨이 막혀요", "가슴 통증이 있어요", "숨이 차요", "죽고 싶어요", "과다 복용했어요", "我咳血", "我胸痛", "我呼吸困难", "我想死",
  "服药过量了", "ደም እያስታወከኝ ነው", "የደረት ህመም አለኝ", "የመተንፈስ ችግር አለብኝ", "መሞት እፈልጋለሁ",
  // Ordinary.
  "can I drive?", "when do I stop ibuprofen?", "how often do I take metformin?", "¿cuándo dejo el ibuprofeno?", "Quand dois-je revenir ?",
  "메트포르민은 얼마나 자주 먹나요?", "我什么时候复诊？", "this is not an emergency: can I drive?", "What does my chest x-ray say?",
  "Can I take it with breakfast?", "When is my next visit?", "Where do I get my blood drawn?", "Khi nào tôi tái khám?",
  "Can I eat bread?", "Is metformin a pill?", "When do I see the eye doctor?", "cuándo vuelvo a la clínica", "ኢቡፕሮፌን መቼ ላቁም?",
  "Do I need to fast before the lab?", "How many tablets of lisinopril?",
];

it("writes the Ask my paper vectors", () => {
  const text = Object.fromEntries(Object.entries(ASK_TEXT).map(([lang, t]) => {
    const plain = Object.fromEntries(Object.entries(t).filter(([, v]) => typeof v === "string"));
    return [lang, {
      ...plain,
      readyQuestion: t.readyQuestion("can I drive?"),
      about: t.about("ibuprofen"),
      held1: t.held(1),
      held2: t.held(2),
      held5: t.held(5),
    }];
  }));

  const urgent = QUESTIONS.map((question) => ({ question, urgent: isUrgentQuestion(question) }));
  // Also every question with extra spaces and line breaks: the check reads runs of spaces as one.
  for (const q of QUESTIONS.slice(0, 12)) urgent.push({ question: `  ${q.replace(/ /g, "  \n ")}  `, urgent: isUrgentQuestion(`  ${q.replace(/ /g, "  \n ")}  `) });

  const long = "why ".repeat(120);
  const ready = [
    ["  can I   drink alcohol? ", "English"], ["¿puedo manejar?", "Spanish"], ["can I drive?", "Klingon"],
    [long, "English"], ["tôi có được lái xe không?", "Vietnamese"], ["운전해도 되나요?", "Korean"], ["我可以开车吗？", "Chinese"],
    ["መኪና መንዳት እችላለሁ?", "Amharic"], ["puis-je conduire ?", "French"], ["line\none\ttwo", "English"],
  ].map(([question, language]) => ({ question, language, expected: askAboutQuestion(question, language) }));

  const paper = "Take metformin 500 mg twice a day.\nStop ibuprofen today.\nReturn to clinic in 3 months.";
  const at = (s: string) => ({ text: s, span: { start: paper.indexOf(s), end: paper.indexOf(s) + s.length } });
  const answer = (quotes: { text: string; span: { start: number; end: number } }[], topic: string | null = "metformin"): AskResponse =>
    ({ kind: "answer", quotes, topic, topic_dropped: null, dropped: [], model: "m", ms: 1 });
  const responses: [string, AskResponse][] = [
    ["every quote on the paper", answer([at("Take metformin 500 mg twice a day."), at("Return to clinic in 3 months.")])],
    ["one quote off the paper: dropped, topic removed", answer([at("Take metformin 500 mg twice a day."), { text: "Take metformin daily.", span: { start: 0, end: 21 } }])],
    ["words differ from the paper at the span", answer([{ text: "Stop ibuprofen now.", span: { start: 35, end: 54 } }])],
    ["span past the end", answer([{ text: "x", span: { start: 10, end: 9999 } }])],
    ["negative start", answer([{ text: "T", span: { start: -1, end: 0 } }])],
    ["empty span", answer([{ text: "", span: { start: 3, end: 3 } }])],
    ["fractional span", answer([{ text: "ake", span: { start: 1.5, end: 4 } }])],
    ["no topic", answer([at("Stop ibuprofen today.")], null)],
    ["already refused", { kind: "not_in_paper", dropped: ["too_short"], model: "m", ms: 1 }],
    ["urgent", { kind: "urgent" }],
    ["earlier drops kept", { ...answer([at("Stop ibuprofen today.")]), dropped: ["ambiguous"] } as AskResponse],
  ];
  const on_this_paper = responses.map(([name, res]) => ({ name, source: paper, res, expected: onThisPaper(res, paper) }));

  expect(urgent.filter((u) => u.urgent).length).toBeGreaterThan(40);
  expect(urgent.filter((u) => !u.urgent).length).toBeGreaterThan(15);
  const vectors = { text, max_question: MAX_QUESTION, urgent, ready, on_this_paper };
  const out = process.env.VECTORS_OUT;
  if (out) writeFileSync(out, JSON.stringify(vectors, null, 1) + "\n");
});
