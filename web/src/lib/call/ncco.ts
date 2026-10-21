import type { LANGUAGES } from "../schema";
import { stripTokens } from "../phiShield";

type Language = (typeof LANGUAGES)[number];

/**
 * What the calls say, and the Vonage Call Control Objects (NCCO) that say them. The only free text ever spoken is the
 * plan's own read-aloud text, accepted only with the speak token /api/plan signed for it. Everything else is a fixed
 * phrase below, in the plan's language.
 */
export type NccoAction = Record<string, unknown> & { action: "stream" | "talk" | "input" };

/** Vonage text-to-speech language per ATLAS language (developer.vonage.com, text-to-speech). Amharic has none. */
export const VONAGE_TTS: Partial<Record<Language, string>> = {
  English: "en-US", Spanish: "es-US", Vietnamese: "vi-VN", Korean: "ko-KR", Chinese: "cmn-CN", French: "fr-FR",
};

type Phrases = { code: (c: string) => string; gate: string; retry: string; intro: string; again: string; bye: string };

const PHRASES: Partial<Record<Language, Phrases>> = {
  English: {
    code: (c) => `Your ATLAS code is ${c}. Again, your code is ${c}. Goodbye.`,
    gate: "This is ATLAS. Enter the 4-digit code you just typed, then press pound.",
    retry: "That code did not match. Enter the 4-digit code, then press pound.",
    intro: "Hello, this is ATLAS, calling with the plan you asked for.",
    again: "Press 1 to hear it again.",
    bye: "Goodbye, and take care.",
  },
  Spanish: {
    code: (c) => `Su código de ATLAS es ${c}. Otra vez, su código es ${c}. Adiós.`,
    gate: "Le habla ATLAS. Marque el código de 4 dígitos que acaba de escribir y luego la tecla de numeral.",
    retry: "Ese código no coincide. Marque el código de 4 dígitos y luego la tecla de numeral.",
    intro: "Hola, le habla ATLAS, con el plan que usted pidió.",
    again: "Oprima 1 para escucharlo otra vez.",
    bye: "Adiós, cuídese.",
  },
  Vietnamese: {
    code: (c) => `Mã ATLAS của bạn là ${c}. Xin nhắc lại, mã của bạn là ${c}. Tạm biệt.`,
    gate: "Đây là ATLAS. Hãy bấm mã 4 số bạn vừa nhập, rồi bấm phím thăng.",
    retry: "Mã đó không đúng. Hãy bấm mã 4 số, rồi bấm phím thăng.",
    intro: "Xin chào, đây là ATLAS, gọi để đọc kế hoạch bạn đã yêu cầu.",
    again: "Bấm số 1 để nghe lại.",
    bye: "Tạm biệt, chúc bạn mạnh khỏe.",
  },
  Korean: {
    code: (c) => `ATLAS 코드는 ${c}입니다. 다시 한 번, 코드는 ${c}입니다. 안녕히 계세요.`,
    gate: "ATLAS입니다. 방금 입력하신 4자리 코드를 누르신 다음 우물 정자를 누르세요.",
    retry: "코드가 맞지 않습니다. 4자리 코드를 누르신 다음 우물 정자를 누르세요.",
    intro: "안녕하세요, ATLAS입니다. 요청하신 계획을 알려 드리려고 전화했습니다.",
    again: "다시 들으시려면 1번을 누르세요.",
    bye: "안녕히 계세요. 건강하세요.",
  },
  Chinese: {
    code: (c) => `您的 ATLAS 验证码是 ${c}。再说一遍，您的验证码是 ${c}。再见。`,
    gate: "这里是 ATLAS。请输入您刚才填写的 4 位验证码，然后按井号键。",
    retry: "验证码不对。请输入 4 位验证码，然后按井号键。",
    intro: "您好，这里是 ATLAS，打电话告诉您您要的计划。",
    again: "如需再听一遍，请按 1。",
    bye: "再见，请保重。",
  },
  French: {
    code: (c) => `Votre code ATLAS est ${c}. Je répète, votre code est ${c}. Au revoir.`,
    gate: "Ici ATLAS. Tapez le code à 4 chiffres que vous venez de saisir, puis la touche dièse.",
    retry: "Ce code ne correspond pas. Tapez le code à 4 chiffres, puis la touche dièse.",
    intro: "Bonjour, ici ATLAS, avec le plan que vous avez demandé.",
    again: "Appuyez sur 1 pour l'entendre encore.",
    bye: "Au revoir, prenez soin de vous.",
  },
};

/** A language can be called only when Vonage can speak the fixed phrases in it. */
export const canCallIn = (language: Language) => Boolean(VONAGE_TTS[language] && PHRASES[language]);

// stripTokens: the last net before Vonage. Plan text never carries a PHI placeholder (planText.ts), and if one ever
// slipped through, the call says nothing in its place rather than reading out "NAME A".
const talk = (text: string, language: string, extra: Record<string, unknown> = {}): NccoAction => ({ action: "talk", text: stripTokens(text), language, ...extra });

/** "1234" is read digit by digit: "1, 2, 3, 4". */
export const spokenCode = (code: string) => code.split("").join(", ");

export function codeNcco(code: string, language: Language): NccoAction[] {
  const lang = VONAGE_TTS[language] ?? "en-US";
  const p = PHRASES[language] ?? PHRASES.English!;
  return [talk(p.code(spokenCode(code)), lang)];
}

/** Vonage's talk action takes a bounded amount of text; long plans are split on line breaks into several talks. */
export const TALK_CHUNK = 1000;
export function talkChunks(text: string, max = TALK_CHUNK): string[] {
  const out: string[] = [];
  let cur = "";
  const push = () => { if (cur.trim()) out.push(cur.trim()); cur = ""; };
  for (const line of text.split("\n")) {
    for (let rest = line; rest.length; ) {
      const room = max - (cur ? cur.length + 1 : 0);
      if (rest.length <= room) { cur = cur ? `${cur}\n${rest}` : rest; rest = ""; break; }
      if (cur) { push(); continue; }
      // a single line longer than a chunk: cut at the last space that fits, else hard cut
      const cut = rest.lastIndexOf(" ", max) > max / 2 ? rest.lastIndexOf(" ", max) : max;
      out.push(rest.slice(0, cut).trim());
      rest = rest.slice(cut).trimStart();
    }
  }
  push();
  return out;
}

export const MAX_REPLAYS = 2;
/**
 * Tries at the code at the start of the plan call (a wrong code or silence each use one). Three, because the person
 * hears the prompt with the phone at their ear and must then open the keypad: a slow first try must not end the call.
 * Guessing stays bounded: 3 tries per plan call, 3 plan calls per number per day (flow.ts PLAN_CALLS_PER_NUMBER), each
 * call against its own fresh 4-digit code, so at most 9 guesses per number per day.
 */
export const GATE_TRIES = 3;
/**
 * Seconds of keypad inactivity before Vonage submits what was typed. Vonage's NCCO reference (input action, DTMF input
 * settings: developer.vonage.com/en/voice/voice-api/ncco-reference) allows a timeOut of up to 10 seconds. The code
 * prompt and the "press 1" prompt both use that maximum, so nobody is cut off while they find the keypad.
 */
export const KEYPAD_TIMEOUT_S = 10;

/**
 * The start of the plan call: a fixed, non-sensitive prompt and a keypad input for the code the person typed on the
 * page. Only that code unlocks the plan (flow.ts handleInput), so whoever else answers, and any voicemail, hears only
 * this prompt, which says nothing about a plan or health (only the name ATLAS, which the code call also says).
 */
export function gateNcco(o: { language: Language; inputUrl: string; /** A wrong code was entered. Never for silence: then the first prompt plays again. */ retry: boolean }): NccoAction[] {
  const lang = VONAGE_TTS[o.language];
  const p = PHRASES[o.language];
  if (!lang || !p) throw new Error(`no phone voice for ${o.language}`);
  return [
    talk(o.retry ? p.retry : p.gate, lang, { bargeIn: true }),
    { action: "input", type: ["dtmf"], dtmf: { maxDigits: 4, submitOnHash: true, timeOut: KEYPAD_TIMEOUT_S }, eventUrl: [o.inputUrl], eventMethod: "POST" },
  ];
}

/**
 * The plan call: intro (first play only), the plan (the natural-voice MP3 when there is one, else Vonage's own voice),
 * then "press 1 to hear it again" up to MAX_REPLAYS times, then goodbye.
 */
export function planNcco(o: { text: string; language: Language; audioUrl: string | null; inputUrl: string; replays: number }): NccoAction[] {
  const lang = VONAGE_TTS[o.language];
  const p = PHRASES[o.language];
  if (!lang || !p) throw new Error(`no phone voice for ${o.language}`);
  const plan: NccoAction[] = o.audioUrl ? [{ action: "stream", streamUrl: [o.audioUrl] }] : talkChunks(o.text).map((t) => talk(t, lang));
  const head = o.replays === 0 ? [talk(p.intro, lang)] : [];
  if (o.replays >= MAX_REPLAYS) return [...head, ...plan, talk(p.bye, lang)];
  return [
    ...head,
    ...plan,
    talk(p.again, lang, { bargeIn: true }),
    { action: "input", type: ["dtmf"], dtmf: { maxDigits: 1, timeOut: KEYPAD_TIMEOUT_S }, eventUrl: [o.inputUrl], eventMethod: "POST" },
  ];
}

export const goodbyeNcco = (language: Language): NccoAction[] =>
  [talk((PHRASES[language] ?? PHRASES.English!).bye, VONAGE_TTS[language] ?? "en-US")];

/**
 * How long one plan call may last: the code prompt (GATE_TRIES times at most, about 30 s each for the prompt, typing
 * and the keypad wait), the intro, the plan played up to three times with the "press 1" prompt and its 10 s wait,
 * with margin.
 * The natural-voice MP3 (ElevenLabs, lib/voice.ts) is 64 kbps (8,000 bytes a second); without audio, assume about 12 characters a second.
 */
export function planLengthSeconds(o: { audioBytes: number | null; textChars: number }): number {
  const once = o.audioBytes ? o.audioBytes / 8000 : o.textChars / 12;
  return Math.min(900, Math.ceil(20 + 30 * GATE_TRIES + (once + 15) * (1 + MAX_REPLAYS)));
}
