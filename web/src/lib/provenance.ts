/**
 * Who a plan line came from. The steps quote the person's paper; the places to call are suggested by ATLAS from checked
 * health center records and official program pages (lib/planTop.ts, lib/plan.ts), never read from the paper. A
 * caregiver's try (Oct 4) could not tell which was which: "Just make it clear what came from the doctor and what came
 * from ATLAS." Every surface that lists those places says so in these words. Only what the code knows is claimed: it
 * does not know whether the doctor also named one of these places, or whether every line of the paper was captured,
 * so no label says a place is "not from the paper" (Codex review, rounds 1 and 2): they say who suggested it and send
 * the person back to the paper.
 * Mirrored in the apps: mobile/ios/ATLAS/Support/ShareText.swift, Views/PlanView.swift; Android ShareText.kt, PlanScreen.kt.
 */
export const BY_ATLAS = "Suggested by ATLAS";

/** In the apps, over a step's places (the web shows BY_ATLAS beside the note below). */
export const BY_ATLAS_CHECK_PAPER = "Suggested by ATLAS from checked records. Follow your paper first.";

/** Under "Start with these 3" on screen. */
export const PLACES_NOTE =
  "ATLAS suggested these from checked health center records and official program pages, for the problems you chose in step 2. They are ATLAS's suggestions. If your paper says who to call, follow your paper, and check the paper itself for anything ATLAS may have missed.";

/** The handoff sheet (first person) and the shared text (third person). */
export const HELP_HEADING_SHEET = "Who can help (suggested by ATLAS from checked records; follow my paper first)";
export const HELP_HEADING_SHARE = "WHO CAN HELP (suggested by ATLAS from checked records; follow the paper first)";
