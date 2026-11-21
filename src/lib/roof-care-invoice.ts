/**
 * The invoice of a Roof Care plan inspection (owner, Nov 18: "it is billed half at first visit
 * half at second visit and invoiced"). Pure.
 *
 * The invoice opens with the plan's own line, at the visit's share of the yearly price. The
 * ticket's time, materials and purchase orders follow it at no charge, because the plan covers
 * them, with their cost kept so the Owner page still knows what the visit cost. The office
 * types a price on any of them that is beyond what the plan includes; a typed price is kept
 * when the invoice is built again.
 *
 * A storm inspection the plan includes bills nothing: its line says it is included. A further
 * one in the same plan year (Nov 19, late) is billed at the price of one inspection, kept on the
 * inspection as its amount; the plan's minor repairs line then takes what is left of the
 * allowance off it (roof-care-allowance.functions.ts).
 *
 * A return trip charged after a visit we could not do (roof-care-no-access.ts) is a line of its
 * own, after the plan's.
 */
import { tripLine, type TripToBill } from "@/lib/roof-care-no-access";
import {
  carePlanLineSource,
  carePlanLineWords,
  VISIT_KINDS,
  type VisitKind,
} from "@/lib/roof-care-plan";

export interface CarePlanVisitRef {
  id: string;
  kind: string;
  amount: number;
  plan: string | null;
  /** The plan has been ended (Nov 19): nothing is billed for it without a person pressing. */
  ended?: boolean;
  /**
   * The plan was paid for the year before it started (Nov 19): the inspection bills nothing,
   * and its invoice is still made, for what the visit cost.
   */
  paid_first?: boolean;
  /**
   * The return trips charged for this inspection, after visits we could not do for want of
   * access (Nov 19, late). Each is billed once, on this inspection's invoice.
   */
  trips?: readonly TripToBill[];
}

/**
 * Whether the invoice is made by itself when the inspection is authorized (owner, Nov 19):
 * a visit with its half to bill, or one that bills nothing (a storm inspection, or an inspection
 * of a plan paid for the year first), whose invoice carries what the trip cost so the Owner page
 * counts it. Never for a plan that has been ended: the
 * office presses the button if the work was done and is owed.
 */
export function billsItself(visit: CarePlanVisitRef | null): boolean {
  if (!visit || visit.ended) return false;
  return visit.amount > 0 || visit.kind === "storm" || !!visit.paid_first;
}

const asKind = (k: string): VisitKind =>
  (VISIT_KINDS as readonly string[]).includes(k) ? (k as VisitKind) : "visit1";

/** The plan's own line: the visit's share of the yearly price, listed by name on the PDF. */
export function carePlanOwnLine(visit: CarePlanVisitRef) {
  const amount = Math.max(0, Number(visit.amount) || 0);
  return {
    sort: 0,
    kind: "other",
    description: carePlanLineWords(
      visit.plan,
      asKind(visit.kind),
      !!visit.paid_first,
      visit.kind === "storm" && amount > 0,
    ),
    qty: 1,
    unit: "ea",
    rate: amount,
    total: amount,
    cost_rate: 0,
    cost_total: 0,
    on_date: null,
    source: carePlanLineSource(visit.id),
    // A service, as labor is: not taxed.
    taxable: false,
    // The price is the plan's, not typed by hand.
    rate_overridden: false,
    show_on_invoice: true,
    hide_price: false,
  };
}

/**
 * The three switches of an invoice line, each as the database would default it. Rows saved in
 * one request must all name the same columns: a column one row names and another leaves out is
 * saved as nothing on the row that left it out, and the database refuses the whole request
 * (Nov 19, the live test: a care plan invoice with time on the ticket was left with no lines).
 */
export function withLineSwitches<T extends object>(line: T) {
  return { rate_overridden: false, show_on_invoice: false, hide_price: false, ...line };
}

/**
 * One of the ticket's own lines on a care plan invoice: no charge and no tax, its cost as it
 * was. Marked as typed so the editor shows the 0 in a box and not "cost + 75%".
 */
export function carePlanCovered<T extends object>(line: T, sort: number) {
  return {
    ...withLineSwitches(line),
    sort,
    rate: 0,
    total: 0,
    taxable: false,
    rate_overridden: true,
  };
}

/** The plan's line, the return trips charged for this inspection, then the ticket's lines at no charge. */
export function carePlanInvoiceLines<T extends object>(
  built: readonly T[],
  visit: CarePlanVisitRef,
) {
  const trips = (visit.trips ?? []).filter((t) => t.amount > 0);
  return [
    carePlanOwnLine(visit),
    ...trips.map((t, i) => tripLine(t, i + 1)),
    ...built.map((l, i) => carePlanCovered(l, i + 1 + trips.length)),
  ];
}

/**
 * A further invoice on a plan inspection's ticket (owner, Nov 20: break test, number 6). The
 * plan's own line is on the ticket's first invoice and is billed once, so it is not repeated
 * here. The ticket's time, materials and purchase orders are covered by the plan on every
 * invoice of the ticket, the first or a later one: listed at no charge with their cost kept,
 * exactly as the first invoice lists them. Until now "Another invoice" priced the covered visit
 * at the standard rates. The office types a price on a line that is beyond what the plan
 * includes; a typed price is kept when the invoice is built again.
 */
export function carePlanFurtherLines<T extends object>(built: readonly T[]) {
  return built.map((l, i) => carePlanCovered(l, i));
}
