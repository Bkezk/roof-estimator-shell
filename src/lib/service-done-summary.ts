/**
 * The "Service done" line on a timeline (owner, Oct 14: "log and show when service is completed
 * and a brief summary there as well"). Written by the close-out (service-field.functions.ts
 * setFieldStatus → done) as a crm_contact_log row, method "service", on the ticket and on the
 * opportunity the ticket was started from. Pure, so the wording is tested without a database.
 */

export interface ServiceDoneFacts {
  /** Who completed it (the actor's name). */
  by: string | null;
  /** The ticket's closing notes, as the technician wrote them. */
  closingNotes: string | null;
  /** The repairs on the ticket, by name, in order. */
  repairNames: string[];
  /** Hours logged on the ticket (labor and travel). */
  hours: number;
}

export const SERVICE_DONE_NOTES_MAX = 240;

const trimTo = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const hoursText = (h: number) => `${Math.round(h * 100) / 100} h`;

/**
 * "Service completed by Braden Keck · 2 repairs (Drain leak, Seam) · 3.25 h — Resealed the
 * drain and the seam over the office." Each part is left out when there is nothing for it.
 */
export function serviceDoneSummary(f: ServiceDoneFacts): string {
  const head = f.by?.trim() ? `Service completed by ${f.by.trim()}` : "Service completed";
  const parts: string[] = [head];
  const names = f.repairNames.map((n) => n.trim()).filter(Boolean);
  if (names.length) {
    const shown = names.slice(0, 3).join(", ") + (names.length > 3 ? ", …" : "");
    parts.push(`${names.length} repair${names.length === 1 ? "" : "s"} (${shown})`);
  }
  if (f.hours > 0) parts.push(hoursText(f.hours));
  const notes = (f.closingNotes ?? "").trim().replace(/\s+/g, " ");
  const line = parts.join(" · ");
  return notes ? `${line} — ${trimTo(notes, SERVICE_DONE_NOTES_MAX)}` : line;
}

/** The same line on the opportunity's timeline, naming the ticket. */
export const serviceDoneForOpportunity = (
  ticketNumber: number,
  customerName: string,
  summary: string,
): string => `Ticket #${ticketNumber} ${customerName.trim()}: ${summary}`;
