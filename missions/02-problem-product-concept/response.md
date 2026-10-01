# Mission 2 Response: Problem & Product Concept Brief

**Status:** Draft for team decision, due Oct 1, 2026 · 11:59 pm ET
**Based on:** the merged proposal (Timothy's communication-gap idea + Akhil's between-visit tracking). See [research/ideas/2026-10-01-timothy-communication-gap.md](../../research/ideas/2026-10-01-timothy-communication-gap.md).

> Items marked **TODO** need a teammate's input. Don't fill evidence with anything we haven't actually observed or sourced.

## 1. Problem statement

When **patients leave a doctor's visit with an after-visit summary and new or changed instructions**, they try to **understand what they're supposed to do and why, and keep doing it until the next visit**, but **the summary is written in clinical language and nothing helps them track what happens between visits**, causing **missed or misunderstood instructions and appointments where they can't clearly report how things went**. We know **TODO (Anusmita): one real observation, conversation, or cited source**; we still need to check **whether patients would actually record anything between visits, and whether they can get their after-visit summary as text or a file**.

- **Evidence source(s):** TODO (Anusmita)
- **Owner:** Anusmita (research) · Timothy (product decision)

## 2. Current alternative & value proposition

| Current solution / workaround | What's wrong with it for this customer |
|-------------------------------|----------------------------------------|
| Pasting the summary into ChatGPT or a general chatbot | Explains well in the moment, but keeps no plan, no record between visits, and nothing to bring to the next appointment. The patient has to remember to ask. |
| Patient portal tools (e.g. Epic's Emmie in MyChart simplifies after-visit instructions) | Only available where the health system has it; focuses on explaining, not tracking how the patient actually did. |
| Medication reminder apps (e.g. Medisafe) | Remind and log doses; don't connect to the instructions from the visit or explain the "why." |
| Paper summary, memory, notes app | Easy to lose; the patient arrives at the next visit relying on memory. |

Sources: [research/landscape/2026-10-01-similar-solutions.md](../../research/landscape/2026-10-01-similar-solutions.md)

**Our product will** reduce misunderstood instructions and create a record of what happened between visits that the patient can bring back to their doctor.

**Value proposition:** Translate healthcare to the patient and the patient back to healthcare: understand your care plan in plain language, with every explanation linked to your own documents, and arrive at your next visit with a clear summary instead of relying on memory.

## 3. One-task product path (Mission 2 scope)

**Task:** turn an after-visit summary into a care plan the patient understands.

1. **Entry:** the patient pastes or uploads their after-visit summary.
2. **Action:** the AI pulls out each care-plan item (medications, instructions, follow-ups, warning signs), explains each one in plain language, links it to the exact line it came from, and suggests questions to ask the doctor.
3. **Meaningful result:** the patient reviews, edits, and confirms the plan, which is saved as their care plan until the next visit.
4. **Likely failure / help state:** if the document can't be read, or an item isn't clearly stated in it, the product says so instead of guessing. Medical questions get "ask your doctor or pharmacist." A visible notice says this is not medical advice.

**Later missions:** between-visit logging (doses, symptoms, questions), then an AI pre-visit summary, then a doctor view (long-term vision).

## 4. AI function

- **What AI does inside the product:** extracts care-plan items from the patient's own document and explains them in plain language, citing the source line for each. It only uses the uploaded document, never general internet knowledge, and it doesn't diagnose.
- **What the customer reviews / controls:** the patient sees every item next to its source, and can edit, remove, or confirm each one before anything is saved.
- **Non-AI baseline for comparison:** the raw after-visit summary plus a medical glossary lookup for unfamiliar terms.

## 5. First executable code slice

- **Link:** TODO (Akhil): repo https://github.com/ACT-Team-12/atlas, plus a deployed URL once live
- **Planned slice:** paste after-visit summary → AI extraction with source quotes → confirm screen, using a made-up sample summary (no real patient data)
- **Or build-state note:** blocker = ___, next code task = ___
- **Owner:** Akhil · **Backup:** Stephen

## 6. FACTS check

TODO (whole team, after the code slice runs)

- **Feed:** 
- **Assess:** 
- **Challenge:** 
- **Test:** 
- **Steward:** 

## 7. Customer question for Mission 3

> Between doctor visits, would you record how you're doing (doses, symptoms, questions) if it took under 30 seconds a day, and what would make you stop?
