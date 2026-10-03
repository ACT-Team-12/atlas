/**
 * The paper's own words behind one plan step. A plan step is the AI's suggestion (a ride, a cheaper pharmacy, a
 * reminder) and is never certified, so wherever it is shown, read or shared next to a step from the paper, that
 * step's verbatim quote goes with it (lib/paperFirst.ts). Steps that point at no care item carry no quote: they are
 * about getting help, not about what the paper says to do.
 */
export function planStepQuotes(step: { care_ids?: string[] }, items: { id: string; source_quote: string; grounded?: boolean }[]): string[] {
  const byId = new Map(items.filter((i) => i.grounded !== false).map((i) => [i.id, i.source_quote.trim()]));
  return [...new Set((step.care_ids ?? []).map((id) => byId.get(id) ?? "").filter(Boolean))];
}
