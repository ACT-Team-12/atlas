---
name: atlas-alignment
description: Keeps Team ATLAS's work aligned with the ACT Challenge Atlanta (ATL Cup 2026) mission requirements. Use this whenever anyone on the team starts or finishes a feature, plans what to build next, writes or reviews a mission response, prepares a submission, pastes a new mission brief, or asks "are we on track", "what's due", "does this meet the mission", or "what should I work on" in this repo, even if they don't mention missions or alignment by name.
---

# ATLAS alignment check

Team ATLAS is building one coded digital product with AI performing a meaningful function inside it. The work is judged mission by mission. Each mission adds requirements, and points only count after staff review. With five people working in parallel, it's easy to build something that's interesting but doesn't serve the current mission or the agreed product path. This skill catches that early.

## Source of truth

Read these before judging anything. They change as the challenge goes on, so don't rely on memory:

- `README.md`: mission tracker (status, due dates), team roster, owners/backups, current customer hypothesis, standing program rules.
- `missions/NN-slug/brief.md`: what the mission asks for. The **Deliverable** checklist is what gets graded.
- `missions/NN-slug/response.md`: what the team submitted or is drafting. The latest response defines the agreed problem, product path, and AI function.

- `research/`: idea log, customer evidence, and team decisions. When someone proposes an idea, add it as `research/ideas/YYYY-MM-DD-slug.md` (original text, alignment review, parked items, open questions) and add a row to the idea log in `research/README.md`. Only real conversations, observations, and cited sources go in `research/evidence/`.

The **active mission** is the earliest one in the tracker that isn't marked submitted. Check its due date against today's date and say how much time is left.

## What to do, by situation

### A new mission brief is pasted
1. Create `missions/NN-slug/brief.md` with the brief text (keep the deliverable checklist exact).
2. Create `missions/NN-slug/response.md` with one section per deliverable item, filling in what earlier responses already settled.
3. Add or update the row in the README tracker.
4. Tell the team what changed compared to the last mission: new deliverables, the due date, and anything that affects the code.

### A team response is pasted
Save it to the mission's `response.md`, set the tracker status, and update anything the README summarizes from it (owners, hypothesis, problem statement, product path).

### Before building something
Check the planned work against the latest response:
- Does it serve the **one-task product path** (entry → action → result → failure/help state)? If not, say so plainly. Scope creep is the main risk in a timed build.
- Does it move the **AI function inside the product** forward, or the parts the customer reviews or controls? AI used only to help write code doesn't count as the product's AI.
- Does the active mission need a code artifact (a link to a working slice, a release)? Put that first.

### After building something / before submitting
Go through the active mission's deliverable checklist item by item and mark each one ✅ done, ⚠️ partial, or ❌ missing, pointing to the file, commit, or section that covers it. Then check the standing rules:
- Evidence is real. Flag any market size, statistic, quote, or competitor-gap claim that has no cited source or observation behind it. The program explicitly penalizes invented evidence, and AI drafts tend to produce it.
- The build-state note is honest. If the code doesn't run, the response should name the precise blocker and the next code task rather than imply it works.
- Access status is reported, never credentials. Make sure no keys, tokens, or passwords are in the repo or the response.
- The FACTS pass (Feed, Assess, Challenge, Test, Steward) is shown where the mission asks for it.
- The final outcome must be a working **coded** MVP with AI inside. No-code tools can help with design, but the product itself must be code.

## Output format

Keep it short and easy to act on. The team reads this in Slack-sized chunks:

```
## Alignment: Mission N · <title> (due <date>, <time left>)

**Verdict:** On track / Gaps to close / Off track

| Deliverable | Status | Where / what's missing |
|---|---|---|

**Risks:** (unsupported claims, scope creep, missing code, credentials)
**Next 3 actions:** each with an owner from the README owners table
```

Assign actions using the owners table (for example, code to the build owner, evidence to the research owner) so the right person picks them up.
