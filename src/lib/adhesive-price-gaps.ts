/**
 * The adhesives a bid uses that have no price (owner, Oct 30: the Somerset Career Center's
 * TECH-Bond adhesive billed $0 for weeks with only a small amber line in the folded Bid total).
 * From the engine's own count of whole units per adhesive (bid-builder adhesiveWholeUnits) and
 * the prices the bid prices with (its snapshot or the live price list): an adhesive with units
 * and no price — or a price of 0, which is how an adhesive the price list never listed reads —
 * bills $0. Pure, so it is tested.
 */
export interface AdhesivePriceGap {
  name: string;
  units: number;
}

export function adhesivePriceGaps(
  units: Readonly<Record<string, number>> | null | undefined,
  prices: Readonly<Record<string, number>> | null | undefined,
): AdhesivePriceGap[] {
  return Object.entries(units ?? {})
    .filter(([name, n]) => n > 0 && !((prices?.[name] ?? 0) > 0))
    .map(([name, n]) => ({ name, units: n }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The red line's words: what bills $0 and what to do about it, in plain terms. */
export function adhesivePriceGapText(g: AdhesivePriceGap, frozen: boolean): string {
  const one = g.units === 1;
  const what = `${g.name}: ${g.units} ${one ? "unit" : "units"} on this bid ${one ? "has" : "have"} no price and ${one ? "bills" : "bill"} $0.`;
  return frozen
    ? `${what} If the price list has it, press "Update pricing & labor"; if not, add its price under Estimate Pricing › Adhesives first.`
    : `${what} Add its price under Estimate Pricing › Adhesives.`;
}
