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
any drift. To change a word list: edit the web file, regenerate, then run the pattern script:

```sh
cp mobile/shared/genSafetyVectors.test.ts web/src/lib/
cd web && VECTORS_OUT=../mobile/shared/safety-vectors.json pnpm exec vitest run src/lib/genSafetyVectors.test.ts
rm src/lib/genSafetyVectors.test.ts && cd ..
python3 mobile/shared/gen-native-patterns.py
```

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
