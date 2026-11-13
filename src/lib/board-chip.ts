/**
 * What a ticket's card on the Tech Board says (owner, Oct 13: "can we get more details on the
 * items shown on the calendar week? right now it just has the ticket number and name").
 *
 * Four lines, each left out when the ticket has nothing for it:
 *   1. #number Customer                      (always)
 *   2. the property: its name, then city, state — or the street address when it has no name
 *   3. the facts: Type · arrival window
 *   4. the description, clamped to two lines
 * An Urgent or Emergency ticket also wears a badge above line 1 (owner, Nov 13; rate-urgency.ts),
 * so the facts line on the card leaves the rate out: it used to print it as plain text between
 * the type and the window, where it was easy to miss. The hover text still spells it out.
 * Pure, so the test pins each line without a browser.
 */
import { arrivalLabel } from "@/lib/arrival-window";
import { RATE_KIND_LABELS } from "@/lib/invoices.functions";
import { urgentRate, type UrgentRate } from "@/lib/rate-urgency";
import { SERVICE_TYPES, TYPE_LABELS, type ServiceType } from "@/lib/service.functions";

export interface ChipJob {
  number: number;
  customer_name: string;
  site_name: string | null;
  site_address: string | null;
  site_city?: string | null;
  site_state?: string | null;
  service_type: string | null;
  labor_rate_kind: string | null;
  arrival_window: string | null;
  description: string | null;
}

const clean = (v: string | null | undefined): string => (v ?? "").trim();

/** "Site name · Corbin, KY", "Site name", "Corbin, KY", the street address, or null. Never repeats the customer's name. */
export function chipPlace(j: ChipJob): string | null {
  const name = clean(j.site_name);
  const city = [clean(j.site_city), clean(j.site_state)].filter(Boolean).join(", ");
  const parts: string[] = [];
  if (name && name.toLowerCase() !== clean(j.customer_name).toLowerCase()) parts.push(name);
  if (city) parts.push(city);
  if (parts.length) return parts.join(" · ");
  return clean(j.site_address) || null;
}

/**
 * ["Leak", "Urgent", "Morning 8–10"] — the type, the rate when not Standard, the arrival window.
 * `rate: false` leaves the rate out, for the card, whose badge already says it.
 */
export function chipFacts(j: ChipJob, opts: { rate?: boolean } = {}): string[] {
  const out: string[] = [];
  const type = clean(j.service_type);
  if ((SERVICE_TYPES as readonly string[]).includes(type))
    out.push(TYPE_LABELS[type as ServiceType]);
  const rate = urgentRate(j.labor_rate_kind);
  if (rate && opts.rate !== false) out.push(RATE_KIND_LABELS[rate]);
  const arrival = arrivalLabel(j.arrival_window);
  if (arrival) out.push(arrival);
  return out;
}

/** The badge an Urgent or Emergency card wears: its kind and its word. Null for Standard. */
export function chipBadge(j: ChipJob): { kind: UrgentRate; label: string } | null {
  const kind = urgentRate(j.labor_rate_kind);
  return kind ? { kind, label: RATE_KIND_LABELS[kind] } : null;
}

/** The description, trimmed, or null. */
export const chipDescription = (j: ChipJob): string | null => clean(j.description) || null;

/** The hover text: every line the card shows, one per row, for the full description. */
export function chipTitleLines(j: ChipJob): string[] {
  return [
    `#${j.number} ${clean(j.customer_name)}`,
    chipPlace(j),
    chipFacts(j).join(" · ") || null,
    chipDescription(j),
  ].filter((x): x is string => !!x);
}
