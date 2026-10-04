"use client";

import { useId, useSyncExternalStore } from "react";

/**
 * Pip (Akhil's design): an inline SVG built from his rig (video/assets/pip-rig.svg), with his named parts as props:
 * faces (norm, happy, o, open) and accessories (chute, flag, paper). Colors come from CSS custom properties
 * (--pip-*, globals.css) so a dark theme can swap them. Decorative to assistive tech: the SVG is aria-hidden, and
 * what Pip says goes through a separate polite live region owned by the screen that shows it.
 *
 * Motion (globals.css): "arrive" hops in, "cheer" is a small bounce, "quiet" never moves. Calm mode (reduced motion,
 * or the saved "Calm mode" toggle) fades instead of hopping and turns off the idle blink.
 */

export type PipFace = "norm" | "happy" | "o" | "open";
export type PipMood = "arrive" | "cheer" | "quiet";

const C = {
  ink: "var(--pip-ink)", pin: "var(--pip-pin)", pin2: "var(--pip-pin2)", deep: "var(--pip-deep)", leaf: "var(--pip-leaf)",
  go: "var(--pip-go)", sky: "var(--pip-sky)", face: "var(--pip-face)", cheek: "var(--pip-cheek)",
};
/** Eyes and mouth stay dark on the light face in both themes, as in Akhil's rig. */
const FACE_INK = "#14283A";

export function PipArt({ face = "norm", flag = false, paper = false, chute = false }: { face?: PipFace; flag?: boolean; paper?: boolean; chute?: boolean }) {
  // One gradient per Pip: two Pips on a page must not share an id.
  const grad = `pip-peach-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
    <svg viewBox="-12 -12 88 92" aria-hidden="true" focusable="false" className="pip-svg" data-face={face}>
      <defs>
        <linearGradient id={grad} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" style={{ stopColor: C.pin }} />
          <stop offset="1" style={{ stopColor: C.pin2 }} />
        </linearGradient>
      </defs>
      {chute && (
        <g data-acc="chute">
          <path d="M2 -6 Q32 -44 62 -6 Z" style={{ fill: C.sky, stroke: C.ink }} strokeWidth="2" />
          <path d="M2 -6 L18 14 M62 -6 L46 14 M32 -6 L32 6" style={{ stroke: C.ink }} strokeWidth="1.5" />
        </g>
      )}
      {flag && (
        <g data-acc="flag">
          <path d="M56 36 L56 4" style={{ stroke: C.ink }} strokeWidth="2.5" strokeLinecap="round" />
          <path d="M56 5 L74 11 L56 17 Z" style={{ fill: C.go, stroke: C.ink }} strokeWidth="1.5" />
        </g>
      )}
      <path d="M32 78 C26 66 6 50 6 30 A26 26 0 0 1 58 30 C58 50 38 66 32 78 Z" fill={`url(#${grad})`} style={{ stroke: C.ink }} strokeWidth="2.5" strokeLinejoin="round" />
      <path d="M32 5 C25 12 24 20 26 24" style={{ stroke: C.deep }} strokeOpacity=".55" strokeWidth="2" fill="none" strokeLinecap="round" />
      <path d="M32 5 L33 -2" style={{ stroke: C.ink }} strokeWidth="2.5" strokeLinecap="round" />
      <path d="M33 -1 C38 -9 48 -9 52 -5 C46 1 38 2 33 -1 Z" style={{ fill: C.leaf, stroke: C.ink }} strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M14 22 A20 20 0 0 1 26 10" stroke="#fff" strokeOpacity=".55" strokeWidth="3" fill="none" strokeLinecap="round" />
      <circle cx="32" cy="30" r="16" style={{ fill: C.face, stroke: C.ink }} strokeWidth="2" />
      <g className="pip-eyes">
        {face === "happy"
          ? <path d="M23 28 q3 -4 6 0 M35 28 q3 -4 6 0" stroke={FACE_INK} strokeWidth="2.2" fill="none" strokeLinecap="round" />
          : <g><circle cx="26" cy="27" r="2.7" fill={FACE_INK} /><circle cx="38" cy="27" r="2.7" fill={FACE_INK} /></g>}
      </g>
      <circle cx="21" cy="33" r="2.6" style={{ fill: C.cheek }} opacity=".55" />
      <circle cx="43" cy="33" r="2.6" style={{ fill: C.cheek }} opacity=".55" />
      {face === "o"
        ? <circle cx="32" cy="36" r="2.4" fill={FACE_INK} />
        : face === "open"
          ? <path d="M27 33 q5 8 10 0 Z" fill={FACE_INK} />
          : <path d="M27 34 q5 4.5 10 0" stroke={FACE_INK} strokeWidth="2.2" fill="none" strokeLinecap="round" />}
      {paper && (
        <g data-acc="paper">
          <rect x="-8" y="34" width="20" height="25" rx="2" fill="#fff" style={{ stroke: C.ink }} strokeWidth="1.8" transform="rotate(-12 2 46)" />
          <path d="M-4 41 h11 M-4 46 h11 M-4 51 h7" style={{ stroke: C.sky }} strokeWidth="1.6" transform="rotate(-12 2 46)" />
        </g>
      )}
    </svg>
  );
}

/**
 * Pip in place, with its mood. A quiet Pip has a neutral face, no accessory, no motion and no blink. A cheering Pip
 * has the happy face and the flag. In calm mode it fades in and does not blink.
 */
export function PipMarker({ mood, calm }: { mood: PipMood; calm: boolean }) {
  const quiet = mood === "quiet";
  return (
    <span className="pip" data-pip={mood} data-calm={calm || undefined} data-blink={!calm && !quiet ? "" : undefined}>
      <span className="pip-body">
        <PipArt face={mood === "cheer" ? "happy" : "norm"} flag={mood === "cheer"} />
      </span>
    </span>
  );
}

/** The reserved spot on a card's right edge. Always takes its space, so text never moves when Pip comes or goes. */
export function PipSlot({ children, className = "" }: { children?: React.ReactNode; className?: string }) {
  return <span aria-hidden="true" data-pip-slot="" className={`pip-slot ${className}`}>{children}</span>;
}

/** What Pip says, as a small bubble under its spot. Decorative: the screen's live region reads the same words. */
export function PipBubble({ text }: { text: string }) {
  return <span aria-hidden="true" data-pip-bubble="" className="pip-bubble">{text}</span>;
}

// Calm mode: the system's reduced-motion setting, or the person's own "Calm mode" toggle, saved on this device.
export const CALM_KEY = "atlas.pipCalm";
const REDUCED = "(prefers-reduced-motion: reduce)";
const listeners = new Set<() => void>();
// When storage is blocked or full (some private windows), the toggle still holds for this page. Once a write fails,
// memory wins: storage may still read fine and would otherwise undo the click (Codex review).
let memoryCalm = false;
let writeFailed = false;

function savedCalm(): boolean {
  if (writeFailed) return memoryCalm;
  try { return window.localStorage.getItem(CALM_KEY) === "1"; } catch { return memoryCalm; }
}
function systemReduced(): boolean {
  try { return typeof window.matchMedia === "function" && window.matchMedia(REDUCED).matches; } catch { return false; }
}
function subscribe(cb: () => void) {
  listeners.add(cb);
  let mq: MediaQueryList | null = null;
  try { mq = typeof window.matchMedia === "function" ? window.matchMedia(REDUCED) : null; } catch { mq = null; }
  mq?.addEventListener?.("change", cb);
  window.addEventListener("storage", cb);
  return () => {
    listeners.delete(cb);
    mq?.removeEventListener?.("change", cb);
    window.removeEventListener("storage", cb);
  };
}
const snapshot = () => `${savedCalm() ? 1 : 0}${systemReduced() ? 1 : 0}`;

export function setCalmMode(on: boolean) {
  try { window.localStorage.setItem(CALM_KEY, on ? "1" : "0"); writeFailed = false; } catch { writeFailed = true; /* the toggle still works until reload */ }
  memoryCalm = on;
  listeners.forEach((l) => l());
}

/** { calm, saved, reduced }: calm is on when the system asks for reduced motion or the toggle is on. */
export function usePipCalm() {
  const s = useSyncExternalStore(subscribe, snapshot, () => "00");
  const saved = s[0] === "1";
  const reduced = s[1] === "1";
  return { calm: saved || reduced, saved, reduced };
}

/** The "Calm mode" switch: Pip fades between spots instead of hopping, and stops blinking. */
export function CalmToggle() {
  const { calm, saved, reduced } = usePipCalm();
  return (
    <button type="button" aria-pressed={calm} disabled={reduced} onClick={() => setCalmMode(!saved)} data-calm-toggle=""
      title={reduced ? "Your device already asks for less motion" : undefined}
      className="inline-flex items-center gap-1.5 rounded-full border-2 border-ink/60 bg-paper px-3 py-1 text-xs font-bold hover:bg-mint-soft disabled:opacity-70">
      <span aria-hidden="true" className={`inline-block h-3 w-3 rounded-full border-2 border-ink ${calm ? "bg-teal" : "bg-paper"}`} />
      Calm mode
    </button>
  );
}
