// Official clinic hours, quoted from each health center's own website.
//
//   TINYFISH_API_KEY=... ANTHROPIC_API_KEY=... node scripts/official_hours.mjs
//
// For each HRSA clinic: TinyFish Search finds pages on the health center's own domain, TinyFish Fetch
// renders them in a real browser, Claude pulls out this location's hours with a verbatim quote, and our
// code keeps the hours only if that quote is really on the fetched page (the same rule the app uses for
// after-visit papers). Output: data-raw/official-hours-<date>.json. scripts/add_hours.py merges it.
// The strict check is src/lib/hoursQuote.ts (day ranges + am/pm times on token boundaries); its test runs it
// over every clinic-site record in resources.json on every CI run, so a weak extraction cannot ship.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const data = JSON.parse(fs.readFileSync(path.join(ROOT, "src/data/resources.json"), "utf8"));
const TF = process.env.TINYFISH_API_KEY;
if (!TF || !process.env.ANTHROPIC_API_KEY) throw new Error("Set TINYFISH_API_KEY and ANTHROPIC_API_KEY");
const client = new Anthropic();
const MODEL = "claude-sonnet-5-5";

// Each health center's own domains, and its own locations/FAQ pages. A page anywhere else is never used.
const OFFICIAL = [
  [/medcura/i, ["medcura.org"], ["https://medcura.org/locations/"]],
  [/mercy care/i, ["mercyatlanta.org"], ["https://mercyatlanta.org/locations/"]],
  [/southside/i, ["southsidemedical.net", "smcmed.com"], ["https://southsidemedical.net/frequently-asked-questions/"]],
  [/ethne/i, ["ethnehealth.org"], []],
  [/recovery consultants/i, ["recoveryconsultants.org"], []],
  [/yourtown/i, ["yourtownhealth.com"], ["https://www.yourtownhealth.com/locations/"]],
  [/\bheal(ing)?\b/i, ["healatlanta.org", "healingcommunitycenter.org"], ["https://healatlanta.org/locations/healing-community-health-main-site/"]],
  [/georgia center for women/i, ["gacfw.org", "gacfw.com", "fhcga.org"], ["https://www.gacfw.org/locations"]],
  [/family health/i, ["fhcga.org"], ["https://fhcga.org/locations"]],
];
const orgFor = (c) => OFFICIAL.find(([re]) => re.test(c.name) || re.test(c.org));
const domainsFor = (c) => {
  const own = c.website ? [new URL(c.website).hostname.replace(/^www\./, "")] : [];
  return [...new Set([...own, ...(orgFor(c)?.[1] ?? [])])];
};
const onDomain = (url, domains) => { try { const h = new URL(url).hostname.replace(/^www\./, ""); return domains.some((d) => h === d || h.endsWith("." + d)); } catch { return false; } };
const norm = (s) => s.replace(/[\u2013\u2014]/g, "-").replace(/[\u2018\u2019]/g, "'").replace(/\*\*/g, "").replace(/\s+/g, " ").trim().toLowerCase();

// Free tier: 30 searches and 150 fetches a minute. Back off on 429 instead of failing the clinic.
async function tf(url, init, tries = 5) {
  for (let i = 0; ; i++) {
    const r = await fetch(url, init);
    if (r.status !== 429 || i >= tries) return r;
    await new Promise((res) => setTimeout(res, 4000 * (i + 1)));
  }
}
async function search(q) {
  const r = await tf(`https://api.search.tinyfish.ai?query=${encodeURIComponent(q)}`, { headers: { "X-API-Key": TF } });
  if (!r.ok) throw new Error(`search ${r.status}`);
  return (await r.json()).results ?? [];
}
async function fetchPages(urls) {
  const r = await tf("https://api.fetch.tinyfish.ai", { method: "POST", headers: { "X-API-Key": TF, "Content-Type": "application/json" }, body: JSON.stringify({ urls }) });
  if (!r.ok) throw new Error(`fetch ${r.status}`);
  return ((await r.json()).results ?? []).filter((p) => p.text);
}

const Extracted = z.object({
  found: z.boolean(),
  page_url: z.string(),
  quote: z.string(),
  hours: z.array(z.object({ day: z.number().int().min(0).max(6), open: z.string(), close: z.string() })),
  note: z.string(),
});
const SYSTEM = `You read a health center's own web pages and report the regular opening hours of ONE location.
- Use only the block of text about the location at the given street address. If the pages do not clearly give hours for that address, set found false.
- quote: copy the hours text for that location EXACTLY as it appears on the page, character for character (it will be checked). Keep it short: the lines with days and times.
- hours: one entry per open day. day 0 = Monday ... 6 = Sunday. open/close in 24h "HH:MM". Skip closed days. Ignore one-off exceptions (holidays, "2nd Friday opens late"), and mention them in note.
- Never guess. Never use another location's hours.`;

async function extract(c, pages) {
  const msg = await client.messages.parse({
    model: MODEL,
    max_tokens: 2000,
    system: SYSTEM,
    output_config: { effort: "low", format: zodOutputFormat(Extracted) },
    messages: [{ role: "user", content: JSON.stringify({ location: { name: c.name, address: `${c.address}, ${c.city}, GA ${c.zip}` }, pages: pages.map((p) => ({ url: p.final_url || p.url, text: p.text.slice(0, 12000) })) }) }],
  });
  return Extracted.parse(msg.parsed_output);
}

const timeDigits = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); const h12 = h % 12 || 12; return m ? `${h12}:${String(m).padStart(2, "0")}` : `${h12}`; };

async function one(c) {
  const domains = domainsFor(c);
  if (!domains.length) return { id: c.id, name: c.name, status: "no_official_domain" };
  const results = await search(`${c.name} ${c.address} ${c.city} GA hours`);
  const urls = [...new Set([...results.map((r) => r.url).filter((u) => onDomain(u, domains)).slice(0, 3), ...(orgFor(c)?.[2] ?? [])])];
  if (!urls.length) return { id: c.id, name: c.name, status: "no_page_found", domains };
  const pages = await fetchPages(urls);
  if (!pages.length) return { id: c.id, name: c.name, status: "fetch_failed", urls };
  const x = await extract(c, pages);
  if (!x.found || !x.hours.length) return { id: c.id, name: c.name, status: "no_hours_on_page", urls, note: x.note };
  const page = pages.find((p) => (p.final_url || p.url) === x.page_url) ?? pages.find((p) => norm(p.text).includes(norm(x.quote)));
  const quoteOnPage = !!page && norm(page.text).includes(norm(x.quote));
  // Every opening and closing hour must be written in the quote itself.
  const timesInQuote = x.hours.every((p) => [p.open, p.close].every((t) => norm(x.quote).includes(timeDigits(t))));
  const sane = x.hours.every((p) => /^\d\d:\d\d$/.test(p.open) && /^\d\d:\d\d$/.test(p.close) && p.close > p.open);
  return {
    id: c.id, name: c.name, status: quoteOnPage && timesInQuote && sane ? "verified" : "rejected",
    checks: { quoteOnPage, timesInQuote, sane }, url: page ? page.final_url || page.url : x.page_url, quote: x.quote, hours: x.hours, note: x.note,
  };
}

const out = [];
const queue = data.clinics.filter((c) => c.setting !== "School");
const worker = async () => { for (let c; (c = queue.shift()); ) { try { const r = await one(c); out.push(r); console.log(r.status.padEnd(18), c.name); } catch (e) { out.push({ id: c.id, name: c.name, status: "error", error: String(e).slice(0, 200) }); console.log("error".padEnd(18), c.name, String(e).slice(0, 120)); } } };
await Promise.all([worker(), worker()]);
const file = path.join(ROOT, "data-raw", `official-hours-${new Date().toISOString().slice(0, 10)}.json`);
fs.writeFileSync(file, JSON.stringify({ retrieved: new Date().toISOString().slice(0, 10), model: MODEL, method: "TinyFish Search + Fetch, Claude extraction, quote verified on the fetched page", items: out.sort((a, b) => a.name.localeCompare(b.name)) }, null, 1) + "\n");
const counts = out.reduce((a, r) => ({ ...a, [r.status]: (a[r.status] ?? 0) + 1 }), {});
console.log("wrote", path.relative(ROOT, file), counts);
