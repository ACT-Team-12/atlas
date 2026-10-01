# Similar solutions: medication tracking, caregiving, health explainers

**Researched by:** Akhil (with Claude) · **Date:** 2026-10-01 · **For:** Mission 2 section 2 (current alternative & value proposition)

Desk research from public web pages. "Verified" means we checked the claim on the product's own page or a page that reviews it directly. Most comparison articles are written by competitors (Caring Village, YouGot, etc.), so treat their rankings as marketing.

## TL;DR for the team

1. **Medication reminders with caregiver alerts already exist and are mature.** Medisafe (10M+ users per review sites) alerts a "Medfriend" when a dose is missed. We cannot pitch "remind + alert caregiver" as new.
2. **AI exists in this space, but as general chatbots, not as analysis of the patient's own log.** Caring Village's AI assistant "Julia" answers caregiving questions and helps organize decisions. We found no app that clearly uses AI to read a patient's own dose history and write them a plain-language summary of their patterns. **This is a possible gap, not a confirmed one.** We only checked public pages, and apps change fast.
3. **Big health systems are moving into "explain my results."** Epic (the company behind MyChart) has an AI tool, Emmie, that summarizes imaging results and simplifies after-visit instructions inside MyChart. A lab-results explainer would compete directly with the patient's own hospital portal, so it's a weaker direction for us.
4. **CareZone, a well-known all-in-one caregiving app, has shut down.** The all-in-one hub idea has been tried. That's a caution for scope, though we don't know why it shut down.

## Medication tracking apps

| App | What it does | Caregiver features | AI | Price | Verified? |
|-----|--------------|--------------------|----|-------|-----------|
| **Medisafe** | Reminders, missed-dose tracking, drug interaction checker, refill reminders, adherence reports for doctors | **Medfriend**: a family member gets an alert if a dose isn't marked (about 1 hr after) | None mentioned | Free; Premium ~$4.99/mo; some caregiver features behind paywall | Yes (multiple reviews) |
| **MyTherapy** | Medication + symptom tracking | Limited caregiver mode, no live alerts | None mentioned | Free | Review sites |
| **EveryDose** | Medication tracking | Multiple profiles on paid tier | None mentioned | Free; Plus $9.99/mo | Review sites |
| **Dosecast** | Reminders | Cloud sync on Pro | None mentioned | Free; Pro $2.99/mo | Review sites |
| **RoundHealth** | Simple logging + reminders | No caregiver notifications | None mentioned | Free | Review sites |
| **YouGot** | Reminders over SMS, WhatsApp, email, push; shared reminders with confirmation | Shared reminders | Markets "AI-powered reminders" (unclear what the AI does) | Free / Plus | Their own blog |
| **Apple Health / Samsung Health Medications** | Built-in phone med tracking | None | None | Free | Review sites |

## Caregiving coordination apps

| App | What it does | AI | Price | Verified? |
|-----|--------------|----|-------|-----------|
| **Caring Village** | Shared, role-based med list; tasks; calendar; documents; messaging for a family "care circle" | **Julia**: "an AI assistant available 24/7 to help answer caregiving questions, think through next steps, and organize care decisions." Says it's not a medical service. | Free; paid from $14.99/mo | Yes (their own site) |
| **CaringBridge** | Post health updates to family/friends in one place | None mentioned | Free | Review sites |
| **Lotsa Helping Hands** | Volunteer and task sign-ups for a care community | None mentioned | Free | Review sites |
| **CareZone** | Was all-in-one: journal, docs, meds, contacts | — | **Shut down** (after Walmart Wellness was retired) | Review sites |

## Health explainers (relevant if we pick lab results instead)

| Product | What it does | Verified? |
|---------|--------------|-----------|
| **Epic Emmie for Patients** (inside MyChart) | AI-generated summaries of imaging/endoscopy results; plain-language after-visit instructions; turns visit notes into follow-up reminders; scheduling by text | Yes (epic.com) |
| **ClearChart AI** | Third-party tool that connects to Epic/MyChart and translates lab results and visit notes into plain language | Their own site only |
| **ChatGPT and other general chatbots** | Patients paste results in themselves; known risk of mistakes (see NPR piece) | News coverage |

## What this means for our wedge (patient medication tracking; doctor access as long-term vision)

- **Don't claim:** "no app helps patients track medications." Medisafe and many others do, often for free.
- **Possible angle to test:** existing apps remind and log, one dose at a time. Medisafe already offers adherence reports for doctors. Ours would tell the patient *what's going on*: an AI summary of their own log ("missed evening doses 3 times this week, all after 9 pm") so they can adjust. The AI only describes the data. It doesn't give medical advice. Later, the same summary becomes the doctor's view.
- **Watch out:** because Medisafe already shares reports with doctors, the doctor-access vision alone isn't a differentiator. The AI summary and how it helps the patient have to be.
- **What we must check with real patients (Mission 3):** why do they miss doses (forgetting, side effects, cost, routine)? Would a summary of their own patterns change what they do, or would they ignore it? Do they already use a med app, and what annoys them about it?
- **If the team picks the lab-results direction instead:** Epic is building this into MyChart, so we'd need a much narrower angle (e.g., a specific patient group that doesn't use MyChart).

## Statistics: verify before using

These came up in search results. **Do not put them in a submission until someone opens the original source and confirms the exact wording:**

- "About 50% of chronic disease medications are not taken as prescribed" (often attributed to CDC). Original not checked.
- Cardiac patients with a paid caregiver were 40% less likely to be non-adherent ([PubMed 23536121](https://pubmed.ncbi.nlm.nih.gov/23536121/)). Abstract not checked.
- "Over 83% of adults 60+ take at least one prescription drug daily". Source unclear.

## Sources

- [Caring Village: 9 Best Medication Management Apps for Caregivers (2026)](https://caringvillage.com/blog/caregiver-tech/medication-management-apps/)
- [Caring Village: 11 Best Caregiver Apps for Families (2026)](https://caringvillage.com/blog/caregiver-tech/caregiver-apps-for-families/)
- [Caring Village: 13 Best Medication Reminder Apps (2026)](https://caringvillage.com/blog/caregiver-tech/medication-reminder-apps/)
- [YouGot: Best Caregiver Medication Management Apps](https://www.yougot.ai/blog/health/caregiver-reminders/caregiver-medication-management-app)
- [Be-Tended: 5 Best Medication Reminder Apps for Caregivers (2026)](https://be-tended.com/guides/medication-reminder-apps-caregivers/)
- [Bearable: Best Medication Tracker Apps of 2026](https://bearable.app/the-best-medication-tracker-apps-of-2026/)
- [Neela: 11 Best Family Caregiver Apps, Compared (2026)](https://www.neelacares.com/blog/family-caregiver-app-tools-examples-and-how-to-choose-the-right-one)
- [AlternativeTo: CareZone alternatives](https://alternativeto.net/software/carezone/)
- [Epic: Emmie for Patients](https://www.epic.com/software/emmie/)
- [ClearChart AI](https://clearchart.ai/)
- [NPR: Running your lab results by ChatGPT?](https://www.northcountrypublicradio.org/news/npr/nx-s1-5537067/running-your-lab-results-by-chatgpt-here-s-what-to-keep-in-mind)
- [AARP: How AI Could Change Family Caregiving](https://www.aarp.org/caregiving/basics/how-ai-can-help-caregivers/)
- [arXiv: Adhera, reducing informal caregiver burden through medication adherence](https://arxiv.org/pdf/2512.03878) (academic prototype, not checked in detail)
