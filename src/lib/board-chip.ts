/**
 * What a ticket's card on the Tech Board says (owner, Oct 13: "can we get more details on the
 * items shown on the calendar week? right now it just has the ticket number and name").
 *
 * Four lines, each left out when the ticket has nothing for it:
 *   1. #number Customer                      (always)
 *   2. the property: its name, then city, state — or the street address when it has no name
 *   3. the facts: Type · Urgent / Emergency (Standard is the default and says nothing) · arrival window
 *   4. the description, clamped to two lines
 * Pure, so the test pins each line without a browser.
 */
import { arrivalLabel } from "@/lib/arrival-window";
import { RATE_KIND_LABELS, RATE_KINDS } from "@/lib/invoices.functions";
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

/** ["Leak", "Urgent", "Morning 8–10"] — the type, the rate when not Standard, the arrival window. */
export function chipFacts(j: ChipJob): string[] {
  const out: string[] = [];
  const type = clean(j.service_type);
  if ((SERVICE_TYPES as readonly string[]).includes(type))
    out.push(TYPE_LABELS[type as ServiceType]);
  const rate = clean(j.labor_rate_kind);
  if (rate !== "standard" && (RATE_KINDS as readonly string[]).includes(rate))
    out.push(RATE_KIND_LABELS[rate as (typeof RATE_KINDS)[number]]);
  const arrival = arrivalLabel(j.arrival_window);
  if (arrival) out.push(arrival);
  return out;
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
