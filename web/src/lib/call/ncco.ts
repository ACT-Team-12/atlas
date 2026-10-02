import type { LANGUAGES } from "../schema";

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

type Phrases = { code: (c: string) => string; intro: string; again: string; bye: string };

const PHRASES: Partial<Record<Language, Phrases>> = {
  English: {
    code: (c) => `Your ATLAS code is ${c}. Again, your code is ${c}. Goodbye.`,
    intro: "Hello, this is ATLAS, calling with the plan you asked for.",
    again: "Press 1 to hear it again.",
    bye: "Goodbye, and take care.",
  },
  Spanish: {
    code: (c) => `Su código de ATLAS es ${c}. Otra vez, su código es ${c}. Adiós.`,
    intro: "Hola, le habla ATLAS, con el plan que usted pidió.",
    again: "Oprima 1 para escucharlo otra vez.",
    bye: "Adiós, cuídese.",
  },
  Vietnamese: {
    code: (c) => `Mã ATLAS của bạn là ${c}. Xin nhắc lại, mã của bạn là ${c}. Tạm biệt.`,
    intro: "Xin chào, đây là ATLAS, gọi để đọc kế hoạch bạn đã yêu cầu.",
    again: "Bấm số 1 để nghe lại.",
    bye: "Tạm biệt, chúc bạn mạnh khỏe.",
  },
  Korean: {
    code: (c) => `ATLAS 코드는 ${c}입니다. 다시 한 번, 코드는 ${c}입니다. 안녕히 계세요.`,
    intro: "안녕하세요, ATLAS입니다. 요청하신 계획을 알려 드리려고 전화했습니다.",
    again: "다시 들으시려면 1번을 누르세요.",
    bye: "안녕히 계세요. 건강하세요.",
  },
  Chinese: {
    code: (c) => `您的 ATLAS 验证码是 ${c}。再说一遍，您的验证码是 ${c}。再见。`,
    intro: "您好，这里是 ATLAS，打电话告诉您您要的计划。",
    again: "如需再听一遍，请按 1。",
    bye: "再见，请保重。",
  },
  French: {
    code: (c) => `Votre code ATLAS est ${c}. Je répète, votre code est ${c}. Au revoir.`,
    intro: "Bonjour, ici ATLAS, avec le plan que vous avez demandé.",
    again: "Appuyez sur 1 pour l'entendre encore.",
    bye: "Au revoir, prenez soin de vous.",
  },
};

/** A language can be called only when Vonage can speak the fixed phrases in it. */
export const canCallIn = (language: Language) => Boolean(VONAGE_TTS[language] && PHRASES[language]);

const talk = (text: string, language: string, extra: Record<string, unknown> = {}): NccoAction => ({ action: "talk", text, language, ...extra });

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
    { action: "input", type: ["dtmf"], dtmf: { maxDigits: 1, timeOut: 6 }, eventUrl: [o.inputUrl], eventMethod: "POST" },
  ];
}

export const goodbyeNcco = (language: Language): NccoAction[] =>
  [talk((PHRASES[language] ?? PHRASES.English!).bye, VONAGE_TTS[language] ?? "en-US")];

/**
 * How long one plan call may last: the intro, the plan played up to three times and the prompts, with margin.
 * The natural-voice MP3 (ElevenLabs, lib/voice.ts) is 64 kbps (8,000 bytes a second); without audio, assume about 12 characters a second.
 */
export function planLengthSeconds(o: { audioBytes: number | null; textChars: number }): number {
  const once = o.audioBytes ? o.audioBytes / 8000 : o.textChars / 12;
  return Math.min(900, Math.ceil(20 + (once + 10) * (1 + MAX_REPLAYS)));
}
