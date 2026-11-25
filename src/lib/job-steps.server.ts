/**
 * One job, one row: the reads and the two notices (job-steps.ts has the rule). SERVER ONLY:
 * load with a dynamic import inside a handler.
 *
 * Everything here is asked fresh. Nothing is written to say an opportunity "waits": what it
 * waits on is read from the tickets and the bids each time, so a ticket that is finished,
 * deleted or left with nobody puts the opportunity back in sight with no step to remember.
 *
 * The reads use the server's own key where there is one (the published site), so the answer is
 * the same for the reminder run and for every person's screen: a person who cannot read
 * tickets still sees their opportunity say "Waiting on inspection #6090". Only the step's
 * label, day and person are handed on, never the ticket.
 *
 * Nov 26, 2026 (the audit's 22, 23 and 24):
 *   - every read here is all or nothing. A part that failed used to count as "no rows", so the
 *     hand-back could say "done: follow up" while another step was in truth still open;
 *   - a read that fills a page is read on to its end (PostgREST answers at most 1,000 rows);
 *   - the late notice is claimed (`step_late_marks`, one row for an opportunity), so two
 *     passes at once send one, a missed morning is caught up, and it is said again every third
 *     working day while the step is still late.
 */
import { chunkIds } from "@/lib/chunk-ids";
import { stepLateMarks } from "@/lib/database-rpc";
import {
  bidIsOfTicketsJob,
  followUpAfterStep,
  followUpBy,
  holdOutlasts,
  lateTellDue,
  openStepsByOpportunity,
  stepDoneLogLine,
  stepDoneNotice,
  stepIsLate,
  stepLateNotice,
  type OpenStep,
  type StepBid,
  type StepOutcome,
  type StepTicket,
} from "@/lib/job-steps";
import { notify, serverClient, type Client } from "@/lib/notify.server";
import { dayText } from "@/lib/ticket-reminders";
import { officeDay } from "@/lib/working-days";

const TICKET_COLS =
  "id, number, service_type, stage, scheduled_date, technician_id, from_opportunity_id, from_job_id, deleted_at, account_id, created_at";
const BID_COLS =
  "id, name, status, due_date, created_by, opportunity_id, from_job_id, deleted_at, account_id, created_at";

/** Rows asked for at a time. A full page is read on; a short one is the end. */
export const STEP_PAGE = 500;
/** No read goes past this many pages: 50,000 rows is not this office's case, and a loop is. */
const MAX_PAGES = 100;

type PageAnswer<T> = { data: T[] | null; error: { message: string } | null };

/**
 * Every row a read answers, by id, a page at a time. Any error is thrown: half an answer is
 * never handed on as the whole (see the top). `page` adds `.order("id").limit(STEP_PAGE)` and
 * `.gt("id", after)` after the first page.
 */
async function everyRow<T extends { id: string }>(
  what: string,
  page: (after: string | null) => PromiseLike<PageAnswer<T>>,
): Promise<T[]> {
  const out: T[] = [];
  let after: string | null = null;
  for (let i = 0; i < MAX_PAGES; i++) {
    const { data, error } = await page(after);
    if (error) throw new Error(`${what}: ${error.message}`);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < STEP_PAGE) return out;
    after = rows[rows.length - 1]!.id;
  }
  throw new Error(`${what}: more than ${MAX_PAGES * STEP_PAGE} rows`);
}

/** The same for a list of ids, 100 to a request (the ids ride in the address). */
async function everyRowOf<T extends { id: string }>(
  what: string,
  ids: readonly string[],
  page: (chunk: string[], after: string | null) => PromiseLike<PageAnswer<T>>,
): Promise<T[]> {
  const parts = await Promise.all(
    chunkIds(ids).map((chunk) => everyRow(what, (after) => page(chunk, after))),
  );
  return parts.flat();
}

/**
 * Everybody who still has a login, of these people (a bid's `created_by` is not tied to a
 * person in the database, so somebody who has left can still be named there). With the
 * server's key the people are read as they are. Without it (the preview) a person reads only
 * their own row, so the every-user list the pages use stands in; when that cannot be read the
 * answer is null: not known, and every estimator counts as before.
 */
async function stillHere(admin: Client, ids: readonly string[]): Promise<Set<string> | null> {
  const asked = [...new Set(ids.filter(Boolean))];
  if (!asked.length) return new Set();
  if (process.env["SUPABASE_SERVICE_ROLE_KEY"]) {
    const rows = await everyRowOf("People", asked, (chunk, after) => {
      const q = admin.from("profiles").select("id").in("id", chunk).order("id").limit(STEP_PAGE);
      return after ? q.gt("id", after) : q;
    });
    return new Set(rows.map((r) => r.id));
  }
  try {
    const { data, error } = await admin.rpc("crm_user_options");
    if (error || !data?.length) return null;
    return new Set(data.map((p) => p.id));
  } catch {
    return null;
  }
}

/** Every ticket and bid that hangs under these opportunities, live or not. Throws on any error. */
async function chainRows(
  admin: Client,
  oppIds: readonly string[],
): Promise<{ tickets: StepTicket[]; bids: StepBid[]; people: Set<string> | null }> {
  const ids = [...new Set(oppIds.filter(Boolean))];
  if (!ids.length) return { tickets: [], bids: [], people: null };
  const ticketsBy = (column: "from_opportunity_id" | "from_job_id", of: readonly string[]) =>
    everyRowOf("Tickets", of, (chunk, after) => {
      const q = admin
        .from("service_jobs")
        .select(TICKET_COLS)
        .in(column, chunk)
        .order("id")
        .limit(STEP_PAGE);
      return after ? q.gt("id", after) : q;
    });
  const bidsBy = (column: "opportunity_id" | "from_job_id", of: readonly string[]) =>
    everyRowOf("Bids", of, (chunk, after) => {
      const q = admin.from("bids").select(BID_COLS).in(column, chunk).order("id").limit(STEP_PAGE);
      return after ? q.gt("id", after) : q;
    });
  const first = await ticketsBy("from_opportunity_id", ids);
  const firstIds = first.map((t) => t.id);
  const [second, ownBids, ticketBids] = await Promise.all([
    ticketsBy("from_job_id", firstIds),
    bidsBy("opportunity_id", ids),
    bidsBy("from_job_id", firstIds),
  ]);
  const tickets = new Map<string, StepTicket>();
  for (const t of [...first, ...second]) tickets.set(t.id, t as StepTicket);
  const bids = new Map<string, StepBid>();
  for (const b of [...ownBids, ...ticketBids]) bids.set(b.id, b as StepBid);
  const drafts = [...bids.values()].filter((b) => !b.deleted_at && b.status === "draft");
  const people = await stillHere(
    admin,
    drafts.map((b) => b.created_by).filter((id): id is string => !!id),
  );
  return { tickets: [...tickets.values()], bids: [...bids.values()], people };
}

/**
 * What each of these opportunities waits on, or an error: for the callers that must not take
 * "could not read" for "waits on nothing" (the hand-back, the late notice).
 */
export async function openStepsStrict(
  sb: Client,
  oppIds: readonly string[],
): Promise<Map<string, OpenStep[]>> {
  const admin = await serverClient(sb);
  return openStepsByOpportunity(await chainRows(admin, oppIds));
}

/**
 * What each of these opportunities waits on, read with the server's key when there is one.
 * An opportunity that waits on nothing is not in the map. A read that fails answers an empty
 * map: every opportunity then shows as it always did, which is the safe way to be wrong.
 */
export async function openStepsFor(
  sb: Client,
  oppIds: readonly string[],
): Promise<Map<string, OpenStep[]>> {
  try {
    return await openStepsStrict(sb, oppIds);
  } catch (e) {
    console.error("Open steps could not be read:", e instanceof Error ? e.message : e);
    return new Map();
  }
}

/** A finished step, as the hand-back is told of it. */
export interface FinishedStep {
  kind: "ticket" | "bid";
  /** "inspection #6090", "bid Dock re-roof". */
  label: string;
  /** How it ended. Left out: "done" for a ticket, "submitted" for a bid. */
  outcome?: StepOutcome;
  from_opportunity_id: string | null;
  from_job_id: string | null;
  /** A bid's customer: one made from a ticket is of that ticket's job only for its customer. */
  account_id?: string | null;
}

/** The opportunity a finished step hangs under, or null. */
async function opportunityOf(admin: Client, step: FinishedStep): Promise<string | null> {
  if (step.from_opportunity_id) return step.from_opportunity_id;
  if (!step.from_job_id) return null;
  const { data, error } = await admin
    .from("service_jobs")
    .select("from_opportunity_id, account_id")
    .eq("id", step.from_job_id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  // A copy of a bid made for another customer is not part of this ticket's job (job-steps.ts).
  if (step.kind === "bid" && !bidIsOfTicketsJob(step, data)) return null;
  return data.from_opportunity_id ?? null;
}

/**
 * A step was just finished: a ticket that left Open / Scheduled, a bid that left Draft, or
 * either one deleted. When that leaves its opportunity waiting on nothing, the opportunity's
 * person is told and given two working days: the follow-up day moves out to then (never in),
 * its timer with it, and one line goes in the opportunity's log. Best effort: the step is
 * finished either way, and a failure here only means the opportunity comes back on the day it
 * already had.
 *
 * Nov 26, 2026 (the audit's 24):
 *   - a hold that is still running and ends after the two working days is left alone, with the
 *     follow-up day: moving the day ended the hold with no word (followups.server.ts);
 *   - when the other steps cannot be read, nobody is told: nothing, rather than a wrong "done";
 *   - the outcome is said as it was (Won, Lost, deleted), not always "submitted".
 * The opportunity's person is told even when they made the press themselves: the owner asked
 * to hear of his own changes too.
 */
export async function afterStepDone(
  sb: Client,
  step: FinishedStep,
  actor: { id: string; name: string | null },
  now: Date = new Date(),
): Promise<"told" | "still_waiting" | "none"> {
  try {
    const admin = await serverClient(sb);
    const oppId = await opportunityOf(admin, step);
    if (!oppId) return "none";
    const { data: opp } = await admin
      .from("crm_opportunities")
      .select("id, title, status, assignee_id, account_id, expected_close, deleted_at")
      .eq("id", oppId)
      .maybeSingle();
    if (!opp || opp.deleted_at || !opp.assignee_id) return "none";
    if (["won", "lost", "no_response"].includes(opp.status)) return "none";
    // Something else of this job is still open: the opportunity goes on waiting on that. A read
    // that fails throws, and nobody is told.
    const still = (await openStepsStrict(admin, [oppId])).get(oppId) ?? [];
    if (still.length) return "still_waiting";

    const today = officeDay(now);
    // A hold on the opportunity (its open follow-up's snoozed_until) that outlasts the two
    // working days: the day and the hold stay.
    const { data: timers, error: timerErr } = await admin
      .from("crm_followups")
      .select("id, snoozed_until")
      .eq("kind", "opportunity")
      .eq("item_id", oppId)
      .eq("status", "open")
      .limit(1);
    if (timerErr) throw new Error(timerErr.message);
    const until = timers?.[0]?.snoozed_until ?? null;
    const heldDay = until && Date.parse(until) > now.getTime() ? officeDay(until) : null;
    const held = holdOutlasts(heldDay, followUpBy(today));
    const by = held
      ? (opp.expected_close ?? heldDay!)
      : followUpAfterStep(today, opp.expected_close);
    if (!held && by !== opp.expected_close) {
      const { error } = await admin
        .from("crm_opportunities")
        .update({ expected_close: by, updated_by_name: actor.name ?? "The site" })
        .eq("id", oppId);
      if (error) throw new Error(error.message);
      const { syncFollowup } = await import("@/lib/followups.server");
      await syncFollowup(
        {
          kind: "opportunity",
          itemId: oppId,
          accountId: opp.account_id,
          assigneeId: opp.assignee_id,
          title: opp.title,
          url: `/opportunities?id=${oppId}`,
          closing: false,
          closeReason: "",
          dueDate: by,
          actorId: actor.id,
          actorName: actor.name,
          quiet: true,
        },
        admin,
      );
    }
    const outcome: StepOutcome = step.outcome ?? (step.kind === "bid" ? "submitted" : "done");
    const said = {
      label: step.label,
      outcome,
      by: dayText(by),
      heldUntil: held ? dayText(heldDay!) : null,
    };
    await admin.from("crm_contact_log").insert({
      kind: "opportunity",
      item_id: oppId,
      method: "note",
      note: stepDoneLogLine(said),
      by_user: actor.id,
      by_name: actor.name ?? "The site",
    });
    const words = stepDoneNotice({ ...said, opportunity: opp.title });
    await notify(
      [opp.assignee_id],
      { kind: "followup", title: words.title, body: words.body, url: `/opportunities?id=${oppId}` },
      admin,
    );
    return "told";
  } catch (e) {
    console.error("After a finished step:", e instanceof Error ? e.message : e);
    return "none";
  }
}

interface LateOpp {
  id: string;
  title: string;
  assignee_id: string | null;
  status: string;
}

/**
 * The morning run: each opportunity that waits on a step whose day has passed tells its person
 * (job-steps.ts lateTellDue): the first working day after the step's date, the first run after
 * it when a morning was missed, and again every third working day while it is still late.
 * Every late step is named. The person is told even when they have the step themselves (the
 * step's own reminders thin out, and a draft bid has none unless its repeat is on).
 * An opportunity nobody is on tells the people on the "Nobody is on it" line (`nobodyLine`):
 * it waits like any other, so its late step must reach somebody.
 *
 * Claimed before it is sent, in `step_late_marks` (20261125400000): the opportunity's row
 * moves to now only where it still holds what this pass read (or is made, when there is none:
 * a second pass's insert is refused), so two passes at once send one, and a send that fails
 * puts it back for the next pass. A table of its own and not a column on the opportunity: a
 * stamp there would move the opportunity's "updated" day and write a line in its history
 * every time. Returns how many opportunities were told, and how many steps failed.
 */
export async function tellLateSteps(
  admin: Client,
  now: Date,
  names: (id: string | null) => string | null,
  nobodyLine: readonly string[] = [],
): Promise<{ told: number; failed: number }> {
  const today = officeDay(now);
  const out = { told: 0, failed: 0 };
  const err = (e: unknown) => (e instanceof Error ? e.message : String(e));
  // Every open opportunity, by id, to its end. A page that fails after the first keeps what
  // was read, and says so.
  const opps: LateOpp[] = [];
  let after: string | null = null;
  for (let i = 0; i < MAX_PAGES; i++) {
    const q = admin
      .from("crm_opportunities")
      .select("id, title, assignee_id, status")
      .is("deleted_at", null)
      .in("status", ["open", "contacted", "quoted"])
      .order("id")
      .limit(STEP_PAGE);
    const page: PageAnswer<LateOpp> = await (after ? q.gt("id", after) : q);
    const { data, error } = page;
    if (error) {
      if (!opps.length) throw new Error(error.message);
      out.failed++;
      console.error(
        `Late steps: the opportunities after the first ${opps.length} could not be read (${error.message}). Those are checked on the next pass.`,
      );
      break;
    }
    const rows = data ?? [];
    opps.push(...rows);
    if (rows.length < STEP_PAGE) break;
    after = rows[rows.length - 1]!.id;
  }
  const byId = new Map(opps.map((o) => [o.id, o]));
  // Strict: a failed read must not read as "nothing is late".
  const waiting = await openStepsStrict(admin, [...byId.keys()]);
  const lateOf = new Map<string, OpenStep[]>();
  for (const [oppId, steps] of waiting) {
    const late = steps.filter((s) => stepIsLate(s, today));
    if (late.length && byId.has(oppId)) lateOf.set(oppId, late);
  }
  if (!lateOf.size) return out;
  // When each was last told. Strict too: "not told yet" must be read, never assumed.
  const marks = new Map<string, string>();
  for (const chunk of chunkIds([...lateOf.keys()])) {
    const { data, error } = await stepLateMarks(admin)
      .select("opportunity_id, told_at")
      .in("opportunity_id", chunk);
    if (error) throw new Error(`Late steps, when each was last told: ${error.message}`);
    for (const m of data ?? []) marks.set(m.opportunity_id, m.told_at);
  }
  for (const [oppId, late] of lateOf) {
    const opp = byId.get(oppId)!;
    const prev = marks.get(oppId) ?? null;
    if (!lateTellDue(late, prev ? officeDay(prev) : null, today)) continue;
    const to = opp.assignee_id ? [opp.assignee_id] : [...nobodyLine];
    if (!to.length) continue;
    // 1. Claim.
    const stamp = now.toISOString();
    try {
      if (prev) {
        const { data: won, error } = await stepLateMarks(admin)
          .update({ told_at: stamp })
          .eq("opportunity_id", oppId)
          .eq("told_at", prev)
          .select("opportunity_id");
        if (error) throw new Error(error.message);
        if (!won?.length) continue;
      } else {
        const { error } = await stepLateMarks(admin).insert({
          opportunity_id: oppId,
          told_at: stamp,
        });
        // Another pass made the row first (the key is the opportunity): it sends, this one not.
        if (error?.code === "23505") continue;
        if (error) throw new Error(error.message);
      }
    } catch (e) {
      out.failed++;
      console.error(`Late steps: could not claim ${opp.title}: ${err(e)}`);
      continue;
    }
    // 2. The notice.
    const words = stepLateNotice({
      steps: late.map((s) => ({
        label: s.label,
        was: s.date ? dayText(s.date) : null,
        made: s.made ? dayText(s.made) : null,
        who: s.personId && s.personId === opp.assignee_id ? "you" : names(s.personId),
      })),
      opportunity: opp.title,
      nobody: !opp.assignee_id,
    });
    try {
      await notify(
        to,
        {
          kind: "followup",
          title: words.title,
          body: words.body,
          url: `/opportunities?id=${oppId}`,
        },
        admin,
      );
      out.told++;
    } catch (e) {
      out.failed++;
      console.error(`Late steps: the notice for ${opp.title} failed: ${err(e)}`);
      // Put the claim back, only where it still holds this pass's stamp: the next pass retries.
      try {
        const back = prev
          ? stepLateMarks(admin).update({ told_at: prev })
          : stepLateMarks(admin).delete();
        const { error } = await back.eq("opportunity_id", oppId).eq("told_at", stamp);
        if (error) throw new Error(error.message);
      } catch (e2) {
        console.error(`Late steps: ${opp.title} could not be put back for a retry: ${err(e2)}`);
      }
    }
  }
  return out;
}
