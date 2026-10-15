/**
 * The technician's clock, CenterPoint-style (owner, Oct 15: "the technicians clock into travel,
 * then clock into the job; while they're out, if they're going to another job they clock into
 * travel for that job, then into the job once they get there, then they can edit time later").
 *
 * One running clock per technician (public.service_tech_clock, 20261015120000_tech_clock.sql):
 * travel to, or labor on, one ticket since started_at. Every press is a transition of that one
 * row (`clockTransition`): Start travel and On site close whatever is running — on any ticket,
 * either kind — and open the new clock; Leave site and Complete close the clock on that ticket
 * and open nothing; Undo drops the clock on that ticket without writing anything. A close
 * becomes a service_time_entries row (source 'clock') with the real start and end and the hours
 * to the quarter hour (`durationHours`, the same rule as the typed entries' quarterHours); a
 * close under a minute writes nothing (a mistap). Pure: no I/O, no dates read — the server
 * (service-field.functions.ts setFieldStatus) and the screens (today-page.tsx, closeout.tsx)
 * call it with the rows they hold.
 */
import { easternYmd } from "@/lib/field-day";

export type ClockKind = "travel" | "labor";

/** A running clock: public.service_tech_clock's row. */
export interface Clock {
  technician_id: string;
  service_job_id: string;
  kind: ClockKind;
  /** ISO. */
  started_at: string;
  helper_count: number;
}

/** What a press means: Start travel, On site, Leave site, Complete, Undo. */
export type ClockAction = "travel" | "on_site" | "leave" | "done" | "cancel";

/** The entry a closed clock becomes (service_time_entries, source 'clock'). */
export interface ClockClose {
  jobId: string;
  technician_id: string;
  kind: ClockKind;
  started_at: string;
  ended_at: string;
  helper_count: number;
}

export interface ClockTransition {
  /** The entry to write for the clock that just stopped; null when none stopped or it was a mistap. */
  close: ClockClose | null;
  /** The clock running after the press (the same object as `open` when nothing changed). */
  open: Clock | null;
  /** Where the technician is on THIS ticket after the press: en route, on site, or neither. */
  fieldStatus: "en_route" | "on_site" | null;
  /** true when the clock row changed (dropped, replaced or opened). */
  changed: boolean;
  /** Why nothing or less than expected happened: "already", "mistap", "no clock on this ticket". */
  note?: string;
}

/** A clock stopped sooner than this wrote nothing: the press was a mistap. */
export const MISTAP_MS = 60_000;

const iso = (d: Date | string) => (typeof d === "string" ? d : d.toISOString());
const ms = (d: Date | string) => new Date(d).getTime();

/**
 * Hours between two stamps, to the quarter hour, never under a quarter (service-field.functions.ts
 * quarterHours delegates here so the typed and the clocked entries round alike).
 */
export function durationHours(from: string | Date, to: string | Date): number {
  const q = Math.round((ms(to) - ms(from)) / (15 * 60 * 1000)) / 4;
  return Math.max(0.25, q);
}

/** The clock `open` closed at `now` — or null when it ran under a minute (a mistap). */
function closeOf(open: Clock, now: Date | string): ClockClose | null {
  if (ms(now) - ms(open.started_at) < MISTAP_MS) return null;
  return {
    jobId: open.service_job_id,
    technician_id: open.technician_id,
    kind: open.kind,
    started_at: open.started_at,
    ended_at: iso(now),
    helper_count: open.helper_count,
  };
}

/**
 * The one rule table. `open` is the technician's running clock (null when none), `jobId` the
 * ticket pressed, `now` the press, `helperCount` the ticket's helper count (kept on the clock, so
 * the entry bills the crew that was there), `technicianId` whose clock it is.
 */
export function clockTransition(
  open: Clock | null,
  action: ClockAction,
  jobId: string,
  now: Date | string,
  helperCount: number,
  technicianId: string,
): ClockTransition {
  const here = !!open && open.service_job_id === jobId;
  const start = (kind: ClockKind): Clock => ({
    technician_id: technicianId,
    service_job_id: jobId,
    kind,
    started_at: iso(now),
    helper_count: helperCount,
  });
  const stopped = open ? closeOf(open, now) : null;
  const mistap = open && !stopped ? "mistap" : undefined;

  switch (action) {
    case "travel": {
      // Pressing Start travel twice on the same ticket is harmless.
      if (here && open.kind === "travel")
        return { close: null, open, fieldStatus: "en_route", changed: false, note: "already" };
      return {
        close: stopped,
        open: start("travel"),
        fieldStatus: "en_route",
        changed: true,
        ...(mistap ? { note: mistap } : {}),
      };
    }
    case "on_site": {
      if (here && open.kind === "labor")
        return { close: null, open, fieldStatus: "on_site", changed: false, note: "already" };
      // Travel on another ticket closes too: one clock per technician.
      return {
        close: stopped,
        open: start("labor"),
        fieldStatus: "on_site",
        changed: true,
        ...(mistap ? { note: mistap } : {}),
      };
    }
    case "leave":
    case "done": {
      // Only a clock on THIS ticket stops; one on another ticket keeps running.
      if (!here)
        return {
          close: null,
          open,
          fieldStatus: null,
          changed: false,
          note: "no clock on this ticket",
        };
      return {
        close: stopped,
        open: null,
        fieldStatus: null,
        changed: true,
        ...(mistap ? { note: mistap } : {}),
      };
    }
    case "cancel": {
      // Undo: drop the clock on this ticket, write nothing.
      if (!here)
        return {
          close: null,
          open,
          fieldStatus: null,
          changed: false,
          note: "no clock on this ticket",
        };
      return { close: null, open: null, fieldStatus: null, changed: true, note: "undo" };
    }
  }
}

/** "1 h 20 m" / "12 m" / "0 m" — the time a clock has run. */
export function elapsedLabel(from: string | Date, now: string | Date): string {
  const minutes = Math.max(0, Math.floor((ms(now) - ms(from)) / 60_000));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h} h ${m} m` : `${m} m`;
}

/** "#6014 Bell County" — how a ticket is named in the clock's lines. */
export const ticketTag = (t: { number: number | string; customer_name: string | null }) =>
  `#${t.number}${t.customer_name ? ` ${t.customer_name}` : ""}`;

/**
 * The running line: "On site at #6014 Bell County · 1 h 20 m" / "Travelling to #6014 Bell
 * County · 12 m". The caller supplies the ticket's number and customer.
 */
export function runningLabel(
  clock: Pick<Clock, "kind" | "started_at">,
  now: string | Date,
  ticket: { number: number | string; customer_name: string | null },
): string {
  const where = clock.kind === "labor" ? "On site at" : "Travelling to";
  return `${where} ${ticketTag(ticket)} · ${elapsedLabel(clock.started_at, now)}`;
}

/**
 * The toast after a clock stopped: "Left #6012 · 0.75 h labor logged", "Travel to #6012 · 0.25 h
 * logged", or "Left #6012 · under a minute, nothing logged" for a mistap.
 */
export function closedLine(
  clock: Pick<Clock, "kind" | "started_at">,
  now: string | Date,
  ticket: { number: number | string; customer_name: string | null },
): string {
  const tag = ticketTag(ticket);
  if (ms(now) - ms(clock.started_at) < MISTAP_MS)
    return `${clock.kind === "labor" ? "Left" : "Travel to"} ${tag} · under a minute, nothing logged`;
  const hours = durationHours(clock.started_at, now);
  return clock.kind === "labor"
    ? `Left ${tag} · ${hours} h labor logged`
    : `Travel to ${tag} · ${hours} h logged`;
}

/** What a ticket card offers (today-page.tsx), from the technician's clock. */
export type CardAction = "travel" | "on_site";
export function cardActions(open: Clock | null, jobId: string): CardAction[] {
  if (!open || open.service_job_id !== jobId) return ["travel", "on_site"];
  // The clock is on this ticket: the banner at the top is its one control (owner, Oct 15:
  // "there's two On site buttons … it may seem like they haven't done anything with the ticket
  // if it's essentially a copy of it"). The card says so and keeps Open ticket.
  return [];
}

/** Shift a YYYY-MM-DD by whole days (the clock ran over midnight). */
export function shiftYmd(ymd: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m || !days) return ymd;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days));
  return d.toISOString().slice(0, 10);
}

/**
 * The day a closed clock's entry belongs to: the phone's day at the close (`day`, already
 * resolved by field-day.ts), moved back by the days the clock ran over midnight (a labor clock
 * started at 10 pm and closed at 1 am belongs to the day it started). The days are counted in
 * the office's zone, Eastern, the one the server can see.
 */
export function entryDay(day: string, startedAt: string | Date, now: string | Date): string {
  const a = easternYmd(new Date(startedAt));
  const b = easternYmd(new Date(now));
  const diff = Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000);
  return Number.isFinite(diff) ? shiftYmd(day, Math.min(0, diff)) : day;
}

/** "08:05" — the local wall-clock time of an instant, for a <input type="time">. */
export function localHm(isoAt: string | null | undefined): string {
  if (!isoAt) return "";
  const d = new Date(isoAt);
  if (Number.isNaN(d.getTime())) return "";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/**
 * The start and end of an entry edited as two times on its day (the time editor): local
 * wall-clock HH:MM on `onDate`; an end before the start is the next day (the entry ran over
 * midnight). Null when either time is blank or not a time, or the two are the same minute.
 */
export function entryTimes(
  onDate: string,
  startHm: string,
  endHm: string,
): { started_at: string; ended_at: string } | null {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(onDate);
  const sm = /^(\d{2}):(\d{2})/.exec(startHm);
  const em = /^(\d{2}):(\d{2})/.exec(endHm);
  if (!dm || !sm || !em) return null;
  const [y, mo, d] = [Number(dm[1]), Number(dm[2]) - 1, Number(dm[3])];
  const start = new Date(y, mo, d, Number(sm[1]), Number(sm[2]));
  let end = new Date(y, mo, d, Number(em[1]), Number(em[2]));
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  // The same minute twice is not an entry; an earlier end ran over midnight.
  if (end.getTime() === start.getTime()) return null;
  if (end.getTime() < start.getTime()) end = new Date(y, mo, d + 1, Number(em[1]), Number(em[2]));
  return { started_at: start.toISOString(), ended_at: end.toISOString() };
}

/**
 * The toast after a press on My tickets: what started and what stopped. `before` is the clock
 * that was running when the button was pressed (any ticket), `ticket` the one pressed.
 */
export function pressLine(
  before: (Clock & { number: number | string; customer_name: string | null }) | null,
  action: "en_route" | "on_site" | "leave" | "undo",
  ticket: { id: string; number: number | string; customer_name: string | null },
  now: string | Date,
): string {
  const tag = ticketTag(ticket);
  const here = !!before && before.service_job_id === ticket.id;
  const stopped = before ? closedLine(before, now, before) : null;
  // Cancel (the banner's "started by mistake"): the clock is dropped, nothing logged.
  if (action === "undo")
    return here ? `Cancelled — nothing logged at ${tag}` : `No clock was running at ${tag}`;
  if (action === "leave") return here && stopped ? stopped : `No clock was running at ${tag}`;
  if (action === "en_route") {
    if (here && before.kind === "travel") return `Already travelling to ${tag}`;
    return stopped ? `${stopped} — travelling to ${tag}` : `Travelling to ${tag}`;
  }
  if (here && before.kind === "labor") return `Already on site at ${tag}`;
  return stopped ? `${stopped} — on site at ${tag}` : `On site at ${tag}`;
}
