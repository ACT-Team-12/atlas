/** ATLAS mark: a folded visit paper with a check, drawn by us. */
export function Mark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <rect x="2" y="2" width="60" height="60" rx="18" fill="#0b7a75" />
      <path d="M20 14h17l9 9v27a3 3 0 0 1-3 3H20a3 3 0 0 1-3-3V17a3 3 0 0 1 3-3z" fill="#fbf8f3" />
      <path d="M37 14v9h9" fill="#bfe9dc" />
      <path d="M23.5 37.5l5.5 5.5 11-12" fill="none" stroke="#0b7a75" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
