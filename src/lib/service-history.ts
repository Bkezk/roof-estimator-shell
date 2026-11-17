/**
 * History at this property (owner, Oct 21; approved as proposed, with one change: every photo,
 * not three). A technician working a ticket sees, with no extra taps, what happened at this
 * property before: one line under the property ("History here: 3 earlier tickets, last Jun 12
 * (leak at HVAC curb, patched). 7 photos." — or "First ticket at this property."), a fold on the
 * ticket page with one row per earlier ticket (newest first, the same named spot first) carrying
 * its repairs, closing notes, inspection outcome and ALL its photos, and under an inspection
 * checklist item a "Last time: Jun 12 — …" line with the photo taken for that item before.
 *
 * The rows come from the SECURITY DEFINER functions site_history / site_history_summary
 * (supabase/migrations/20261021110000_site_history.sql) through service-history.functions.ts,
 * which signs the photo paths. Everything here is pure, so it is tested without a server.
 */
import { z } from "zod";

import { isPhotoOnItem, type ItemPhotoLike } from "@/lib/inspection";

/** `?open=history` on a ticket's URL opens the fold on arrival (My tickets' strip links so). */
export const HISTORY_OPEN_PARAM = "history";
/** The strip when there is nothing before (muted on the ticket page; left out on My tickets). */
export const FIRST_TICKET = "First ticket at this property.";
/** The longest gist in a strip or a "Last time" line; longer text ends in "…". */
export const GIST_MAX = 48;

// ── The shapes the database hands back ─────────────────────────────────────────────────────

const text = z.string().nullable().default(null);

/** A JSON value (the photo's saved marks, kept as the database holds them; the viewer parses). */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };
const jsonSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonSchema),
    z.record(jsonSchema),
  ]),
);

export const historyPhotoSchema = z.object({
  id: z.string(),
  storage_path: z.string(),
  /** The small copy (Nov 3, review item 34); absent from a JSON made before then. */
  thumb_path: text.optional(),
  file_name: text,
  role: z.string(),
  repair_id: text,
  item_key: text,
  /** Every checklist item the photo is on (Oct 28); absent from a JSON made before then. */
  item_keys: z.array(z.string()).optional(),
  taken_at: text,
  created_at: z.string(),
  annotations: jsonSchema.nullable().default(null),
});
export const historyRepairSchema = z.object({
  id: z.string(),
  name: z.string(),
  problem_text: text,
  resolution_text: text,
  completed_on: text,
});
/** An answer on the earlier ticket's inspection checklist (service_jobs.inspection.items[]). */
export const historyItemSchema = z.object({
  id: text,
  label: text,
  status: text,
  note: text,
});
/**
 * An Activity entry the office ticked "Viewable to technicians" on the earlier ticket (owner,
 * Nov 17; lib/tech-visible.ts): a Note, or Called / Texted / Emailed / Visited with its words.
 */
export const historyNoteSchema = z.object({
  id: z.union([z.number(), z.string()]),
  method: z.string(),
  note: text,
  by_name: text,
  at: z.string(),
});
export const historyTicketSchema = z.object({
  id: z.string(),
  number: z.number(),
  service_type: z.string(),
  description: text,
  scheduled_date: text,
  completed_at: text,
  created_at: z.string(),
  stage: z.string(),
  location_id: text,
  location_name: text,
  closing_notes: text,
  inspection_outcome: text,
  /** The earlier ticket's Special instructions box (Nov 17); absent from a JSON made before. */
  special_instructions: text,
  /** The inspection's own notes box (Nov 17); absent before. */
  inspection_notes: text,
  /** The Activity entries ticked "Viewable to technicians" (Nov 17); absent before. */
  shared_notes: z.array(historyNoteSchema).default([]),
  technician_name: text,
  inspection_items: z.array(historyItemSchema).default([]),
  repairs: z.array(historyRepairSchema).default([]),
  photos: z.array(historyPhotoSchema).default([]),
});
export const siteHistorySchema = z.array(historyTicketSchema);

export const siteHistorySummarySchema = z.object({
  count: z.number(),
  photo_count: z.number(),
  last: z
    .object({
      id: z.string(),
      number: z.number(),
      completed_at: text,
      scheduled_date: text,
      created_at: text,
      description: text,
      /** The first repair's work completed, else the closing notes (cut by the database). */
      resolution: text,
    })
    .nullable(),
});

export type HistoryRepair = z.output<typeof historyRepairSchema>;
export type HistoryNote = z.output<typeof historyNoteSchema>;
export type HistoryItem = z.output<typeof historyItemSchema>;
/**
 * A photo as the server function returns it: the row plus its signed links (null when signing
 * failed) — `url` the full picture, `thumb_url` the small copy when the photo has one.
 */
export type HistoryPhoto = z.output<typeof historyPhotoSchema> & {
  url: string | null;
  thumb_url?: string | null;
};
export type SiteHistoryTicket = Omit<z.output<typeof historyTicketSchema>, "photos"> & {
  photos: HistoryPhoto[];
};
export type SiteHistorySummary = z.output<typeof siteHistorySummarySchema>;

// ── Dates ──────────────────────────────────────────────────────────────────────────────────

interface Dated {
  completed_at: string | null;
  scheduled_date: string | null;
  created_at?: string | null;
}

/** The day a ticket is filed under: when it was done, else its scheduled day, else opened. */
export function historyWhen(r: Dated): Date | null {
  if (r.completed_at) return new Date(r.completed_at);
  if (r.scheduled_date) {
    const [y, m, d] = r.scheduled_date.split("-").map(Number);
    if (y && m && d) return new Date(y, m - 1, d);
  }
  return r.created_at ? new Date(r.created_at) : null;
}

/** "Jun 12", or "Jun 12, 2025" when it is not this year (callbacks reach back years). */
export function dayText(d: Date, today: Date = new Date()): string {
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(d.getFullYear() === today.getFullYear() ? {} : { year: "numeric" }),
  });
}

// ── Wording ────────────────────────────────────────────────────────────────────────────────

/** The first non-blank line of a text, cut to `max` with "…". */
export function gist(text: string | null | undefined, max: number = GIST_MAX): string {
  const first =
    (text ?? "")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l !== "") ?? "";
  return first.length > max ? `${first.slice(0, max - 1).trimEnd()}…` : first;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "last Jun 12 (Leak at HVAC curb, Patched the curb seam)" — the last ticket's day and gist. */
function lastPart(s: SiteHistorySummary, today: Date): string {
  const last = s.last;
  if (!last) return "";
  const when = historyWhen(last);
  const bits = [gist(last.description), gist(last.resolution)].filter(Boolean);
  return `last ${when ? dayText(when, today) : "undated"}${bits.length ? ` (${bits.join(", ")})` : ""}`;
}

/**
 * The one-line strip: "History here: 3 earlier tickets, last Jun 12 (leak at HVAC curb,
 * patched). 7 photos." Singular where it should be; no photo sentence without photos; and
 * FIRST_TICKET when nothing came before.
 */
export function historyStrip(s: SiteHistorySummary, today: Date = new Date()): string {
  if (s.count <= 0) return FIRST_TICKET;
  const photos = s.photo_count > 0 ? ` ${plural(s.photo_count, "photo", "photos")}.` : "";
  const last = lastPart(s, today);
  return `History here: ${plural(s.count, "earlier ticket", "earlier tickets")}${last ? `, ${last}` : ""}.${photos}`;
}

/** The fold's title: "History at this property (3)" once the count is known. */
export function historyFoldTitle(count: number | null): string {
  return count === null ? "History at this property" : `History at this property (${count})`;
}

/** The fold's header summary: "last Jun 12 (…) · 7 photos", or "none yet". */
export function historyFoldSummary(s: SiteHistorySummary, today: Date = new Date()): string {
  if (s.count <= 0) return "none yet";
  const parts = [lastPart(s, today)];
  if (s.photo_count > 0) parts.push(plural(s.photo_count, "photo", "photos"));
  return parts.filter(Boolean).join(" · ");
}

// ── Ordering ───────────────────────────────────────────────────────────────────────────────

/** Is this earlier ticket at the same named spot on the property as the current one? */
export function isSameSpot(r: { location_id: string | null }, locationId: string | null): boolean {
  return !!locationId && r.location_id === locationId;
}

/**
 * Newest first; when the current ticket names a spot on the property (location_id), the
 * tickets at that same spot lead, each group newest first. Stable for equal days.
 */
export function orderHistory<T extends Dated & { location_id: string | null }>(
  rows: readonly T[],
  locationId: string | null,
): T[] {
  const at = (r: T) => historyWhen(r)?.getTime() ?? 0;
  return [...rows].sort((a, b) => {
    const spot = Number(isSameSpot(b, locationId)) - Number(isSameSpot(a, locationId));
    return spot !== 0 ? spot : at(b) - at(a);
  });
}

// ── The inspection item match ──────────────────────────────────────────────────────────────

/**
 * A checklist item's photos on a ticket: role "other", on no repair, the item among its
 * `item_keys` (a photo may be on several items, Oct 28; an older JSON has only `item_key`).
 */
const itemPhotos = <P extends ItemPhotoLike>(photos: readonly P[], itemKey: string) =>
  photos.filter((p) => isPhotoOnItem(p, itemKey));

/**
 * The newest earlier ticket (rows newest first) with a photo taken for this checklist item, and
 * every such photo of it; null when none.
 */
export function lastTimeForItem<T extends SiteHistoryTicket>(
  rows: readonly T[],
  itemKey: string,
): { ticket: T; photos: T["photos"] } | null {
  for (const ticket of rows) {
    const photos = itemPhotos(ticket.photos, itemKey);
    if (photos.length) return { ticket, photos };
  }
  return null;
}

const STATUS_WORD: Record<string, string> = { ok: "OK", issue: "Issue", na: "N/A" };

/**
 * What to say about that item last time: its answer then ("Issue: cracked sealant"), else the
 * first repair ("Reseal curb — Resealed the curb"), else the closing notes' gist, else "".
 */
export function itemHistoryText(ticket: SiteHistoryTicket, itemKey: string): string {
  const item = ticket.inspection_items.find((i) => i.id === itemKey);
  if (item && (item.status || item.note)) {
    const status = item.status ? (STATUS_WORD[item.status] ?? item.status) : "";
    const note = gist(item.note);
    return status && note ? `${status}: ${note}` : status || note;
  }
  const repair = ticket.repairs[0];
  if (repair) {
    const done = gist(repair.resolution_text);
    return done ? `${repair.name} — ${done}` : repair.name;
  }
  return gist(ticket.closing_notes);
}

/** "Last time: Jun 12 — Issue: cracked sealant" (no day: "Last time — …"; nothing to say: the day alone). */
export function lastTimeText(when: Date | null, text: string, today: Date = new Date()): string {
  const day = when ? `: ${dayText(when, today)}` : "";
  return text ? `Last time${day} — ${text}` : `Last time${day}`;
}

// ── The short row and the ticket's pop-up (owner, Nov 17) ──────────────────────────────────
//
// "when the tech clicks history at this property i just want them to see this [a short row per
// earlier ticket] and then they can click the ticket and itll pop up its photos and notes from
// the tickets and on the activity log have a check box that says viewable to technicians and
// anything with that check box should also show". The row is short: when, what kind, the
// description, what an inspection flagged, the outcome. Everything else is in the pop-up.

/** The checklist rows the earlier inspection flagged, each with its note ("" when none). */
export function flaggedHistoryItems(
  ticket: Pick<SiteHistoryTicket, "inspection_items">,
): { key: string; label: string; note: string }[] {
  return ticket.inspection_items
    .filter((i) => i.status === "issue")
    .map((i, n) => ({
      key: i.id ?? `item-${n}`,
      label: (i.label ?? "").trim() || "Checklist item",
      note: (i.note ?? "").trim(),
    }));
}

const NOTE_WORDS: Record<string, string> = {
  called: "Called",
  texted: "Texted",
  emailed: "Emailed",
  visited: "Visited",
};

/** Who wrote an Activity entry and when: "Nov 10 · Dana Office", with "Called" when it was one. */
export function historyNoteHead(n: HistoryNote, today: Date = new Date()): string {
  const at = new Date(n.at);
  const day = Number.isNaN(at.getTime()) ? "" : dayText(at, today);
  return [day, (n.by_name ?? "").trim(), NOTE_WORDS[n.method] ?? ""].filter(Boolean).join(" · ");
}

const has = (s: string | null | undefined) => !!(s ?? "").trim();

/** Does the earlier ticket carry any written note the pop-up shows? */
export function historyHasNotes(ticket: SiteHistoryTicket): boolean {
  return (
    has(ticket.special_instructions) ||
    has(ticket.inspection_notes) ||
    has(ticket.closing_notes) ||
    ticket.shared_notes.length > 0 ||
    ticket.repairs.some((r) => has(r.problem_text) || has(r.resolution_text)) ||
    flaggedHistoryItems(ticket).some((f) => f.note !== "")
  );
}

/** What waits behind a row, so the tap is worth it: "3 photos · notes", "notes", "1 photo". */
export function historyRowHint(ticket: SiteHistoryTicket): string {
  const parts: string[] = [];
  if (ticket.photos.length) parts.push(plural(ticket.photos.length, "photo", "photos"));
  if (historyHasNotes(ticket)) parts.push("notes");
  return parts.length ? parts.join(" · ") : "no photos or notes";
}

/** The pop-up's words when the earlier ticket has no photo and nothing written. */
export const HISTORY_DETAIL_EMPTY =
  "No photos were taken and no notes were written on this ticket.";
export const historyDetailIsEmpty = (ticket: SiteHistoryTicket): boolean =>
  ticket.photos.length === 0 &&
  !historyHasNotes(ticket) &&
  ticket.repairs.length === 0 &&
  flaggedHistoryItems(ticket).length === 0;
