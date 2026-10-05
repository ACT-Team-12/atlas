# Shared test vectors for the phone apps

## Safety rules (safety-vectors.json)

`safety-vectors.json` is the website's own answer for the safety rules the phone apps port by hand: which steps are
pinned as warning signs (`web/src/lib/warningPin.ts`) and which by-when group each step goes in, including a medicine
the paper says to stop going under "Right away" (`web/src/lib/stepsView.ts`: `whenFromText`, `listHeading`,
`stepWhen`), in all seven app languages: English and Spanish in those files, Vietnamese, Korean, Chinese,
Amharic and French in `web/src/lib/safetyWords.ts` (which can only add a pin or move a step earlier). It also carries the exact source and flags of every pattern
those rules use. `gen-native-patterns.py` copies that pattern table into `mobile/ios/ATLAS/Support/SafetyPatterns.swift`
and `mobile/android/app/src/main/java/com/stephensookra/atlas/data/SafetyPatterns.kt`, so all three apps run the same
pattern text; `SafetyVectorsTests.swift` and `SafetyVectorsTest.kt` fail if a phone's table differs from the file or
gives a different answer for any case. `check-vectors.sh` regenerates the file in web-ci on every branch and fails on
any drift. `safety-floor.json` is a ratchet: it records every pinned line and every step's group, and the generator fails if
a rule change unpins a recorded line, moves a recorded step to a later group, or drops a case. A change that only adds
caution is recorded by regenerating with `UPDATE_FLOOR=1`; anything else needs a deliberate, reviewed edit of the floor.

To change a word list: edit the web file, regenerate, then run the pattern script:

```sh
cp mobile/shared/genSafetyVectors.test.ts web/src/lib/
cd web && UPDATE_FLOOR=1 VECTORS_OUT=../mobile/shared/safety-vectors.json pnpm exec vitest run src/lib/genSafetyVectors.test.ts
rm src/lib/genSafetyVectors.test.ts && cd ..
python3 mobile/shared/gen-native-patterns.py
```

## Pip (pip-vectors.json)

`pip-vectors.json` is the website's own answer for Pip, the "you are here" marker (`web/src/lib/pip.ts`): every fixed
line he can say in the seven app languages, the kinds of step he stays quiet on, and 618 cases (the web tests' own plus
600 seeded random ones) of steps in the order shown, which are done, each step's check, the step just marked done and
whether the heading greeting is still allowed, with `pipSpot`'s answer and where the one Pip is drawn (a card, or the
heading for the greeting and "All done for now"; never both). The drawing rule is the screen's (`CareSteps.tsx`) and is
written out in the generator, not regenerated from it; the web guards it in `Pip.test.tsx`. iOS replays it in `mobile/ios/ATLASTests/PipTests.swift`
(a test resource referenced from `project.yml`) and Android in `mobile/android/app/src/test/java/com/stephensookra/atlas/PipVectorsTest.kt`.
`check-vectors.sh` regenerates it in web-ci once `pip.ts` is on the branch (PR 82). To regenerate by hand:

```sh
cp mobile/shared/genPipVectors.test.ts web/src/lib/
cd web && VECTORS_OUT=../mobile/shared/pip-vectors.json pnpm exec vitest run src/lib/genPipVectors.test.ts
rm src/lib/genPipVectors.test.ts
```

## Medicine changes (medicine-changes-vectors.json)

`medicine-changes-vectors.json` holds hand-written cases for the "Your medicine changes" card
(`web/src/lib/medicineChanges.ts`): a medicine line (and, when it matters, the paper it sits in, for its list heading),
with the row it must go in (`stop`, `change`, `start`, `keep`, or `ask` for "Ask your pharmacist"; `none` for a step that
is not a medicine), why, the medicine's name as the paper starts the line, and the old and new dose shown only when both
are written in the line. Cases cover all seven app languages, negations, conditions, a hold then restart, two medicines on
one line, and a change with one dose versus two. Unlike the files above it is not generated: the web suite replays it
(`web/src/lib/medicineChanges.vectors.test.ts`) and `check-vectors.sh` runs that test in web-ci. The phone apps should
replay the same file when they port the card. The non-English lines need a native speaker's review.

## Missed lines (missed-lines-vectors.json)

`missed-lines-vectors.json` is the website's own answer for the "Lines on your paper we didn't turn into steps"
check, so the Android and iOS apps can prove they compute the same thing from the `missed_lines` field of
`/api/extract`. Each fixture holds a `payload` (exactly what the server sends), `source_length` (the UTF-16 length
of the paper, which every offset must stay within) and `cases`: a list of kept step ids and the expected
`{show, why, languages, total, covered, lines}`, where `expected` is `missedLinesView` in
`web/src/lib/missedLines.ts` run over the kept items. The generator also asserts that the web reference client
`missedFromPayload` agrees on every case, with and without `source_length`.

Fixtures: the English, Spanish and bilingual papers, the six eval papers, the sample paper, the live 12-item
`/api/extract` response, a number covered only by two quotes together, a line printed twice, the three hidden
states, six seeded random papers (repeated lines, quotes across line ends, touching quotes, ellipsis quotes with
more than one range, quotes that stop before a number), and nineteen `malformed:` payloads that each break one
validation rule (`missedLinesPayloadValid`), which every client must hide as `invalid`. A plan with up to 7 steps
has every kept subset; a larger one has all, none and 58 seeded random subsets (18 for the random papers).

Android replays it in `mobile/android/app/src/test/java/com/stephensookra/atlas/MissedLinesTest.kt`.
iOS replays it in `mobile/ios/ATLASTests/MissedLinesTests.swift` (the file is a test resource referenced from
`mobile/ios/project.yml`, not a copy).

## Drift check (CI)

`check-vectors.sh` regenerates the file from the current web code and fails when it differs from the committed
one. web-ci runs it after the web tests, on any change to `web/`, `mobile/shared/` or the live response fixture.
It needs `missedLinesPayload` in `web/src/lib/missedLines.ts` (PR 66): on main and on pull requests into main a
branch without it fails; on other branches it only warns, so it fully runs once PR 66 and PR 67 are both on main.

## Regenerate

Needs a checkout where `web/src/lib/missedLines.ts` has `missedLinesPayload`:

```sh
cp mobile/shared/genMissedLinesVectors.test.ts web/src/lib/
cd web && VECTORS_OUT=../mobile/shared/missed-lines-vectors.json pnpm exec vitest run src/lib/genMissedLinesVectors.test.ts
rm src/lib/genMissedLinesVectors.test.ts
```
