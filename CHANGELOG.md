# Changelog

## 2026-10-07

- Fixed Ask my paper to use the same configured AI client as reading and planning. A live request exposed that questions still used the direct Anthropic route when OpenRouter was configured. Quote checks, refusals, emergency handling and usage limits are unchanged.
- Updated the privacy page to name the configured AI route for both papers and questions. OpenRouter retention depends on provider and account settings; ATLAS does not claim verified zero data retention for that route.
- Updated local setup instructions to accept either supported AI key.
- Independent-review follow-up: the privacy page resolves its provider at render time and names retention limits in the question section too. Tests cover a provider change without module reload and OpenRouter precedence when both keys are configured.
- Verification: regression tests first reproduced both the client-selection failure and the stale privacy text. All 45 targeted tests then passed. Local frozen-lockfile install, lint (three existing warnings), Next route generation, TypeScript, all six shared-vector checks and production build passed. The local suite passed 2,289 tests; 37 database-dependent tests were skipped without local Postgres and require CI. CI and live verification are recorded with the change's pull request.
