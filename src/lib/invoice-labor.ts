/**
 * The invoice's travel and labor lines from a ticket's time entries (docs/service-module-design.md
 * §4; owner, Sep 30 for the named crew). Pure; invoices.server.ts loads the rows and calls it.
 *
 * - An old-style ticket (no crew rows): every time entry is one line for the technician at the
 *   rate table's tech rate plus one "Helper" line per helper_count at the helper rate — exactly
 *   what invoices were built with before the crew existed.
 * - A ticket with a crew: every time entry is one line per crew member. Labor bills at the
 *   member's effective rate (its own $, else its profile rate, else the rate table: tech for the
 *   lead, helper for the others); travel keeps the rate table. The cost side is always the rate
 *   table (tech for the lead, helper for the others).
 */
import { effectiveBillRate, sortCrew, type CrewRow } from "@/lib/service-crew";

export interface RateTable {
  [key: string]: { bill: number; cost: number };
}

export interface TimeEntryForLines {
  id: number;
  kind: string;
  hours: number | string;
  helper_count: number | null;
  technician_id: string | null;
  on_date: string;
}

export interface TimeLine {
  sort: number;
  kind: "travel" | "labor";
  description: string;
  qty: number;
  unit: string;
  rate: number;
  total: number;
  cost_rate: number;
  cost_total: number;
  on_date: string;
  source: string;
  taxable: boolean;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const ZERO = { bill: 0, cost: 0 };

export function timeLines(input: {
  times: readonly TimeEntryForLines[];
  rates: RateTable;
  /** The ticket's crew rows; empty = an old-style ticket. */
  crew: readonly CrewRow[];
  /** Display names by profile id. */
  techName: ReadonlyMap<string, string>;
  /** profiles.default_bill_rate by profile id (only those set). */
  profileRates: ReadonlyMap<string, number>;
  /** The first line's sort (default 0). */
  startSort?: number;
}): TimeLine[] {
  const { times, rates, techName } = input;
  const lines: TimeLine[] = [];
  let sort = input.startSort ?? 0;
  const crew = sortCrew(input.crew);
  const table = {
    tech: (rates["tech:labor"] ?? ZERO).bill,
    helper: (rates["helper:labor"] ?? ZERO).bill,
  };
  for (const t of times) {
    const hours = Number(t.hours);
    if (!(hours > 0)) continue;
    const kind = t.kind === "travel" ? "travel" : "labor";
    const label = kind === "travel" ? "Travel" : "Labor";
    if (crew.length === 0) {
      // Old-style ticket: unchanged from before the crew.
      const tech = rates[`tech:${kind}`] ?? ZERO;
      const helper = rates[`helper:${kind}`] ?? ZERO;
      const who = (t.technician_id && techName.get(t.technician_id)) || "Technician";
      lines.push({
        sort: sort++,
        kind,
        description: `${who} — ${label}`,
        qty: hours,
        unit: "hour",
        rate: tech.bill,
        total: r2(hours * tech.bill),
        cost_rate: tech.cost,
        cost_total: r2(hours * tech.cost),
        on_date: t.on_date,
        source: `time:${t.id}`,
        taxable: false,
      });
      for (let h = 0; h < (t.helper_count ?? 0); h++) {
        lines.push({
          sort: sort++,
          kind,
          description: `Helper — ${label}`,
          qty: hours,
          unit: "hour",
          rate: helper.bill,
          total: r2(hours * helper.bill),
          cost_rate: helper.cost,
          cost_total: r2(hours * helper.cost),
          on_date: t.on_date,
          source: `time:${t.id}:helper${h + 1}`,
          taxable: false,
        });
      }
      continue;
    }
    for (const m of crew) {
      const isLead = m.sort === 0;
      const role = isLead ? "tech" : "helper";
      const tableRate = rates[`${role}:${kind}`] ?? ZERO;
      const bill =
        kind === "labor"
          ? effectiveBillRate(m, input.profileRates.get(m.technician_id), table)
          : tableRate.bill;
      const who = techName.get(m.technician_id) || (isLead ? "Technician" : "Helper");
      lines.push({
        sort: sort++,
        kind,
        description: `${who} — ${label}`,
        qty: hours,
        unit: "hour",
        rate: bill,
        total: r2(hours * bill),
        cost_rate: tableRate.cost,
        cost_total: r2(hours * tableRate.cost),
        on_date: t.on_date,
        source: isLead ? `time:${t.id}` : `time:${t.id}:tech:${m.technician_id}`,
        taxable: false,
      });
    }
  }
  return lines;
}
