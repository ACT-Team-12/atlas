/**
 * Who a plan line came from. The steps quote the person's paper; the places to call are picked by ATLAS from public
 * records (lib/planTop.ts, lib/plan.ts), not by the doctor. A caregiver's try (Oct 4) could not tell which was which:
 * "Just make it clear what came from the doctor and what came from ATLAS." Every surface that lists those places
 * says so in these words.
 */
export const BY_ATLAS = "Suggested by ATLAS";

/** Under "Start with these 3" on screen. */
export const PLACES_NOTE =
  "ATLAS picked these places from public records, for the problems you chose in step 2. Your doctor did not send you to them. Anything your paper tells you to do is in your steps, marked \"From your paper\".";

/** The handoff sheet (first person) and the shared text (third person). */
export const HELP_HEADING_SHEET = "Who can help (picked by ATLAS, not by my doctor; checked numbers)";
export const HELP_HEADING_SHARE = "WHO CAN HELP (picked by ATLAS, not by the doctor; checked numbers)";
