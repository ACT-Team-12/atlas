import { describe, expect, it, vi } from "vitest";
import { MAX_SHIELD_CHARS, PhiShield, PhiShieldRefused } from "./phiShield";
import { guardMeaning, guardText } from "./phiGuard";
import { ExtractError } from "./extract";
import { createShieldedFetch } from "./shieldFetch";

/**
 * Fails closed: a text the shield cannot finish is refused, never sent half shielded. The shield has no cap on how
 * many identifiers it spreads and no time budget; its only limit is the text's length, and hitting it refuses.
 */
describe("fail closed", () => {
  const tooLong = `Patient: Maria Lopez\n${"Take your pills. ".repeat(Math.ceil(MAX_SHIELD_CHARS / 17) + 1)}`;

  it("the shield refuses a text over its limit instead of shielding part of it", () => {
    expect(tooLong.length).toBeGreaterThan(MAX_SHIELD_CHARS);
    expect(() => new PhiShield().shield(tooLong)).toThrow(PhiShieldRefused);
    expect(() => new PhiShield().learn(tooLong)).toThrow(PhiShieldRefused);
  });

  it("the server refuses the request with a clear 413 and never calls the AI", async () => {
    const call = vi.fn(async () => ({}));
    const err = await guardText({ text: tooLong }, call).catch((e) => e);
    expect(err).toBeInstanceOf(ExtractError);
    expect(err.status).toBe(413);
    expect(err.message).toMatch(/too long/);
    const err2 = await guardMeaning({ items: [{ id: "a", plain_language: tooLong, when: "", source_quote: "" }] } as never, call).catch((e) => e);
    expect(err2.status).toBe(413);
    expect(call).not.toHaveBeenCalled();
  });

  it("the page never sends a request it cannot shield: it answers 413 itself", async () => {
    const base = vi.fn(async () => new Response("{}"));
    const f = createShieldedFetch(base as unknown as typeof fetch, "https://atlas.test");
    const r = await f("https://atlas.test/api/prep", { method: "POST", body: JSON.stringify({ text: tooLong }) });
    expect(r.status).toBe(413);
    expect((await r.json()).error).toMatch(/too long/);
    expect(base).not.toHaveBeenCalled();
  });

  it("with far more identifiers than any cap would allow, every one is still hidden (no partial redaction)", () => {
    const people = Array.from({ length: 1500 }, (_, i) => `Zed${i.toString(26).replace(/\d/g, (d) => "qrstuvwxyz"[Number(d)])}`);
    const s = new PhiShield();
    s.learn(people.map((p) => `Patient: ${p}`).join("\n"));
    const out = s.shield(people.map((p) => `${p}, rest.`).join(" ")).text;
    for (const p of people) expect(out).not.toContain(p);
  });
});
