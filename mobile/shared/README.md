# Shared test vectors for the phone apps

`missed-lines-vectors.json` is the website's own answer for the "Lines on your paper we didn't turn into steps"
check, so the Android and iOS apps can prove they compute the same thing from the `missed_lines` field of
`/api/extract`. Each fixture holds a `payload` (exactly what the server sends) and `cases`: a list of kept step ids
and the expected `{show, why, languages, total, covered, lines}`, where `expected` is `missedLinesView` in
`web/src/lib/missedLines.ts` run over the kept items. The generator also asserts that the web reference client
`missedFromPayload` agrees on every case.

Fixtures: the English, Spanish and bilingual papers, the six eval papers, the sample paper, the live 12-item
`/api/extract` response, a number covered only by two quotes together, a line printed twice, and the three hidden
states. A plan with up to 7 steps has every kept subset; a larger one has all, none and 58 seeded random subsets.

Android replays it in `mobile/android/app/src/test/java/com/stephensookra/atlas/MissedLinesTest.kt`.

Regenerate (needs a checkout where `web/src/lib/missedLines.ts` has `missedLinesPayload`):

```sh
cp mobile/shared/genMissedLinesVectors.test.ts web/src/lib/
cd web && VECTORS_OUT=../mobile/shared/missed-lines-vectors.json pnpm exec vitest run src/lib/genMissedLinesVectors.test.ts
rm src/lib/genMissedLinesVectors.test.ts
```
