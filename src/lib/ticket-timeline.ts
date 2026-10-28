/**
 * The ticket's Activity stream (owner, Oct 27: one full stream in the form, not a contact list
 * in the form and an "Activity log" in the Work fold): the contact log (crm_contact_log, kind
 * 'ticket' — contacts, comments, "Service done") merged with the ticket's events
 * (service_job_events — stage changes, date moves, field status, photos, the signature, hand
 * notes), newest first.
 *
 * The database copies every logged CONTACT into service_job_events (crm_contact_log_apply,
 * 20260928120000_untouched.sql: kind 'contact', the same note, by_user, by_name and `at`, and
 * meta {method}); a note, a comment or a "service" row is not copied (20261015090000). The merge
 * drops that copy and keeps the contact-log row, which carries the method and the hold. Nothing
 * flows the other way, so a genuine note or stage row is never deduped.
 *
 * Pure: tested in ticket-timeline.test.ts; drawn by components/service/ticket-activity.tsx.
 */
import {
  CONTACT_METHODS,
  COMMENT_METHOD,
  contactMethodLabel,
  LOG_NOTE_METHOD,
  SERVICE_DONE_METHOD,
  type ContactLogRow,
} from "@/lib/contact-log.functions";
import { STAGE_LABELS, type ServiceStage } from "@/lib/service.functions";
import type { JobEventRow } from "@/lib/service-field.functions";

/** What the row's icon stands for; the component maps each to a lucide icon. */
export type TimelineIcon =
  | "called"
  | "texted"
  | "emailed"
  | "visited"
  | "other"
  | "note"
  | "comment"
  | "service"
  | "stage"
  | "field"
  | "date"
  | "photo"
  | "signature"
  | "crew"
  | "edit";

export interface TimelineEntry {
  /** "contact:<id>" or "event:<id>" — unique across the two sources. */
  key: string;
  source: "contact" | "event";
  at: string;
  /** "Called", "Note", "Service done", "Stage: Open", "Date moved from … to …", "En route". */
  label: string;
  /** The note under the label, or null when the label says it all. */
  text: string | null;
  byName: string | null;
  icon: TimelineIcon;
  /** A "Service done" row stands out (owner, Oct 14). */
  done: boolean;
}

/** About eight rows' height, then the list scrolls inside its own box (owner, Oct 27). */
export const TIMELINE_ROWS_SHOWN = 8;
/** The list's box: capped, scrolling, a thin rounded border, light and dark. */
/**
 * The box is exactly TIMELINE_ROWS_SHOWN rows tall and scrolls past that (owner, Oct 28: "this
 * box isnt scrolling after 8 entries" — 18rem fit ten): a row is text-xs (1rem line) + the
 * 0.25rem gap, so 8 rows = 8 × 1rem + 7 × 0.25rem = 9.75rem, plus the box's 2 × 0.5rem padding.
 */
export const TIMELINE_LIST_MAX_H = "max-h-[10.75rem]";
export const TIMELINE_LIST_CLASS = `${TIMELINE_LIST_MAX_H} overflow-y-auto rounded-md border bg-background/60 p-2 dark:border-border dark:bg-muted/20`;
export const ACTIVITY_EMPTY = "No activity yet";

/** "1 entry" / "12 entries". */
export const entriesLine = (n: number) => `${n} ${n === 1 ? "entry" : "entries"}`;

const FIELD_LABEL: Record<string, string> = { en_route: "En route", on_site: "On site" };
const FIELD_NOTE: Record<string, string> = {
  "left site": "Left the site",
  "stopped travelling": "Stopped travelling",
};

const contactIcon = (method: string): TimelineIcon =>
  (CONTACT_METHODS as readonly string[]).includes(method)
    ? (method as TimelineIcon)
    : method === COMMENT_METHOD
      ? "comment"
      : method === SERVICE_DONE_METHOD
        ? "service"
        : method === LOG_NOTE_METHOD
          ? "note"
          : "other";

/** A contact-log row as a stream entry: the method's label, the note, who. */
export function contactEntry(r: ContactLogRow): TimelineEntry {
  return {
    key: `contact:${r.id}`,
    source: "contact",
    at: r.at,
    // Owner, Oct 28: the ticket's button reads "Note", so does its row (an opportunity keeps "Comment").
    label: r.method === COMMENT_METHOD ? "Note" : contactMethodLabel(r.method),
    text: r.note?.trim() ? r.note : null,
    byName: r.by_name ?? null,
    icon: contactIcon(r.method),
    done: r.method === SERVICE_DONE_METHOD,
  };
}

/** An events row as a stream entry, worded as the Activity log tab worded it until Oct 27. */
export function eventEntry(e: JobEventRow): TimelineEntry {
  const meta = (e.meta ?? {}) as {
    role?: string;
    method?: string;
    date_from?: string | null;
    date_to?: string | null;
  };
  const base = {
    key: `event:${e.id}`,
    source: "event" as const,
    at: e.at,
    byName: e.by_name ?? null,
    done: false,
  };
  switch (e.kind) {
    case "stage":
      return {
        ...base,
        label: `Stage: ${STAGE_LABELS[e.stage as ServiceStage] ?? e.stage ?? "changed"}`,
        text: null,
        icon: "stage",
      };
    case "field":
      if (e.note === "undo")
        return { ...base, label: "Undid the last step", text: null, icon: "field" };
      // The clock's leaving rows (owner, Oct 15): "left site", "stopped travelling".
      if (e.note && !e.field_status)
        return { ...base, label: FIELD_NOTE[e.note] ?? e.note, text: null, icon: "field" };
      return {
        ...base,
        label: FIELD_LABEL[e.field_status ?? ""] ?? `Field: ${e.field_status ?? "changed"}`,
        text: null,
        icon: "field",
      };
    case "note": {
      // A date the server moved (service.functions.ts logTicketDateMove: meta date_from/date_to)
      // reads as its own line, "Date moved from Oct 3, 2026 to Oct 10, 2026".
      if ("date_from" in meta || "date_to" in meta)
        return { ...base, label: e.note ?? "Date moved", text: null, icon: "date" };
      return { ...base, label: "Note", text: e.note?.trim() ? e.note : null, icon: "note" };
    }
    case "contact": {
      // A contact copy that survived the dedupe (its contact-log row is not readable): the method.
      const method = meta.method ?? "other";
      return {
        ...base,
        label: contactMethodLabel(method),
        text: e.note?.trim() ? e.note : null,
        icon: contactIcon(method),
      };
    }
    case "photo":
      return {
        ...base,
        label: `${meta.role === "before" ? "Before photo" : meta.role === "after" ? "After photo" : "Photo"} added`,
        text: null,
        icon: "photo",
      };
    case "signature":
      return { ...base, label: "Customer signed", text: null, icon: "signature" };
    case "edit":
      // "Who is on this job" answers (setJobCrew) and other recorded edits.
      return {
        ...base,
        label: e.note ?? "Edited",
        text: null,
        icon: /^Crew:/.test(e.note ?? "") ? "crew" : "edit",
      };
    default:
      return {
        ...base,
        label: [e.kind, e.note].filter(Boolean).join(": "),
        text: null,
        icon: "edit",
      };
  }
}

const ms = (iso: string) => {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
};

/**
 * The fingerprint of a contact as the database copies it to the events: the same instant, the
 * same method, the same note. (crm_contact_log_apply writes `at`, `note` and meta.method from
 * the contact row; both columns are timestamptz, so the instant compares exactly.)
 */
const copyKey = (at: string, method: string | null | undefined, note: string | null | undefined) =>
  `${ms(at)}\u0000${method ?? ""}\u0000${note ?? ""}`;

/**
 * Both lists as one, newest first; an event that is the database's copy of a contact-log row is
 * dropped in favour of that row. At the same instant a contact-log row comes before an event.
 */
export function mergeTimeline(
  contacts: readonly ContactLogRow[],
  events: readonly JobEventRow[],
): TimelineEntry[] {
  const copied = new Set(contacts.map((c) => copyKey(c.at, c.method, c.note)));
  const out: TimelineEntry[] = contacts.map(contactEntry);
  for (const e of events) {
    const meta = (e.meta ?? {}) as { method?: string };
    if (e.kind === "contact" && copied.has(copyKey(e.at, meta.method, e.note))) continue;
    out.push(eventEntry(e));
  }
  return out.sort((a, b) => {
    const d = ms(b.at) - ms(a.at);
    if (d) return d;
    if (a.source !== b.source) return a.source === "contact" ? -1 : 1;
    return b.key.localeCompare(a.key, undefined, { numeric: true });
  });
}
