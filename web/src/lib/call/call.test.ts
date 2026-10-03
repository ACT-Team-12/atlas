import { createHash, createHmac, createVerify, generateKeyPairSync } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { issueSpeakToken } from "../speakToken";
import { callConfig, normalizePem, strongSecret, publicBaseUrl, signTicket, verifyTicket, type CallConfig } from "./config";
import { audioFor, CODE_CALL_GAP_MS, CODE_CALLS_PER_HOUR, CODE_CALLS_PER_IP, CODE_CALLS_PER_NUMBER, handleEvent, handleInput, publicStatus, settlePendingEnds, startCall, verifyAndCall, type Deps } from "./flow";
import { MemoryCallStore } from "./memoryStore";
import { startRefusal, verifyRefusal } from "./messages";
import { canCallIn, codeNcco, gateNcco, MAX_REPLAYS, planLengthSeconds, planNcco, talkChunks, TALK_CHUNK, VONAGE_TTS } from "./ncco";
import { last4, parseUsPhone, phoneHash } from "./phone";
import { open, openText, seal } from "./seal";
import { CallStoreDown, END_PENDING, PREPARING_MAX_MS, reserveSlots, UNCONFIRMED_PLAN_MS } from "./store";
import { placeCall, vonageJwt } from "./vonage";
import { verifyVonageJwt } from "./webhook";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const SECRET = "call-secret-for-tests";
const SPEAK = "speak-secret-for-tests";
const NOW = Date.UTC(2026, 9, 2, 15, 0, 0);
const PHONE = "(404) 555-2368";
const TEXT = "Take the blue pill.\n1. Call the clinic. Ask for Dr. Lee.";

const cfg: CallConfig = { applicationId: "app-123", privateKey: PEM, from: "+19432445023", secret: SECRET, baseUrl: "https://atlas.example", siteDailyCap: 40, signatureSecret: null };
const b64json = (s: string) => JSON.parse(Buffer.from(s, "base64url").toString());

/** What Vonage's GET /v1/calls/{uuid} reports for each call the mock placed (the truth the callbacks are checked against). */
const truth = new Map<string, { status: string; to?: string; direction?: string }>();
/** A mocked Vonage: POST /v1/calls places call-1, call-2, ...; GET /v1/calls/{uuid} answers from `truth`. */
function vonageOk() {
  let n = 0;
  return vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async (url, init) => {
    if ((init?.method ?? "GET") === "GET") {
      const uuid = decodeURIComponent(url.split("/").pop() ?? "");
      const t = truth.get(uuid);
      if (!t) return new Response("{}", { status: 404 });
      return new Response(JSON.stringify({ uuid, status: t.status, direction: t.direction ?? "outbound", to: { type: "phone", number: t.to ?? "14045552368" } }), { status: 200 });
    }
    const uuid = `call-${++n}`;
    truth.set(uuid, { status: "started" });
    return new Response(JSON.stringify({ uuid }), { status: 201 });
  });
}
/** Like vonageOk, but the `failPost`-th POST answers 503 after Vonage did create the call (as `lostUuid`). */
function vonageFlaky(failPost: number, lostUuid = "call-lost") {
  const ok = vonageOk();
  let p = 0;
  return vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async (url, init) => {
    if (init?.method === "POST" && ++p === failPost) {
      truth.set(lostUuid, { status: "started" });
      return new Response("", { status: 503 });
    }
    return ok(url, init);
  });
}
const posts = (f: ReturnType<typeof vonageOk>) => f.mock.calls.filter((c) => c[1]?.method === "POST");
const sentBody = (f: ReturnType<typeof vonageOk>, i = 0) => JSON.parse(String(posts(f)[i][1]?.body));

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

describe("placing a call when Vonage does not confirm it", () => {
  const o = { applicationId: "app-123", privateKey: PEM, to: "+14045552368", from: "+19432445023", ncco: [], eventUrl: "https://a/e", lengthTimer: 60 };
  it("treats a timeout, a dropped connection, a 5xx or a success without a uuid as UNKNOWN, a 4xx as a refusal", async () => {
    expect(await placeCall(o, (() => new Promise(() => {})) as unknown as typeof fetch, 20)).toMatchObject({ ok: false, unknown: true });
    expect(await placeCall(o, (async () => { throw new TypeError("reset"); }) as unknown as typeof fetch)).toMatchObject({ ok: false, unknown: true });
    expect(await placeCall(o, (async () => new Response("", { status: 502 })) as unknown as typeof fetch)).toMatchObject({ ok: false, unknown: true });
    expect(await placeCall(o, (async () => new Response("{}", { status: 201 })) as unknown as typeof fetch)).toMatchObject({ ok: false, unknown: true });
    expect(await placeCall(o, (async () => new Response("", { status: 400 })) as unknown as typeof fetch)).toMatchObject({ ok: false, unknown: false });
  });
});

describe("wired-or-cut config", () => {
  const env = {
    ATLAS_VONAGE_APPLICATION_ID: "app", ATLAS_VONAGE_PRIVATE_KEY: Buffer.from(PEM).toString("base64"), ATLAS_VONAGE_FROM_NUMBER: "+19432445023",
    ATLAS_CALL_SECRET: "test-only-call-secret-0123456789abcdef", DATABASE_URL: "postgres://x", VERCEL_ENV: "production", VERCEL_PROJECT_PRODUCTION_URL: "atlas-team12.vercel.app",
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
  it("stays off with a short or placeholder ATLAS_CALL_SECRET, and never logs it", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const weak of ["s", "changeme", "x".repeat(64), "0123456789".repeat(3), "abababababababababababababababab12"]) {
      expect(callConfig({ ...env, ATLAS_CALL_SECRET: weak }), weak).toBeNull();
    }
    expect(JSON.stringify(err.mock.calls)).not.toContain("changeme");
    err.mockRestore();
    expect(strongSecret("test-only-call-secret-0123456789abcdef")).toBe(true);
  });
  it("needs an https origin Vonage can reach, and reads the daily cap", () => {
    expect(callConfig({ ...env, VERCEL_ENV: "", VERCEL_PROJECT_PRODUCTION_URL: "" })).toBeNull();
    expect(publicBaseUrl({ ATLAS_PUBLIC_URL: "http://localhost:3000" })).toBeNull();
    expect(publicBaseUrl({ VERCEL_URL: "atlas-team12-abc.vercel.app" })).toBe("https://atlas-team12-abc.vercel.app");
    expect(callConfig({ ...env, ATLAS_CALL_DAILY_CAP: "5" })?.siteDailyCap).toBe(5);
  });
});

describe("Vonage signed webhooks (HS256 JWT, optional defense in depth)", () => {
  const SIG = "sig-secret";
  const jwt = (claims: Record<string, unknown>, secret = SIG, alg = "HS256") => {
    const h = Buffer.from(JSON.stringify({ alg, typ: "JWT" })).toString("base64url");
    const p = Buffer.from(JSON.stringify(claims)).toString("base64url");
    return `Bearer ${h}.${p}.${createHmac("sha256", secret).update(`${h}.${p}`).digest("base64url")}`;
  };
  const body = JSON.stringify({ uuid: "call-1", status: "completed" });
  const hash = createHash("sha256").update(body).digest("hex");
  const good = { iat: NOW / 1000, jti: "j", iss: "Vonage", api_key: "k", application_id: "app-123", payload_hash: hash };

  it("accepts a fresh, correctly signed token whose payload_hash matches the body", () => {
    expect(verifyVonageJwt(jwt(good), body, SIG, NOW, "app-123")).toBe(true);
  });
  it("refuses another secret, a changed body, an old token, another application, alg none, or no token", () => {
    expect(verifyVonageJwt(jwt(good, "other"), body, SIG, NOW)).toBe(false);
    expect(verifyVonageJwt(jwt(good), body.replace("completed", "answered"), SIG, NOW)).toBe(false);
    expect(verifyVonageJwt(jwt(good), body, SIG, NOW + 11 * 60_000)).toBe(false);
    expect(verifyVonageJwt(jwt(good), body, SIG, NOW, "other-app")).toBe(false);
    expect(verifyVonageJwt(jwt(good, SIG, "none"), body, SIG, NOW)).toBe(false);
    expect(verifyVonageJwt(null, body, SIG, NOW)).toBe(false);
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

describe("start refusals before the code", () => {
  it("answer the same for every reason that depends on the number's history, so a stranger's number reveals nothing", () => {
    const same = (["in-flight", "too-soon", "capped-code", "capped-plan"] as const).map((s) => JSON.stringify(startRefusal(s)));
    expect(new Set(same).size).toBe(1);
    expect(same[0]).not.toMatch(/already on its way|last 10 minutes|3 code calls|3 plan calls/);
    expect(startRefusal("capped-caller")).not.toEqual(startRefusal("in-flight")); // reasons not about the number stay specific
  });
});

describe("NCCO", () => {
  it("before the code, says nothing about a plan in any language, so voicemail records only a code request", () => {
    const planWord: Record<string, RegExp> = { English: /plan|health/i, Spanish: /plan|salud/i, Vietnamese: /kế hoạch|sức khỏe/i, Korean: /계획|건강/, Chinese: /计划|健康/, French: /plan|santé/i };
    for (const [language, word] of Object.entries(planWord)) {
      for (const retry of [false, true]) {
        const [prompt] = gateNcco({ language: language as "English", inputUrl: "https://x/i", retry });
        expect(String(prompt.text), `${language} retry=${retry}`).not.toMatch(word);
      }
    }
  });
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
    expect(planLengthSeconds({ audioBytes: 8000 * 60, textChars: 0 })).toBe(20 + 30 + 70 * 3); // 30 s for the code prompt
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

  const hk = (over: { now?: number } = {}) => ({ store, cfg, fetchImpl: fetchImpl as unknown as typeof fetch, now: NOW, ...over });

  beforeEach(() => {
    truth.clear();
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
    expect([row.sealed_phone, row.sealed_text, row.sealed_token, row.last4]).toEqual([null, null, null, null]);
    expect([row.phone_hash, row.language, row.code_uuid, row.note]).toEqual([null, null, null, null]);
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

  /** The person's answer at the start of the plan call: the 4-digit code they typed on the page, then pound. */
  const gate = (id: string, digits: string, g = 0, uuid = "call-2") => {
    truth.set(uuid, { status: "answered" });
    return handleInput(hk(), { k: id, p: "input", g, exp: NOW + 60_000 }, digits, uuid);
  };

  it("places the plan call with nothing in it but a code prompt: whoever answers (or voicemail) hears no plan", async () => {
    const id = await started();
    const r = await verifyAndCall(deps(), { id, code: "4821" });
    expect(r).toEqual({ state: "calling", last4: "2368", mode: "stream" });
    expect(voice).toHaveBeenCalledWith(TEXT, "English");
    const body = sentBody(fetchImpl, 1);
    expect(body.ncco.map((a: { action: string }) => a.action)).toEqual(["talk", "input"]);
    expect(body.ncco[0].text).toContain("4-digit code");
    expect(body.ncco[1]).toMatchObject({ type: ["dtmf"], dtmf: { maxDigits: 4, submitOnHash: true, timeOut: 3 } });
    expect(JSON.stringify(body.ncco)).not.toContain("blue pill");
    expect(JSON.stringify(body.ncco)).not.toContain("/api/call/audio");
    expect(body.length_timer).toBe(planLengthSeconds({ audioBytes: 16_000, textChars: TEXT.length }));
    // the code can't be used twice on the page
    expect((await verifyAndCall(deps(), { id, code: "4821" })).state).toBe("expired");
  });

  it("plays the plan, streamed from a signed URL, only after the right code is entered on the call", async () => {
    const id = await started();
    await verifyAndCall(deps(), { id, code: "4821" });
    const ncco = await gate(id, "4821");
    expect(ncco.map((a) => a.action)).toEqual(["talk", "stream", "talk", "input"]);
    const audioUrl = new URL(String((ncco[1].streamUrl as string[])[0]));
    expect(audioUrl.origin + audioUrl.pathname).toBe("https://atlas.example/api/call/audio");
    const t = verifyTicket(SECRET, audioUrl.searchParams.get("t"), "audio", NOW)!;
    expect(t.k).toBe(id);
    // the MP3 comes back from the store (any instance), and only for this session's ticket
    expect((await audioFor({ store, cfg, now: NOW }, t))?.byteLength).toBe(16_000);
  });

  it("a wrong code gets one more try, then goodbye, never the plan", async () => {
    const id = await started();
    await verifyAndCall(deps(), { id, code: "4821" });
    const retry = await gate(id, "1111");
    expect(retry.map((a) => a.action)).toEqual(["talk", "input"]);
    const next = verifyTicket(SECRET, new URL(String((retry[1].eventUrl as string[])[0])).searchParams.get("t"), "input", NOW)!;
    expect(next.g).toBe(1);
    const out = await gate(id, "1111", 1);
    expect(out.map((a) => a.action)).toEqual(["talk"]);
    expect(JSON.stringify([retry, out])).not.toContain("blue pill");
    expect(JSON.stringify([retry, out])).not.toContain("/api/call/audio"); // no plan audio URL before the right code
    expect((await gate(id, "4821", 2)).map((a) => a.action)).toEqual(["talk"]); // past the tries, even the right code
  });

  it.each([[""], ["48211"], [undefined]])("silence or a malformed entry (%s), as from voicemail, never gets the plan", async (digits) => {
    const id = await started();
    await verifyAndCall(deps(), { id, code: "4821" });
    const first = await gate(id, digits as string, 0);
    const second = await gate(id, digits as string, 1);
    expect([first.map((a) => a.action), second.map((a) => a.action)]).toEqual([["talk", "input"], ["talk"]]);
    expect(JSON.stringify([first, second])).not.toContain("blue pill");
    expect(JSON.stringify([first, second])).not.toContain("/api/call/audio");
  });

  it("counts code tries at the start of the plan call in the store, so a replayed first-try callback cannot guess on", async () => {
    const id = await started();
    await verifyAndCall(deps(), { id, code: "4821" });
    expect((await gate(id, "1111", 0)).map((a) => a.action)).toEqual(["talk", "input"]);
    expect((await gate(id, "2222", 0)).map((a) => a.action)).toEqual(["talk", "input"]);
    // the same g=0 ticket a third time: tries are used up, even with the right code
    expect((await gate(id, "4821", 0)).map((a) => a.action)).toEqual(["talk"]);
  });

  it("the right code on a call Vonage does not report live, or for another call, says goodbye", async () => {
    const id = await started();
    await verifyAndCall(deps(), { id, code: "4821" });
    truth.set("call-2", { status: "completed" });
    expect((await handleInput(hk(), { k: id, p: "input", g: 0, exp: NOW + 60_000 }, "4821", "call-2")).map((a) => a.action)).toEqual(["talk"]);
    truth.set("call-x", { status: "answered", to: "14045552368" });
    expect((await handleInput(hk(), { k: id, p: "input", g: 0, exp: NOW + 60_000 }, "4821", "call-x")).map((a) => a.action)).toEqual(["talk"]);
  });

  it("falls back to Vonage's own voice when the natural voice is unavailable", async () => {
    const id = await started();
    const r = await verifyAndCall(deps({ voice: async () => null }), { id, code: "4821" });
    expect(r).toMatchObject({ state: "calling", mode: "talk" });
    const ncco = await gate(id, "4821");
    expect(ncco[1]).toMatchObject({ action: "talk", language: "en-US", text: TEXT });
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
    truth.set("call-2", { status: "answered" });
    const tk = (n: number) => ({ k: id, p: "input" as const, n, exp: NOW + 60_000 });
    const again = await handleInput(hk(), tk(0), "1", "call-2");
    expect(again.map((a) => a.action)).toEqual(["stream", "talk", "input"]);
    const next = verifyTicket(SECRET, new URL(String((again[2].eventUrl as string[])[0])).searchParams.get("t"), "input", NOW)!;
    expect(next.n).toBe(1);
    expect((await handleInput(hk(), tk(1), "1", "call-2")).map((a) => a.action)).toEqual(["stream", "talk"]);
    expect((await handleInput(hk(), tk(2), "1", "call-2")).map((a) => a.action)).toEqual(["talk"]);
    expect((await handleInput(hk(), tk(0), "9", "call-2")).map((a) => a.action)).toEqual(["talk"]);
  });

  it("wipes the number, text and audio when the plan call ends, and never moves a status backwards", async () => {
    const id = await started();
    await verifyAndCall(deps(), { id, code: "4821" });
    const ev = { k: id, p: "event" as const, c: "plan" as const, exp: NOW + 60_000 };
    truth.set("call-2", { status: "answered" });
    expect(await handleEvent(hk(), ev, "call-2")).toBe("ok");
    truth.set("call-2", { status: "ringing" });
    await handleEvent(hk(), ev, "call-2");
    expect(store.rows.get(id)!.plan_status).toBe("answered");
    truth.set("call-2", { status: "completed" });
    await handleEvent(hk(), ev, "call-2");
    const row = store.rows.get(id)!;
    expect(row.phase).toBe("done");
    expect([row.sealed_phone, row.sealed_text, row.sealed_token, row.sealed_audio]).toEqual([null, null, null, null]);
    expect(await audioFor({ store, cfg, now: NOW }, { ...ev, p: "audio" })).toBeNull();
    // even the last 4 digits go: the page keeps its own copy for display
    expect(row.last4).toBeNull();
    // and everything else about the call: only whether it finished is left, with nothing tied to the person
    expect([row.phone_hash, row.language, row.code_uuid, row.plan_uuid, row.note, row.plan_mode, row.placed_at, row.code_hash]).toEqual([null, null, null, null, null, null, null, null]);
    expect(publicStatus(row)).toMatchObject({ phase: "done", plan_status: "completed", last4: null });
  });

  it("a 'completed' callback while Vonage's GET still says answered asks for a retry, then the retry wipes", async () => {
    const id = await started();
    await verifyAndCall(deps(), { id, code: "4821" });
    const ev = { k: id, p: "event" as const, c: "plan" as const, exp: NOW + 60_000 };
    truth.set("call-2", { status: "answered" });
    expect(await handleEvent(hk(), ev, "call-2", "answered")).toBe("ok");
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await handleEvent(hk(), ev, "call-2", "completed")).toBe("error"); // stale read: 503, Vonage retries
    err.mockRestore();
    expect(store.rows.get(id)!.phase).toBe("calling"); // the body alone never ends a call or wipes it
    truth.set("call-2", { status: "completed" });
    expect(await handleEvent(hk(), ev, "call-2", "completed")).toBe("ok");
    expect(store.rows.get(id)!.phase).toBe("done");
    expect(store.rows.get(id)!.sealed_text).toBeNull();
  });

  describe("a pending end the sweep re-checks with Vonage (#54)", () => {
    const planLive = async () => {
      const id = await started();
      await verifyAndCall(deps(), { id, code: "4821" });
      truth.set("call-2", { status: "answered" });
      const ev = { k: id, p: "event" as const, c: "plan" as const, exp: NOW + 60_000 };
      expect(await handleEvent(hk(), ev, "call-2", "answered")).toBe("ok");
      return { id, ev };
    };
    const quiet = () => vi.spyOn(console, "error").mockImplementation(() => {});

    it("a stale GET on the first delivery AND on the retry marks the end pending, keeps the call, and the sweep wipes once Vonage turns terminal", async () => {
      const { id, ev } = await planLive();
      const err = quiet();
      expect(await handleEvent(hk(), ev, "call-2", "completed")).toBe("error"); // first delivery: stale
      expect(store.rows.get(id)!.note).toBe(END_PENDING);
      expect(await handleEvent(hk(), ev, "call-2", "completed")).toBe("error"); // the retry: stale again
      err.mockRestore();
      let row = store.rows.get(id)!;
      expect([row.phase, row.note]).toEqual(["calling", END_PENDING]);
      expect(row.sealed_text).not.toBeNull(); // nothing wiped on the callback's word
      // The sweep asks Vonage again: still live, so it changes nothing.
      expect(await settlePendingEnds(hk({ now: NOW + 5 * 60_000 }))).toEqual({ checked: 1, ended: 0, failed: 0 });
      expect(store.rows.get(id)!.phase).toBe("calling");
      // Vonage now reports the end: the next sweep wipes everything, the marker included.
      truth.set("call-2", { status: "completed" });
      expect(await settlePendingEnds(hk({ now: NOW + 10 * 60_000 }))).toEqual({ checked: 1, ended: 1, failed: 0 });
      row = store.rows.get(id)!;
      expect([row.phase, row.plan_status, row.note, row.sealed_phone, row.sealed_text, row.sealed_token, row.sealed_audio, row.plan_uuid])
        .toEqual(["done", "completed", null, null, null, null, null, null]);
      expect(await settlePendingEnds(hk({ now: NOW + 15 * 60_000 }))).toEqual({ checked: 0, ended: 0, failed: 0 });
    });

    it("the status poll re-checks only its own pending session, and wipes once Vonage reports the end", async () => {
      const { id, ev } = await planLive();
      const err = quiet();
      await handleEvent(hk(), ev, "call-2", "completed");
      err.mockRestore();
      expect(await settlePendingEnds(hk(), "someone-else")).toEqual({ checked: 0, ended: 0, failed: 0 });
      truth.set("call-2", { status: "unanswered" });
      expect(await settlePendingEnds(hk(), id)).toEqual({ checked: 1, ended: 1, failed: 0 });
      expect(store.rows.get(id)!.sealed_text).toBeNull();
    });

    it("the marker alone never wipes or ends the call: not while Vonage says live, not when Vonage cannot be reached, not for another call's UUID", async () => {
      const { id } = await planLive();
      store.rows.get(id)!.note = END_PENDING;
      // Vonage still live.
      expect(await settlePendingEnds(hk())).toEqual({ checked: 1, ended: 0, failed: 0 });
      // Vonage down: the check fails and the marker stays for the next run.
      const down = vi.fn(async () => new Response("", { status: 500 }));
      const err = quiet();
      expect(await settlePendingEnds({ store, cfg, fetchImpl: down as unknown as typeof fetch, now: NOW })).toEqual({ checked: 1, ended: 0, failed: 1 });
      // Vonage reports an end, but for a call to another number: refused, nothing wiped.
      truth.set("call-2", { status: "completed", to: "14045550000" });
      const other = await settlePendingEnds(hk());
      err.mockRestore();
      expect(other).toEqual({ checked: 1, ended: 0, failed: 0 });
      truth.set("call-2", { status: "answered" });
      // The sweep's own retention rules leave a live, marked call alone until its longest possible length.
      await store.sweep(NOW + 6 * 60_000);
      const row = store.rows.get(id)!;
      expect([row.phase, row.note, row.plan_status]).toEqual(["calling", END_PENDING, "answered"]);
      expect([row.sealed_phone, row.sealed_text, row.sealed_token]).not.toContain(null);
      expect(store.rows.get(id)!.sealed_audio).not.toBeNull();
    });

    it("does not mark a code call, nor a callback whose UUID is not the session's call", async () => {
      const { id, ev } = await planLive();
      const err = quiet();
      truth.set("call-9", { status: "answered" });
      expect(await handleEvent(hk(), ev, "call-9", "completed")).toBe("ignored");
      expect(store.rows.get(id)!.note).toBeNull();
      // A code call's stale end is still retried (503) but not marked: its code expiry already bounds it.
      const code = await startCall(deps({ now: NOW }), input({ phone: "(404) 555-2399", text: "Other plan.", token: issueSpeakToken("English", "Other plan.", SPEAK, NOW) }));
      if (code.state !== "calling") throw new Error(code.state);
      truth.set("call-3", { status: "answered", to: "14045552399" });
      expect(await handleEvent(hk(), { k: code.id, p: "event", c: "code", exp: NOW + 60_000 }, "call-3", "completed")).toBe("error");
      err.mockRestore();
      expect(store.rows.get(code.id)!.note).toBeNull();
    });

    it("a live status read before a concurrent end can never move the finished session back", async () => {
      const { id, ev } = await planLive();
      truth.set("call-2", { status: "completed" });
      expect(await handleEvent(hk(), ev, "call-2")).toBe("ok");
      // A check that read "answered" before the end landed now writes: only while the call is live.
      expect(await store.update(id, { plan_status: "answered" }, ["calling"])).toBe("phase_changed");
      expect(store.rows.get(id)!.plan_status).toBe("completed");
    });
  });

  it("ends a session whose code call nobody answered, freeing the number for a new code", async () => {
    const id = await started();
    truth.set("call-1", { status: "unanswered" });
    await handleEvent(hk(), { k: id, p: "event", c: "code", exp: NOW + 60_000 }, "call-1");
    expect(store.rows.get(id)!.phase).toBe("code_missed");
    expect((await startCall(deps({ now: NOW + CODE_CALL_GAP_MS + 1 }), input())).state).toBe("calling");
  });

  describe("callbacks are checked against Vonage, never trusted", () => {
    const plan = async () => {
      const id = await started();
      await verifyAndCall(deps(), { id, code: "4821" });
      return { id, ev: { k: id, p: "event" as const, c: "plan" as const, exp: NOW + 60_000 }, inp: { k: id, p: "input" as const, n: 0, exp: NOW + 60_000 } };
    };

    it("stores the call UUIDs Vonage returned", async () => {
      const { id } = await plan();
      expect([store.rows.get(id)!.code_uuid, store.rows.get(id)!.plan_uuid]).toEqual(["call-1", "call-2"]);
    });

    it("a replayed 'completed' event does not end a call Vonage says is still answered", async () => {
      const { id, ev } = await plan();
      truth.set("call-2", { status: "answered" });
      // The route never passes the body's status on: whatever the forged body says, Vonage's answer is used.
      expect(await handleEvent(hk(), ev, "call-2")).toBe("ok");
      const row = store.rows.get(id)!;
      expect([row.phase, row.plan_status]).toEqual(["calling", "answered"]);
      expect(row.sealed_text).not.toBeNull();
    });

    it("ignores an event naming another call, and does not bind it", async () => {
      const { id, ev } = await plan();
      truth.set("call-x", { status: "completed" });
      expect(await handleEvent(hk(), ev, "call-x")).toBe("ignored");
      expect(store.rows.get(id)!.phase).toBe("calling");
      expect(await handleEvent(hk(), ev, undefined)).toBe("ignored");
    });

    it("binds a UUID it did not store yet only when Vonage confirms the call went to this session's number", async () => {
      const { id, ev } = await plan();
      store.rows.get(id)!.plan_uuid = null; // e.g. the event beat our own write
      truth.set("call-y", { status: "completed", to: "14045559999" });
      expect(await handleEvent(hk(), ev, "call-y")).toBe("ignored");
      expect(store.rows.get(id)!.plan_uuid).toBeNull();
      truth.set("call-2", { status: "answered" });
      expect(await handleEvent(hk(), ev, "call-2")).toBe("ok");
      expect(store.rows.get(id)!.plan_uuid).toBe("call-2");
    });

    it("answers 'error' (so the route says 503 and Vonage retries) when Vonage cannot be asked", async () => {
      const { id, ev } = await plan();
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      fetchImpl = vi.fn(async () => new Response("down", { status: 500 }));
      expect(await handleEvent(hk(), ev, "call-2")).toBe("error");
      expect(store.rows.get(id)!.phase).toBe("calling");
      spy.mockRestore();
    });

    it("answers 'error' (503, Vonage retries) when a code-call event cannot be saved, instead of acknowledging it", async () => {
      const id = await started();
      truth.set("call-1", { status: "unanswered" });
      store.failUpdates = true;
      vi.spyOn(console, "error").mockImplementation(() => {});
      expect(await handleEvent(hk(), { k: id, p: "event", c: "code", exp: NOW + 60_000 }, "call-1")).toBe("error");
      truth.set("call-1", { status: "ringing" });
      expect(await handleEvent(hk(), { k: id, p: "event", c: "code", exp: NOW + 60_000 }, "call-1")).toBe("error");
      store.failUpdates = false;
      truth.set("call-1", { status: "unanswered" });
      expect(await handleEvent(hk(), { k: id, p: "event", c: "code", exp: NOW + 60_000 }, "call-1")).toBe("ok");
      expect(store.rows.get(id)!.phase).toBe("code_missed");
    });

    it("acknowledges an event for a session that has moved on (phase changed), without an error", async () => {
      const id = await started();
      await verifyAndCall(deps(), { id, code: "4821" }); // now 'calling'
      truth.set("call-1", { status: "completed" });
      expect(await handleEvent(hk(), { k: id, p: "event", c: "code", exp: NOW + 60_000 }, "call-1")).toBe("ok");
    });

    it("never returns the plan text on keypad input for a call Vonage says has ended, or cannot confirm", async () => {
      const { inp } = await plan();
      truth.set("call-2", { status: "completed" });
      const ended = await handleInput(hk(), inp, "1", "call-2");
      expect(ended.map((a) => a.action)).toEqual(["talk"]);
      expect(JSON.stringify(ended)).not.toContain("blue pill");
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      fetchImpl = vi.fn(async () => new Response("down", { status: 503 }));
      expect((await handleInput(hk(), inp, "1", "call-2")).map((a) => a.action)).toEqual(["talk"]);
      truth.set("call-2", { status: "answered" });
      fetchImpl = vonageOk();
      expect((await handleInput(hk(), inp, "1", "call-x")).map((a) => a.action)).toEqual(["talk"]);
      spy.mockRestore();
    });
  });

  describe("an unconfirmed call is kept and reconciled, never wiped or retried while it may ring", () => {
    beforeEach(() => { vi.spyOn(console, "error").mockImplementation(() => {}); });

    it("keeps an unconfirmed code call's session, blocks a second code call, and lets its event settle it", async () => {
      fetchImpl = vonageFlaky(1);
      const r = await startCall(deps(), input());
      expect(r).toMatchObject({ state: "calling", uncertain: true });
      const id = (r as { id: string }).id;
      expect(store.rows.get(id)!.code_status).toBe("unknown");
      expect((await startCall(deps({ now: NOW + 60_000 }), input())).state).toBe("in-flight");
      truth.set("call-lost", { status: "answered" });
      expect(await handleEvent(hk(), { k: id, p: "event", c: "code", exp: NOW + 60_000 }, "call-lost")).toBe("ok");
      expect([store.rows.get(id)!.code_status, store.rows.get(id)!.code_uuid]).toEqual(["answered", "call-lost"]);
      expect((await verifyAndCall(deps(), { id, code: "4821" })).state).toBe("calling");
    });

    it("keeps an unconfirmed plan call's text, blocks new calls to the number, and wipes it if nothing confirms it", async () => {
      fetchImpl = vonageFlaky(2);
      const id = await started();
      const v = await verifyAndCall(deps(), { id, code: "4821" });
      expect(v).toMatchObject({ state: "calling", uncertain: true });
      let row = store.rows.get(id)!;
      expect([row.phase, row.plan_status]).toEqual(["calling", "unknown"]);
      expect(row.sealed_text).not.toBeNull();
      // no second call to this number while that one may be ringing (the live session refuses before any cap is looked at)
      expect((await startCall(deps({ now: NOW + 4 * 60_000 }), input())).state).toBe("in-flight");
      await store.sweep(NOW + UNCONFIRMED_PLAN_MS + 1000);
      row = store.rows.get(id)!;
      expect([row.phase, row.sealed_phone, row.sealed_text, row.sealed_audio]).toEqual(["failed", null, null, null]);
    });

    it("an event Vonage confirms turns an unconfirmed plan call into a live one, which the sweep then leaves alone", async () => {
      fetchImpl = vonageFlaky(2);
      const id = await started();
      await verifyAndCall(deps(), { id, code: "4821" });
      truth.set("call-lost", { status: "answered" });
      expect(await handleEvent(hk(), { k: id, p: "event", c: "plan", exp: NOW + 60_000 }, "call-lost")).toBe("ok");
      await store.sweep(NOW + UNCONFIRMED_PLAN_MS + 1000);
      const row = store.rows.get(id)!;
      expect([row.phase, row.plan_status, row.plan_uuid]).toEqual(["calling", "answered", "call-lost"]);
      expect(row.sealed_text).not.toBeNull();
    });
  });

  it("refuses a stale session's data at read time even before any sweep runs", async () => {
    const id = await started();
    const late = await store.get(id, NOW + 10 * 60_000 + 1); // code untyped past 10 minutes, not swept
    expect([late?.sealed_phone, late?.sealed_text, late?.sealed_token, late?.code_hash]).toEqual([null, null, null, null]);
    expect((await store.get(id, NOW))?.sealed_text).not.toBeNull();
  });

  it("refuses a plan call's audio and text past its longest possible length, before any sweep", async () => {
    const id = await started();
    await verifyAndCall(deps(), { id, code: "4821" });
    const at = NOW + 18 * 60_000;
    expect(await audioFor({ store, cfg, now: at }, { k: id, p: "audio", exp: at + 60_000 })).toBeNull();
    truth.set("call-2", { status: "answered" });
    expect((await handleInput(hk({ now: at }), { k: id, p: "input", n: 0, exp: at + 60_000 }, "1", "call-2")).map((a) => a.action)).toEqual(["talk"]);
  });

  describe("never claims the number and plan were deleted unless that write was confirmed", () => {
    beforeEach(() => { vi.spyOn(console, "error").mockImplementation(() => {}); });
    const wipeFails = () => { store.failWhen = (p) => p.phase === "failed"; };

    it.each([
      ["token", async () => { const row = [...store.rows.values()][0]; row.sealed_text = seal(SECRET, "text", row.id, row.expires_at.getTime(), "Other."); }],
      ["capped-plan", async () => { store.counters.set(`plan:${phoneHash(SECRET, "+14045552368")}:2026-10-02`, 3); }],
      ["capped-site", async () => { store.counters.set("site:2026-10-02", 40); }],
      ["failed", async () => { fetchImpl = vi.fn(async () => new Response("no", { status: 400 })); }],
      ["failed", async () => { const row = [...store.rows.values()][0]; row.sealed_phone = Buffer.from([1, 2, 3]); }],
    ] as const)("%s with a failed wipe reports cleanup pending, and confirmed when the wipe lands", async (state, breakIt) => {
      const id = await started();
      await breakIt();
      wipeFails();
      expect(await verifyAndCall(deps(), { id, code: "4821" })).toEqual({ state, cleanup: "pending" });
    });

    it("tells the person about deletion only as far as it was confirmed", () => {
      expect(verifyRefusal({ state: "failed", cleanup: "done" })[1]).toContain("Your number and plan were deleted.");
      const pending = verifyRefusal({ state: "failed", cleanup: "pending" })[1];
      expect(pending).not.toContain("were deleted.");
      expect(pending).toContain("couldn't confirm");
      // no deletion deadline the code cannot keep through an outage; only the read limit ATLAS enforces itself
      expect(pending).not.toMatch(/within \d+ minutes/);
      expect(pending).toContain("ATLAS refuses to open them after 30 minutes");
      expect(verifyRefusal({ state: "capped-plan", cleanup: "pending" })[0]).toBe(429);
      expect(verifyRefusal({ state: "expired" })[1]).not.toContain("deleted");
    });

    it("reports cleanup confirmed when the wipe is written", async () => {
      const id = await started();
      fetchImpl = vi.fn(async () => new Response("no", { status: 400 }));
      expect(await verifyAndCall(deps(), { id, code: "4821" })).toEqual({ state: "failed", cleanup: "done" });
      expect(store.rows.get(id)!.sealed_text).toBeNull();
    });

    it("a failed audio write with a failed wipe reports cleanup pending", async () => {
      const id = await started();
      store.failWhen = (p) => p.sealed_audio !== undefined || p.phase === "failed";
      expect(await verifyAndCall(deps(), { id, code: "4821" })).toEqual({ state: "failed", cleanup: "pending" });
    });

    it("a session left preparing (wipe never landed) is unreadable after 5 minutes and swept", async () => {
      const id = await started();
      fetchImpl = vi.fn(async () => new Response("no", { status: 400 }));
      wipeFails();
      await verifyAndCall(deps(), { id, code: "4821" });
      expect(store.rows.get(id)!.phase).toBe("calling"); // the wipe did not land
      store.failWhen = undefined;
      const later = NOW + PREPARING_MAX_MS + 1000;
      expect((await store.get(id, later))?.sealed_text).toBeNull();
      await store.sweep(later);
      const row = store.rows.get(id)!;
      expect([row.phase, row.sealed_phone, row.sealed_text]).toEqual(["failed", null, null]);
    });
  });

  describe("a database outage is an error, never 'not found'", () => {
    it("verify, events, keypad input and audio throw CallStoreDown (the routes answer 503) instead of acting as if the session were gone", async () => {
      const id = await started();
      await verifyAndCall(deps(), { id, code: "4821" });
      truth.set("call-2", { status: "completed" });
      store.failReads = true;
      await expect(verifyAndCall(deps(), { id, code: "4821" })).rejects.toBeInstanceOf(CallStoreDown);
      await expect(handleEvent(hk(), { k: id, p: "event", c: "plan", exp: NOW + 60_000 }, "call-2")).rejects.toBeInstanceOf(CallStoreDown);
      await expect(handleInput(hk(), { k: id, p: "input", g: 0, exp: NOW + 60_000 }, "4821", "call-2")).rejects.toBeInstanceOf(CallStoreDown);
      await expect(audioFor({ store, cfg, now: NOW }, { k: id, p: "audio", exp: NOW + 60_000 })).rejects.toBeInstanceOf(CallStoreDown);
      await expect(store.get(id, NOW)).rejects.toBeInstanceOf(CallStoreDown);
      store.failReads = false;
      expect(await store.get("no-such-session", NOW)).toBeNull(); // absent is still null
    });

    it("when the counters and then the delete both fail, start says the number and plan were kept, never 'nothing was saved'", async () => {
      // the token binding works; the counters taken after the session is saved fail, and so does deleting it
      const real = store.takeSlot.bind(store);
      store.takeSlot = async (...a: Parameters<typeof store.takeSlot>) => { if (a[0].startsWith("gap:")) throw new CallStoreDown(); return real(...a); };
      store.failDrops = true;
      const r = await startCall(deps(), input());
      expect(r).toEqual({ state: "no-db", kept: true });
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(store.rows.size).toBe(1); // the row really is still there
      const [status, msg] = startRefusal("no-db", true);
      expect(status).toBe(503);
      expect(msg).not.toContain("Nothing was saved");
      expect(msg).toContain("couldn't confirm they were deleted");
      expect(startRefusal("no-db")[1]).toContain("Nothing was saved"); // only when the delete was confirmed
    });

    it("logs (kind only, never the number) when a cap refusal or a Vonage refusal cannot delete its session", async () => {
      const err = vi.spyOn(console, "error").mockImplementation(() => {});
      store.failDrops = true;
      store.counters.set(`code:${phoneHash(SECRET, "+14045552368")}:2026-10-02`, 3);
      expect((await startCall(deps(), input())).state).toBe("capped-code");
      store.counters.clear();
      store.counterEnds.clear();
      store.rows.clear();
      fetchImpl = vi.fn(async () => new Response("nope", { status: 401 })) as unknown as typeof fetchImpl;
      expect((await startCall(deps(), input())).state).toBe("failed");
      const logged = err.mock.calls.map((c) => String(c[0]));
      expect(logged).toContain("call session not deleted after a cap refusal; the sweep will remove it");
      expect(logged).toContain("call session not deleted after Vonage refused the code call; the sweep will remove it");
      expect(JSON.stringify(err.mock.calls)).not.toMatch(/4045552368|2368/);
      err.mockRestore();
    });

    it("an insert error after the row was saved tries the delete, and says kept only when the delete also fails", async () => {
      store.failAfterInsert = true;
      expect(await startCall(deps(), input())).toEqual({ state: "no-db" });
      expect(store.rows.size).toBe(0); // deleted, so "nothing was saved" is true
      store.failDrops = true;
      expect(await startCall(deps(), input())).toEqual({ state: "no-db", kept: true });
      expect(store.rows.size).toBe(1);
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(startRefusal("no-db", true)[1]).not.toMatch(/can't be opened|encryption/); // no cryptographic-expiry claim
    });

    it("a counter the database cannot reach is an outage, never a cap: starting says no-db and places no call", async () => {
      store.failSlots = true;
      expect((await startCall(deps(), input())).state).toBe("no-db");
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(store.rows.size).toBe(0); // nothing kept
    });

    it("an outage while reserving the plan call is a failure that wipes the session, not a cap, and places no plan call", async () => {
      const id = await started();
      store.failSlots = true;
      expect(await verifyAndCall(deps(), { id, code: "4821" })).toEqual({ state: "failed", cleanup: "done" });
      expect(store.rows.get(id)?.sealed_text).toBeNull();
      expect(fetchImpl).toHaveBeenCalledTimes(1); // only the code call
    });

    it("an outage at the keypad step throws (the input route answers 503), never a goodbye as if the tries were used up", async () => {
      const id = await started();
      await verifyAndCall(deps(), { id, code: "4821" });
      store.failSlots = true;
      truth.set("call-2", { status: "answered" });
      await expect(handleInput(hk(), { k: id, p: "input", g: 0, exp: NOW + 60_000 }, "4821", "call-2")).rejects.toBeInstanceOf(CallStoreDown);
      store.failSlots = false;
      expect((await handleInput(hk(), { k: id, p: "input", g: 0, exp: NOW + 60_000 }, "4821", "call-2")).map((a) => a.action)).toContain("stream");
    });

    it("reserveSlots gives back what it took when a later counter hits a database error", async () => {
      let calls = 0;
      const real = store.takeSlot.bind(store);
      store.takeSlot = async (...a: Parameters<typeof store.takeSlot>) => { if (++calls === 2) throw new CallStoreDown(); return real(...a); };
      await expect(reserveSlots(store, [{ key: "a", cap: 3 }, { key: "b", cap: 3 }], NOW)).rejects.toBeInstanceOf(CallStoreDown);
      expect(store.counters.get("a")).toBe(0);
    });
  });

  it("is gone after 30 minutes", async () => {
    const id = await started();
    expect(publicStatus(await store.get(id, NOW + 31 * 60_000))).toEqual({ phase: "gone" });
  });
});
