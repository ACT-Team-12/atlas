# AI personas run through the live product (Mission 3 "test the imagination")

**SIMULATED. These are AI-generated hypothesis personas, not customer evidence.** Each one pairs a labeled sample paper written by our team with a language, reading level, barriers and a real metro Atlanta ZIP. They were run through the live site (https://atlas-team12.vercel.app, commit 002659c) on 2026-10-02 around 6:20 am ET with `web/scripts/persona-runs.mjs`. Raw output: `2026-10-02-ai-persona-runs.json`. Requests were marked as tests, so they are not counted as real use.

| Persona (AI hypothesis) | Paper | Language | ZIP | Steps grounded | Plan steps | Made-up refs | Read / plan time |
|---|---|---|---|---|---|---|---|
| Parent resettled in Clarkston, child with asthma | pediatric-asthma | Amharic | 30021 | 5/5 | 6 | 0 | 18.7 s / 29.6 s |
| Night-shift worker in Doraville, new diabetes medicine | diabetes-hypertension | Spanish | 30340 | 8/8 | 7 | 0 | 14.7 s / 16.7 s |
| Teen translating for a grandparent after heart failure | heart-failure-discharge | Vietnamese | 30084 | 8/8 | 7 | 0 | 16.2 s / 20.7 s |
| Uninsured day laborer after urgent care | uti-urgent-care | English | 30315 | 4/4 | 5 | 0 | 9.7 s / 11.2 s |
| CHW helping a client with a cardiology referral | hypertension-new-med | English (detailed) | 30310 | 7/7 | 6 | 0 | 15.9 s / 18.0 s |

## What held up
- Steps and plans came back in the requested language and script for Amharic, Vietnamese and Spanish (script check in the runner).
- Every step quoted its paper: 32 of 32 grounded. Every plan used only verified resources: 0 made-up references.
- Each plan covered the barriers the persona picked, and flagged "this needs a person too" when housing or several barriers stacked up.

## What broke (product findings)
1. **Wrong kind of clinic.**
   - The Clarkston asthma parent got "Ethne Health - Dental".
   - The grandparent after heart failure got "Recovery Consultants: Tucker".
   - We match health centers by distance only. Our HRSA extract has no services field, so a dental-only site looks like any other.
   - Fix: exclude sites whose HRSA name says Dental from medical follow-up.
   - Recovery Consultants sites: check what each one actually offers on their own site before changing anything (NOT VERIFIED yet).
   - Longer term: service lines from HRSA Find a Health Center.
2. **"I work nights" can't be answered.**
   - We hold HRSA hours per week, not opening times, so the plan can't say which clinic is open in the evening.
   - Fix: add verified opening hours per site, or tell the person to call and ask about evening hours. Never guess.
3. **A grandparent without a smartphone.** The teen needs something to hand over. Supports a printable or shareable handoff sheet in the patient's language (helper mode).
4. **Empty barrier label** on one plan step (Doraville run). Small schema fix: barrier must be one of the picked categories.
5. **Slow in Amharic (29.6 s plan).** The wait needs a clear progress state, and streaming.
6. **The CHW persona got one program for three barriers.** The verified program list is thin for referrals, scheduling and housing; it needs more verified programs (tier 13).

These findings are hypotheses about real users. The interviews today are what confirm or kill them.
