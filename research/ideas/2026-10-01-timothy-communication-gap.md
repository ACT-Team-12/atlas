# Idea: Close the communication gap between patient and care team

**Proposed by:** Timothy · **Date:** 2026-10-01 · **Status:** Under discussion (merged with [healthcare hub](2026-10-01-healthcare-hub.md))

## Original proposal

> I did some research and there are already a few apps doing the all-in-one AI healthcare assistant thing or mimicking the idea of it, so I think we should narrow ours. What could separate us is focusing on the communication gap and helping patients understand the "why" behind their care, keeping track of what happens between visits, then use AI to create a patient summary for their next appointment. We could also have every AI explanation show where it pulled the information from to help with the hallucination concern. Basically, translate healthcare to the patient and the patient back to healthcare. If that makes sense. It feels a little like asking ChatGPT to explain a medical term like what Akhil was mentioning. I think we can separate ourselves by letting users type a question OR upload something like an after visit summary, then have the AI explain what they don't understand in plain language, show where it pulled the information from, and suggest questions they can ask their doctor. That keeps us focused on healthcare literacy without trying to diagnose anybody, but makes it feel more like an actual product.

## Evaluation

**Akhil's concern: "we can already do this with ChatGPT."** For the explain-my-after-visit-summary part, that's right. Paste an after-visit summary into ChatGPT and ask "explain this simply, quote the lines you used, and give me questions for my doctor": it does all three today, for free. Epic's Emmie already simplifies after-visit instructions inside MyChart (see [similar solutions](../landscape/2026-10-01-similar-solutions.md)). Showing sources reduces the hallucination risk, but it's a feature, not a reason for someone to switch from ChatGPT.

**The same test applies to the medication-tracking idea.** A patient can tell ChatGPT "I missed doses Tuesday and Thursday." What ChatGPT doesn't do is capture things over time: no reminders, no one-tap logging, no record kept between visits. It only knows what the patient remembers to type.

**The defensible part is in both ideas: what happens between visits.** Together they make one loop:

1. **Healthcare → patient:** upload the after-visit summary → AI pulls out the care plan (meds, instructions, follow-ups) in plain language, each item linked to the line it came from → patient confirms or edits.
2. **Between visits:** patient logs doses, symptoms, and questions as they come up.
3. **Patient → healthcare:** before the appointment, AI writes a one-page summary (adherence, symptoms, questions), each point linked to a log entry or line of the after-visit summary → patient edits it and brings or sends it. Later, this becomes the doctor's view (long-term vision).

ChatGPT can't do step 2, so it can't do step 3 well either. Citations work better here because the AI cites the patient's own records, not the internet.

**Caveat:** Medisafe already shares adherence reports with doctors. Our pitch has to be the AI-written pre-visit summary built from the care plan plus the log, not "reports exist."

## Recommended Mission 2 scope

Step 1 of the loop is the one task. It's where the whole loop starts, and it's buildable tonight.

- **Customer:** a patient leaving a doctor visit with an after-visit summary and new or changed instructions.
- **Task:** turn the after-visit summary into a care plan they understand and can follow until the next visit.
- **Next missions:** between-visit logging, then the pre-visit summary, then the doctor view.

## Open questions

- [ ] Would patients actually log anything between visits? (Biggest assumption; Mission 3)
- [ ] Do patients get after-visit summaries they can copy or upload (portal text, PDF, paper photo)?
- [ ] Team decision on the merged direction (Timothy owns product decisions)

## Discussion

_Add comments below as `**Name (date):** comment`._

