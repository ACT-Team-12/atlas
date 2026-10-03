/**
 * A plan action's label: an icon, one short word on phones (the plan's bottom bar, globals.css .plan-dock), and the
 * full words on wider screens. Only one of the two words is displayed at a time, so a screen reader hears one name.
 */
export function DockLabel({ icon, short, long }: { icon: string; short: string; long: string }) {
  return (
    <>
      <span aria-hidden="true" className="dock-ic">{icon}</span>
      <span className="md:hidden">{short}</span>
      <span className="max-md:hidden">{long}</span>
    </>
  );
}
