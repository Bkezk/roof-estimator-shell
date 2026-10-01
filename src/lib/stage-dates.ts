/**
 * "Is there an opened date stamped on tickets or opportunities?" (owner, Oct 1). Both pages show
 * "Opened Sep 29 by RoAnna Sims" under the title, and a strip of the stages (a ticket) or the
 * statuses (an opportunity) in order, each with the date it was last entered.
 *
 * The dates come from rows the database writes itself (migration
 * 20261001130000_opened_and_stage_dates.sql): a ticket's timeline (service_job_events, kind
 * 'stage', written by the trigger service_jobs_stage_log on every change of stage, including
 * the ones an invoice makes) and an opportunity's log (crm_opportunity_events: 'created' with
 * the status it started at, 'status' on every change). Nothing to fill in.
 *
 * Pure: no database, no React (unit tested in stage-dates.test.ts).
 */
import { SERVICE_STAGES, STAGE_LABELS, type ServiceStage } from "@/lib/service.functions";
import {
  OPP_CLOSING,
  OPP_STATUS_LABELS,
  OPP_STATUSES,
  type OppStatus,
} from "@/lib/opportunities.functions";

export interface DateOpts {
  /** "Today", for deciding whether the year is shown (default: now). */
  now?: Date;
  /** The calendar the date is read on (default: the browser's own). */
  timeZone?: string;
}

const yearOf = (d: Date, timeZone?: string) =>
  new Intl.DateTimeFormat("en-US", { year: "numeric", ...(timeZone ? { timeZone } : {}) }).format(
    d,
  );

/** "Sep 29" in the current year, "Sep 29, 2025" otherwise; "" for nothing or a bad stamp. */
export function shortDate(iso: string | null | undefined, opts: DateOpts = {}): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const tz = opts.timeZone ? { timeZone: opts.timeZone } : {};
  const sameYear = yearOf(d, opts.timeZone) === yearOf(opts.now ?? new Date(), opts.timeZone);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
    ...tz,
  });
}

/** "Opened Sep 29, 2026 by RoAnna Sims" ("Opened Sep 29" alone when the name is unknown). */
export function openedLine(
  created_at: string | null | undefined,
  by_name: string | null | undefined,
  opts: DateOpts = {},
): string {
  const when = shortDate(created_at, opts);
  if (!when) return "";
  const who = (by_name ?? "").trim();
  return `Opened ${when}${who ? ` by ${who}` : ""}`;
}

/**
 * Who opened it: the creator's name from a roster (id → name), else the name on the earliest
 * row of the record's own log written by the creator. null when neither knows.
 */
export function openerName(
  created_by: string | null | undefined,
  roster: readonly { id: string; name: string }[] | null | undefined,
  log: readonly { by_user: string | null; by_name: string | null; at: string }[] = [],
): string | null {
  if (!created_by) return null;
  const hit = roster?.find((r) => r.id === created_by)?.name?.trim();
  if (hit) return hit;
  const first = [...log]
    .filter((e) => e.by_user === created_by && (e.by_name ?? "").trim())
    .sort((a, b) => a.at.localeCompare(b.at))[0];
  return first?.by_name?.trim() ?? null;
}

const later = (a: string | undefined, b: string) =>
  !a || new Date(b).getTime() > new Date(a).getTime() ? b : a;

/** A ticket timeline row, as far as the stage strip reads it. */
export interface StageEventLike {
  kind: string;
  stage?: string | null;
  at: string;
}

/**
 * For each ticket stage the LAST time it was entered (a ticket can go back and forth), from the
 * timeline's 'stage' rows. A stage never reached is absent.
 */
export function stageDates(
  events: readonly StageEventLike[],
): Partial<Record<ServiceStage, string>> {
  const out: Partial<Record<ServiceStage, string>> = {};
  for (const e of events) {
    if (e.kind !== "stage" || !e.stage) continue;
    if (!(SERVICE_STAGES as readonly string[]).includes(e.stage)) continue;
    const s = e.stage as ServiceStage;
    out[s] = later(out[s], e.at);
  }
  return out;
}

/** An opportunity log row (crm_opportunity_events), as far as the status strip reads it. */
export interface StatusEventLike {
  kind: string;
  status?: string | null;
  at: string;
}

/**
 * For each opportunity status the LAST time it was entered: the 'created' row (the status it
 * started at; a backfilled one has none) and every 'status' row. A status never reached is
 * absent.
 */
export function statusDates(
  events: readonly StatusEventLike[],
): Partial<Record<OppStatus, string>> {
  const out: Partial<Record<OppStatus, string>> = {};
  for (const e of events) {
    if ((e.kind !== "status" && e.kind !== "created") || !e.status) continue;
    if (!(OPP_STATUSES as readonly string[]).includes(e.status)) continue;
    const s = e.status as OppStatus;
    out[s] = later(out[s], e.at);
  }
  return out;
}

/** One cell of a strip: its label, the date it was last entered ("" = never), current or not. */
export interface StripCell {
  key: string;
  label: string;
  at: string | null;
  current: boolean;
}

/** The ticket's stage strip: every stage in board order (Open → Closed), the current one marked. */
export function ticketStageStrip(
  current: string | null | undefined,
  events: readonly StageEventLike[],
): StripCell[] {
  const dates = stageDates(events);
  return SERVICE_STAGES.map((s) => ({
    key: s,
    label: STAGE_LABELS[s],
    at: dates[s] ?? null,
    current: s === current,
  }));
}

/** The one slot for Won / Lost / No response while none of them is reached. */
export const OUTCOME_LABEL = "Won / Lost / No response";

/**
 * The opportunity's status strip: Open, Contacted, Quoted, then one slot for the outcome — the
 * status it ended at (Won, Lost or No response) with its date, or, while it is still open, the
 * outcome it last reached before being reopened, else "Won / Lost / No response" undated.
 */
export function oppStatusStrip(
  current: string | null | undefined,
  events: readonly StatusEventLike[],
): StripCell[] {
  const dates = statusDates(events);
  const cells: StripCell[] = OPP_STATUSES.filter((s) => !OPP_CLOSING.includes(s)).map((s) => ({
    key: s,
    label: OPP_STATUS_LABELS[s],
    at: dates[s] ?? null,
    current: s === current,
  }));
  let outcome: OppStatus | null = OPP_CLOSING.includes(current as OppStatus)
    ? (current as OppStatus)
    : null;
  if (!outcome) {
    let best: string | undefined;
    for (const s of OPP_CLOSING) {
      const at = dates[s];
      if (at && (!best || new Date(at).getTime() > new Date(best).getTime())) {
        best = at;
        outcome = s;
      }
    }
  }
  cells.push({
    key: "outcome",
    label: outcome ? OPP_STATUS_LABELS[outcome] : OUTCOME_LABEL,
    at: outcome ? (dates[outcome] ?? null) : null,
    current: !!outcome && outcome === current,
  });
  return cells;
}
