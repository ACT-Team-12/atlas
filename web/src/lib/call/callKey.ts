/**
 * The identity of the plan a "Call me with my plan" panel belongs to. The speak token is unique to one built plan (it
 * signs that plan's exact read-aloud text and language), so switching to another plan, even a saved one with the same
 * summary, remounts the panel with no call session, and the phone can never read the previous plan.
 */
export const callMeKey = (language: string, plan: { summary: string; speak_token?: string | null }) =>
  `${language}:${plan.speak_token ?? `no-token:${plan.summary}`}`;
