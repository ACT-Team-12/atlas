# Idea: All-in-one healthcare hub

**Proposed by:** Akhil · **Date:** 2026-10-01 · **Status:** Under discussion

## Original proposal

Concern: what we described sounds like a ChatGPT for understanding healthcare, and AI is known to make mistakes and hallucinate.

Suggestion: make it the go-to solution for anything related to healthcare:

1. Tracking health metrics, pulled from wearable devices
2. Doctor appointments, and notes if the session is recorded
3. Medicine tracker with daily reminders and streaks for taking medicines
4. Profiles for individuals and their guardians to manage
5. AI that tells individuals and guardians how they're doing, and flags missed medication or complications, since we have all the data
6. If possible, access for the patient's doctor, so they can pull and review results using AI

## Alignment review (Mission 2)

**The hallucination concern is valid.** A general health explainer has the AI answer open-ended medical questions, which is where it makes things up. The fix is to have the AI reason over data the app already holds. That doesn't require building every feature.

**As a whole, it's too broad for Mission 2.** The mission asks for one task, one product path, and a first working piece of code. Some items also bring extra legal and privacy work: recording visits needs consent, and doctor access brings in health-privacy law (HIPAA).

### Suggested wedge: patient medication tracking (from items 3, 4, 5)

**Akhil (2026-10-01):** we're building for the **patient**. Doctor access is the long-term vision, so the doctor can see how the patient did between visits.

- **Target customer:** the patient managing their own medications. A guardian view (item 4) is optional and can come later.
- **Product path:**
  1. **Entry:** the patient adds their medications and schedule.
  2. **Action:** the patient marks doses as taken, which builds a streak.
  3. **Result:** the AI reviews the patient's dose history and writes a short, plain-language summary for them: what's going well, what's slipping, and when.
  4. **Help/failure state:** the summary only describes what's in the log. Any medical question gets "ask your doctor or pharmacist."
- **What the AI does:** spots patterns in the patient's own logged data and writes a summary. It never gives medical advice.
- **What the customer controls:** the patient reviews the summary and decides what to change (reminder times, what to raise at their next visit).
- **Simpler version to compare against (no AI):** a fixed alarm plus a raw list of missed doses.
- **Current workaround to name:** existing medication reminder apps (e.g. Medisafe), pill organizers, phone alarms. We shouldn't claim to be the only solution. See [similar solutions](../landscape/2026-10-01-similar-solutions.md).
- **Path to the vision:** the same summary the patient sees later becomes the report a doctor sees, which builds toward doctor access without needing it now.

### Parked for later missions

| Item | Why parked | Revisit when |
|------|------------|--------------|
| Wearable health metrics | Device integration work; not needed to prove the core task | Missions 4–5 |
| Appointment notes from recordings | Consent and privacy rules make this the riskiest | Only if research shows strong need |
| Doctor access (**long-term vision**) | Doctor sees how the patient did between visits. Needs health-privacy compliance (HIPAA) | After the patient product works; check whether doctors want it |
| Guardian / caregiver profiles | Secondary user; patient comes first | After the patient path works |

## Open questions

- [ ] Do patients actually struggle to stay on track with their medications, and why? (Anusmita: talk to one real patient)
- [ ] What do they use today (Medisafe, alarms, pill organizers), and what's frustrating about it?
- [x] Is the main user the caregiver or the patient? **Patient** (Akhil, 2026-10-01)
- [ ] Mission 2 focus: medication tracking vs. lab-results explainer vs. something else? (Timothy to decide with the team)

## Discussion

_Add comments below as `**Name (date):** comment`._

