/**
 * Was the Roof Care plan offered? (owner, Nov 19: "we also need to track if the care plan was
 * even offered so track the care plan button click on the ticket to ensure it's being offered").
 *
 * Pressing Care Plan on a ticket is kept in the database (roof_care_offers, one row for each
 * person on each ticket). This is the counting: for each technician, the tickets they finished
 * in the last 30 days at a property with no plan, on how many of them Care Plan was opened, and
 * how many of those properties signed up. The arithmetic only; care-plan-offers.functions.ts
 * reads the rows.
 */
import { shortDay } from "@/lib/followup-rules";
import { localYmd, TASK_TZ } from "@/lib/tasks";
import { plusDays } from "@/lib/working-days";

/** How far back the Owner page counts. */
export const OFFER_DAYS = 30;
/** A plan signed within this many days before a ticket was finished was signed on that visit. */
export const SIGNED_WITH_TICKET_DAYS = 7;

export const offersKey = (jobId: string) => ["roof-care-offers", jobId] as const;
export const OFFER_REPORT_KEY = ["owner-care-plan-offers"] as const;

export interface TicketOffer {
  by_name: string;
  at: string;
}

/** Under the Care Plan button on a ticket, for the office. */
export function offeredWords(offers: readonly TicketOffer[], tz: string = TASK_TZ): string {
  const first = offers[0];
  if (!first) return "Care Plan has not been opened on this ticket.";
  const who = first.by_name.trim() || "someone";
  const more = offers.length - 1;
  return `Care Plan opened on this ticket by ${who} on ${shortDay(localYmd(new Date(first.at), tz))}${
    more > 0 ? `, and by ${more} more` : ""
  }.`;
}

export interface OfferTicketIn {
  id: string;
  number: number | null;
  site_id: string | null;
  technician_id: string | null;
  completed_at: string | null;
  roof_care_visit_id: string | null;
}
export interface OfferPlanIn {
  site_id: string;
  signed_on: string;
  status: string;
  ended_on: string | null;
}
export interface OfferRow {
  /** The technician; null for tickets nobody was on. */
  id: string | null;
  name: string;
  finished: number;
  shown: number;
  signed: number;
  /** The finished tickets Care Plan was not opened on, newest first. */
  missed: { id: string; number: number | null }[];
}
export interface OfferReport {
  since: string;
  rows: OfferRow[];
  total: { finished: number; shown: number; signed: number };
}

export const NO_TECHNICIAN = "No technician";

/**
 * The count. A ticket counts when it was finished since `since`, has a property, is not one of
 * a plan's own inspections, and the property had no plan the day it was finished: there the
 * plan was there to be offered. "Shown": Care Plan was pressed on that ticket, by anyone.
 * "Signed": the property signed a plan on that visit or after it.
 */
export function offerReport(i: {
  today: string;
  tickets: readonly OfferTicketIn[];
  /** The tickets Care Plan was pressed on. */
  offered: ReadonlySet<string>;
  plans: readonly OfferPlanIn[];
  names: ReadonlyMap<string, string>;
  tz?: string;
}): OfferReport {
  const since = plusDays(i.today, -OFFER_DAYS);
  const plansOf = new Map<string, OfferPlanIn[]>();
  for (const p of i.plans) plansOf.set(p.site_id, [...(plansOf.get(p.site_id) ?? []), p]);
  const rows = new Map<string, OfferRow>();
  const sorted = [...i.tickets].sort((a, b) =>
    (b.completed_at ?? "").localeCompare(a.completed_at ?? ""),
  );
  for (const t of sorted) {
    if (!t.completed_at || !t.site_id || t.roof_care_visit_id) continue;
    const day = localYmd(new Date(t.completed_at), i.tz ?? TASK_TZ);
    if (day < since) continue;
    const plans = plansOf.get(t.site_id) ?? [];
    const withTicket = plusDays(day, -SIGNED_WITH_TICKET_DAYS);
    // A plan from before this visit that was still there that day: nothing to offer.
    const hadPlan = plans.some(
      (p) => p.signed_on < withTicket && (p.status !== "ended" || (p.ended_on ?? "") >= day),
    );
    if (hadPlan) continue;
    const key = t.technician_id ?? "";
    const row =
      rows.get(key) ??
      ({
        id: t.technician_id,
        name: t.technician_id
          ? (i.names.get(t.technician_id) ?? "").trim() || "Someone no longer here"
          : NO_TECHNICIAN,
        finished: 0,
        shown: 0,
        signed: 0,
        missed: [],
      } satisfies OfferRow);
    row.finished++;
    if (i.offered.has(t.id)) row.shown++;
    else row.missed.push({ id: t.id, number: t.number });
    if (plans.some((p) => p.signed_on >= withTicket)) row.signed++;
    rows.set(key, row);
  }
  const list = [...rows.values()].sort(
    (a, b) =>
      a.shown / a.finished - b.shown / b.finished ||
      b.finished - a.finished ||
      a.name.localeCompare(b.name),
  );
  return {
    since,
    rows: list,
    total: list.reduce(
      (n, r) => ({
        finished: n.finished + r.finished,
        shown: n.shown + r.shown,
        signed: n.signed + r.signed,
      }),
      { finished: 0, shown: 0, signed: 0 },
    ),
  };
}

/** "Opened on 3 of 8 finished tickets. 1 signed up." */
export function offerLine(r: Pick<OfferRow, "finished" | "shown" | "signed">): string {
  const base = `Opened on ${r.shown} of ${r.finished} finished ${r.finished === 1 ? "ticket" : "tickets"}.`;
  return r.signed ? `${base} ${r.signed} signed up.` : base;
}
export const OFFER_REPORT_NOTE =
  "Counts tickets finished in the last 30 days at a property with no Roof Care plan. A plan's own inspections are left out. Opened means the Care Plan button was pressed on the ticket.";
