/**
 * The second check's rules, as one string: the rules version (prompt, number checker, guards) plus the checker model
 * the server actually runs. The server stamps every /api/meaning answer with it; the page knows its own deploy's from
 * the build (next.config.ts inlines the model, and a Vercel env change only takes effect on a new deploy). Saved
 * verdicts are kept and restored only when the two match, so a changed model or rule never reopens as "Checked twice".
 */
export const CHECK_RULES = "2026-10-05";
export const DEFAULT_CHECKER_MODEL = "claude-sonnet-5-5";
export const checkPolicyFor = (model: string) => `${CHECK_RULES}:${model}`;
/** This build's policy. Bump CHECK_RULES whenever the prompt, number checker or guards change. */
export const CLIENT_CHECK_POLICY = checkPolicyFor(process.env.NEXT_PUBLIC_ATLAS_CHECKER_MODEL || DEFAULT_CHECKER_MODEL);
