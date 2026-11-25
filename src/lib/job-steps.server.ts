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
 */
import { readInChunks } from "@/lib/chunk-ids";
import {
  followUpAfterStep,
  openStepsByOpportunity,
  stepDoneNotice,
  stepLateNotice,
  stepLateOn,
  type OpenStep,
  type StepBid,
  type StepTicket,
} from "@/lib/job-steps";
import { notify, serverClient, type Client } from "@/lib/notify.server";
import { dayText } from "@/lib/ticket-reminders";
import { officeDay } from "@/lib/working-days";

const TICKET_COLS =
  "id, number, service_type, stage, scheduled_date, technician_id, from_opportunity_id, from_job_id, deleted_at";
const BID_COLS = "id, name, status, due_date, created_by, opportunity_id, from_job_id, deleted_at";

/** Every ticket and bid that hangs under these opportunities, live or not. */
async function chainRows(
  admin: Client,
  oppIds: readonly string[],
): Promise<{ tickets: StepTicket[]; bids: StepBid[] }> {
  const ids = [...new Set(oppIds.filter(Boolean))];
  if (!ids.length) return { tickets: [], bids: [] };
  const first = await readInChunks(ids, (c) =>
    admin.from("service_jobs").select(TICKET_COLS).in("from_opportunity_id", c),
  );
  const firstIds = first.map((t) => t.id);
  const [second, ownBids, ticketBids] = await Promise.all([
    readInChunks(firstIds, (c) =>
      admin.from("service_jobs").select(TICKET_COLS).in("from_job_id", c),
    ),
    readInChunks(ids, (c) => admin.from("bids").select(BID_COLS).in("opportunity_id", c)),
    readInChunks(firstIds, (c) => admin.from("bids").select(BID_COLS).in("from_job_id", c)),
  ]);
  const tickets = new Map<string, StepTicket>();
  for (const t of [...first, ...second]) tickets.set(t.id, t as StepTicket);
  const bids = new Map<string, StepBid>();
  for (const b of [...ownBids, ...ticketBids]) bids.set(b.id, b as StepBid);
  return { tickets: [...tickets.values()], bids: [...bids.values()] };
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
    const admin = await serverClient(sb);
    return openStepsByOpportunity(await chainRows(admin, oppIds));
  } catch (e) {
    console.error("Open steps could not be read:", e instanceof Error ? e.message : e);
    return new Map();
  }
}

/** The opportunity a ticket hangs under, or null. */
async function opportunityOf(
  admin: Client,
  from: { from_opportunity_id: string | null; from_job_id: string | null },
): Promise<string | null> {
  if (from.from_opportunity_id) return from.from_opportunity_id;
  if (!from.from_job_id) return null;
  const { data } = await admin
    .from("service_jobs")
    .select("from_opportunity_id")
    .eq("id", from.from_job_id)
    .maybeSingle();
  return data?.from_opportunity_id ?? null;
}

/**
 * A step was just finished: a ticket marked Done, or a bid submitted. When that leaves its
 * opportunity waiting on nothing, the opportunity's person is told and given two working days:
 * the follow-up day moves out to then (never in), its timer with it, and one line goes in the
 * opportunity's log. Best effort: the step is finished either way, and a failure here only
 * means the opportunity comes back on the day it already had.
 */
export async function afterStepDone(
  sb: Client,
  step: {
    kind: "ticket" | "bid";
    /** "inspection #6090", "bid Dock re-roof". */
    label: string;
    from_opportunity_id: string | null;
    from_job_id: string | null;
  },
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
    // Something else of this job is still open: the opportunity goes on waiting on that.
    const still = (await openStepsFor(admin, [oppId])).get(oppId) ?? [];
    if (still.length) return "still_waiting";

    const today = officeDay(now);
    const by = followUpAfterStep(today, opp.expected_close);
    if (by !== opp.expected_close) {
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
    const outcome = step.kind === "bid" ? "submitted" : "done";
    await admin.from("crm_contact_log").insert({
      kind: "opportunity",
      item_id: oppId,
      method: "note",
      note: `${step.label.charAt(0).toUpperCase()}${step.label.slice(1)} is ${outcome}. Follow up by ${dayText(by)}.`,
      by_user: actor.id,
      by_name: actor.name ?? "The site",
    });
    const words = stepDoneNotice({
      label: step.label,
      outcome,
      opportunity: opp.title,
      by: dayText(by),
    });
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

/**
 * The morning run: each opportunity that waits on a step whose day has just passed tells its
 * person, once (job-steps.ts stepLateOn; and never twice in a day, whoever runs the pass).
 * Returns how many people were told.
 */
export async function tellLateSteps(
  admin: Client,
  now: Date,
  names: (id: string | null) => string | null,
  notToldToday: (ids: string[], url: string) => Promise<string[]>,
): Promise<number> {
  const today = officeDay(now);
  const { data: opps, error } = await admin
    .from("crm_opportunities")
    .select("id, title, assignee_id, status")
    .is("deleted_at", null)
    .in("status", ["open", "contacted", "quoted"])
    .limit(2000);
  if (error) throw new Error(error.message);
  // Only an opportunity somebody has: there is nobody to tell of the others.
  const byId = new Map((opps ?? []).filter((o) => !!o.assignee_id).map((o) => [o.id, o]));
  const waiting = await openStepsFor(admin, [...byId.keys()]);
  let told = 0;
  for (const [oppId, steps] of waiting) {
    const opp = byId.get(oppId);
    const late = steps.find((s) => stepLateOn(s.date, today));
    if (!opp?.assignee_id || !late || !late.date) continue;
    // The person who has the late step hears of it from the step's own reminders.
    if (late.personId === opp.assignee_id) continue;
    const url = `/opportunities?id=${oppId}`;
    const to = await notToldToday([opp.assignee_id], url);
    if (!to.length) continue;
    const words = stepLateNotice({
      label: late.label,
      opportunity: opp.title,
      was: dayText(late.date),
      who: names(late.personId),
    });
    await notify(to, { kind: "followup", title: words.title, body: words.body, url }, admin);
    told++;
  }
  return told;
}
