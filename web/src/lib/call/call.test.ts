import { createVerify, generateKeyPairSync } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { issueSpeakToken } from "../speakToken";
import { callConfig, normalizePem, publicBaseUrl, signTicket, verifyTicket, type CallConfig } from "./config";
import { audioFor, CODE_CALL_GAP_MS, CODE_CALLS_PER_HOUR, CODE_CALLS_PER_IP, CODE_CALLS_PER_NUMBER, handleEvent, handleInput, publicStatus, startCall, verifyAndCall, type Deps } from "./flow";
import { MemoryCallStore } from "./memoryStore";
import { canCallIn, codeNcco, MAX_REPLAYS, planLengthSeconds, planNcco, talkChunks, TALK_CHUNK, VONAGE_TTS } from "./ncco";
import { last4, parseUsPhone, phoneHash } from "./phone";
import { open, openText, seal } from "./seal";
import { reserveSlots } from "./store";
import { vonageJwt } from "./vonage";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const SECRET = "call-secret-for-tests";
const SPEAK = "speak-secret-for-tests";
const NOW = Date.UTC(2026, 9, 2, 15, 0, 0);
const PHONE = "(404) 555-2368";
const TEXT = "Take the blue pill.\n1. Call the clinic. Ask for Dr. Lee.";

const cfg: CallConfig = { applicationId: "app-123", privateKey: PEM, from: "+19432445023", secret: SECRET, baseUrl: "https://atlas.example", siteDailyCap: 40 };
const b64json = (s: string) => JSON.parse(Buffer.from(s, "base64url").toString());

function vonageOk(uuid = "call-uuid") {
  return vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => new Response(JSON.stringify({ uuid }), { status: 201 }));
}
const sentBody = (f: ReturnType<typeof vonageOk>, i = 0) => JSON.parse(String(f.mock.calls[i][1]?.body));

describe("Vonage application JWT", () => {
  it("is RS256, names the application, lives 5 minutes, and verifies with the public key", () => {
    const jwt = vonageJwt("app-123", PEM, NOW);
    const [h, b, s] = jwt.split(".");
    expect(b64json(h)).toEqual({ alg: "RS256", typ: "JWT" });
    const body = b64json(b);
    expect(body.application_id).toBe("app-123");
    expect(body.exp - body.iat).toBe(300);
    expect(body.iat).toBe(NOW / 1000);
    expect(typeof body.jti).toBe("string");
    const v = createVerify("RSA-SHA256");
    v.update(`${h}.${b}`);
    expect(v.verify(publicKey, Buffer.from(s, "base64url"))).toBe(true);
  });

  it("accepts the key as a PEM, a PEM with escaped newlines, or base64", () => {
    expect(normalizePem(PEM)).toBe(PEM.trim());
    expect(normalizePem(PEM.replace(/\n/g, "\\n"))).toBe(PEM.trim());
    expect(normalizePem(Buffer.from(PEM).toString("base64"))).toBe(PEM.trim());
  });
});

describe("wired-or-cut config", () => {
  const env = {
    ATLAS_VONAGE_APPLICATION_ID: "app", ATLAS_VONAGE_PRIVATE_KEY: Buffer.from(PEM).toString("base64"), ATLAS_VONAGE_FROM_NUMBER: "+19432445023",
    ATLAS_CALL_SECRET: "s", DATABASE_URL: "postgres://x", VERCEL_ENV: "production", VERCEL_PROJECT_PRODUCTION_URL: "atlas-team12.vercel.app",
  };
  it("is on with every variable, and off when any one is missing", () => {
    const c = callConfig(env);
    expect(c?.baseUrl).toBe("https://atlas-team12.vercel.app");
    expect(c?.from).toBe("+19432445023");
    expect(c?.siteDailyCap).toBe(40);
    for (const k of ["ATLAS_VONAGE_APPLICATION_ID", "ATLAS_VONAGE_PRIVATE_KEY", "ATLAS_VONAGE_FROM_NUMBER", "ATLAS_CALL_SECRET", "DATABASE_URL"]) {
      expect(callConfig({ ...env, [k]: "" }), k).toBeNull();
    }
  });
  it("needs an https origin Vonage can reach, and reads the daily cap", () => {
    expect(callConfig({ ...env, VERCEL_ENV: "", VERCEL_PROJECT_PRODUCTION_URL: "" })).toBeNull();
    expect(publicBaseUrl({ ATLAS_PUBLIC_URL: "http://localhost:3000" })).toBeNull();
    expect(publicBaseUrl({ VERCEL_URL: "atlas-team12-abc.vercel.app" })).toBe("https://atlas-team12-abc.vercel.app");
    expect(callConfig({ ...env, ATLAS_CALL_DAILY_CAP: "5" })?.siteDailyCap).toBe(5);
  });
});

describe("US phone numbers", () => {
  it("normalizes an ordinary US number", () => {
    expect(parseUsPhone(PHONE)).toBe("+14045552368");
    expect(parseUsPhone("+1 943 244 5023")).toBe("+19432445023");
    expect(last4("+14045552368")).toBe("2368");
  });
  it.each(["900-555-1234", "976-555-1234", "800-555-1234", "888-555-1234", "416-555-2368", "787-555-2368", "12345", "911", "404-911-2345", "404-555-0123", "abc", "", "+44 20 7946 0958"])(
    "refuses %s", (n) => expect(parseUsPhone(n)).toBeNull(),
  );
  it("hashes the number with the secret, never in the clear", () => {
    const h = phoneHash(SECRET, "+14045552368");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toBe(phoneHash("other", "+14045552368"));
  });
});

describe("callback tickets", () => {
  it("round-trips and names the purpose", () => {
    const t = signTicket(SECRET, { k: "s1", p: "audio" }, 60_000, NOW);
    expect(verifyTicket(SECRET, t, "audio", NOW + 1000)?.k).toBe("s1");
    expect(verifyTicket(SECRET, t, "input", NOW + 1000)).toBeNull();
  });
  it("expires", () => {
    const t = signTicket(SECRET, { k: "s1", p: "event" }, 60_000, NOW);
    expect(verifyTicket(SECRET, t, "event", NOW + 61_000)).toBeNull();
  });
  it("refuses a tampered body, a tampered signature and another secret", () => {
    const t = signTicket(SECRET, { k: "s1", p: "input", n: 0 }, 60_000, NOW);
    const [body, sig] = t.split(".");
    const forged = Buffer.from(JSON.stringify({ k: "s1", p: "input", n: -5, exp: NOW + 60_000 })).toString("base64url");
    expect(verifyTicket(SECRET, `${forged}.${sig}`, "input", NOW)).toBeNull();
    expect(verifyTicket(SECRET, `${body}.${sig.slice(0, -2)}AA`, "input", NOW)).toBeNull();
    expect(verifyTicket("other", t, "input", NOW)).toBeNull();
    expect(verifyTicket(SECRET, null, "input", NOW)).toBeNull();
  });
});

describe("encryption at rest", () => {
  it("round-trips and binds the field and the session", () => {
    const s = seal(SECRET, "text", "sess", NOW + 60_000, TEXT);
    expect(s.includes(Buffer.from("blue pill"))).toBe(false);
    expect(openText(SECRET, "text", "sess", s, NOW)).toBe(TEXT);
    expect(openText(SECRET, "phone", "sess", s, NOW)).toBeNull();
    expect(openText(SECRET, "text", "other", s, NOW)).toBeNull();
    expect(openText("other-secret", "text", "sess", s, NOW)).toBeNull();
  });
  it("refuses to open after its time, even if the row was not swept, and an edited expiry breaks it", () => {
    const s = seal(SECRET, "audio", "sess", NOW + 60_000, Buffer.from([1, 2, 3]));
    expect(open(SECRET, "audio", "sess", s, NOW + 59_000)).toEqual(Buffer.from([1, 2, 3]));
    expect(open(SECRET, "audio", "sess", s, NOW + 61_000)).toBeNull();
    const edited = Buffer.from(s);
    edited.writeBigUInt64BE(BigInt(NOW + 10 * 60_000), 2);
    expect(open(SECRET, "audio", "sess", edited, NOW + 61_000)).toBeNull();
  });
});

describe("NCCO", () => {
  it("speaks the code digit by digit in the plan's language", () => {
    expect(codeNcco("1234", "Spanish")).toEqual([{ action: "talk", text: expect.stringContaining("1, 2, 3, 4"), language: "es-US" }]);
    expect(codeNcco("0907", "Chinese")[0]).toMatchObject({ language: "cmn-CN", text: expect.stringContaining("0, 9, 0, 7") });
  });
  it("calls in every ATLAS language except Amharic", () => {
    expect(canCallIn("Amharic")).toBe(false);
    expect(Object.keys(VONAGE_TTS).sort()).toEqual(["Chinese", "English", "French", "Korean", "Spanish", "Vietnamese"]);
    expect(() => planNcco({ text: "x", language: "Amharic", audioUrl: null, inputUrl: "u", replays: 0 })).toThrow();
  });
  it("streams the natural voice, then offers press 1, then says goodbye after the last replay", () => {
    const first = planNcco({ text: TEXT, language: "English", audioUrl: "https://a/audio", inputUrl: "https://a/input", replays: 0 });
    expect(first.map((a) => a.action)).toEqual(["talk", "stream", "talk", "input"]);
    expect(first[1]).toEqual({ action: "stream", streamUrl: ["https://a/audio"] });
    expect(first[3]).toMatchObject({ type: ["dtmf"], eventUrl: ["https://a/input"], dtmf: { maxDigits: 1 } });
    const replay = planNcco({ text: TEXT, language: "English", audioUrl: "https://a/audio", inputUrl: "u", replays: 1 });
    expect(replay.map((a) => a.action)).toEqual(["stream", "talk", "input"]);
    const last = planNcco({ text: TEXT, language: "English", audioUrl: "https://a/audio", inputUrl: "u", replays: MAX_REPLAYS });
    expect(last.map((a) => a.action)).toEqual(["stream", "talk"]);
  });
  it("falls back to Vonage's voice in the plan's language, split into bounded chunks", () => {
    const long = Array.from({ length: 40 }, (_, i) => `${i + 1}. Step number ${i + 1} says something long enough to matter.`).join("\n");
    const n = planNcco({ text: long, language: "Korean", audioUrl: null, inputUrl: "u", replays: 0 });
    const plan = n.slice(1, -2);
    expect(plan.length).toBeGreaterThan(1);
    expect(plan.every((a) => a.action === "talk" && a.language === "ko-KR" && String(a.text).length <= TALK_CHUNK)).toBe(true);
    expect(plan.map((a) => a.text).join("\n")).toBe(long);
  });
  it("splits a single very long line without losing words", () => {
    const line = "word ".repeat(500).trim();
    const parts = talkChunks(line, 100);
    expect(parts.every((p) => p.length <= 100)).toBe(true);
    expect(parts.join(" ")).toBe(line);
  });
  it("bounds how long a plan call may last", () => {
    expect(planLengthSeconds({ audioBytes: 8000 * 60, textChars: 0 })).toBe(20 + 70 * 3);
    expect(planLengthSeconds({ audioBytes: 8000 * 3000, textChars: 0 })).toBe(900);
  });
});

describe("caps", () => {
  it("restarts a windowed counter once its window has passed", async () => {
    const store = new MemoryCallStore();
    expect(await store.takeSlot("gap", 1, NOW, 60_000)).toBe(true);
    expect(await store.takeSlot("gap", 1, NOW + 59_000, 60_000)).toBe(false);
    expect(await store.takeSlot("gap", 1, NOW + 60_000, 60_000)).toBe(true);
    expect(await store.counter("gap", NOW + 60_000)).toBe(1);
    expect(await store.counter("gap", NOW + 120_000)).toBe(0);
  });
  it("reserves every counter or none", async () => {
    const store = new MemoryCallStore();
    store.counters.set("site", 40);
    expect(await reserveSlots(store, [{ key: "num", cap: 3 }, { key: "site", cap: 40 }], NOW)).toEqual({ ok: false, refused: 1 });
    expect(store.counters.get("num")).toBe(0); // given back
    store.counters.set("site", 0);
    expect(await reserveSlots(store, [{ key: "num", cap: 3 }, { key: "site", cap: 40 }], NOW)).toEqual({ ok: true });
  });
});

describe("the call flow", () => {
  let store: MemoryCallStore;
  let fetchImpl: ReturnType<typeof vonageOk>;
  const voice = vi.fn(async () => new Uint8Array(16_000).fill(9).buffer as ArrayBuffer);
  const deps = (over: Partial<Deps> = {}): Deps => ({ store, cfg, fetchImpl: fetchImpl as unknown as typeof fetch, now: NOW, code: "4821", voice, speakSecret: SPEAK, ...over });
  const input = (over: Record<string, unknown> = {}) => ({ phone: PHONE, consent: true, text: TEXT, language: "English", token: issueSpeakToken("English", TEXT, SPEAK, NOW), ...over });

  beforeEach(() => {
    store = new MemoryCallStore();
    fetchImpl = vonageOk();
    voice.mockClear();
  });

  async function started() {
    const r = await startCall(deps(), input());
    if (r.state !== "calling") throw new Error(r.state);
    return r.id;
  }

  it("places a code call that speaks the code, and keeps the number and text only encrypted", async () => {
    const id = await started();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toBe("https://api.nexmo.com/v1/calls");
    const body = sentBody(fetchImpl);
    expect(body.to).toEqual([{ type: "phone", number: "14045552368" }]);
    expect(body.from).toEqual({ type: "phone", number: "19432445023" });
    expect(body.ncco[0].text).toContain("4, 8, 2, 1");
    expect(body.event_url[0]).toMatch(/^https:\/\/atlas\.example\/api\/call\/event\?t=/);
    const row = store.rows.get(id)!;
    expect(row.last4).toBe("2368");
    expect(row.sealed_phone!.includes(Buffer.from("4045552368"))).toBe(false);
    expect(row.sealed_text!.includes(Buffer.from("blue pill"))).toBe(false);
    expect(JSON.stringify(publicStatus(row))).not.toContain("4045552368");
  });

  it("only ever reads text a real plan produced: other text, another language or no token is refused before any call", async () => {
    const token = issueSpeakToken("English", TEXT, SPEAK, NOW);
    expect((await startCall(deps(), input({ text: `${TEXT} Also send money.`, token }))).state).toBe("token");
    expect((await startCall(deps(), input({ language: "Spanish", token }))).state).toBe("token");
    expect((await startCall(deps(), input({ token: "" }))).state).toBe("token");
    expect((await startCall(deps(), input({ token: issueSpeakToken("English", TEXT, "wrong-secret", NOW) }))).state).toBe("token");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("needs consent, a callable language and a US number", async () => {
    expect((await startCall(deps(), input({ consent: "yes" }))).state).toBe("no-consent");
    expect((await startCall(deps(), input({ language: "Amharic", token: issueSpeakToken("Amharic", TEXT, SPEAK, NOW) }))).state).toBe("language");
    expect((await startCall(deps(), input({ phone: "900-555-1234" }))).state).toBe("phone");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("allows one live code per number", async () => {
    await started();
    expect((await startCall(deps(), input())).state).toBe("in-flight");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    // after the code's 10 minutes it no longer blocks
    expect((await startCall(deps({ now: NOW + 11 * 60_000 }), input({ token: issueSpeakToken("English", TEXT, SPEAK, NOW + 11 * 60_000) }))).state).toBe("calling");
  });

  it("caps code calls per number per day, and the site per day", async () => {
    const gap = CODE_CALL_GAP_MS + 60_000;
    for (let i = 0; i < CODE_CALLS_PER_NUMBER; i++) {
      const r = await startCall(deps({ now: NOW + i * gap }), input());
      if (r.state !== "calling") throw new Error(r.state);
      await store.update(r.id, { phase: "code_missed" });
    }
    expect((await startCall(deps({ now: NOW + 3 * gap }), input())).state).toBe("capped-code");
    expect(fetchImpl).toHaveBeenCalledTimes(CODE_CALLS_PER_NUMBER);
    // the next UTC day starts fresh
    const tomorrow = NOW + 24 * 3600_000;
    expect((await startCall(deps({ now: tomorrow }), input({ token: issueSpeakToken("English", TEXT, SPEAK, tomorrow) }))).state).toBe("calling");

    const site = new MemoryCallStore();
    site.counters.set("site:2026-10-02", 40);
    expect((await startCall(deps({ store: site }), input())).state).toBe("capped-site");
    expect(site.counters.get(`code:${phoneHash(SECRET, "+14045552368")}:2026-10-02`)).toBe(0); // the number's slot was given back
  });

  // A distinct plan token (one per built plan) for each number.
  const fresh = (i: number) => issueSpeakToken("English", TEXT, SPEAK, NOW - 1000 - i)!;

  it("caps code calls per caller across numbers, counted in the store", async () => {
    for (let i = 0; i < CODE_CALLS_PER_IP; i++) {
      expect((await startCall(deps(), input({ phone: `404-555-23${10 + i}`, caller: "ip1", token: fresh(i) }))).state).toBe("calling");
    }
    expect((await startCall(deps(), input({ phone: "404-555-2399", caller: "ip1", token: fresh(50) }))).state).toBe("capped-caller");
    expect((await startCall(deps(), input({ phone: "404-555-2399", caller: "ip2", token: fresh(51) }))).state).toBe("calling");
  });

  it("binds a plan token to the first number it calls: another number needs a new plan", async () => {
    const id = await started();
    expect((await startCall(deps(), input({ phone: "404-555-2399" }))).state).toBe("token-used");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    // the same number may be called again with the same plan (after a missed call and the 10-minute gap)
    await store.update(id, { phase: "code_missed" });
    expect((await startCall(deps({ now: NOW + CODE_CALL_GAP_MS + 1 }), input())).state).toBe("calling");
  });

  it("lets exactly one of two racing first uses of a token bind it", async () => {
    const r = await Promise.all([startCall(deps(), input({ phone: "404-555-2391" })), startCall(deps(), input({ phone: "404-555-2392" }))]);
    expect(r.map((x) => x.state).sort()).toEqual(["calling", "token-used"]);
  });

  it("places at most one code call per number per 10 minutes, whatever happened to the last one", async () => {
    const id = await started();
    await store.update(id, { phase: "code_missed" });
    expect((await startCall(deps({ now: NOW + 60_000 }), input())).state).toBe("too-soon");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect((await startCall(deps({ now: NOW + CODE_CALL_GAP_MS + 1 }), input())).state).toBe("calling");
  });

  it("caps code calls per hour site-wide", async () => {
    for (let i = 0; i < CODE_CALLS_PER_HOUR; i++) {
      expect((await startCall(deps(), input({ phone: `404-555-24${10 + i}`, caller: `ip${i}`, token: fresh(i) }))).state).toBe("calling");
    }
    expect((await startCall(deps(), input({ phone: "404-555-2499", caller: "ipx", token: fresh(99) }))).state).toBe("capped-site");
    const nextHour = NOW + 60 * 60_000;
    expect((await startCall(deps({ now: nextHour }), input({ phone: "404-555-2499", caller: "ipx", token: issueSpeakToken("English", TEXT, SPEAK, nextHour) }))).state).toBe("calling");
  });

  it("keeps a quarter of the site cap for plan calls, so code calls alone cannot use it up", async () => {
    const id = await started();
    store.counters.set("site:2026-10-02", 30); // 75% of 40, counting this session's code call
    expect((await startCall(deps(), input({ phone: "404-555-2399", token: fresh(7) }))).state).toBe("capped-site");
    expect((await verifyAndCall(deps(), { id, code: "4821" })).state).toBe("calling");
    expect(store.counters.get("site:2026-10-02")).toBe(31);
  });

  it("wipes a session's encrypted data as soon as its code expires", async () => {
    const id = await started();
    await store.sweep(NOW + 11 * 60_000);
    const row = store.rows.get(id)!;
    expect(row.phase).toBe("expired");
    expect([row.sealed_phone, row.sealed_text, row.sealed_token]).toEqual([null, null, null]);
  });

  it("logs and returns only the Vonage status, never its body", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    fetchImpl = vi.fn(async () => new Response("bad number 14045552368", { status: 400 }));
    expect((await startCall(deps(), input())).state).toBe("failed");
    expect(JSON.stringify(spy.mock.calls)).not.toContain("4045552368");
    spy.mockRestore();
  });

  it("does not spend a code call when the number already used its plan calls today", async () => {
    store.counters.set(`plan:${phoneHash(SECRET, "+14045552368")}:2026-10-02`, 3);
    expect((await startCall(deps(), input())).state).toBe("capped-plan");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fails closed when the database is down", async () => {
    store.failNext = true;
    expect((await startCall(deps(), input())).state).toBe("no-db");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("drops the session when Vonage refuses the code call", async () => {
    fetchImpl = vi.fn(async () => new Response("nope", { status: 401 }));
    expect((await startCall(deps(), input())).state).toBe("failed");
    expect(store.rows.size).toBe(0);
  });

  it("gives 3 tries at the code, then ends the session", async () => {
    const id = await started();
    expect(await verifyAndCall(deps(), { id, code: "0000" })).toEqual({ state: "wrong", attemptsLeft: 2 });
    expect(await verifyAndCall(deps(), { id, code: "1111" })).toEqual({ state: "wrong", attemptsLeft: 1 });
    expect(await verifyAndCall(deps(), { id, code: "2222" })).toEqual({ state: "expired" });
    expect(await verifyAndCall(deps(), { id, code: "4821" })).toEqual({ state: "expired" });
    expect(store.rows.get(id)!.sealed_text).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1); // only the code call
  });

  it("refuses an expired code", async () => {
    const id = await started();
    expect((await verifyAndCall(deps({ now: NOW + 11 * 60_000 }), { id, code: "4821" })).state).toBe("expired");
  });

  it("with the right code, places the plan call with the natural voice, streamed from a signed URL", async () => {
    const id = await started();
    const r = await verifyAndCall(deps(), { id, code: "4821" });
    expect(r).toEqual({ state: "calling", last4: "2368", mode: "stream" });
    expect(voice).toHaveBeenCalledWith(TEXT, "English");
    const body = sentBody(fetchImpl, 1);
    expect(body.ncco.map((a: { action: string }) => a.action)).toEqual(["talk", "stream", "talk", "input"]);
    const audioUrl = new URL(body.ncco[1].streamUrl[0]);
    expect(audioUrl.origin + audioUrl.pathname).toBe("https://atlas.example/api/call/audio");
    const t = verifyTicket(SECRET, audioUrl.searchParams.get("t"), "audio", NOW)!;
    expect(t.k).toBe(id);
    // the MP3 comes back from the store (any instance), and only for this session's ticket
    expect((await audioFor({ store, cfg, now: NOW }, t))?.byteLength).toBe(16_000);
    expect(body.length_timer).toBe(planLengthSeconds({ audioBytes: 16_000, textChars: TEXT.length }));
    // the code can't be used twice
    expect((await verifyAndCall(deps(), { id, code: "4821" })).state).toBe("expired");
  });

  it("falls back to Vonage's own voice when the natural voice is unavailable", async () => {
    const id = await started();
    const r = await verifyAndCall(deps({ voice: async () => null }), { id, code: "4821" });
    expect(r).toMatchObject({ state: "calling", mode: "talk" });
    const body = sentBody(fetchImpl, 1);
    expect(body.ncco[1]).toMatchObject({ action: "talk", language: "en-US", text: TEXT });
  });

  it("caps plan calls per number and wipes the session when refused", async () => {
    const id = await started();
    store.counters.set(`plan:${phoneHash(SECRET, "+14045552368")}:2026-10-02`, 3);
    expect((await verifyAndCall(deps(), { id, code: "4821" })).state).toBe("capped-plan");
    const row = store.rows.get(id)!;
    expect(row.phase).toBe("failed");
    expect([row.sealed_phone, row.sealed_text, row.sealed_token]).toEqual([null, null, null]);
  });

  it("refuses the plan call if the token stored with the session no longer matches", async () => {
    const id = await started();
    const row = store.rows.get(id)!;
    row.sealed_text = seal(SECRET, "text", id, row.expires_at.getTime(), "Different text.");
    expect((await verifyAndCall(deps(), { id, code: "4821" })).state).toBe("token");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("replays on 1 at most twice, then says goodbye", async () => {
    const id = await started();
    await verifyAndCall(deps(), { id, code: "4821" });
    const tk = (n: number) => ({ k: id, p: "input" as const, n, exp: NOW + 60_000 });
    const again = await handleInput({ store, cfg, now: NOW }, tk(0), "1");
    expect(again.map((a) => a.action)).toEqual(["stream", "talk", "input"]);
    const next = verifyTicket(SECRET, new URL(String((again[2].eventUrl as string[])[0])).searchParams.get("t"), "input", NOW)!;
    expect(next.n).toBe(1);
    expect((await handleInput({ store, cfg, now: NOW }, tk(1), "1")).map((a) => a.action)).toEqual(["stream", "talk"]);
    expect((await handleInput({ store, cfg, now: NOW }, tk(2), "1")).map((a) => a.action)).toEqual(["talk"]);
    expect((await handleInput({ store, cfg, now: NOW }, tk(0), "9")).map((a) => a.action)).toEqual(["talk"]);
  });

  it("wipes the number, text and audio when the plan call ends, and never moves a status backwards", async () => {
    const id = await started();
    await verifyAndCall(deps(), { id, code: "4821" });
    const ev = { k: id, p: "event" as const, c: "plan" as const, exp: NOW + 60_000 };
    await handleEvent({ store, now: NOW }, ev, "answered");
    await handleEvent({ store, now: NOW }, ev, "ringing");
    expect(store.rows.get(id)!.plan_status).toBe("answered");
    await handleEvent({ store, now: NOW }, ev, "completed");
    const row = store.rows.get(id)!;
    expect(row.phase).toBe("done");
    expect([row.sealed_phone, row.sealed_text, row.sealed_token, row.sealed_audio]).toEqual([null, null, null, null]);
    expect(await audioFor({ store, cfg, now: NOW }, { ...ev, p: "audio" })).toBeNull();
    expect(publicStatus(row)).toMatchObject({ phase: "done", plan_status: "completed", last4: "2368" });
  });

  it("ends a session whose code call nobody answered, freeing the number for a new code", async () => {
    const id = await started();
    await handleEvent({ store, now: NOW }, { k: id, p: "event", c: "code", exp: NOW + 60_000 }, "unanswered");
    expect(store.rows.get(id)!.phase).toBe("code_missed");
    expect((await startCall(deps({ now: NOW + CODE_CALL_GAP_MS + 1 }), input())).state).toBe("calling");
  });

  it("is gone after 30 minutes", async () => {
    const id = await started();
    expect(publicStatus(await store.get(id, NOW + 31 * 60_000))).toEqual({ phase: "gone" });
  });
});
