/**
 * A ticket's arrival window (service study M1, owner Oct 5): CenterPoint schedules "8/24/26
 * 9:00am Morning (8-10am)"; the portal had a day only. Optional — blank means any time on the
 * day, and nothing asks for one. Shown next to the day on the ticket, the Tickets list, the
 * Tech Board card and the technician's Today card. A board drop moves the day and keeps the
 * window. Stored as the key (service_jobs.arrival_window, migration 20261005120000).
 */
export const ARRIVAL_WINDOWS = ["morning", "midday", "afternoon"] as const;
export type ArrivalWindow = (typeof ARRIVAL_WINDOWS)[number];

export const ARRIVAL_LABELS: Record<ArrivalWindow, string> = {
  morning: "Morning 8–10",
  midday: "Midday 10–1",
  afternoon: "Afternoon 1–4",
};

/** The label for a stored value; null for blank or anything unknown (shown as nothing). */
export function arrivalLabel(v: string | null | undefined): string | null {
  return v && (ARRIVAL_WINDOWS as readonly string[]).includes(v)
    ? ARRIVAL_LABELS[v as ArrivalWindow]
    : null;
}

/** "Mon, Oct 6 · Morning 8–10", or the day alone when there is no window. */
export function dayWithWindow(dayText: string, v: string | null | undefined): string {
  const w = arrivalLabel(v);
  return w ? `${dayText} · ${w}` : dayText;
}

/** The select's "Any time" item (a Select item cannot have an empty value). */
export const ARRIVAL_ANY = "any";

/** A form value to what is saved: a known key, else null (any time). */
export function asArrival(v: string | null | undefined): ArrivalWindow | null {
  return v && (ARRIVAL_WINDOWS as readonly string[]).includes(v) ? (v as ArrivalWindow) : null;
}
