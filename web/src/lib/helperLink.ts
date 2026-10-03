import { LANGUAGES, READING_LEVELS } from "./schema";

/**
 * Helper links: a community health worker, navigator, nurse or family member makes a link that opens ATLAS with the
 * language, reading level and ZIP already picked, for the person they help.
 *
 * Everything travels in the URL fragment (after the #). Browsers never send the fragment to a server, so the
 * choices stay out of our host's request logs and out of Referer headers. The format is short and fixed:
 *
 *   https://atlas-team12.vercel.app/#try&via=helper&lang=es&level=simple&zip=30310
 *
 * `via=helper` marks it as a helper link; the other three are optional. Every value is checked against an allow-list,
 * and anything that does not match is ignored, so a broken or tampered link just opens the normal page.
 * There is no organization, no name and no free text in the format, by design.
 */

export type Language = (typeof LANGUAGES)[number];
export type ReadingLevel = (typeof READING_LEVELS)[number];
export type HelperPresets = { language?: Language; level?: ReadingLevel; zip?: string };

/** Short codes for the link. ISO 639-1, so they read naturally. */
export const LANG_CODE: Record<Language, string> = {
  English: "en", Spanish: "es", Vietnamese: "vi", Korean: "ko", Chinese: "zh", Amharic: "am", French: "fr",
};
const CODE_LANG = Object.fromEntries(Object.entries(LANG_CODE).map(([l, c]) => [c, l])) as Record<string, Language>;

/** A real helper link is about 60 characters after the #. Anything far longer is not one of ours. */
export const MAX_FRAGMENT = 120;
const KEYS = ["via", "lang", "level", "zip"] as const;
const ZIP_RE = /^\d{5}$/;

export function isZip(z: string): boolean {
  return ZIP_RE.test(z) && z !== "00000";
}

/**
 * Reads presets from `location.hash`. Returns null unless this is a helper link (exactly one `via=helper`).
 * Unknown keys, repeated keys and values outside the allow-lists are dropped, never guessed at. Values are
 * compared as raw text (no URL decoding), so an encoded payload can never match an allow-list entry.
 */
export function parseHelperFragment(hash: string): HelperPresets | null {
  if (typeof hash !== "string" || hash.length === 0 || hash.length > MAX_FRAGMENT + 1) return null;
  const body = hash.startsWith("#") ? hash.slice(1) : hash;
  const seen = new Map<string, string[]>();
  for (const part of body.split("&")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue; // "try" (the section anchor) or junk
    const key = part.slice(0, eq), value = part.slice(eq + 1);
    if (!(KEYS as readonly string[]).includes(key)) continue;
    seen.set(key, [...(seen.get(key) ?? []), value]);
  }
  // A repeated key is ambiguous, so it counts as absent.
  const one = (k: (typeof KEYS)[number]) => { const v = seen.get(k); return v && v.length === 1 ? v[0] : undefined; };
  if (one("via") !== "helper") return null;

  const out: HelperPresets = {};
  const lang = one("lang");
  if (lang !== undefined && Object.hasOwn(CODE_LANG, lang)) out.language = CODE_LANG[lang];
  const level = one("level");
  if (level !== undefined && (READING_LEVELS as readonly string[]).includes(level)) out.level = level as ReadingLevel;
  const zip = one("zip");
  if (zip !== undefined && isZip(zip)) out.zip = zip;
  return out;
}

/** The link a helper hands over. `origin` is the site the helper is on (production, or a preview while testing). */
export function buildHelperLink(origin: string, p: HelperPresets): string {
  const parts = ["try", "via=helper"];
  if (p.language) parts.push(`lang=${LANG_CODE[p.language]}`);
  if (p.level) parts.push(`level=${p.level}`);
  if (p.zip && isZip(p.zip)) parts.push(`zip=${p.zip}`);
  return `${origin.replace(/\/+$/, "")}/#${parts.join("&")}`;
}

/** The short text message the helper can send, in the language they picked for the person. */
const SMS: Record<Language, (link: string) => string> = {
  English: (l) => `Here is ATLAS, set up for you in English. It explains your visit paper and helps you plan the next steps. No account, and we do not keep anything about you. ${l}`,
  Spanish: (l) => `Aquí está ATLAS, preparado para usted en español. Explica la hoja de su visita y le ayuda a planear los próximos pasos. No necesita cuenta y no guardamos nada sobre usted. ${l}`,
  Vietnamese: (l) => `Đây là ATLAS, đã cài sẵn cho bạn bằng tiếng Việt. ATLAS giải thích giấy tờ sau buổi khám và giúp bạn lên kế hoạch cho các bước tiếp theo. Không cần tài khoản và chúng tôi không lưu thông tin gì về bạn. ${l}`,
  Korean: (l) => `ATLAS 링크입니다. 한국어로 설정해 두었습니다. 진료 후 받은 안내문을 쉽게 설명하고 다음 단계를 계획하도록 도와줍니다. 계정이 필요 없고 저희는 개인 정보를 보관하지 않습니다. ${l}`,
  Chinese: (l) => `这是 ATLAS，已为您设置为中文。它会解释您的就诊单，并帮您安排下一步。无需注册账户，我们也不会保存您的任何信息。${l}`,
  // Reviewed 2026-10-03 by two model families (GPT and Gemini) via blind back-translation; not yet by a native speaker.
  Amharic: (l) => `ይህ ATLAS ነው፣ በአማርኛ ተዘጋጅቶልዎታል። ከሕክምና ጉብኝትዎ ጋር የተያያዘውን ሰነድ ያብራራል፣ ቀጣይ እርምጃዎችንም ለማቀድ ይረዳዎታል። መለያ መፍጠር አያስፈልግም፤ እርስዎን የሚመለከት ምንም መረጃ አናስቀምጥም። ${l}`,
  French: (l) => `Voici ATLAS, préparé pour vous en français. Il explique le compte rendu de votre visite et vous aide à prévoir les prochaines étapes. Pas de compte, et nous ne gardons rien sur vous. ${l}`,
};

export function helperSmsText(language: Language, link: string): string {
  return (SMS[language] ?? SMS.English)(link);
}

/** `sms:?&body=` opens the phone's messages app with the text filled in on both iPhone and Android. */
export function helperSmsHref(text: string): string {
  return `sms:?&body=${encodeURIComponent(text)}`;
}

/** The banner the person sees when they open the link: in their language, and in English for whoever is with them. */
const BANNER: Record<Language, (zip?: string) => string> = {
  English: (z) => `Someone helping you set this up in English${z ? ` for ${z}` : ""}. You can change anything.`,
  Spanish: (z) => `Alguien que le ayuda preparó esto en español${z ? ` para el código postal ${z}` : ""}. Puede cambiar cualquier cosa.`,
  Vietnamese: (z) => `Một người đang giúp bạn đã cài sẵn bằng tiếng Việt${z ? ` cho mã ZIP ${z}` : ""}. Bạn có thể thay đổi bất cứ điều gì.`,
  Korean: (z) => `도와주시는 분이 한국어로 설정해 두었습니다${z ? ` (우편번호 ${z})` : ""}. 무엇이든 바꿀 수 있습니다.`,
  Chinese: (z) => `帮助您的人已将这里设置为中文${z ? `（邮编 ${z}）` : ""}。您可以更改任何内容。`,
  Amharic: (z) => `የሚረዳዎት ሰው ይህንን በአማርኛ አዘጋጅቶልዎታል${z ? ` (ዚፕ ኮድ ${z})` : ""}። ማንኛውንም ነገር መቀየር ይችላሉ።`,
  French: (z) => `Une personne qui vous aide a préparé ceci en français${z ? ` pour le code postal ${z}` : ""}. Vous pouvez tout modifier.`,
};

export function helperBanner(p: HelperPresets): { text: string; lang: string; english: string | null } {
  const zip = p.zip && isZip(p.zip) ? p.zip : undefined;
  if (!p.language) {
    const english = `Someone helping you set this up${zip ? ` for ${zip}` : ""}. You can change anything.`;
    return { text: english, lang: "en", english: null };
  }
  const english = `Someone helping you set this up in ${p.language}${zip ? ` for ${zip}` : ""}. You can change anything.`;
  if (p.language === "English") return { text: english, lang: "en", english: null };
  return { text: BANNER[p.language](zip), lang: LANG_CODE[p.language], english };
}

/** Plans built in a browser tab that arrived through a helper link carry this header, so they can be counted. */
export const ENTRY_HEADER = "x-atlas-entry";
export const HELPER_ENTRY = "helper-link";
const SESSION_KEY = "atlas-entry";

/** Remembers, for this tab only, that it was opened from a helper link. Nothing about the link itself is kept. */
export function markHelperSession(): void {
  try { sessionStorage.setItem(SESSION_KEY, HELPER_ENTRY); } catch {}
}

/** Called once a plan from the link has been built, so one link counts at most one plan in this tab. */
export function consumeHelperSession(): void {
  try { sessionStorage.removeItem(SESSION_KEY); } catch {}
}

export function entryHeaders(): Record<string, string> {
  try { return sessionStorage.getItem(SESSION_KEY) === HELPER_ENTRY ? { [ENTRY_HEADER]: HELPER_ENTRY } : {}; } catch { return {}; }
}
