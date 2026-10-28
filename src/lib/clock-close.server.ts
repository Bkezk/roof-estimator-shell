/**
 * The clock's entry, and the office stopping a technician's clock (audit risk 4, Oct 28; owner:
 * "if the office closes it shouldn't it just close the time?").
 *
 * `insertClockEntry` is the one place a closed clock becomes a service_time_entries row (source
 * 'clock', the real start and end, hours to the quarter hour, the day by tech-clock.ts entryDay):
 * the technician's presses (service-field.functions.ts setFieldStatus) and the office path below
 * both write through it, so the two never drift.
 *
 * `stopClocksForOffice`: before the office moves a ticket to Authorized / Invoiced / Closed
 * (service.functions.ts setServiceStage; invoices.functions.ts finalizeDraft), every running
 * clock on it is closed the way the technician's Leave site would — entry written, clock row
 * deleted, "Clock stopped by the office — stage Invoiced" on the timeline — under the caller's
 * own client (works_on_ticket and ticket_open_for_tech are true for anyone who is not a plain
 * technician, 20261006192000_field_edit_lock.sql, so the office writes time at any stage). It
 * runs BEFORE the stage write and throws when a clock could not be closed, so the stage change
 * is refused rather than leaving a clock the technician can no longer close (their Leave would
 * hit the RLS wall once the ticket is past Done). No clock → nothing written. Done from the
 * stage picker stops it too (owner, Oct 28: "do you think done should stop the clock?" — yes:
 * the only clock alive at Done is one the technician forgot, and it would tick until noticed);
 * the technician's own Complete closes its clock itself and never comes through here. Open and
 * Scheduled leave the clock alone.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import { resolveFieldDay } from "@/lib/field-day";
import { OFFICE_STAGES } from "@/lib/ticket-stage";
import {
  clockTransition,
  durationHours,
  entryDay,
  type Clock,
  type ClockClose,
} from "@/lib/tech-clock";

type Client = SupabaseClient<Database>;

/** The stages whose setting stops a running clock: Done, and the ones a technician cannot write time at. */
export const CLOCK_CLOSING_STAGES: readonly string[] = ["done", ...OFFICE_STAGES];

/** "Invoiced" for 'invoiced' — the stage word in the timeline row (no import from service.functions: it imports this). */
const stageWord = (stage: string) => stage.charAt(0).toUpperCase() + stage.slice(1);

/** The timeline note the office's stop writes (kind 'field', no field_status: the label is the note). */
/** The timeline row; "by the office" unless the technician stopped their own clock from the picker. */
export const clockStoppedNote = (stage: string, own = false) =>
  `Clock stopped${own ? "" : " by the office"} — stage ${stageWord(stage)}`;

/**
 * A closed clock as a service_time_entries row (source 'clock'; owner, Oct 15). `onDate` is the
 * day the press belongs to (the phone's, field-day.ts), moved back by entryDay when the clock
 * ran over midnight. Throws with the entry's times in the message, so a failed write can still
 * be typed by hand.
 */
export async function insertClockEntry(
  sb: Client,
  close: ClockClose,
  onDate: string,
  createdBy: string,
): Promise<void> {
  const { error } = await sb.from("service_time_entries").insert({
    service_job_id: close.jobId,
    technician_id: close.technician_id,
    kind: close.kind,
    started_at: close.started_at,
    ended_at: close.ended_at,
    hours: durationHours(close.started_at, close.ended_at),
    helper_count: close.helper_count,
    source: "clock",
    on_date: entryDay(onDate, close.started_at, close.ended_at),
    created_by: createdBy,
  });
  if (error)
    throw new Error(
      `The time entry (${close.kind}, ${close.started_at} – ${close.ended_at}) was not written: ${error.message}`,
    );
}

/**
 * Stop every clock running on `job` because the office is setting `stage` (a no-op below
 * Authorized, or with no clock). Returns how many were stopped. Throws — before anything else
 * happens to the ticket — when a clock could not be closed.
 */
export async function stopClocksForOffice(
  sb: Client,
  job: { id: string; number: number },
  stage: string,
  actor: { id: string; name: string | null },
  now: Date = new Date(),
): Promise<{ stopped: number }> {
  if (!CLOCK_CLOSING_STAGES.includes(stage)) return { stopped: 0 };
  const { data: rows, error } = await sb
    .from("service_tech_clock")
    .select("technician_id, service_job_id, kind, started_at, helper_count")
    .eq("service_job_id", job.id);
  if (error)
    throw new Error(`Could not read the clocks on ticket #${job.number}: ${error.message}`);
  if (!rows?.length) return { stopped: 0 };
  // The office's day is the Eastern one (field-day.ts), the only one the server can see.
  const day = resolveFieldDay(undefined, now);
  const label = `#${job.number}`;
  for (const r of rows) {
    const open: Clock = { ...r, kind: r.kind === "travel" ? "travel" : "labor" };
    const t = clockTransition(open, "leave", job.id, now, open.helper_count, open.technician_id);
    // The swap first, on the row as read (started_at): a clock its owner moved in between is
    // theirs — their press reports "moved" and nothing is written twice here.
    const gone = await sb
      .from("service_tech_clock")
      .delete()
      .eq("technician_id", open.technician_id)
      .eq("started_at", open.started_at)
      .select("technician_id");
    if (gone.error)
      throw new Error(`Could not stop the clock on ticket ${label}: ${gone.error.message}`);
    if (!gone.data?.length)
      throw new Error(
        `The clock on ticket ${label} changed while it was being stopped — try again`,
      );
    // Under a minute: a mistap, nothing to log (tech-clock.ts MISTAP_MS), as the technician's.
    if (t.close) await insertClockEntry(sb, t.close, day, actor.id);
    const { error: evErr } = await sb.from("service_job_events").insert({
      service_job_id: job.id,
      kind: "field",
      field_status: null,
      note: clockStoppedNote(stage, open.technician_id === actor.id),
      by_user: actor.id,
      by_name: actor.name,
      meta: {
        technician_id: open.technician_id,
        clock: open.kind,
        hours: t.close ? durationHours(t.close.started_at, t.close.ended_at) : 0,
      },
    });
    if (evErr)
      throw new Error(
        `The clock on ticket ${label} is stopped and its time written, but the timeline row was not: ${evErr.message}`,
      );
  }
  // Nobody is en route to or on site at a ticket the office closed: the lead's whereabouts go.
  const { error: fsErr } = await sb
    .from("service_jobs")
    .update({ field_status: null, updated_by_name: actor.name })
    .eq("id", job.id);
  if (fsErr)
    console.error(
      `Ticket ${label}: could not clear its field status after the office stopped the clock`,
      fsErr.message,
    );
  return { stopped: rows.length };
}
