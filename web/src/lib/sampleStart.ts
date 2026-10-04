/**
 * "Try it with a sample" lands on the tool with the sample paper already in the box and "Read my paper" in view.
 *
 * Why: in the first watched try (Oct 4), a medical assistant tapped "Try it with a sample" on the home page and landed on
 * an empty paper box with "Read my paper" greyed out below the fold. She was "looking for just anything to press or
 * something that changed". The sample is now filled in for her, and the button she needs next is on screen and focused.
 *
 * Two ways in: the home page button sends TRY_SAMPLE_EVENT (Next's Link changes the hash without a hashchange event),
 * and a full link to /#try-sample (e.g. from /judge) is read when the page loads.
 */
export const TRY_SAMPLE_HASH = "#try-sample";
export const TRY_SAMPLE_EVENT = "atlas:try-sample";

/**
 * Whether arriving with the sample may fill the paper box: only when the box is empty or already holds the sample, and
 * no photo is chosen. A paper the person typed, pasted or photographed is never replaced.
 */
export function mayFillSample(text: string, hasPhoto: boolean, sample: string): boolean {
  return !hasPhoto && (text.trim() === "" || text === sample);
}
