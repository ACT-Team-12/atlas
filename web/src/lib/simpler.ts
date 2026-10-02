import type { READING_LEVELS } from "./schema";

type Level = (typeof READING_LEVELS)[number];

export type SimplerState = {
  /** The reading level the steps on screen were read at, or null when nothing has been read. */
  readLevel: Level | null;
  hasCare: boolean;
  /** A photo's reading has not been checked yet. Nothing is re-read until it is. */
  needsPhotoCheck: boolean;
  reading: boolean;
  /** Length of the text the steps were read from. Same minimum as the read button. */
  sourceLength: number;
  /** The photo reading was edited and differs from the text the steps quote. That person should use "Use my corrected text". */
  transcriptEdited: boolean;
  /** A plan exists. A re-read would wipe it, the done checks and the removed steps. */
  hasPlan: boolean;
  /** A plan is being built from the steps on screen. */
  planning: boolean;
};

/** True when the person changed our reading of their photo, so it no longer matches the text the steps came from. */
export function isTranscriptEdited(transcript: string | null, accepted: string): boolean {
  return transcript != null && transcript !== accepted;
}

/**
 * "Too much? Make it simpler": one tap re-reads the same paper at the simple level.
 * Offered only after a read at a higher level, never before a photo is checked, never mid-read,
 * and never when the photo reading was edited: it only re-reads text the person accepted.
 * Only before a plan exists and while none is being made, so it never wipes someone's plan.
 */
export function canMakeSimpler(s: SimplerState): boolean {
  return s.hasCare && !s.needsPhotoCheck && !s.reading && s.readLevel != null && s.readLevel !== "simple" && s.sourceLength >= 20 && !s.transcriptEdited && !s.hasPlan && !s.planning;
}
