/**
 * The technician's phone flow (docs/service-module-design.md §5.3): the day's tickets, the
 * clock (owner, Oct 15, CenterPoint-style: Start travel → On site → Leave site / Complete, one
 * running clock per technician — tech-clock.ts; setFieldStatus and myClock here) that writes the
 * travel and labor time entries with their real start and end, repairs from the template catalog
 * with before / after photos, closing notes, and the customer's signature. Materials used are
 * inventory movements (inventory.functions.ts) against the ticket.
 *
 * Photos and the signature are uploaded by the browser straight into the private "service"
 * bucket at <job id>/<file> (storage RLS follows the Service page); these functions record
 * the rows. Access: Service. A technician touches only their own tickets (RLS + checks here).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware.hardened";
import type { Database, Json } from "@/integrations/supabase/types";
import { canAccess, isOffice, managesTickets } from "@/lib/access";
import { closeoutGaps, closeoutRefusal } from "@/lib/closeout-check";
import { fieldEditProblem } from "@/lib/field-edit-lock";
import { catalogTemplate, templatesForViewer } from "@/lib/ticket-money";
import { REPAIR_TAG_VALUES } from "@/lib/repair-tags";
import type { ServiceJobRow } from "@/lib/service.functions";
import { SERVICE_DONE_METHOD } from "@/lib/contact-log.functions";
import { MAX_HELPERS, confirmedCrew } from "@/lib/service-crew";
import { isAnnotatableRole, photoMarksSchema, serializePhotoMarks } from "@/lib/photo-annotations";
import { easternYmd, resolveFieldDay } from "@/lib/field-day";
import {
  clockTransition,
  durationHours,
  MOVED_PRESS,
  pressReport,
  type Clock,
  type ClockPress,
} from "@/lib/tech-clock";
import { insertClockEntry } from "@/lib/clock-close.server";
import { warrantyBadges, type Warranty } from "@/lib/warranty";
import { mentionedIds } from "@/lib/mentions";
import { mentionRoster } from "@/lib/auth.functions";
import {
  SERVICE_CATEGORY,
  materialsByCell,
  servicePiece,
  stockCellOf,
  unitWord,
} from "@/lib/service-materials";
import { cellUnit } from "@/lib/inventory.functions";
import { stockUnitFor, type PieceDef } from "@/lib/stock-units";
import { loadServiceMaterialLinks } from "@/lib/service-materials.server";
import { siteAddressLine } from "@/lib/crm.functions";
import { geocodeAddress, geocodeAddressCached } from "@/lib/service-aerial.functions";
import {
  estimateTravelBetween,
  travelFromRoute,
  travelOrigin,
  type TravelEstimate,
} from "@/lib/travel-estimate";
import { routedDrive } from "@/lib/drive-route";
import { parseStreetAddress } from "@/lib/aerial-address";

export const SERVICE_BUCKET = "service";
export type TimeEntryRow = Database["public"]["Tables"]["service_time_entries"]["Row"];
export type RepairTemplateRow = Database["public"]["Tables"]["repair_templates"]["Row"];
export type JobRepairRow = Database["public"]["Tables"]["service_job_repairs"]["Row"];
export type JobPhotoRow = Database["public"]["Tables"]["service_job_photos"]["Row"];
export type JobEventRow = Database["public"]["Tables"]["service_job_events"]["Row"];

type Ctx = { supabase: SupabaseClient<Database>; userId: string };
async function me(ctx: Ctx) {
  const { data } = await ctx.supabase
    .from("profiles")
    .select("role, access, technician, full_name, email")
    .eq("id", ctx.userId)
    .maybeSingle();
  if (!data || !canAccess(data, "service")) throw new Error("Forbidden: Service access required");
  return data;
}
const nameOf = (p: { full_name: string | null; email: string }) =>
  (p.full_name ?? "").trim() || p.email;
/**
 * The phone's calendar day (YYYY-MM-DD, field-utils.ts localYmd) sent with a field action that
 * stamps a day. Optional: an older cached bundle sends none and the server uses the Eastern day
 * (field-day.ts resolveFieldDay, which also refuses a day that is not believable).
 */
const phoneDay = z.string().max(32).optional();

type Me = Awaited<ReturnType<typeof me>>;
/** A technician may only touch their own ticket; office users and admins any. */
async function ownJob(ctx: Ctx, id: string, profile?: Me): Promise<ServiceJobRow> {
  const p = profile ?? (await me(ctx));
  const { data: job, error } = await ctx.supabase
    .from("service_jobs")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!job) throw new Error("Ticket not found");
  if (!isOffice(p) && job.technician_id !== ctx.userId)
    throw new Error("This ticket is assigned to someone else");
  return job;
}
/**
 * Is the caller on this ticket's crew (the lead, or a member named in "Who is on this job with
 * you?")? Read from the price-free crew view (service_job_crew; a technician may not read
 * service_job_techs' rates). The clock's rule (owner, Oct 15): a crew member clocks into the
 * ticket too — their own clock, their own time entries.
 */
async function worksOnJob(ctx: Ctx, job: ServiceJobRow): Promise<boolean> {
  if (job.technician_id === ctx.userId) return true;
  const { data, error } = await ctx.supabase
    .from("service_job_crew")
    .select("technician_id")
    .eq("service_job_id", job.id)
    .eq("technician_id", ctx.userId)
    .limit(1);
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}
/**
 * The ticket a clock press is about, and whose clock it moves. The lead and the crew (worksOnJob)
 * clock their own; the office pressing for a technician moves the LEAD's clock (the technician
 * the ticket is assigned to; the office's own when the ticket has none — keep it simple). Anyone
 * else: "assigned to someone else".
 */
async function clockJob(
  ctx: Ctx,
  id: string,
  p: Me,
): Promise<{ job: ServiceJobRow; clockTech: string }> {
  const { data: job, error } = await ctx.supabase
    .from("service_jobs")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!job) throw new Error("Ticket not found");
  const onCrew = await worksOnJob(ctx, job);
  if (!onCrew && !isOffice(p)) throw new Error("This ticket is assigned to someone else");
  return { job, clockTech: onCrew ? ctx.userId : (job.technician_id ?? ctx.userId) };
}
/** The technician's running clock (service_tech_clock), or null. */
async function openClock(ctx: Ctx, technicianId: string): Promise<Clock | null> {
  const { data, error } = await ctx.supabase
    .from("service_tech_clock")
    .select("technician_id, service_job_id, kind, started_at, helper_count")
    .eq("technician_id", technicianId)
    .maybeSingle();
  if (error) throw new Error(`Could not read the clock: ${error.message}`);
  if (!data) return null;
  return { ...data, kind: data.kind === "travel" ? "travel" : "labor" };
}
/**
 * ownJob, then the stage lock on time, repairs and materials (owner, Oct 6; field-edit-lock.ts):
 * a technician while the ticket is Open / Scheduled / Done, a manager before Invoiced, the office
 * never on Invoiced / Closed. The database twin is ticket_open_for_tech (20261006192000).
 */
async function editableJob(ctx: Ctx, id: string): Promise<{ job: ServiceJobRow; p: Me }> {
  const p = await me(ctx);
  const job = await ownJob(ctx, id, p);
  const problem = fieldEditProblem(p, job.stage, job.technician_id === ctx.userId);
  if (problem) throw new Error(problem);
  return { job, p };
}
/** Hours between two stamps, to the quarter hour, never under a quarter (tech-clock.ts' rule). */
export function quarterHours(from: string | Date, to: string | Date): number {
  return durationHours(from, to);
}
/**
 * The timeline rows the app writes. Not 'stage': the database writes those itself on every change
 * of stage (trigger service_jobs_stage_log, 20261001130000_opened_and_stage_dates.sql).
 */
export type AppEventKind = "field" | "note" | "assign" | "photo" | "signature" | "edit";
type AppEvent = {
  kind: AppEventKind;
  field_status?: string | null;
  note?: string | null;
  meta?: Record<string, unknown>;
};
/**
 * Write a timeline row; a refused insert throws (Oct 28 audit: it used to vanish silently). The
 * caller's loud error path shows it — with `stands`, what was already saved is said first ("The
 * photo is saved, but …"), so the person knows the main write went through.
 */
async function logEvent(ctx: Ctx, jobId: string, ev: AppEvent, byName: string, stands?: string) {
  const { error } = await ctx.supabase.from("service_job_events").insert({
    service_job_id: jobId,
    kind: ev.kind,
    field_status: ev.field_status ?? null,
    note: ev.note ?? null,
    by_user: ctx.userId,
    by_name: byName,
    ...(ev.meta ? { meta: ev.meta as Json } : {}),
  });
  if (error)
    throw new Error(
      `${stands ? `${stands}, but the` : "The"} timeline row was not written: ${error.message}`,
    );
}
/**
 * logEvent for setFieldStatus, whose clock and entry writes are done by the time the row is
 * logged and whose ticket update still follows: a refusal must not fail the press, so it is
 * logged here and handed back as a warning the screen toasts beside the result.
 */
async function tryLogEvent(ctx: Ctx, jobId: string, ev: AppEvent, byName: string) {
  try {
    await logEvent(ctx, jobId, ev, byName);
    return null;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`Ticket ${jobId}: ${msg}`);
    return `The clock moved, but the ticket's timeline was not updated: ${msg}`;
  }
}

/**
 * The service_jobs columns My tickets reads (Oct 28 audit: `select("*")` sent every column of
 * every ticket to the phone): what the card shows, plus what the close-out reads when the card
 * seeds it (job-cache.ts seedJobFromToday fills the rest with nulls — the compiler holds the two
 * lists together: a column dropped here must be added there). No wider than before: RLS still
 * decides which rows a technician reads.
 */
export const TODAY_JOB_SELECT =
  "id, number, customer_name, description, service_type, stage, field_status, en_route_at, on_site_at, completed_at, scheduled_date, arrival_window, technician_id, helper_count, crew_confirmed_at, site_id, site_name, site_address, contact_id, account_id, from_job_id, signature_path, signed_at, signed_by, closing_notes, checked_in_with, checked_out_with, recommend_new_roof, inspection, inspection_outcome, inspection_outcome_at, inspection_outcome_by, labor_rate_kind, created_at, updated_at, updated_by_name" as const;
type SplitColumns<S extends string> = S extends `${infer H}, ${infer T}` ? H | SplitColumns<T> : S;
export type TodayJobColumn = SplitColumns<typeof TODAY_JOB_SELECT>;
/** The ticket row as My tickets reads it (TODAY_JOB_SELECT). */
export type TodayJobRow = Pick<ServiceJobRow, TodayJobColumn>;

/** A ticket on the My tickets page: the row's columns plus what the tech needs at a glance. */
export interface TodayJob extends TodayJobRow {
  technician_instructions: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  account_phone: string | null;
  /** The other technicians of the named crew (not the lead), in order. */
  crew_names: string[];
  /** The site's roof warranties in force today ("Duro-Last 15 NDL · to Mar 2031"; M5). */
  warranty_badges: string[];
}

/**
 * My tickets that still need me: not Done yet, soonest first (today's on top). Everyone's own
 * tickets only, the office included (owner, Oct 9: "it should probably be called my tickets");
 * an Office technician claims unassigned work from Work Overview, and the Service page shows
 * the whole board.
 */
export const myDay = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<TodayJob[]> => {
    await me(context); // Service access
    const sb = context.supabase;
    // Mine only, whoever I am (RLS also filters a technician's reads).
    const { data: jobs, error } = await sb
      .from("service_jobs")
      .select(TODAY_JOB_SELECT)
      .is("deleted_at", null)
      .in("stage", ["open", "scheduled"])
      .eq("technician_id", context.userId)
      .order("scheduled_date", { ascending: true, nullsFirst: false })
      .limit(100);
    if (error) throw new Error(error.message);
    const siteIds = [
      ...new Set((jobs ?? []).map((j) => j.site_id).filter((x): x is string => !!x)),
    ];
    const contactIds = [
      ...new Set((jobs ?? []).map((j) => j.contact_id).filter((x): x is string => !!x)),
    ];
    const accountIds = [
      ...new Set((jobs ?? []).map((j) => j.account_id).filter((x): x is string => !!x)),
    ];
    const jobIds = (jobs ?? []).map((j) => j.id);
    const [
      { data: sites },
      { data: contacts },
      { data: accounts },
      { data: crewRows },
      warrantyRes,
    ] = await Promise.all([
      siteIds.length
        ? sb.from("crm_sites").select("id, technician_instructions").in("id", siteIds)
        : Promise.resolve({ data: [] as { id: string; technician_instructions: string | null }[] }),
      contactIds.length
        ? sb.from("crm_contacts").select("id, name, mobile, office_phone").in("id", contactIds)
        : Promise.resolve({
            data: [] as {
              id: string;
              name: string;
              mobile: string | null;
              office_phone: string | null;
            }[],
          }),
      accountIds.length
        ? sb.from("crm_accounts").select("id, phone").in("id", accountIds)
        : Promise.resolve({ data: [] as { id: string; phone: string | null }[] }),
      // Who is on each crew: the price-free view (a technician reads no rates).
      jobIds.length
        ? sb
            .from("service_job_crew")
            .select("service_job_id, technician_id, sort")
            .in("service_job_id", jobIds)
            .gt("sort", 0)
            .order("sort")
        : Promise.resolve({
            data: [] as {
              service_job_id: string | null;
              technician_id: string | null;
              sort: number | null;
            }[],
          }),
      // M5: before 20261005160000_site_warranties.sql is applied this errors; no badges then.
      siteIds.length
        ? sb
            .from("site_warranties")
            .select("id, site_id, manufacturer, kind, number, start_date, end_date, notes")
            .in("site_id", siteIds)
        : Promise.resolve({ data: [] as Warranty[], error: null }),
    ]);
    // The crew's names (the roster rpc) only when a crew row needs one (Oct 28 audit).
    const techs = crewRows?.length ? (await sb.rpc("technician_options")).data : [];
    const today = easternYmd();
    const warrantiesOf = new Map<string, Warranty[]>();
    for (const w of warrantyRes.error ? [] : (warrantyRes.data ?? []))
      warrantiesOf.set(w.site_id, [...(warrantiesOf.get(w.site_id) ?? []), w]);
    const techName = new Map<string, string>();
    for (const t of techs ?? []) techName.set(t.id, (t.full_name ?? "").trim() || t.email);
    const crewOf = new Map<string, string[]>();
    for (const r of crewRows ?? []) {
      if (!r.service_job_id || !r.technician_id) continue;
      const list = crewOf.get(r.service_job_id) ?? [];
      list.push(techName.get(r.technician_id) ?? "Former technician");
      crewOf.set(r.service_job_id, list);
    }
    const siteMap = new Map((sites ?? []).map((s) => [s.id, s.technician_instructions]));
    const contactMap = new Map((contacts ?? []).map((c) => [c.id, c]));
    const accountMap = new Map((accounts ?? []).map((a) => [a.id, a.phone]));
    return (jobs ?? []).map((j) => {
      const c = j.contact_id ? contactMap.get(j.contact_id) : undefined;
      return {
        ...j,
        technician_instructions: j.site_id ? (siteMap.get(j.site_id) ?? null) : null,
        contact_name: c?.name ?? null,
        contact_phone: c?.mobile || c?.office_phone || null,
        account_phone: j.account_id ? (accountMap.get(j.account_id) ?? null) : null,
        crew_names: crewOf.get(j.id) ?? [],
        warranty_badges: j.site_id ? warrantyBadges(warrantiesOf.get(j.site_id) ?? [], today) : [],
      };
    });
  });

/** The caller's running clock with the ticket it is on (the Today banner, the close-out line). */
export interface MyClock extends Clock {
  number: number;
  customer_name: string;
}
/**
 * My running clock (owner, Oct 15): travel to or labor on one ticket since started_at, with the
 * ticket's number and customer; null when none. The Today page's banner and card buttons and
 * the close-out's line read it.
 */
export const myClock = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<MyClock | null> => {
    await me(context);
    return withTicket(context, await openClock(context, context.userId));
  });

/**
 * The clock running on a ticket, whoever's it is (the office ticket page; the office reads every
 * clock — RLS service_tech_clock_read). The newest when several crew members are clocked in.
 */
export const clockOnJob = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<(MyClock & { technician_name: string }) | null> => {
    await me(context);
    const sb = context.supabase;
    const { data: rows, error } = await sb
      .from("service_tech_clock")
      .select("technician_id, service_job_id, kind, started_at, helper_count")
      .eq("service_job_id", data.id)
      .order("started_at", { ascending: false })
      .limit(1);
    if (error) throw new Error(`Could not read the clock: ${error.message}`);
    const row = rows?.[0];
    if (!row) return null;
    const clock = await withTicket(context, {
      ...row,
      kind: row.kind === "travel" ? "travel" : "labor",
    });
    if (!clock) return null;
    const { data: techs } = await sb.rpc("technician_options");
    const t = (techs ?? []).find((x) => x.id === row.technician_id);
    return { ...clock, technician_name: t ? (t.full_name ?? "").trim() || t.email : "Technician" };
  });

/** The stages a technician's clock can still be closed at (ticket_open_for_tech's list). */
const CLOCKABLE_STAGES: readonly string[] = ["open", "scheduled", "done"];
/**
 * A clock with its ticket's number and customer; null when the ticket is gone — or past Done
 * (Oct 28 audit, defensive: the office's closing stages stop the clock themselves,
 * clock-close.server.ts; a row that slipped through would otherwise show a banner whose Leave
 * site can only hit the RLS wall).
 */
async function withTicket(ctx: Ctx, clock: Clock | null): Promise<MyClock | null> {
  if (!clock) return null;
  const { data: job, error } = await ctx.supabase
    .from("service_jobs")
    .select("number, customer_name, stage")
    .eq("id", clock.service_job_id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!job || !CLOCKABLE_STAGES.includes(job.stage)) return null;
  return { ...clock, number: job.number, customer_name: job.customer_name };
}

/**
 * What a press returns (Oct 28, audit risk 3): the ticket row and what the clock actually did
 * (tech-clock.ts ClockPress — the toast is built from this, not from the phone's cached clock),
 * plus a warning when a timeline row could not be written (the press itself stood).
 */
export interface FieldStatusResult {
  row: ServiceJobRow;
  transition: ClockPress;
  warning?: string;
}

/**
 * The clock's buttons (owner, Oct 15, CenterPoint-style; tech-clock.ts clockTransition has the
 * rules): en_route = Start travel, on_site = On site, leave = Leave site, done = Complete (the
 * close-out's), undo. Every press moves the actor's one clock row (service_tech_clock; the office
 * pressing for a technician moves the lead's — clockJob): Start travel and On site close whatever
 * runs, on any ticket, and open the new clock; a closed clock becomes a time entry with its real
 * start and end (source 'clock', hours to the quarter hour, under a minute nothing — a mistap).
 * The ticket's field_status / en_route_at / on_site_at are still stamped so the board and My
 * tickets show where he is: en_route also moves an Open ticket to Scheduled; leave clears
 * field_status (the stamps stay). Travel to ticket B while on site at A closes A's labor and
 * clears A's field_status ("left site" on its timeline). done keeps every close-out rule (the
 * gaps refusal for a technician, managers complete anyway, finished tickets only stamped, the
 * Service done timeline row, afterTicketStage, syncFollowup); its labor entry comes from the
 * clock on this ticket, or — no clock, still "on site" from the buttons of before Oct 8 — from
 * on_site_at as it always did. undo drops a clock on this ticket without an entry (field_status
 * back to none); with no clock it steps a Done ticket back as before, deleting the labor entry
 * Complete wrote ('buttons' or 'clock'). Pressing a button twice is harmless.
 */
export const setFieldStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        to: z.enum(["en_route", "on_site", "leave", "done", "undo"]),
        day: phoneDay,
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<FieldStatusResult> => {
    // The day the time entries belong to: the phone's, not UTC's (field-day.ts). Checked first,
    // so a refused day changes nothing.
    const at = new Date();
    const onDate = resolveFieldDay(data.day, at);
    const p = await me(context);
    // Complete is the lead's or the office's (the close-out, ownJob); the clock buttons are the
    // crew's too (clockJob).
    const { job, clockTech } =
      data.to === "done"
        ? { job: await ownJob(context, data.id, p), clockTech: null }
        : await clockJob(context, data.id, p);
    // Whose clock Complete closes: the lead's (the office completing for them included).
    const tech = clockTech ?? job.technician_id ?? context.userId;
    const sb = context.supabase;
    const now = at.toISOString();
    const who = nameOf(p);
    const open = await openClock(context, tech);
    const clockHere = open?.service_job_id === job.id ? open : null;
    // The OTHER ticket the clock is on (its lead, and its name for the toast), read once.
    const other =
      open && open.service_job_id !== job.id
        ? (
            await sb
              .from("service_jobs")
              .select("number, customer_name, technician_id")
              .eq("id", open.service_job_id)
              .maybeSingle()
          ).data
        : null;
    const before = open
      ? {
          ...open,
          number: clockHere ? job.number : (other?.number ?? "?"),
          customer_name: clockHere ? job.customer_name : (other?.customer_name ?? null),
        }
      : null;
    /** What the press did, for the toast (tech-clock.ts pressReport). */
    const report = (t: ReturnType<typeof clockTransition>): ClockPress =>
      pressReport(t, before, job);
    const unchanged = (t: ReturnType<typeof clockTransition>): FieldStatusResult => ({
      row: job,
      transition: report(t),
    });
    const warnings: string[] = [];
    const note = async (ev: AppEvent) => {
      const w = await tryLogEvent(context, job.id, ev, who);
      if (w) warnings.push(w);
    };
    let transition: ClockPress = { close: null, open: null, note: null };
    let patch: Database["public"]["Tables"]["service_jobs"]["Update"] = {};

    /**
     * Move the clock row to `t.open` and write the entry of what it closed. The swap first, on
     * the row as read (audit risk 2, Oct 28): the delete names the started_at that was read, so
     * a clock another device already moved is not deleted — nothing is written and the press
     * reports "moved" (the page re-reads). The entry is written only after the swap held.
     */
    const applyClock = async (
      t: ReturnType<typeof clockTransition>,
    ): Promise<"applied" | "moved" | "unchanged"> => {
      if (!t.changed) return "unchanged";
      if (open) {
        const { data: gone, error } = await sb
          .from("service_tech_clock")
          .delete()
          .eq("technician_id", tech)
          .eq("started_at", open.started_at)
          .select("technician_id");
        if (error) throw new Error(`Could not stop the clock: ${error.message}`);
        if (!gone?.length) return "moved";
      }
      if (t.open) {
        const { error } = await sb.from("service_tech_clock").insert(t.open);
        if (error) throw new Error(`Could not start the clock: ${error.message}`);
      }
      if (t.close) await insertClockEntry(sb, t.close, onDate, context.userId);
      // He left the OTHER ticket the clock was on: it is no longer en route / on site. The
      // ticket's field_status is the lead's whereabouts: cleared when the clock's owner leads
      // that ticket (or the office presses); a crew member's clock leaving it changes nothing
      // there (RLS would refuse the update anyway). A refused update is said out loud.
      if (open && open.service_job_id !== job.id) {
        if (other && (other.technician_id === tech || isOffice(p))) {
          const { error: leftErr } = await sb
            .from("service_jobs")
            .update({ field_status: null, updated_by_name: who })
            .eq("id", open.service_job_id);
          if (leftErr)
            console.error(
              `Ticket ${open.service_job_id}: could not clear its field status after the clock left it`,
              leftErr.message,
            );
        }
        const w = await tryLogEvent(
          context,
          open.service_job_id,
          { kind: "field", note: open.kind === "labor" ? "left site" : "stopped travelling" },
          who,
        );
        if (w) warnings.push(w);
      }
      return "applied";
    };
    const moved: FieldStatusResult = { row: job, transition: MOVED_PRESS };

    if (data.to === "en_route") {
      const t = clockTransition(open, "travel", job.id, at, job.helper_count, tech);
      if (!t.changed) return unchanged(t);
      if ((await applyClock(t)) === "moved") return moved;
      transition = report(t);
      patch = {
        field_status: "en_route",
        en_route_at: now,
        stage: job.stage === "open" ? "scheduled" : job.stage,
      };
      await note({ kind: "field", field_status: "en_route" });
    } else if (data.to === "on_site") {
      const t = clockTransition(open, "on_site", job.id, at, job.helper_count, tech);
      if (!t.changed) return unchanged(t);
      if ((await applyClock(t)) === "moved") return moved;
      transition = report(t);
      // No clock, still "en route" from the buttons of before Oct 8: the travel from en_route_at
      // as it always was (source 'buttons'); a clock's travel comes from the clock (above).
      if (!open && job.field_status === "en_route" && job.en_route_at) {
        await sb.from("service_time_entries").insert({
          service_job_id: job.id,
          technician_id: job.technician_id ?? context.userId,
          kind: "travel",
          started_at: job.en_route_at,
          ended_at: now,
          hours: quarterHours(job.en_route_at, now),
          helper_count: job.helper_count,
          source: "buttons",
          on_date: onDate,
          created_by: context.userId,
        });
      }
      patch = {
        field_status: "on_site",
        on_site_at: now,
        stage: job.stage === "open" ? "scheduled" : job.stage,
      };
      await note({ kind: "field", field_status: "on_site" });
    } else if (data.to === "leave") {
      const t = clockTransition(open, "leave", job.id, at, job.helper_count, tech);
      if ((await applyClock(t)) === "moved") return moved;
      if (!t.changed && !job.field_status) return unchanged(t);
      transition = report(t);
      patch = { field_status: null };
      await note({ kind: "field", note: "left site" });
    } else if (data.to === "done") {
      const finished = ["done", "authorized", "invoiced", "closed"].includes(job.stage);
      // Owner, Oct 5 (RoAnna closed #6004 from the stage picker, then completed its close-out and
      // "the status didn't move"): a ticket the office already set Done / Invoiced / Closed keeps
      // that stage, but its close-out is still recorded — completed_at is stamped once, so the
      // ticket page's Close-out fold says "Done <date>" instead of "not closed out yet".
      if (finished && job.completed_at) return { row: job, transition };
      // The labor the clock supplies (owner, Oct 15): a labor clock on this ticket, closed now.
      // With no clock, a ticket still "on site" from the old buttons supplies it from on_site_at
      // (never after Leave site: the clock wrote that labor already).
      const t = clockTransition(open, "done", job.id, at, job.helper_count, tech);
      const laborFromClock = t.close?.kind === "labor" ? t.close.started_at : null;
      const laborFromStamp =
        !clockHere && job.field_status === "on_site" && job.on_site_at ? job.on_site_at : null;
      // Owner, Oct 12 (item 7): the close-out's completeness is the server's rule too, the same
      // one the screen shows (closeout-check.ts closeoutGaps). A technician's Complete is refused
      // while a repair lacks its Before / After photo, no time is logged (unless an On site
      // stamp supplies it) or there is no signature; the gaps come back in the message. A manager
      // completes anyway. A ticket the office already finished is only stamped (above).
      if (!finished && !managesTickets(p)) {
        // An inspection (owner, Oct 12): its gaps are a checklist never saved (the saved
        // answers merged with the live checklist; Oct 26: no row is ever "unanswered" — a row
        // with no status reads as OK) and the time; no photo, no signature.
        const inspection = job.service_type === "inspection";
        const [repairs, photos, time, checklist] = await Promise.all([
          sb.from("service_job_repairs").select("id, name").eq("service_job_id", job.id),
          sb.from("service_job_photos").select("repair_id, role").eq("service_job_id", job.id),
          sb.from("service_time_entries").select("hours").eq("service_job_id", job.id),
          inspection
            ? sb.from("inspection_checklist_items").select("id, label, sort")
            : Promise.resolve({ data: [], error: null }),
        ]);
        const readErr = repairs.error ?? photos.error ?? time.error ?? checklist.error;
        if (readErr) throw new Error(`Could not check the close-out: ${readErr.message}`);
        const gaps = closeoutGaps({
          service_type: job.service_type,
          signature_path: job.signature_path,
          on_site_at: laborFromClock ?? laborFromStamp,
          repairs: repairs.data ?? [],
          photos: photos.data ?? [],
          time: time.data ?? [],
          inspection: job.inspection,
          checklist: checklist.data ?? [],
        });
        if (gaps.length) throw new Error(closeoutRefusal(gaps));
      }
      patch = finished
        ? { field_status: null, completed_at: now }
        : { field_status: null, completed_at: now, stage: "done" };
      if ((await applyClock(t)) === "moved") return moved;
      transition = report(t);
      if (!t.changed && laborFromStamp) {
        await sb.from("service_time_entries").insert({
          service_job_id: job.id,
          technician_id: job.technician_id ?? context.userId,
          kind: "labor",
          started_at: laborFromStamp,
          ended_at: now,
          hours: quarterHours(laborFromStamp, now),
          helper_count: job.helper_count,
          source: "buttons",
          on_date: onDate,
          created_by: context.userId,
        });
      }
      // The timeline's 'stage' row is the database's (trigger service_jobs_stage_log,
      // 20261001130000_opened_and_stage_dates.sql): every change of stage, logged once.
    } else {
      // undo: a clock on this ticket is dropped, nothing written, the ticket back to neither en
      // route nor on site (owner, Oct 15; the stamps of that press go with it).
      const t = clockTransition(open, "cancel", job.id, at, job.helper_count, tech);
      transition = report(t);
      if (t.changed) {
        if ((await applyClock(t)) === "moved") return moved;
        patch =
          clockHere?.kind === "travel"
            ? { field_status: null, en_route_at: null }
            : { field_status: null, on_site_at: null };
      } else if (job.stage === "done" && job.completed_at) {
        // Step a Done ticket back and drop the labor entry Complete wrote (the clock's since
        // Oct 15, the buttons' before).
        patch = { stage: "scheduled", field_status: "on_site", completed_at: null };
        await sb
          .from("service_time_entries")
          .delete()
          .eq("service_job_id", job.id)
          .eq("kind", "labor")
          .in("source", ["buttons", "clock"])
          .eq("ended_at", job.completed_at);
      } else if (job.field_status === "on_site" && job.on_site_at) {
        patch = { field_status: job.en_route_at ? "en_route" : null, on_site_at: null };
        await sb
          .from("service_time_entries")
          .delete()
          .eq("service_job_id", job.id)
          .eq("kind", "travel")
          .eq("source", "buttons")
          .eq("ended_at", job.on_site_at);
      } else if (job.field_status === "en_route") {
        patch = { field_status: null, en_route_at: null };
      } else return unchanged(t);
      await note({ kind: "field", note: "undo" });
    }
    const { data: row, error } = await sb
      .from("service_jobs")
      .update({ ...patch, updated_by_name: who })
      .eq("id", job.id)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    // Owner, Oct 14: the timeline (the contact log) says when service was completed, with a
    // brief summary — on the ticket, and on the opportunity the ticket was started from. Once,
    // at the first close-out (a ticket already stamped is not logged again). The close-out is
    // done by now: a problem here is logged loudly, never a reason to fail it.
    if (data.to === "done" && !job.completed_at && row.completed_at) {
      try {
        await logServiceDone(sb, row, who, context.userId);
      } catch (e) {
        console.error(`Ticket #${row.number}: the Service done timeline row was not written`, e);
      }
    }
    if (row.stage !== job.stage) {
      const { afterTicketStage } = await import("@/lib/ticket-events.server");
      await afterTicketStage(row, job.stage, { id: context.userId, name: who }, context.supabase);
      const { syncFollowup } = await import("@/lib/followups.server");
      await syncFollowup(
        {
          kind: "ticket",
          itemId: row.id,
          accountId: row.account_id,
          assigneeId: row.technician_id,
          title: `Ticket #${row.number} ${row.customer_name}${row.description ? ` — ${row.description}` : ""}`,
          url: `/service?id=${row.id}`,
          closing: ["done", "authorized", "invoiced", "closed"].includes(row.stage),
          closeReason: `stage ${row.stage}`,
          dueDate: row.scheduled_date,
          actorId: context.userId,
          actorName: who,
        },
        context.supabase,
      );
    }
    return { row, transition, ...(warnings.length ? { warning: warnings.join(" ") } : {}) };
  });

/** The "Service done" timeline rows (service-done-summary.ts): the ticket's, and the opportunity's. */
async function logServiceDone(
  sb: SupabaseClient<Database>,
  job: ServiceJobRow,
  by: string | null,
  userId: string,
) {
  const { serviceDoneSummary, serviceDoneForOpportunity } =
    await import("@/lib/service-done-summary");
  const [repairs, time] = await Promise.all([
    sb.from("service_job_repairs").select("name, sort").eq("service_job_id", job.id).order("sort"),
    sb.from("service_time_entries").select("hours").eq("service_job_id", job.id),
  ]);
  if (repairs.error) throw new Error(repairs.error.message);
  if (time.error) throw new Error(time.error.message);
  const summary = serviceDoneSummary({
    by,
    closingNotes: job.closing_notes,
    repairNames: (repairs.data ?? []).map((r) => r.name ?? ""),
    hours: (time.data ?? []).reduce((s, t) => s + Number(t.hours ?? 0), 0),
  });
  const base = { method: SERVICE_DONE_METHOD, by_user: userId, by_name: by };
  const rows = [
    { ...base, kind: "ticket", item_id: job.id, note: summary },
    ...(job.from_opportunity_id
      ? [
          {
            ...base,
            kind: "opportunity",
            item_id: job.from_opportunity_id,
            note: serviceDoneForOpportunity(job.number, job.customer_name, summary),
          },
        ]
      : []),
  ];
  const { error } = await sb.from("crm_contact_log").insert(rows);
  if (error) throw new Error(error.message);
}

export const listTimeEntries = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<TimeEntryRow[]> => {
    await me(context);
    const { data: rows, error } = await context.supabase
      .from("service_time_entries")
      .select("*")
      .eq("service_job_id", data.id)
      .order("on_date")
      .order("id");
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const TIME_END_BEFORE_START = "End must be after start";
export const TIME_HOURS_NEEDED = "Enter the hours, or a start and an end";
/**
 * A time entry as typed or as edited: hours to the quarter hour, OR (owner, Oct 15, "they can
 * edit the times like in CenterPoint") a start and an end — then the hours follow the times
 * (quarterHours; a sent hours is ignored), the end must be after the start, and the day is the
 * start's when none is sent.
 */
const timeSchema = z
  .object({
    id: z.number().int().optional(),
    service_job_id: z.string().uuid(),
    kind: z.enum(["travel", "labor"]),
    hours: z.number().finite().min(0).max(24).optional(),
    helper_count: z.number().int().min(0).max(9).default(0),
    on_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    started_at: z.string().datetime({ offset: true }).nullable().optional(),
    ended_at: z.string().datetime({ offset: true }).nullable().optional(),
    note: z.string().trim().max(300).nullable().optional(),
  })
  .superRefine((d, ctx) => {
    if (d.started_at && d.ended_at) {
      if (new Date(d.ended_at).getTime() <= new Date(d.started_at).getTime())
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: TIME_END_BEFORE_START });
    } else if (d.hours === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: TIME_HOURS_NEEDED });
    } else if (!d.on_date) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "The day is missing" });
    }
  });
export type TimeEntryInput = z.input<typeof timeSchema>;
/**
 * Add or correct a time entry: typed hours (a forgotten press), or the start and end of one
 * (the clock's entries, or any entry given times). A clock entry edited stays source 'clock'
 * (an edit never changes the source; a new typed entry is 'manual').
 */
export const saveTimeEntry = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => {
    const r = timeSchema.safeParse(d);
    if (!r.success) {
      const custom = r.error.issues.find((i) => i.code === "custom");
      if (custom) throw new Error(custom.message);
      throw r.error;
    }
    return r.data;
  })
  .handler(async ({ data, context }): Promise<TimeEntryRow> => {
    const { job } = await editableJob(context, data.service_job_id);
    const sb = context.supabase;
    const { id, started_at, ended_at, ...fields } = data;
    const timed = !!(started_at && ended_at);
    const hours = timed ? quarterHours(started_at, ended_at) : (fields.hours ?? 0);
    const on_date =
      fields.on_date ?? (timed ? easternYmd(new Date(started_at)) : easternYmd(new Date()));
    const row = {
      kind: fields.kind,
      helper_count: fields.helper_count,
      hours,
      on_date,
      note: fields.note ?? null,
      // Times only when both are sent (null clears them: the entry is typed hours again).
      ...(started_at !== undefined || ended_at !== undefined
        ? { started_at: timed ? started_at : null, ended_at: timed ? ended_at : null }
        : {}),
    };
    if (id) {
      const { data: r, error } = await sb
        .from("service_time_entries")
        .update(row)
        .eq("id", id)
        .eq("service_job_id", job.id)
        .select("*")
        .single();
      if (error) throw new Error(error.message);
      return r;
    }
    const { data: r, error } = await sb
      .from("service_time_entries")
      .insert({
        ...row,
        service_job_id: job.id,
        source: "manual",
        technician_id: job.technician_id ?? context.userId,
        created_by: context.userId,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return r;
  });

export const deleteTimeEntry = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z.object({ id: z.number().int(), service_job_id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }): Promise<void> => {
    await editableJob(context, data.service_job_id);
    const { error } = await context.supabase
      .from("service_time_entries")
      .delete()
      .eq("id", data.id)
      .eq("service_job_id", data.service_job_id);
    if (error) throw new Error(error.message);
  });

/**
 * The automatic travel line (owner, Oct 9: "an automated travel to the time section that tracks
 * the distance between the jbk office and the location on the ticket and calculates the drive
 * time and prefills from there? if its missing any info its just empty as it is now"; later the
 * same day: "can we have it do the routed drive to have more accurate time and it should use
 * the address in the customer profile").
 *
 * The office is where the trucks leave from (travel-estimate.ts travelOrigin; owner, Oct 9: "the
 * drive time wasnt auto added to the close out" — the main address is the invoice header's PO
 * box, which no geocoder can place): company_settings' shop_* street when one is set, else the
 * main address when it is a street, else null. The destination,
 * in order: the ticket's property address when it has a street line (site_address as typed,
 * else its crm_sites row), else the customer's physical address from crm_accounts (address1,
 * city, state, zip — the same columns the invoice's Bill To reads), else null. The state hint
 * for the geocoder comes from whichever row was used. Both ends go through the aerial's address
 * chain (service-aerial.functions.ts geocodeAddress: our stored map data, then the live state
 * layers); then drive-route.ts asks a router for the road miles and minutes ("(routed)"), and
 * when no router answers travel-estimate.ts stretches the straight line as before
 * ("(estimated)"). Null whenever a piece is missing or fails — no office address, no address
 * on the ticket or its customer, no match, the state server down, the ticket not readable — so
 * the Time section stays as it is; only a login without Service access is refused.
 */
export const estimateTravel = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<TravelEstimate | null> => {
    await me(context);
    const sb = context.supabase;
    try {
      // The price-free view (Oct 20): the office and shop addresses, not the settings row.
      const { data: office } = await sb
        .from("company_settings_public")
        .select("address, city, state, zip, shop_address, shop_city, shop_state, shop_zip")
        .eq("id", 1)
        .maybeSingle();
      const origin = office ? travelOrigin(office) : null;
      if (!origin) return null;
      const { data: job } = await sb
        .from("service_jobs")
        .select("id, site_id, site_address, account_id")
        .eq("id", data.id)
        .maybeSingle();
      if (!job) return null;
      const dest = await travelDestination(sb, job);
      if (!dest) return null;
      const [from, to] = await Promise.all([
        geocodeAddressCached(sb, origin.line, origin.state),
        geocodeAddress(sb, dest.line, dest.state),
      ]);
      if (!from || !to) return null;
      const routed = await routedDrive(from, to);
      return (routed && travelFromRoute(routed)) ?? estimateTravelBetween(from, to);
    } catch {
      // A read, a router or the state server failing is "no estimate", never an error on the
      // close-out.
      return null;
    }
  });

/** A line has a street when the aerial's parser finds a house number and street in it. */
const hasStreetLine = (line: string) => !!parseStreetAddress(line);

/**
 * Where the truck drives to (owner, Oct 9: "it should use the address in the customer
 * profile"): the ticket's property address when it has a street line — site_address as typed,
 * else its crm_sites row — else the customer's physical address (crm_accounts address1 /
 * address2 / city / state / zip; not the mailing_* columns, a PO box is nowhere to drive), else
 * null. `state` is the hint for the geocoder, from the row the line came from.
 */
async function travelDestination(
  sb: SupabaseClient<Database>,
  job: { site_id: string | null; site_address: string | null; account_id: string | null },
): Promise<{ line: string; state: string | null } | null> {
  const typed = (job.site_address ?? "").trim();
  let siteState: string | null = null;
  if (job.site_id) {
    const { data: s } = await sb
      .from("crm_sites")
      .select("address1, address2, city, state, zip")
      .eq("id", job.site_id)
      .maybeSingle();
    if (s) {
      siteState = s.state;
      if (!hasStreetLine(typed)) {
        const line = siteAddressLine(s);
        if (hasStreetLine(line)) return { line, state: s.state };
      }
    }
  }
  if (hasStreetLine(typed)) return { line: typed, state: siteState };
  if (!job.account_id) return null;
  const { data: a } = await sb
    .from("crm_accounts")
    .select("address1, address2, city, state, zip")
    .eq("id", job.account_id)
    .maybeSingle();
  if (!a) return null;
  const line = siteAddressLine(a);
  return hasStreetLine(line) ? { line, state: a.state } : null;
}

/**
 * Repair templates: favourites and the most used first, then a name search. `tag` (owner,
 * Oct 6: the picker's roof-type chips, repair-tags.ts) keeps only the repairs tagged with that
 * roof type, on the server, so the limit applies after the filter.
 */
export const listRepairTemplates = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z
      .object({
        q: z.string().trim().max(120).optional(),
        limit: z.number().int().min(1).max(500).optional(),
        tag: z.enum(REPAIR_TAG_VALUES).optional(),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ data, context }): Promise<RepairTemplateRow[]> => {
    const p = await me(context);
    const manager = managesTickets(p);
    const sb = context.supabase;
    const limit = data.limit ?? 60;
    const like = data.q ? `%${data.q.replace(/[%_,]/g, " ")}%` : null;
    // Prices are a manager's (owner, Oct 1): a manager reads the table (unit_price), anyone
    // else the price-free catalog view (RLS repair_templates_read no longer shows a technician
    // the table; the view carries tags since 20261006220000). Same filters and order on both.
    let rows: RepairTemplateRow[];
    if (manager) {
      let q = sb
        .from("repair_templates")
        .select("*")
        .eq("active", true)
        .order("favorite", { ascending: false })
        .order("usage_count", { ascending: false })
        .order("name")
        .limit(limit);
      if (like) q = q.ilike("name", like);
      if (data.tag) q = q.contains("tags", [data.tag]);
      const { data: r, error } = await q;
      if (error) throw new Error(error.message);
      rows = r ?? [];
    } else {
      let q = sb
        .from("repair_templates_catalog")
        .select("*")
        .eq("active", true)
        .order("favorite", { ascending: false })
        .order("usage_count", { ascending: false })
        .order("name")
        .limit(limit);
      if (like) q = q.ilike("name", like);
      if (data.tag) q = q.contains("tags", [data.tag]);
      const { data: r, error } = await q;
      if (error) throw new Error(error.message);
      rows = (r ?? []).map(catalogTemplate);
    }
    return templatesForViewer(rows, manager);
  });

const templateSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(200),
  category: z.string().trim().max(120).nullable().optional(),
  unit: z.string().trim().min(1).max(20).default("EA"),
  description: z.string().trim().max(2000).nullable().optional(),
  work_completed: z.string().trim().max(2000).nullable().optional(),
  unit_price: z.number().finite().nonnegative().nullable().optional(),
  favorite: z.boolean().optional(),
  active: z.boolean().optional(),
});
export type RepairTemplateInput = z.input<typeof templateSchema>;
export const saveRepairTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => templateSchema.parse(d))
  .handler(async ({ data, context }): Promise<RepairTemplateRow> => {
    const p = await me(context);
    // A template carries a price: a manager's (owner, Oct 1; RLS repair_templates_write).
    if (!managesTickets(p)) throw new Error("Only a manager edits repair templates");
    const { id, ...fields } = data;
    const row = {
      name: fields.name,
      unit: fields.unit,
      category: fields.category ?? null,
      description: fields.description ?? null,
      work_completed: fields.work_completed ?? null,
      unit_price: fields.unit_price ?? null,
      ...(fields.favorite === undefined ? {} : { favorite: fields.favorite }),
      ...(fields.active === undefined ? {} : { active: fields.active }),
    };
    const q = id
      ? context.supabase.from("repair_templates").update(row).eq("id", id)
      : context.supabase.from("repair_templates").insert(row);
    const { data: r, error } = await q.select("*").single();
    if (error) throw new Error(error.message);
    return r;
  });

export const listJobRepairs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<JobRepairRow[]> => {
    await me(context);
    const { data: rows, error } = await context.supabase
      .from("service_job_repairs")
      .select("*")
      .eq("service_job_id", data.id)
      .order("sort")
      .order("created_at");
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

const repairSchema = z.object({
  id: z.string().uuid().optional(),
  service_job_id: z.string().uuid(),
  repair_template_id: z.string().uuid().nullable().optional(),
  name: z.string().trim().min(1).max(200),
  quantity: z.number().finite().min(0).default(1),
  unit: z.string().trim().min(1).max(20).default("EA"),
  problem_text: z.string().trim().max(2000).nullable().optional(),
  resolution_text: z.string().trim().max(2000).nullable().optional(),
  completed_on: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  print_on_invoice: z.boolean().optional(),
  /** Today on the phone: the completed_on of a repair saved without one (one just added). */
  day: phoneDay,
});
export type JobRepairInput = z.input<typeof repairSchema>;
/** Add or edit a repair on a ticket; a template fills the name and texts when given. */
export const saveJobRepair = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => repairSchema.parse(d))
  .handler(async ({ data, context }): Promise<JobRepairRow> => {
    const { id, day, ...fields } = data;
    // The phone's day (field-day.ts), checked first so a refused day changes nothing.
    const completedOn = fields.completed_on ?? resolveFieldDay(day);
    const { job } = await editableJob(context, data.service_job_id);
    const sb = context.supabase;
    const row = {
      ...fields,
      repair_template_id: fields.repair_template_id ?? null,
      problem_text: fields.problem_text ?? null,
      resolution_text: fields.resolution_text ?? null,
      completed_on: completedOn,
      print_on_invoice: fields.print_on_invoice ?? true,
    };
    if (id) {
      const { data: r, error } = await sb
        .from("service_job_repairs")
        .update(row)
        .eq("id", id)
        .eq("service_job_id", job.id)
        .select("*")
        .single();
      if (error) throw new Error(error.message);
      return r;
    }
    const { count } = await sb
      .from("service_job_repairs")
      .select("id", { count: "exact", head: true })
      .eq("service_job_id", job.id);
    const { data: r, error } = await sb
      .from("service_job_repairs")
      .insert({ ...row, sort: count ?? 0, created_by: context.userId })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return r;
  });

export const deleteJobRepair = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z.object({ id: z.string().uuid(), service_job_id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }): Promise<void> => {
    await editableJob(context, data.service_job_id);
    const { error } = await context.supabase
      .from("service_job_repairs")
      .delete()
      .eq("id", data.id)
      .eq("service_job_id", data.service_job_id);
    if (error) throw new Error(error.message);
  });

export const listJobPhotos = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<JobPhotoRow[]> => {
    await me(context);
    const { data: rows, error } = await context.supabase
      .from("service_job_photos")
      .select("*")
      .eq("service_job_id", data.id)
      .order("created_at");
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

/** Safe object name inside the bucket: <job id>/<time>-<random>.<ext>. */
export function photoObjectPath(jobId: string, fileName: string): string {
  const ext = (fileName.split(".").pop() ?? "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  return `${jobId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
}

const photoSchema = z.object({
  service_job_id: z.string().uuid(),
  repair_id: z.string().uuid().nullable().optional(),
  role: z.enum(["before", "after", "other", "signature"]).default("other"),
  /**
   * The inspection checklist item a photo was taken for (owner, Oct 12; role "other", no
   * repair): inspection_checklist_items.id as kept in the ticket's inspection JSON. Null for a
   * repair's photo or the findings step's general roll.
   */
  item_key: z.string().min(1).max(60).nullable().optional(),
  storage_path: z.string().min(1).max(300),
  file_name: z.string().max(200).nullable().optional(),
  file_size: z.number().int().nonnegative().nullable().optional(),
  taken_at: z.string().datetime({ offset: true }).nullable().optional(),
  lat: z.number().finite().nullable().optional(),
  lng: z.number().finite().nullable().optional(),
});
/** Record an uploaded photo (the browser uploaded it to the "service" bucket already). */
export const registerJobPhoto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => photoSchema.parse(d))
  .handler(async ({ data, context }): Promise<JobPhotoRow> => {
    const p = await me(context);
    const job = await ownJob(context, data.service_job_id);
    if (!data.storage_path.startsWith(`${job.id}/`))
      throw new Error("The photo must be stored under the ticket's own folder");
    const { data: r, error } = await context.supabase
      .from("service_job_photos")
      .insert({
        service_job_id: job.id,
        repair_id: data.repair_id ?? null,
        role: data.role,
        item_key: data.item_key ?? null,
        storage_path: data.storage_path,
        file_name: data.file_name ?? null,
        file_size: data.file_size ?? null,
        taken_at: data.taken_at ?? null,
        lat: data.lat ?? null,
        lng: data.lng ?? null,
        by_user: context.userId,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    if (data.role === "signature") {
      await context.supabase
        .from("service_jobs")
        .update({ signature_path: data.storage_path, signed_at: new Date().toISOString() })
        .eq("id", job.id);
      await logEvent(context, job.id, { kind: "signature" }, nameOf(p), "The signature is saved");
    } else {
      await logEvent(
        context,
        job.id,
        {
          kind: "photo",
          meta: {
            role: data.role,
            repair_id: data.repair_id ?? null,
            item_key: data.item_key ?? null,
          },
        },
        nameOf(p),
        "The photo is saved",
      );
    }
    return r;
  });

export const deleteJobPhoto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z.object({ id: z.string().uuid(), service_job_id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }): Promise<void> => {
    await ownJob(context, data.service_job_id);
    const { data: row } = await context.supabase
      .from("service_job_photos")
      .select("storage_path")
      .eq("id", data.id)
      .eq("service_job_id", data.service_job_id)
      .maybeSingle();
    if (!row) return;
    await context.supabase.storage.from(SERVICE_BUCKET).remove([row.storage_path]);
    const { error } = await context.supabase.from("service_job_photos").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
  });

/** The save of a photo's marks: the photo, its ticket, and the marks (null = none). */
export const savePhotoAnnotationsInput = z.object({
  id: z.string().uuid(),
  service_job_id: z.string().uuid(),
  annotations: photoMarksSchema.nullable(),
});
/**
 * Save the marks drawn over a ticket photo (owner, Oct 1: "issues circled, text added etc").
 * The same rules as recording a photo: Service access, and a technician only on their own
 * ticket (ownJob). Only a Before / After / other photo of this ticket takes marks (a signature
 * never; an aerial keeps its own markup). The image is never touched: the marks are JSON on the
 * row, rounded, with the rotation the picture is shown turned by (owner, Oct 28; 0 is not
 * written), and null when the last mark is removed and the picture is not turned. The close-out
 * and the ticket page auto-save here as the marks or the rotation change.
 */
export const savePhotoAnnotations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => savePhotoAnnotationsInput.parse(d))
  .handler(async ({ data, context }): Promise<JobPhotoRow> => {
    const job = await ownJob(context, data.service_job_id);
    const sb = context.supabase;
    const { data: photo, error: pErr } = await sb
      .from("service_job_photos")
      .select("id, role")
      .eq("id", data.id)
      .eq("service_job_id", job.id)
      .maybeSingle();
    if (pErr) throw new Error(pErr.message);
    if (!photo) throw new Error("That photo is not on this ticket (it may have been deleted)");
    if (!isAnnotatableRole(photo.role))
      throw new Error("Only a Before, After or other photo can be marked up");
    const value = serializePhotoMarks(
      data.annotations?.marks ?? [],
      data.annotations?.rotation ?? 0,
    );
    const { data: row, error } = await sb
      .from("service_job_photos")
      .update({ annotations: value as unknown as Json })
      .eq("id", photo.id)
      .eq("service_job_id", job.id)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

/** Attach a ticket photo to a checklist item, or detach it (item_key null): the photo, its ticket, the item. */
export const setJobPhotoItemInput = z.object({
  id: z.string().uuid(),
  service_job_id: z.string().uuid(),
  /** inspection_checklist_items.id as kept in the ticket's inspection JSON; null detaches. */
  item_key: z.string().min(1).max(60).nullable(),
});
/**
 * Owner, Oct 26: "add pictures from the service ticket to each part of the inspection". A loose
 * ticket photo (role "other", on no repair) is attached to a checklist item by setting its
 * item_key — the row stays the ticket's, only its place in the checklist changes; Detach sets it
 * back to null and the photo stays on the ticket. The same rules as recording a photo or saving
 * its marks: Service access, and a technician only on their own ticket (ownJob). A repair's
 * Before / After, the signature and an aerial never move onto an item.
 */
export const setJobPhotoItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => setJobPhotoItemInput.parse(d))
  .handler(async ({ data, context }): Promise<JobPhotoRow> => {
    const job = await ownJob(context, data.service_job_id);
    const sb = context.supabase;
    const { data: photo, error: pErr } = await sb
      .from("service_job_photos")
      .select("id, role, repair_id")
      .eq("id", data.id)
      .eq("service_job_id", job.id)
      .maybeSingle();
    if (pErr) throw new Error(pErr.message);
    if (!photo) throw new Error("That photo is not on this ticket (it may have been deleted)");
    if (data.item_key !== null && (photo.role !== "other" || photo.repair_id))
      throw new Error(
        "Only a loose ticket photo (not a repair's, the signature or an aerial) goes on a checklist item",
      );
    const { data: row, error } = await sb
      .from("service_job_photos")
      .update({ item_key: data.item_key })
      .eq("id", photo.id)
      .eq("service_job_id", job.id)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

const closeoutSchema = z.object({
  id: z.string().uuid(),
  closing_notes: z.string().trim().max(10000).nullable().optional(),
  checked_in_with: z.string().trim().max(200).nullable().optional(),
  checked_out_with: z.string().trim().max(200).nullable().optional(),
  recommend_new_roof: z.boolean().optional(),
  helper_count: z.number().int().min(0).max(9).optional(),
  signed_by: z.string().trim().max(200).nullable().optional(),
});
/** The close-out screen's text fields (repairs, photos, materials and time are their own calls). */
export const saveCloseout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => closeoutSchema.parse(d))
  .handler(async ({ data, context }): Promise<ServiceJobRow> => {
    const p = await me(context);
    const job = await ownJob(context, data.id);
    const { id, ...fields } = data;
    const patch: Database["public"]["Tables"]["service_jobs"]["Update"] = {
      updated_by_name: nameOf(p),
    };
    if (fields.closing_notes !== undefined) patch.closing_notes = fields.closing_notes;
    if (fields.checked_in_with !== undefined) patch.checked_in_with = fields.checked_in_with;
    if (fields.checked_out_with !== undefined) patch.checked_out_with = fields.checked_out_with;
    if (fields.recommend_new_roof !== undefined)
      patch.recommend_new_roof = fields.recommend_new_roof;
    if (fields.helper_count !== undefined) patch.helper_count = fields.helper_count;
    if (fields.signed_by !== undefined) patch.signed_by = fields.signed_by;
    const { data: row, error } = await context.supabase
      .from("service_jobs")
      .update(patch)
      .eq("id", job.id)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

/**
 * The technician's answer to "Who is on this job with you?" (owner, Sep 30): alone, or the
 * other technicians picked. Writes the crew rows (the lead stays row 0; rates the office set on
 * kept members stay) and stamps crew_confirmed_at the first time; the answer stays editable
 * (before photos now, after photos later). Auto-saved by the close-out, no Save button.
 */
export const setJobCrew = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        others: z.array(z.string().uuid()).max(MAX_HELPERS),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<ServiceJobRow> => {
    const p = await me(context);
    const job = await ownJob(context, data.id);
    // The lead technician answers; a manager may too. Anyone else in the office asks a manager
    // (RLS service_job_techs_lead lets only the lead write besides a manager).
    if (!managesTickets(p) && job.technician_id !== context.userId)
      throw new Error("Only the technician on this ticket or a manager says who is on the job");
    const sb = context.supabase;
    // Kept members keep the rate a manager set; new ones get none. A manager reads the rates
    // and sends them back; the lead cannot read them (RLS service_job_techs_read) and sends
    // none, and set_job_crew keeps the stored ones (it and the trigger
    // service_job_techs_rate_guard refuse a rate from a non-manager).
    const { readCrew, writeCrew } = await import("@/lib/service-crew.server");
    const rows = confirmedCrew(
      await readCrew(sb, job.id, { rates: managesTickets(p) }),
      job.technician_id,
      data.others,
    );
    const helper_count = await writeCrew(sb, job.id, rows);
    const { data: row, error } = await sb
      .from("service_jobs")
      .update({
        helper_count,
        crew_confirmed_at: job.crew_confirmed_at ?? new Date().toISOString(),
        updated_by_name: nameOf(p),
      })
      .eq("id", job.id)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    await logEvent(
      context,
      job.id,
      {
        kind: "edit",
        note: data.others.length
          ? `Crew: ${data.others.length} other technician${data.others.length > 1 ? "s" : ""} on the job`
          : "Crew: alone on the job",
        meta: { crew: data.others },
      },
      nameOf(p),
      "The crew is saved",
    );
    return row;
  });

export const listJobEvents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<JobEventRow[]> => {
    await me(context);
    const { data: rows, error } = await context.supabase
      .from("service_job_events")
      .select("*")
      .eq("service_job_id", data.id)
      .order("at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

/** Add a note to the ticket's timeline. */
export const addJobNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z.object({ id: z.string().uuid(), note: z.string().trim().min(1).max(5000) }).parse(d),
  )
  .handler(async ({ data, context }): Promise<{ mentioned: number }> => {
    const p = await me(context);
    const job = await ownJob(context, data.id);
    await logEvent(context, data.id, { kind: "note", note: data.note }, nameOf(p));
    // @mentions (M3, owner Oct 5): everyone named after an "@" hears about it, not the writer.
    // The roster is everyone with Service or Customers access (owner, Oct 6: mention_options,
    // the same list the note box offers), not the dispatch roster.
    if (!data.note.includes("@")) return { mentioned: 0 };
    let people: { id: string; name: string }[];
    try {
      people = await mentionRoster(context.supabase);
    } catch (e) {
      throw new Error(
        `Note added, but the mentions were not sent: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    const ids = mentionedIds(data.note, people).filter((id) => id !== context.userId);
    if (!ids.length) return { mentioned: 0 };
    const { notify } = await import("@/lib/notify.server");
    try {
      await notify(
        ids,
        {
          kind: "mention",
          title: `${nameOf(p)} mentioned you on Ticket #${job.number} ${job.customer_name}`,
          body: data.note,
          url: `/service?id=${job.id}`,
        },
        context.supabase,
      );
    } catch (e) {
      throw new Error(
        `Note added, but the mentions were not sent: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    return { mentioned: ids.length };
  });

/** Templates used before on this site (or account), most recent first — the "usual" chips. */
export const recentRepairsForJob = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<RepairTemplateRow[]> => {
    const p = await me(context);
    const manager = managesTickets(p);
    const sb = context.supabase;
    const { data: job } = await sb
      .from("service_jobs")
      .select("site_id, account_id")
      .eq("id", data.id)
      .maybeSingle();
    if (!job || (!job.site_id && !job.account_id)) return [];
    let jobsQ = sb
      .from("service_jobs")
      .select("id")
      .is("deleted_at", null)
      .neq("id", data.id)
      .limit(50);
    jobsQ = job.site_id
      ? jobsQ.eq("site_id", job.site_id)
      : jobsQ.eq("account_id", job.account_id!);
    const { data: jobs } = await jobsQ;
    const ids = (jobs ?? []).map((j) => j.id);
    if (!ids.length) return [];
    const { data: reps } = await sb
      .from("service_job_repairs")
      .select("repair_template_id, created_at")
      .in("service_job_id", ids)
      .not("repair_template_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(100);
    const seen: string[] = [];
    for (const r of reps ?? [])
      if (r.repair_template_id && !seen.includes(r.repair_template_id))
        seen.push(r.repair_template_id);
    if (!seen.length) return [];
    // Prices are a manager's (owner, Oct 1): the table for a manager, the price-free catalog
    // view for anyone else (as listRepairTemplates).
    const picked = seen.slice(0, 12);
    let templates: RepairTemplateRow[];
    if (manager) {
      const { data: r } = await sb
        .from("repair_templates")
        .select("*")
        .in("id", picked)
        .eq("active", true);
      templates = r ?? [];
    } else {
      const { data: r } = await sb
        .from("repair_templates_catalog")
        .select("*")
        .in("id", picked)
        .eq("active", true);
      templates = (r ?? []).map(catalogTemplate);
    }
    const order = new Map(seen.map((id, i) => [id, i]));
    const sorted = templates.sort((a, b) => (order.get(a.id) ?? 99) - (order.get(b.id) ?? 99));
    return templatesForViewer(sorted, manager);
  });

/**
 * The service material list for the close-out's "Find any material" search (owner, Oct 9: a tech
 * searches any material and takes it from the shop or a truck), one row per stock cell, so a
 * material nobody has stocked yet is still found. From the price-free view (service-materials.server.ts
 * loadServiceMaterialLinks — a technician may not read service_materials' costs): NO prices here.
 * The unit is the cell's stock unit (a twin's screen unit, else the material's own word); a stock
 * row's unit wins on the screen when there is one.
 */
export interface ServiceMaterialOption {
  screen_id: string;
  row_label: string;
  price_col: string;
  /** The service material's name (CenterPoint's). */
  label: string;
  category: string;
  unit: string;
  piece: PieceDef | null;
  /** Catalog item number when there is exactly one for the cell. */
  item_no: string | null;
}
export const listServiceMaterialOptions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ServiceMaterialOption[]> => {
    await me(context);
    const sb = context.supabase;
    const [materials, { data: nums }] = await Promise.all([
      loadServiceMaterialLinks(sb),
      sb.from("catalog_item_numbers_map").select("screen_id, row_label, price_col, item_no"),
    ]);
    // A twin cell counts in the catalog's pieces (a box of 1,000 fasteners) unless the material
    // says otherwise (servicePiece); owner, Oct 9: a tap must log one screw, not one box.
    const pieceCache = new Map<string, PieceDef | null>();
    const catalogPiece = async (cell: {
      screen_id: string;
      row_label: string;
      price_col: string;
    }) => {
      const k = `${cell.screen_id}\u0000${cell.row_label}\u0000${cell.price_col}`;
      if (!pieceCache.has(k)) {
        try {
          pieceCache.set(k, (await cellUnit(sb, cell)).piece);
        } catch {
          pieceCache.set(k, null);
        }
      }
      return pieceCache.get(k) ?? null;
    };
    const numsByCell = new Map<string, string[]>();
    for (const n of nums ?? []) {
      if (!n.item_no) continue; // a view's columns type as nullable; the key never is
      const k = `${n.screen_id}\u0000${n.row_label}\u0000${n.price_col}`;
      const list = numsByCell.get(k) ?? [];
      if (!list.includes(n.item_no)) list.push(n.item_no);
      numsByCell.set(k, list);
    }
    // One row per cell, named by the material that names it everywhere else (materialsByCell).
    const out: ServiceMaterialOption[] = [];
    for (const m of materialsByCell(materials.filter((m) => m.active)).values()) {
      const cell = stockCellOf(m);
      const nos = numsByCell.get(`${cell.screen_id}\u0000${cell.row_label}\u0000${cell.price_col}`);
      out.push({
        ...cell,
        label: m.name,
        category: m.category?.trim() || SERVICE_CATEGORY,
        unit: m.stock_screen_id ? stockUnitFor(cell.screen_id) : unitWord(m.unit),
        piece: servicePiece(m) ?? (m.stock_screen_id ? await catalogPiece(cell) : null),
        item_no: nos?.length === 1 ? (nos[0] ?? null) : null,
      });
    }
    return out;
  });
