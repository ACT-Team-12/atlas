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
};

/**
 * "Too much? Make it simpler": one tap re-reads the same paper at the simple level.
 * Offered only after a read at a higher level, never before a photo is checked, never mid-read.
 */
export function canMakeSimpler(s: SimplerState): boolean {
  return s.hasCare && !s.needsPhotoCheck && !s.reading && s.readLevel != null && s.readLevel !== "simple" && s.sourceLength >= 20;
}
