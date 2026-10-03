// Browser check of helper links on a phone-sized screen (390x844). Usage, against `pnpm build && pnpm start`:
//   PLAYWRIGHT_MODULE=/path/to/node_modules/playwright/index.mjs node scripts/helper-e2e.mjs [baseUrl] [screenshotDir]
// Playwright is not a dependency of this app, so point PLAYWRIGHT_MODULE at any installed copy (default: "playwright").
//
// What it checks:
//   1. /helper: labelled inputs, a link with the presets in the fragment only, an on-device QR with a text alternative,
//      an sms: button carrying the Spanish message, and no sideways scrolling.
//   2. Opening the link: banner shown, language / reading level / ZIP filled in and still editable, the presets
//      cleared from the address bar (only #try is left), no request to any server carrying the ZIP, and the plan
//      request tagged x-atlas-entry: helper-link (answered by a stub here, so no AI call and no cost).
//   3. Tampered and partial links: an injection attempt fills in nothing, and a link without via=helper shows no banner.
// Every request carries x-atlas-test: 1, so nothing here can count as real use. Exits non-zero naming the failed check.
import { mkdirSync } from "node:fs";

const BASE = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");
const SHOTS = process.argv[3] ?? "helper-e2e-shots";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");

let failed = 0;
function check(ok, name, detail = "") {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failed++;
}

mkdirSync(SHOTS, { recursive: true });
const browser = await chromium.launch();
const newPhone = () => browser.newContext({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  extraHTTPHeaders: { "x-atlas-test": "1" }, reducedMotion: "reduce",
});

try {
  // 1. Make the link.
  const maker = await newPhone();
  const page = await maker.newPage();
  await page.goto(`${BASE}/helper`, { waitUntil: "networkidle" });
  check(await page.getByRole("heading", { level: 1 }).innerText().then((t) => /someone you help/i.test(t)), "helper page heading");
  await page.getByLabel("Explain things in").selectOption("Spanish");
  await page.getByLabel("Reading level").selectOption("standard");
  await page.getByLabel("Their ZIP (optional)").fill("30310");
  const link = await page.getByRole("textbox", { name: "The link", exact: true }).inputValue();
  check(link === `${BASE}/#try&via=helper&lang=es&level=standard&zip=30310`, "link has presets in the fragment only", link);
  const qr = page.getByRole("img", { name: /QR code for the link above/ });
  check(await qr.count() === 1, "QR code drawn with a text alternative");
  check(await page.locator("svg[role=img] path").getAttribute("d").then((d) => (d ?? "").length > 500), "QR has modules");
  const sms = await page.getByRole("link", { name: "Send as a text message" }).getAttribute("href");
  check(sms?.startsWith("sms:?&body=") && decodeURIComponent(sms.slice(11)).includes("español") && decodeURIComponent(sms.slice(11)).endsWith(link), "sms: button carries the Spanish message and link");
  const wide = await page.evaluate(() => document.documentElement.scrollWidth);
  check(wide <= 390, "no sideways scroll on /helper", `scrollWidth ${wide}`);
  // Clipped overflow does not scroll, so also check that nothing in the page sticks out past the screen edge.
  const outside = await page.evaluate(() => [...document.querySelectorAll("main *")]
    .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.right > window.innerWidth + 1; })
    .map((el) => el.tagName.toLowerCase()).slice(0, 5));
  check(outside.length === 0, "nothing on /helper is cut off at the screen edge", outside.join(","));
  await page.screenshot({ path: `${SHOTS}/helper-390.png`, fullPage: true });
  await maker.close();

  // 2. Open it as the person would.
  const person = await newPhone();
  const p2 = await person.newPage();
  const leaks = [];
  let planHeaders = null;
  p2.on("request", (r) => { if (r.url().includes("30310") || (r.headers().referer ?? "").includes("30310")) leaks.push(r.url()); });
  await p2.route("**/api/plan", async (route) => {
    planHeaders = route.request().headers();
    await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Stubbed by the helper-link check." }) });
  });
  await p2.goto(link, { waitUntil: "networkidle" });
  const banner = p2.getByText("Someone helping you set this up in Spanish for 30310. You can change anything.");
  await banner.waitFor({ timeout: 10_000 }).catch(() => {});
  check(await banner.isVisible(), "banner shown in English");
  check(await p2.getByText(/Alguien que le ayuda preparó esto en español para el código postal 30310/).isVisible(), "banner shown in Spanish");
  const lang = p2.locator("#try").getByLabel("Explain it in");
  check(await lang.inputValue() === "Spanish", "language preset applied");
  check(await p2.locator("#try").getByLabel("Reading level").first().inputValue() === "standard", "reading level preset applied");
  check(await p2.locator("#zip").inputValue() === "30310", "ZIP preset applied");
  check(await lang.isEnabled(), "language stays editable");
  await lang.selectOption("French");
  check(await lang.inputValue() === "French", "language can be changed");
  await lang.selectOption("Spanish");
  const href = await p2.evaluate(() => window.location.href);
  check(href === `${BASE}/#try`, "presets cleared from the address bar", href);
  check(await p2.evaluate(() => !window.history.state || !JSON.stringify(window.history.state).includes("30310")), "presets not left in history state");
  check(await p2.evaluate(() => sessionStorage.getItem("atlas-entry")) === "helper-link", "tab remembers only that it came from a helper link");
  check(await p2.evaluate(() => JSON.stringify(sessionStorage).includes("30310") || JSON.stringify(localStorage).includes("30310")) === false, "ZIP not written to browser storage before a plan exists");
  await p2.screenshot({ path: `${SHOTS}/arrival-390.png` });

  // Build a plan (stubbed answer) to see the tag on the request.
  await p2.getByRole("tab", { name: /2/ }).first().click().catch(() => {});
  await p2.getByRole("button", { name: /Getting there/ }).first().click();
  await p2.getByRole("button", { name: "Make my plan" }).click();
  await p2.waitForTimeout(1500);
  check(planHeaders?.["x-atlas-entry"] === "helper-link", "plan request tagged as helper-link", JSON.stringify(planHeaders?.["x-atlas-entry"] ?? null));
  check(leaks.length === 0, "no request URL or Referer carried the ZIP", leaks.join(", "));
  await p2.getByRole("button", { name: /Close this note/ }).click();
  check(await banner.count() === 0, "banner can be dismissed");
  await person.close();

  // 3. Tampered and partial links.
  const t = await newPhone();
  const p3 = await t.newPage();
  await p3.goto(`${BASE}/#try&via=helper&lang=javascript:alert(1)&level=<script>&zip=30310%00`, { waitUntil: "networkidle" });
  check(await p3.getByText("Someone helping you set this up. You can change anything.").isVisible(), "tampered link: plain banner, nothing filled in");
  check(await p3.locator("#try").getByLabel("Explain it in").inputValue() === "English", "tampered link: language untouched");
  check(await p3.locator("#zip").inputValue() === "", "tampered link: ZIP untouched");
  await t.close();
  const u = await newPhone();
  const p4 = await u.newPage();
  await p4.goto(`${BASE}/#try&lang=es&zip=30310`, { waitUntil: "networkidle" });
  check(await p4.getByText(/Someone helping you/).count() === 0, "link without via=helper: no banner");
  check(await p4.locator("#try").getByLabel("Explain it in").inputValue() === "English", "link without via=helper: no presets");
  check(await p4.evaluate(() => sessionStorage.getItem("atlas-entry")) === null, "link without via=helper: not tagged");
  await u.close();
} finally {
  await browser.close();
}

console.log(failed ? `${failed} check(s) failed` : "all helper-link checks passed");
process.exit(failed ? 1 : 0);
