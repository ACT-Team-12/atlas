/**
 * Save-on-change for the open plan, fenced to the session it was rendered for.
 *
 * The page saves the open plan from a React effect. That effect captures the paper of the render that scheduled it but
 * writes into the live store, so an effect still pending when the person deletes the plan (Clear, Delete) would run
 * against a store with no open plan and save the deleted paper again as a new plan. Each session therefore has an
 * epoch: deleting, clearing, opening another plan or starting a new one bumps it, and a save whose render saw an older
 * epoch writes nothing.
 */
import { saveSession, type Session, type Store } from "./savedPlans";

export type Autosave = {
  /** False until saved plans were loaded from this device. */
  loaded: boolean;
  /** The session epoch of the render that scheduled this save. */
  epoch: number;
  /** The session epoch now. */
  currentEpoch: number;
  store: Store;
  session: Session;
  now: string;
  newId: string;
};

/** The store to write, or null when nothing should be saved. */
export function autosaveStore(a: Autosave): Store | null {
  if (!a.loaded) return null;
  if (a.epoch !== a.currentEpoch) return null; // the session this save was rendered for was deleted or replaced
  if (!a.session.care && !a.session.plan) return null;
  return saveSession(a.store, a.session, a.now, a.newId);
}
