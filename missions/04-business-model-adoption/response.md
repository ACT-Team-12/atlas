# ATLAS (Team 12): Mission 4, Business Model & Adoption Decision

DRAFT 2026-10-03 01:30 ET. Tags: **[S]** observed or sourced (source listed), **[I]** inferred (our
reasoning), **[U]** unknown (not tested yet). Prices: none. Partners: none committed. Every number is
sourced, measured by us, or labeled an estimate.

Live product: https://atlas-team12.vercel.app · Code: github.com/ACT-Team-12/atlas (private; judges get
access on request through the organizers).

## 0. One-paragraph answer
ATLAS turns a patient's after-visit paper into a plan they can follow, where every step quotes the paper
word for word. **Patients and caregivers use it free, with no account. Community health workers, patient
navigators and nurses run it with them. Organizations that already pay those helpers are who we think
would sponsor it, because it saves their helpers time on work they already do.** Nothing about pricing
or partnership has been tested; this mission sets up the first safe test and ships the one coded step that
test depends on: a link a helper makes for the person they help.

## 1. Business Model Canvas (9 fields, tagged)

| Field | ATLAS | Tag |
|---|---|---|
| Customer segments | Users: adults and caregivers holding a visit or discharge paper, first in metro Atlanta, Georgia health-center patients (91.12% at or below 200% FPL; 12.34% limited English). Operators: CHWs, patient navigators, nurses, front-desk staff. | [S] HRSA UDS GA 2025; M3 interviews (8) |
| Value proposition | Patient: "what do I do next, in my language, and what's stopping me," with every step quoted from their own paper and local help that actually exists. Helper: the explaining, barrier check, resource search and follow-up booking done in minutes, printed or sent. | [S] M3 evidence; [I] time saved not yet measured |
| Channels | Helpers hand it over (link, QR, printed sheet) inside visits and follow-up calls; direct web and app; later, a health-center network (GPCA HCCN covers 35 GA health centers). | [S] GPCA page; [U] which channel converts |
| Relationships / support | Self-serve with a human in the loop: no account, "ask your helper," printed handoff sheet, call 211 or the clinic number printed on the paper. | [S] shipped features |
| Key resources | Quote-verifier (TypeScript + Rust/WASM), verified resource data (HRSA sites, MARTA, programs with quotes from their own pages), Claude models, the team. | [S] repo |
| Key activities | Keep the verifier and evals green; refresh and re-verify resource data; observe real helpers and patients; fix what blocks them. | [S] repo CI + evals |
| Key partners | None committed. Target types: health centers (FQHCs), CHW programs and community organizations, health-center networks. | [S] none signed |
| Costs | Per use: AI $0.075 per text plan (measured); read-aloud of a 1,500-character plan about $0.06; a 3-minute call about $0.03; 1 minute of speech-to-text about $0.004 (estimates from vendor list prices). Fixed: a clinic deployment needs HIPAA business associate tiers (Vercel BAA add-on $350/month, Neon Scale about $42/month floor, Deepgram/ElevenLabs BAAs Enterprise-only, price unknown), so compliance, not usage, is the main cost. Human time to refresh resource lists: unknown. | [S] measured + vendor pricing pages 2026-10-03; [U] Enterprise BAA prices, refresh cost |
| Revenue or stewardship | Patients never pay. Hypotheses: organization sponsorship (H1), grants through a nonprofit host (H2), health-plan funding (H3, later). No price tested. | [I] all three untested |

## 2. Who uses, who pays, who runs it, and why each would join

| Role | Who | Why they would participate | Tag |
|---|---|---|---|
| Uses (gets the value) | Patient or caregiver | Understands what to do next, sees what's stopping them, finds help that exists, in their language, free | [S] M3 interviews; 2 observed testers |
| Runs it (operator) | CHW, navigator, nurse, front desk | Less time re-explaining papers and searching for resources; a sheet to hand over | [S] M3 RN + specialist staff; [U] minutes saved |
| May pay or sponsor | Health center or CHW program (H1); foundation via a nonprofit host (H2); health plan (H3) | Their helpers' time; follow-through on referrals and appointments; Medicare now pays for CHW navigation time (CHI/PIN), which needs documented barriers, action plans and resource plans | [S] CMS FAQ, NACHC 2026; [I] motive untested |

## 3. Models compared (packet: user payment, organization payment, partner support, another route)

| Model | Verdict | Why |
|---|---|---|
| User pays | Rejected | 91.12% of GA health-center patients are at or below 200% FPL [S]; charging them excludes the person we serve. |
| Organization pays or sponsors (H1, primary) | Test first | Helpers already do this work; Medicare CHI G0019 $86.17 and PIN G0023 $87.17 per patient-month (2026, NACHC) are optional upside, not a price [S]. Against: G0019 billed ~5,421 times nationally in 2024 [S]; the Community Health Center Fund expires 2026-12-31 [S]; a clinic deployment likely needs a HIPAA business associate agreement [S HHS]. |
| Partner / philanthropic support through a nonprofit host (H2) | Alternative | Free-to-user tools in this space are funded by institutions or philanthropy [S findhelp, CareMessage]; Georgia Health Foundation grants are typically $10K-$30K, 501(c)(3)s only, no seed funding [S], so it needs a host. |
| Health plan funds it (H3) | Later | A plan funded CHW software this year (Health Net gave Pear Suite $900,000 on 2026-08-25) [S]; Georgia's Medicaid plan contracts are extended to 2027-06-30 while the rebid is in protest [S]. Not this sprint. |

**Revenue sentence (hypothesis):** if H1 holds, ATLAS would earn from the organizations whose helpers use it,
never from patients. No price has been tested. Who would sign (hypothesis): a CHW program manager or a
health-center operations director.

## 4. Up to three hypotheses, prioritized, and the safe test of the first
1. **H1:** organizations that employ helpers will put ATLAS in their helpers' hands because it saves them
   time on work they already do. [U]
2. **H2:** a nonprofit host can fund free patient access with small grants; our measured AI cost ($0.075 per
   text plan) keeps the grant need small. [U]
3. **H3:** a health plan funds it as member follow-through. [U]

**Safe test of H1 (no money asked, no partner claimed):** each teammate asks the helpers they already know
(clinical staff, a nurse, caregivers' helpers): "Would you send this link to two or three people you help this
week?" That is a time commitment, not a payment. We log yes / no / not now per helper, and the app counts
plans built from helper links (no personal data). **Keep H1** if at least 2 helpers send a link that leads to at
least 1 built plan within 72 hours; otherwise lead with H2. Interest is never counted as revenue.

Why this test and this order: Steve Blank asks whether a customer, "if you gave them your product today for
free, are they prepared to install and use it" [S steveblank.com]; the Mom Test treats only a commitment of
time, reputation or money as a real signal [S secondary summaries]. Our ladder: conversations, then helper
time (this test), then introductions, then a non-binding pilot MOU with no patient data, then a cancelable
order, and only after business associate agreements are signed, a pilot that touches patient data [I, built
from HHS OCR guidance that a vendor processing a clinic's patient data is a business associate]. Any free
arrangement with a clinic gets a legal check first (HHS OIG warns free services to referral sources can raise
anti-kickback questions) [S].

## 4b. Second test: does ATLAS save a helper time? (from FACTS)
One helper we already know (the RN or a clinical staff member from Mission 3) times two runs per sample
paper: the usual way vs with ATLAS, including their own checking of the quotes, order alternated. Pass line
set before running: faster on most papers AND they would hand over what it produced. Closing question: "Who
at your organization would notice if this part of your day got shorter?" n=1 on sample papers is a signal,
not proof; we will report it that way.

## 5. The path a person takes (discover, begin, result, help, regain trust)

| Stage | Patient | Helper |
|---|---|---|
| Discover | A helper gives them a link, QR or printed sheet; or finds the site | Opens /helper, makes a link in their language and ZIP |
| Begin | Opens the link already set to their language and area; photo or paste the paper | Sends by text or shows the QR |
| Receive the result | Steps quoted from their paper, barriers, local clinics and programs with verified numbers, book-it scripts | Prints the handoff sheet, or reviews it with them |
| Get help | "Ask your helper," 211, the clinic number printed on the paper | Same plan on their screen or paper |
| Regain trust if it fails | Every step shows the exact words from the paper; held-back steps are listed; "check it against your paper"; omissions are possible and we say so | Reviews against the paper; reports it with the in-app feedback |

## 6. The in-product AI (inputs, permissions, cost, failure, human control)
- **Inputs:** photo or text of the paper, language (7), reading level, chosen barriers, ZIP or location.
- **Permissions:** camera only if the person picks a photo; no account; we do not store the paper; it is sent
  to Anthropic's API to be read [S privacy page].
- **Cost:** $0.075 per text plan, measured on 2 sample papers [S]; photo plans not measured yet [U].
- **Failure behavior:** a step not quoted from the paper is refused; a second model checks the meaning; held-
  back steps are shown; missed steps (omissions) are possible and are the leading error type in 2026 studies
  [S JAMA Netw Open 2026], so we do not claim nothing is missed.
- **Human control:** the person confirms the photo transcript, can edit every input, make it simpler, delete
  it; the helper reviews.

## 7. The coded step: "Make a link for someone you help" (PR 51)
- **Customer action:** a helper (family member, neighbor, CHW, navigator or nurse) opens /helper, picks a
  language (7), a reading level and an optional ZIP, then copies the link, shows the QR code, or taps
  "send as text" (message prewritten in all 7 languages).
- **System response:** the patient's phone opens ATLAS at "Try it" with those choices already filled in and a
  short note in their language ("Someone helping you set this up ... You can change anything"). The choices
  travel only after the # in the link, which browsers do not send to our server, and ATLAS clears them from
  the address bar once applied. The first plan built from the link is tagged "helper-link" on its existing
  anonymous record (language, barrier types, step count, timing; never the ZIP), so /api/stats and /judge
  can show plans built from helper links.
- **Recovery path:** a wrong, missing or edited value is ignored and ATLAS opens normally; every choice stays
  editable; if the QR will not scan, the link and text button are on the same screen; the printed handoff
  sheet still works without any phone.
- **Test result (2026-10-03, before merge):** 250 unit tests pass (link parser rejects injection, unknown and
  repeated values; link round-trips; text per language; stats count helper plans and exclude tests); 30 of 30
  browser checks pass at phone size (390x844) on a production build; one real plan built from a helper link
  was tagged and counted once; CI green on GitHub; three rounds of adversarial review by a second AI model
  (OpenAI Codex), every finding checked against the code, 7 of 9 fixed. Known limit we state: a plan whose
  response is lost and retried can be counted twice, and the count is reported by the browser.
- **Live link:** https://atlas-team12.vercel.app/helper (PENDING merge + deploy; replace this line with the live
  test result after deploy).

## 8. Mission 5 scope decision
- **Must work (coded, AI inside):** paper -> quote-verified plan with the meaning check -> barriers + ZIP ->
  verified local resources -> handoff (sheet, send to family, book it), entered directly or through a helper
  link, on a phone, on the deployed site.
- **Human-supported at the edges:** the helper who explains and sends the link; resource-list refresh and
  phone verification; outreach to 10+ target customers; any clinic conversation.
- **Deliberately out of scope:** payments; accounts and logins; storing papers or patient data on our servers;
  EHR integration or billing submission; sponsor-branded links until a real organization consents; medical
  advice beyond what the paper says; new features beyond the core task.

## 9. FACTS trace (real exchange, 2026-10-03 ~02:00 ET, Claude Opus 5.5 via API; full transcript saved)
- **Feed:** we pasted this canvas (sections 0-3) with our constraints: patients never pay, no invented prices
  or partners, nothing about the patient stored, AI stays quote-verified. Asked for three scenarios.
- **Assess:** it ranked helper-led sponsorship (our H1) first because its first test needs no signature.
  We kept its point that "nothing stored" is not "no PHI in transit": the paper is processed by us and the AI
  provider while a plan is made, which is why a clinic deployment needs business associate agreements.
- **Challenge:** we asked it to list every claim not in our evidence. It listed 33 of its own, e.g. "small
  grants may cover hosting and AI costs" (made up), "3-5 synthetic papers" (made up number), and an overstated claim about our own design, that a
  link fragment "can't land in server logs" (true for servers, but page scripts can read it). We used none of the 33 in this packet, and we changed our code: presets are now cleared from the address bar
  after use, and the privacy page says exactly that.
- **Test the Imagination:** asked for a route we had not considered, it proposed the family link: let an
  informal caregiver (adult child, bilingual relative, neighbor) make the link, reaching people with no formal
  helper. We adopted it: the helper page now names family caregivers.
- **Steward (what we executed):** it named our riskiest assumption: that ATLAS saves a helper time net, once
  their own checking counts. We added the smallest test for it (section 4b) and shipped the coded step
  (section 7). Rejected: its suggestion to wait on all live patient use until compliance is answered; patients
  using ATLAS themselves stay our cleanest posture [S HHS OCR app guidance].

## Sources
HRSA UDS Georgia 2025; CMS HRSN FAQ; NACHC CHI and PIN tips (March 2026); Becker's / Forbes on 2024 G0019
volume; HHS business associate and cloud guidance; Georgia Health Foundation guidelines; findhelp pricing;
CareMessage impact fund; Health Net press release 2026-08-25; Georgia Families notice 2026-04-23; Medical
Daily 2026-09-14 (Community Health Center Fund); JAMA Netw Open 2026-05-08 (MedAgentBrief); KFF 2026. Full
quotes and URLs in our evidence files.
