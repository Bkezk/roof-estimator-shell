/**
 * Two rules that keep a Roof Care plan and its tickets together (break test Nov 20, numbers 17
 * and 18). Pure: the words the server functions say before they try. The database says the same
 * and is the rule (20261120710000_roof_care_plan_holds_property.sql,
 * 20261120720000_care_ticket_stays_put.sql); a test holds the two wordings together.
 *
 * 17. A property or a customer is not deleted while one of its plans is in force or waiting for
 *     its payment: the plan would go on, and the morning run would keep making inspection
 *     tickets for a property nobody can open.
 * 18. A plan's inspection ticket is not moved to another property or customer, nor changed to
 *     another kind of ticket: it would still count as the plan's inspection.
 */
import { planName } from "@/lib/roof-care-plan";

/** The plan statuses that hold a property and its customer. */
export const PLAN_HOLDING_STATUSES = ["active", "awaiting_payment"] as const;

export interface HoldingPlan {
  plan: unknown;
  plan_number: number | null;
  status: string;
  /** The property's name, when the reader has it. */
  site_name?: string | null | undefined;
}

/** The plan that holds, when several do: one in force first, then the lowest number. */
export function holdingPlan<T extends HoldingPlan>(plans: readonly T[]): T | null {
  const held = plans.filter((p) => (PLAN_HOLDING_STATUSES as readonly string[]).includes(p.status));
  held.sort(
    (a, b) =>
      Number(b.status === "active") - Number(a.status === "active") ||
      (a.plan_number ?? Number.MAX_SAFE_INTEGER) - (b.plan_number ?? Number.MAX_SAFE_INTEGER),
  );
  return held[0] ?? null;
}

/** "Roof Care plan #1004 at Main plant (in force)". */
export function planHoldWords(p: HoldingPlan): string {
  const site = (p.site_name ?? "").trim();
  return `${planName(p.plan)} plan${p.plan_number != null ? ` #${p.plan_number}` : ""}${site ? ` at ${site}` : ""} ${p.status === "awaiting_payment" ? "(waiting for its payment)" : "(in force)"}`;
}

export const propertyHeldMessage = (p: HoldingPlan): string =>
  `This property cannot be deleted: it has the ${planHoldWords(p)}. End the plan first (open the property and press End plan), then delete the property.`;

export const customerHeldMessage = (p: HoldingPlan): string =>
  `This customer cannot be deleted: it has the ${planHoldWords(p)}. End the plan first (open the property and press End plan), then delete the customer.`;

/**
 * Why a save may not change a plan inspection ticket's property, customer or kind; null when it
 * changes none of them, or the ticket is not a plan's inspection.
 */
export function careTicketMoveProblem(
  cur: {
    number: number;
    roof_care_visit_id: string | null | undefined;
    site_id: string | null;
    account_id: string | null;
    service_type: string | null;
  },
  next: { site_id: string | null; account_id: string | null; service_type: string | null },
): string | null {
  if (!cur.roof_care_visit_id) return null;
  if ((next.site_id ?? null) !== (cur.site_id ?? null))
    return `Ticket #${cur.number} is a Roof Care plan inspection for its property. It cannot be moved to another property. For work somewhere else, open a new ticket there.`;
  if ((next.account_id ?? null) !== (cur.account_id ?? null))
    return `Ticket #${cur.number} is a Roof Care plan inspection for its customer. It cannot be moved to another customer. For work for someone else, open a new ticket for them.`;
  if ((next.service_type ?? null) !== (cur.service_type ?? null))
    return `Ticket #${cur.number} is a Roof Care plan inspection. It cannot be changed to another kind of ticket. For a repair, start a repair ticket from this inspection once it is done.`;
  return null;
}
