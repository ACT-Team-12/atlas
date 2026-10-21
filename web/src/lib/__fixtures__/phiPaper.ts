// A made-up paper (no real patient) with the patient's name in the header AND inside sentences, so a quote, a span and
// a missed line can all sit next to a hidden name. Used by the PHI shield tests.
export const NAMED_PAPER = `AFTER VISIT SUMMARY
Patient: Maria Lopez   DOB: 04/12/1961   MRN: 88412907
Phone: (404) 555-0182
Midtown Family Medicine   Dr. Lee   Visit: 10/01/2026

Medication changes
Maria, take metformin 500 mg by mouth 2 times a day with meals.
CHANGE lisinopril 10 mg tablet. Take 2 tablets (20 mg total) by mouth once daily.
Ms. Lopez, stop ibuprofen 200 mg. Avoid NSAIDs due to kidney function.

Orders placed today
Hemoglobin A1c - due in 3 months
Referral to Ophthalmology. If you have not heard from them in 10 days, call 404-555-0134.

When to seek care
Maria, call the office if your blood sugar is above 300 two times in a row.
Call 911 if you have chest pain or trouble breathing.`;

/** Every identifier in NAMED_PAPER, as written. */
export const NAMED_PAPER_IDENTIFIERS = ["Maria", "Lopez", "04/12/1961", "88412907", "555-0182"];
