# ATLAS plan (Missions 3 to 7 and finals)

Legend: ✅ done · 🟡 in progress · ⬜ not started · ⛔ blocked

## How we're judged (orientation, Sep 21) and what answers each one

| Criterion | What a judge needs to see | Our surface | Status |
|---|---|---|---|
| Evidence of user value | Real CHWs, navigators or patients we talked to, what they said, and a change we made because of it | Mission 3 personas from interviews; quotes (with consent) on the site and in the pitch | ⬜ (biggest gap) |
| Responsible AI | Proof it doesn't make things up, and what it refuses | Span checker + "held back to protect you"; resource ids checked against the verified list; a public test page with measured numbers | 🟡 (checks built, numbers not published yet) |
| Solution & prototype | It works on the live link, on a phone, with a real paper | https://atlas-team12.vercel.app: photo or paste, barrier check, verified plan, read aloud, print, saved on device | ✅ (keep testing) |
| Adoption & story | Who uses it, why they'd keep using it, how it spreads, how it pays for itself | CHW / nonprofit view, shareable plan, reminders, Mission 4 business model, pitch | ⬜ |

Leaderboard points also count. Mission base points: M3 150, M4 150, M5 175, M6 175, M7 200. **Submit each packet at least 2 hours before 11:59 pm ET (+100).**

## Mission plan

| Mission | Releases | Owner (backup) | What we hand in |
|---|---|---|---|
| M3 Customer Research & User Personas | Oct 2, 12:05 am | Anusmita (Timothy) · Lilian writes up | 5+ real conversations (CHWs, nonprofit staff, patients or caregivers), 2 to 3 personas built only from them, what changes in the product |
| M4 Business Model & Adoption | Oct 3 | Timothy (Lilian) | Who pays (FQHCs, nonprofits, CHW programs, Medicaid health plans), pricing hypothesis, how the first 10 users find it, adoption numbers from real testers |
| M5 Build & Ship MVP | Oct 4 | Akhil (Stephen) | Release notes, live link, test results, what changed from M3 feedback |
| M6 Brand Identity & Product Experience | Oct 5 | Lilian (Stephen) | Brand (name, logo, colors, voice), UX polish, accessibility check |
| M7 Product Demo & Pitch | Oct 6 | Stephen (Timothy) | Demo video, pitch deck, live demo script; then semifinal and final pitches |

Dates for M4 to M7 are our guess (one per day); confirm in #atl-cup-2026 each night.

## Build tiers (in order; everything here is in scope for the challenge)

| # | Item | Why (criterion) | Owner | Status |
|---|---|---|---|---|
| 1 | Paper read with span checker, 7 languages | Responsible AI, prototype | Stephen | ✅ |
| 2 | Barrier check + verified Atlanta resources (41 HRSA health centers with nearest MARTA stops, 10 programs) | Prototype, user value | Stephen | ✅ |
| 3 | Remove/undo, "what your paper does not say", saved in the browser | Prototype (packet claims) | Stephen | 🟡 PR #2 |
| 4 | Abuse guard on the AI endpoints (per-IP limit, same-site check) | Keeps the demo alive | Stephen | 🟡 PR #2 |
| 5 | Show the photo transcription so the person can check it before the plan | Responsible AI | Stephen | ⬜ |
| 6 | Public test page: grounding rate, planted fake-instruction catch rate, time vs a paper checklist, on labeled sample papers | Responsible AI (measured) | Stephen, Akhil | ⬜ |
| 7 | In-app feedback + interview mode (CHW answers 3 questions after using it) | User value evidence | Stephen, Anusmita | ⬜ |
| 8 | Reminders: text or call on the day of the lab or follow-up, reply "done" | Adoption, demo moment | Akhil, Stephen | ⬜ |
| 9 | CHW / nonprofit view: several people's plans, who is stuck on which barrier | Adoption | Akhil | ⬜ |
| 10 | Share plan: QR / link for a caregiver or the clinic, one-page brief for the next visit | Adoption, story | Stephen | ⬜ |
| 11 | Spoken plan in natural voices per language; speech input for the barrier check | Accessibility, demo moment | Stephen | ⬜ |
| 12 | Faster responses (streaming, progress), add to home screen polish | Prototype | Akhil | ⬜ |
| 13 | More areas beyond Fulton and DeKalb (Cobb, Gwinnett, Clayton) | Adoption | Akhil | ⬜ |
| 14 | /judge page: 3-minute walkthrough, sample papers, links to tests and sources | All four | Stephen | ⬜ |
| 15 | Accessibility and performance pass (axe, Lighthouse, phone testing) | Product experience | Lilian, Stephen | ⬜ |

## Rules we keep
- No invented numbers, quotes or market gaps. Every number has a source or a measurement.
- No real patient records in the app or repo until we have consent and privacy written down. Sample papers are labeled.
- The packet only claims what the live build does. Check before every submission.
- One PR per change, CI green before merge, test the live link after every deploy.
