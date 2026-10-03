# Coverage check: what on the paper did we not turn into a step?

`src/lib/coverage.ts` is the check. Step 1 of the care plan shows its result through
`src/lib/missedLines.ts` (view logic) and `src/ui/MissedLines.tsx` (the section). See "In the app" below.

## Why

The span verifier (`src/lib/verify.ts`) refuses any step whose quote is not on the paper, so it stops
**invented** steps. It cannot see **missing** ones. Recent studies of AI-written clinical summaries
report omission as the most common error, so a plan can pass the verifier and still leave out
"STOP ibuprofen". The coverage check covers that gap with plain rules: no model and no network.

## What it does

`checkCoverage(sourceText, keptItems, { languages })` returns:

- `total`: how many sentences on the paper read like instructions to the patient
- `covered`: how many of them overlap the quote of at least one kept item
- `uncovered`: the rest, in reading order, each with `start` / `end` offsets into the original text
  (the same UTF-16 offsets `findSpan` uses) and the `reason` the rule fired

Items use the `span` the verifier already found. An item that has no span is located with `findSpan`,
using the verifier's own normalization. A sentence that repeats a covered sentence word for word also
counts as covered, because `findSpan` only returns the first match.

### Splitting into sentences

- A blank line always ends a sentence. A line break ends one too, unless the line has no closing
  punctuation and the next line starts lower-case (a line wrapped by a PDF or a photo).
- Inside a line, `.`, `!` or `?` followed by a space ends a sentence. It does not when the next word is
  lower-case, or when the word before the period is a known abbreviation (`Dr.`, `e.g.`). A decimal
  such as `0.5 mg` has no space after the period, so it never splits.
- Handles `\r\n`, `\r`, `\n`, U+2028 and U+2029 line breaks.

### What counts as an instruction

Exclusions are checked first and always win:

| Excluded | Examples |
|---|---|
| Staff-only lines | "Provider note (not for patient action)", "Billing code: 99214" |
| Signatures | "Electronically signed by ...", "Attending: ...", "Sincerely" |
| Boilerplate | "Page 1 of 2", "Printed on ...", "not a substitute for medical advice", "If you have questions, call our office" |
| Phone-only lines | "Phone: 404-555-0177", "Clinic phone (404) 555-0100 \| Fax ..." |
| Visit-reason labels | "Reason for visit: Follow-up for ...", "Chief complaint: ..." (says why they came, not what to do) |
| Headers | ends with `:`, or has no closing punctuation, no digit, does not start with an action verb, and is 4 words or fewer or all capitals ("Medicines", "FOLLOW-UP APPOINTMENTS") |

Anything left counts as an instruction if one of these fires (the first one becomes `reason`):

1. `imperative`: it starts with an action verb (take, stop, start, call, schedule, return, avoid,
   do not, follow up, check, weigh, drink, bring, ...). A leading bullet, "please", or a short
   `Label:` is skipped first, so "New medicine: take 1 tablet" counts.
2. `phrase`: call 911, go to the ER, follow-up, next visit, appointment, refill, referral, due in,
   will call you, you should / must / need to, as needed.
3. `conditional`: "if you ..." or "if your ..." followed later by call, go, return, come, seek,
   contact or tell.
4. `dose_or_timing`: a number with a dose unit (mg, mL, tablets, puffs, drops, ...), or a frequency
   or time window (twice a day, every 4 hours, in 2 weeks, within 7 days, daily, at bedtime).

### Languages

Every rule lives in one lexicon per language. English is the default. Pass `languages: ["en", "es"]`
to add the Spanish starter set (tome, llame, vaya, regrese, evite, no tome, cita, seguimiento,
"si tiene ... llame", "2 veces al día", ...). The Spanish lexicon is off by default because a few of
its words are also English words. To add a language, write a new lexicon object; nothing outside
that block changes.

## What it catches

On the six sample papers in `src/data/eval/papers.json`, a plan that quotes only the clauses listed
under `expected` leaves out 9 instruction sentences, and the check names every one. Examples:
"STOP ibuprofen 200 mg tablet.", "Start tomorrow morning.", "Finish all of it even if you feel
better.", "Bring the log to your next visit." A plan that quotes each whole line leaves nothing out,
and none of the `distractors` (provider notes, billing codes, past events) count as instructions.

## What it cannot catch

- **Instructions with no signal words.** "Your sugar should stay under 180" has none of the cues, so
  it is not counted. The rules are kept narrow on purpose: a wrong "you missed this" makes people
  trust the warning less.
- **Partial coverage.** Any overlap counts as covered. If an item quotes "Take 2 tablets" but drops
  "for 10 days" from the same sentence, the sentence still counts as covered.
- **Tables and lists split over many lines.** One row of a medicine table can turn into several
  sentences, and some pieces may not look like instructions.
- **Facts written as orders**, or orders written as facts. "Labs were drawn today" is skipped, which
  is correct. "Labs will be drawn next week" is skipped too, which is a miss.
- **Generic phrases.** "If you have questions, call ..." is treated as boilerplate even when a real
  warning follows it in the same sentence.
- **Spanish and other languages** have only a starter word list. Other languages get no coverage until
  someone adds a lexicon.
- **Speed.** The check itself is a single pass and handles a 20,000-character paper in well under 50 ms
  when items arrive with spans (as `verifyItems` returns them). An item without a span costs one
  `findSpan` call over the whole paper.

## In the app

Step 1 of the care plan, after the steps and the held-back list, shows
**"Lines on your paper we didn't turn into steps"**:

- When some lines are uncovered: a button with a count badge ("3 lines"), collapsed by default.
  One tap opens the list (`aria-expanded` / `aria-controls`). Each line is shown word for word, in
  paper order, under "Read these yourself or ask your helper. They might matter."
- When every instruction-like line is in a step: "Every instruction-like line on your paper is in a
  step." with "(we check for lines that look like instructions; it can miss some)".
- The steps that count are the ones the person still sees: a step they removed no longer covers its line.
- Items are passed with the spans the server's verifier found, so the check never searches for a quote.
- The printed handoff sheet adds the same lines as "Also on your paper".

### When the section is hidden (the language rule)

The section never says "all covered" for a paper it could not check. `paperLanguages(source)` in
`missedLines.ts` decides from the **paper's** text, not from the language the plan is written in,
because every step quotes the paper word for word. The section is hidden, and the handoff sheet gets
no list, when:

- the paper is mostly non-Latin script (Korean, Chinese, Amharic, ...), or uses Vietnamese letters;
- French, Portuguese or Creole marker words are more than 20% of the recognized marker words, even on
  a paper that is partly English;
- neither English nor Spanish marker words are frequent enough to tell (at least 3, and at least 6% of
  the words);
- the check finds no instruction-like line at all (an "all covered" message would be true only vacuously).

A paper with enough of both English and Spanish gets both lexicons. Tests for every case are in
`src/lib/missedLines.test.ts`.

### Not built yet

- Highlighting the uncovered lines in the "your paper" view (`start` / `end` are ready for it).
- "Add as a step" and "Not for me" next to each line.
- Logging `covered / total` per plan as a quality number, with no patient text.
