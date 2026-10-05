/**
 * What "Rebuild from ticket" keeps on a draft invoice (owner, Oct 5, service follow-up 3: fix
 * hours and quantities on the ticket; the invoice follows; line edits are for prices only).
 *
 * The lines are built again from the ticket's time and materials (quantities, hours, new and
 * removed time / material all come from the ticket), and then:
 *   - a line added by hand on the invoice ("Add line": no `source`) is kept as it was, after the
 *     ticket's lines;
 *   - a rebuilt line whose old line had its price changed by hand (`rate_overridden`) keeps that
 *     price, its total worked out again for the new quantity.
 * Everything else takes today's rates. Pure, so it is tested without a server.
 */

export interface RebuildLine {
  sort: number;
  kind: string;
  description: string;
  qty: number;
  unit: string;
  rate: number;
  total: number;
  cost_rate: number;
  cost_total: number;
  on_date: string | null;
  source: string | null;
  taxable: boolean;
  rate_overridden?: boolean;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Did the user change this line's price on the invoice (vs the rate it was built with)? */
export function rateWasChanged(
  prev: { rate: number | string; rate_overridden?: boolean | null },
  nextRate: number,
): boolean {
  return !!prev.rate_overridden || Number(prev.rate) !== nextRate;
}

export function mergeRebuild(
  old: readonly RebuildLine[],
  fresh: readonly RebuildLine[],
): RebuildLine[] {
  const overridden = new Map<string, number>();
  for (const l of old) if (l.source && l.rate_overridden) overridden.set(l.source, Number(l.rate));
  const out: RebuildLine[] = fresh.map((l) => {
    const rate = l.source ? overridden.get(l.source) : undefined;
    return rate === undefined
      ? { ...l }
      : { ...l, rate, total: r2(Number(l.qty) * rate), rate_overridden: true };
  });
  const manual = [...old].filter((l) => !l.source).sort((a, b) => a.sort - b.sort);
  let sort = out.reduce((m, l) => Math.max(m, l.sort), -1) + 1;
  for (const l of manual) out.push({ ...l, sort: sort++ });
  return out;
}
