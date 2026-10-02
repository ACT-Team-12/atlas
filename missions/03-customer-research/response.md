# Mission 3 response: Customer Evidence & Product Change (Team 12, ATLAS)

Status: **draft v2, 12:50 pm Oct 2.** Personas are COMPOSITE v1 (our team's reasoning + published evidence). Interview answers from today replace or confirm every line marked *to confirm*. Submit target 9:30 pm ET.

**Evidence rules for this packet.**
- Every quote has an evidence file (consented) or a public URL.
- Every number is tagged SOURCED, MEASURED, ESTIMATE or NOT VERIFIED.
- Personas are COMPOSITE (built from the evidence listed, name invented) or AI-HYPOTHESIS. No persona is presented as a real person.
- Sources: `research/evidence/2026-10-02-published-sources.md` (22 of 25 claims confirmed by 3 independent checks; key quotes re-read at the source by hand).

## 0. Where our thinking started (team first, then AI)

Before any AI was involved, the team argued it out on Oct 1:
- **Timothy:** "translate healthcare to the patient and the patient back to healthcare", with every explanation showing where it came from.
- **Akhil:** challenged it: "we can already do this with ChatGPT."
- **Anusmita:** pushed for preparing for the next visit.
- **Lilian:** pushed for literacy.

That argument produced our customer hypothesis: the person who helps a patient after a visit (a community health worker, navigator or family member) and the patient holding the paper. We then used AI to challenge that first pass (section 9).

## 1. Ideal customer persona 1: the helper (COMPOSITE v1)

**"Denise", community health worker at a safety-net clinic in DeKalb County** *(name invented; composite)*

- **Quote:** *to confirm: a real CHW quote from today's interviews goes here, with consent.*
- **Background:**
  - Works for a federally qualified health center or nonprofit.
  - Georgia has no state certification for CHWs. There's an advisory board (2017), an advocacy coalition (2018, about 70 members) and a network (2021), and the certification bill HB 291 died in 2026. [SOURCED: Georgia DPH CHW page; BillTrack50]
  - So training varies, and a tool has to guide, not assume.
- **Goals:**
  - Every patient she helps actually gets the lab, the referral and the medicine.
  - Spend her time with people, not on searching.
- **How she solves it today:**
  - Phone, 211, a remembered list of places, sometimes a referral platform.
  - Referral platforms are often barely used even when free: in Trenton, NJ, four years into a free NowPow rollout, "only 7% of trained users in 25% of trained organizations used the platform". Users mostly searched and shared listings (about 246 shares a month vs 8 e-referrals). [SOURCED: Fichtenberg et al. 2024, re-checked at source]
- **Pain points:**
  - Resources change constantly. Front-line staff name "constant fluctuation of community resources" plus cost, communication, transportation and paperwork. [SOURCED: Rodriguez et al. 2026, abstract]
  - The paper is clinical, the patient's real barriers aren't on it, and she has little time per person. *Caseload and minutes per plan: NOT VERIFIED; asked in today's clinic-worker form.*
- **Tech comfort:**
  - Phone: high. Desktop at work: medium.
  - New platforms: low tolerance (see adoption numbers above).

## 2. Ideal customer persona 2: the person holding the paper (COMPOSITE v1)

**"Ana", 46, leaving a clinic in DeKalb with a new diabetes medicine and a lab order** *(name invented; composite)*

- **Quote:** "My doctor will give some vague advice on how to fix my problems but no actual guidance so I'm left doing it on my own." [REAL: patient survey, own care, Oct 2, consented anonymous quote; `research/evidence/2026-10-02-patient-form-response-1.md`. Ana herself is a composite.]
- **Background:**
  - Spanish is her first language: 8.3% of DeKalb residents have limited English proficiency.
  - Many households have no car: 10.8% in Fulton, 8.6% in DeKalb.
  - Neighbors call MARTA "a strength for those who live close to a transit station or bus stop".
  - [SOURCED: Grady Health 2022 CHNA, ACS 2016 to 2020]
- **Goals:** do what the doctor asked without losing a day's pay, and know she got it right.
- **How she solves it today:**
  - Reads the paper, asks family, calls the clinic if she can get through.
  - Most people don't know when they've misunderstood. In an emergency department study, 78% of patients misunderstood at least one part of their instructions, and they noticed their own confusion only 20% of the time. Post-visit care was the largest gap (34%). [SOURCED: Engel et al. 2009, ED setting, English speakers; re-checked at source]
- **Pain points:**
  - She skips a referral when she feels better. In a national primary care cohort, the top reasons for not completing a referral were believing the problem had resolved (47.5%) and lack of time (37.3%). [SOURCED: Forrest et al. 2007]
  - Getting an appointment quickly, finding the office and office hours predicted a missed referral. [SOURCED: Zuckerman et al. 2012]
- **Tech comfort:** phone: high (texting, video). Portals and apps that need an account: low. *to confirm.*

## 3. Pain points, prioritized

| # | Pain point | Why it ranks here | Evidence |
|---|---|---|---|
| 1 | People misunderstand an instruction and don't know it | Safety: the person does the wrong thing confidently | Engel 2009 (78% at least one gap; noticed 20%) [SOURCED] |
| 2 | Steps that need booking never get booked | Most common loss point in referral studies; booking by staff predicts completion | Forrest 2007, Zuckerman 2012 [SOURCED] |
| 3 | Help exists but is hard to find, trust and keep current | Helpers fall back to memory and phone calls; platforms go unused | Rodriguez 2026; Fichtenberg 2024 [SOURCED] |
| 4 | Language and transportation | Concentrated in our two counties | Grady 2022 CHNA [SOURCED] |
| 5 | "I feel better" so the step is skipped | Top stated reason for skipping a referral | Forrest 2007 (47.5%) [SOURCED] |

*So far 1 real patient response (consented): confirms pain point 1 ("a lot of medical jargon", waiting for "the next time I see them") and adds understanding lab **results**, not just instructions. More answers pending; we will give the count.*

## 4. Journey, touchpoints and moments of truth

Paper handed over → read at home → (moment of truth 1: does she understand it correctly?) → figure out what's needed → (moment of truth 2: can she book the lab, and get there?) → day of the lab → (moment of truth 3: does she remember, and go?) → next visit.

| Moment | What goes wrong today | What ATLAS does |
|---|---|---|
| Reading the paper | Confusion she doesn't notice | Every step quotes the paper. "Check I understood" asks one question per step and shows the line again when she misses one. A second AI checks every explanation against its line. |
| Planning around barriers | No car, no time, doesn't know where to go | Barrier check, then a plan built only from verified clinics and programs, with MARTA stops |
| Doing it | Forgets, can't get an appointment, or feels better | **Book it now**: who to call (verified number only), a script built from the paper's own line, an add-to-calendar reminder that carries that line, and "even if you feel better, your paper still says...". Phone reminders in the iOS and Android apps. |
| Next visit | Starts from zero | Questions for the doctor, printed or saved *(pre-visit brief is next on our build list)* |

## 5. Priority need → decision for our core task → how AI helps

- **Priority need:** *"Know I understood my paper correctly, before I act on it."* This is pain point 1, the one with a safety cost.
- **Decision:** the core task stops at "a checked plan the person understands", not just "a plain-language summary". So:
  1. We built **Check I understood** (teach-back). It's one question per step in the person's language. The answer's proof must be words in the paper, inside that same step, checked by our own code.
  2. We built a **double-check**: a different AI model compares each explanation with its line, and our code checks every number. A step that may not match says "double-check this one with your clinic".
- **How AI helps:**
  - It reads the paper, writes plain language in 7 languages, writes the teach-back questions, and plans around barriers with verified resources only.
  - **Our code, not the AI, decides what is shown:** quotes must be in the paper, resources must be on the verified list, and questions must be proven inside their step.
- **Measured (local production build, labeled sample papers, our run):**
  - 38/38 instructions found; 38/38 quiz questions kept.
  - 52/52 planted meaning mistakes caught; 2/38 real explanations flagged, both read by hand.
  - 0 made-up resource references.
  - [MEASURED, `web/src/data/eval/`]

## 6. 4 to 5 AI personas ("test the imagination"), run through the live product

AI-HYPOTHESIS personas, each run through the live site with a labeled sample paper. Full write-up: `research/evidence/2026-10-02-ai-persona-runs.md`.

| Persona (AI hypothesis) | Language | What we learned |
|---|---|---|
| Parent resettled in Clarkston, child with asthma | Amharic | Worked end to end, but a dental-only clinic was suggested. **Fixed.** Plan took 29.6 s |
| Night-shift worker in Doraville | Spanish | We couldn't say which clinic is open after work. **Shipped:** opening hours (quoted from 12 clinics' own sites), "open now", and evening/weekend clinics offered when work hours are the barrier |
| Teen translating for a grandparent after heart failure | Vietnamese | Grandparent has no smartphone. **Shipped:** a large-type printable handoff sheet, a box to tick per step, the paper's line under each |
| Uninsured day laborer after urgent care | English | Cost, insurance and food all matched to verified programs |
| CHW helping a client with a cardiology referral | English | Only one verified program for referrals, scheduling and housing: the list needs to grow |

- Across all five: 32/32 steps grounded and 0 made-up references. [MEASURED, simulated, not customer evidence]
- One flag was wrong: we thought a recovery center was a mismatch, but their own site says they provide primary care. Corrected.

## 7. Market: gaps, Blue Ocean, value proposition, scalability

| What people use today | What it does | Where it falls short for our customers |
|---|---|---|
| ChatGPT and similar | Explains a pasted paper | Nothing checks it against the paper; no local verified help; nothing between visits |
| Epic's Emmie / MyChart | Simplifies instructions inside MyChart | Only for patients in that portal; paper after-visit summaries and many uninsured patients are outside it *(pricing and reach NOT VERIFIED)* |
| findhelp, Unite Us, NowPow | Resource directories and closed-loop referrals | Low use even when free (7%), and patients rate the help much lower than staff do (56% vs 93%) [SOURCED: Fichtenberg 2024; Essentia 2025] |
| Medisafe and pill apps | Medication reminders | Reminders, but no understanding check and no plan around barriers |
| Phone, 211, paper | Human help | Works, but slow, and nothing confirms the person understood |

**Blue Ocean (eliminate / reduce / raise / create):**
- **Eliminate:** accounts, enterprise onboarding, e-referral networks people don't use.
- **Reduce:** setup and training: open the link, paste or photograph the paper.
- **Raise:** proof. Every step quotes the paper, every explanation is double-checked, and every resource is verified with its source.
- **Create:** a checked understanding (teach-back) plus a plan matched to the person's own barriers, in their language, on paper or on the phone, with reminders that quote their paper.

**Value proposition:** *ATLAS turns a visit paper into steps a person understands and can finish: every step quotes the paper, the person's understanding is checked, and help comes only from verified local programs.*

**Scalability:**
- More counties: the data pipeline is per-county.
- More languages: the model already writes 7.
- Clinics and CHW programs as the first partners.

**Barriers:**
- No state CHW certification (training varies).
- Georgia Medicaid payment for CHW services: NOT VERIFIED.
- Keeping resources current: needs a verification routine.

## 8. The product change we shipped, and what people did when they tried it

**Shipped:**
1. **Check I understood (teach-back).**
2. **The double-check by a second model.**
3. **Three-tap feedback after a plan**, counted live and anonymously on /tests (real use only, our own tests excluded).
4. **Book it now** (pain point 2: booking by staff predicts completion; "I felt better" is the top reason to skip): call script, verified number, calendar reminder with the paper's line. No AI call.
5. **Clinic hours quoted from each clinic's own website** (night-shift persona). Kept only when the quoted text is on the clinic's page. It caught a public listing that showed Southside East Point open evenings and Saturdays; its own page says Monday to Friday, 8 to 5.
6. **Printable handoff sheet** for someone without a smartphone (teen-caregiver persona).
7. **Honest wait screen** while the AI reads, and a **/judge** page with a three-minute tour.
8. **Fixes from the persona runs** (no dental-only clinics; clean barrier labels).
9. **Explain my lab results** (PR #25), asked for by our first real patient: shows only the lines the report itself marks High/Low or prints out of range; our code decides, the AI only explains; every row quotes its line; nothing stored. Labeled sample report: 10/10 rows right (5 out, 5 in), English and Spanish. MEASURED.
10. **Send to family** (PR #26), from a family caregiver's observed try: one tap sends the plan by text or email from the person's own phone (steps, the line from the paper, checked numbers). Nothing reaches our server.

Items 1 to 9 live at atlas-team12.vercel.app (commit 46310f2), tested on the live site at desktop and phone sizes with 0 page errors. Item 10 is built and tested; live when PR #26 merges.

**Customer reaction (exact counts, 3 pm Oct 2):** 1 patient survey response, 2 clinical survey responses, 1 observed try by a family caregiver.
- **Patient, own care (consented):** "it's very difficult to even find the information and then to comprehend it since it's a lot of medical jargon". Would ask AI but is "unsure how accurate it'd be". Asked for "a summary option that only highlights what I need to improve or cut back on".
- **What it changes:** the accuracy worry is why every step quotes the paper and a second model double-checks it. The results summary was a gap, so we shipped "Explain my lab results" the same day.
- **Clinical:** both from patient-safety nurses not in direct care; logged, not quoted as front-line helpers.
- **Family caregiver, observed try with Timothy** (evidence file `research/evidence/2026-10-02-caregiver-try-1.md`; consent to quote PENDING, so paraphrased): manages her parents' care from another state while a relative does the appointments; said she'd use it for her family, asked if it will be a real app, wanted to keep the relative on track; liked read aloud and print; impatient with a sub-30 s wait. **Changed:** we built Send to family that afternoon.
- *Pending: Timothy's 4 pm interviews (travel nurses, in-home caregivers), more survey answers, one nurse interview, live three-tap counts on /tests.*

## 9. FACTS pass (team first, then AI challenge)

- **Feed:** our Oct 1 team reasoning, the verified published evidence, the live build.
- **Assess:** in Mission 2 we dropped a popular "patients forget 40 to 80%" figure because we couldn't find its source. For Mission 3 we used only claims we could re-read at the source, such as Engel 2009 and the Hoek et al. meta-analysis (Ann Emerg Med; studies through March 2018).
- **Challenge:**
  - Akhil's "ChatGPT can do this" pushed us to build what ChatGPT doesn't: grounding, teach-back, verified local help, a second check.
  - The AI's own persona runs challenged our clinic list (dental site) and our coverage (night hours). Checking hours against clinics' own sites then challenged a public listing (East Point).
- **Test:** measured on labeled sample papers and planted mistakes (section 5). Simulated personas are labeled as such.
- **Steward:**
  - No real patient data.
  - Usage is counted without the paper, names or location.
  - Privacy page is live.
  - The Android OCR's Google diagnostics are disclosed.

## 10. What we still need to check

- What CHWs actually use today and how long a plan takes (clinic-worker form and interviews).
- Whether patients would use a teach-back check, or find it annoying (observe today).
- Opening hours for the 18 clinics whose own sites don't list them for that address (shown as "hours not listed" or the public listing, marked "call to confirm").
- Who pays: clinics, CHW programs, health plans (Mission 4).
