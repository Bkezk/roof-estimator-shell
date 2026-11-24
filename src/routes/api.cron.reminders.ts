/**
 * POST /api/cron/reminders — fires the due follow-up reminders (notify.server.ts), the task
 * notices (tasks-notify.server.ts) and the "Bid due tomorrow" notices (bids-notify.server.ts;
 * owner, Oct 12). Called on a
 * schedule with `Authorization: Bearer <LOVABLE_CRON_SECRET>` (Lovable Cloud's cron, or the
 * GitHub Actions workflow .github/workflows/reminders.yml), and since Nov 13 by the database's
 * own timer twice an hour with a token of its own (cron-timer.ts; GitHub ran this job about
 * twice a day instead of twice an hour). The app also runs the same pass,
 * throttled, whenever an office user loads it, so reminders go out even with no cron set up.
 *
 * The passes are independent: the task and bid notices run whatever happened to the follow-ups.
 * The answer reports each ({ followups: {...} | { error }, tasks: {...} | { error }, bids: {...}
 * | { error } }). `ok` is
 * false when anything failed (a whole pass, or single sends, which are logged and recorded on
 * their rows); the status is 500 only when a whole pass could not run.
 *
 * This route alone stamps crm_settings.last_cron_at (stamp_cron, Oct 12): the app's own pass
 * stamps last_dispatch_at too, so Admin › Reminders could not tell whether the scheduled job was
 * running at all. `cron_stamped` in the answer says whether the stamp landed.
 */
import { createFileRoute } from "@tanstack/react-router";

import type { BidNoticeResult } from "@/lib/bids-notify.server";
import { authenticateCron } from "@/lib/cron-auth";
import { databaseTimerCheck } from "@/lib/cron-timer.server";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function run(request: Request): Promise<Response> {
  // The database's own timer may call this route too (cron-timer.ts); no other route takes it.
  const denied = await authenticateCron(request, { timer: databaseTimerCheck });
  if (denied) return denied;
  let notifyMod: typeof import("@/lib/notify.server");
  let supabaseAdmin: (typeof import("@/integrations/supabase/client.server"))["supabaseAdmin"];
  try {
    notifyMod = await import("@/lib/notify.server");
    if (!notifyMod.hasServiceRole())
      return Response.json(
        { ok: false, error: "SUPABASE_SERVICE_ROLE_KEY is not set on this server" },
        { status: 500 },
      );
    ({ supabaseAdmin } = await import("@/integrations/supabase/client.server"));
  } catch (e) {
    return Response.json({ ok: false, error: errText(e) }, { status: 500 });
  }
  const { dispatchDueReminders } = notifyMod;
  let passFailed = false;
  let sendsFailed = 0;

  let followups: Awaited<ReturnType<typeof dispatchDueReminders>> | { error: string };
  try {
    followups = await dispatchDueReminders(supabaseAdmin);
    sendsFailed += followups.failed;
  } catch (e) {
    passFailed = true;
    console.error("Cron reminders: the follow-up pass failed", e);
    followups = { error: errText(e) };
  }

  // Task notices (tasks-notify.server.ts): New task / due today / still open the day after.
  let tasks: Record<string, number> | { error: string };
  try {
    const { dispatchTaskNotices } = await import("@/lib/tasks-notify.server");
    const t = await dispatchTaskNotices(supabaseAdmin);
    sendsFailed += t.tasks_errors;
    tasks = t;
  } catch (e) {
    passFailed = true;
    console.error("Cron reminders: the task notice pass failed", e);
    tasks = { error: errText(e) };
  }

  // "Bid due tomorrow" (bids-notify.server.ts; owner, Oct 12): one notice per draft bid to
  // whoever started it, the day before its due date.
  let bids: BidNoticeResult | { error: string };
  try {
    const { dispatchBidDueNotices } = await import("@/lib/bids-notify.server");
    const b = await dispatchBidDueNotices(supabaseAdmin);
    sendsFailed += b.bids_errors;
    bids = b;
  } catch (e) {
    passFailed = true;
    console.error("Cron reminders: the bid due notice pass failed", e);
    bids = { error: errText(e) };
  }

  // "A Roof Care plan expired" (roof-care-notify.server.ts; owner, Nov 19): the admins and the
  // managers, once for each plan the morning run ended.
  let plans: Record<string, number> | { error: string };
  try {
    const { dispatchPlanExpiredNotices } = await import("@/lib/roof-care-notify.server");
    const p = await dispatchPlanExpiredNotices(supabaseAdmin);
    sendsFailed += p.plans_errors;
    plans = { ...p };
  } catch (e) {
    passFailed = true;
    console.error("Cron reminders: the Roof Care plan expired pass failed", e);
    plans = { error: errText(e) };
  }

  // "A Roof Care plan is signed and not paid" (owner, Nov 24): what a sign-up could not send,
  // and the reminder every two days while a plan still waits.
  let planPay: Record<string, number> | { error: string };
  try {
    const { dispatchPlanPayNotices } = await import("@/lib/roof-care-notify.server");
    const p = await dispatchPlanPayNotices(supabaseAdmin);
    sendsFailed += p.plans_errors;
    planPay = { ...p };
  } catch (e) {
    passFailed = true;
    console.error("Cron reminders: the Roof Care plan not paid pass failed", e);
    planPay = { error: errText(e) };
  }

  // A Roof Care customer's agreement and receipt (roof-care-email.server.ts; owner, Nov 19):
  // whatever was not sent where it was made. Held, and said so, while email is not set up.
  let planEmails: Record<string, number | string | null> | { error: string };
  try {
    const { dispatchPlanEmails } = await import("@/lib/roof-care-email.server");
    const e = await dispatchPlanEmails(supabaseAdmin);
    sendsFailed += e.email_errors;
    planEmails = { ...e };
  } catch (e) {
    passFailed = true;
    console.error("Cron reminders: the Roof Care plan email pass failed", e);
    planEmails = { error: errText(e) };
  }

  // The inspection tickets the site made for Roof Care plans (roof-care-ticket-announce.server.ts;
  // break test Nov 20, number 16): the morning run makes them in silence, so this run says
  // "Opened" and starts the timers, once for each ticket, one notice per person.
  let planTickets: Record<string, number> | { error: string };
  try {
    const { dispatchCareTicketAnnouncements } =
      await import("@/lib/roof-care-ticket-announce.server");
    const t = await dispatchCareTicketAnnouncements(supabaseAdmin);
    sendsFailed += t.tickets_errors;
    planTickets = { ...t };
  } catch (e) {
    passFailed = true;
    console.error("Cron reminders: the Roof Care ticket announcement pass failed", e);
    planTickets = { error: errText(e) };
  }

  // Requests sent from the two public pages (public-forms.server.ts; Nov 21): the office is told
  // where the request is made. This picks up any whose notice did not go out then, once each.
  let publicRequests: Record<string, number> | { error: string };
  try {
    const { dispatchPublicRequestNotices } = await import("@/lib/public-forms.server");
    const r = await dispatchPublicRequestNotices(supabaseAdmin);
    sendsFailed += r.requests_errors;
    publicRequests = { ...r };
  } catch (e) {
    passFailed = true;
    console.error("Cron reminders: the public request notice pass failed", e);
    publicRequests = { error: errText(e) };
  }

  // The scheduled run's own stamp (last_cron_at), after the passes, whatever they did: it says
  // the job runs, not that every send landed. Missing function = the Oct 12 migration is not
  // applied yet; logged, never a failure of the run.
  let cronStamped = false;
  try {
    const { error } = await (
      supabaseAdmin as unknown as {
        rpc: (fn: string) => Promise<{ error: { message: string } | null }>;
      }
    ).rpc("stamp_cron");
    if (error) throw new Error(error.message);
    cronStamped = true;
  } catch (e) {
    console.error("Cron reminders: could not stamp last_cron_at —", errText(e));
  }

  return Response.json(
    {
      ok: !passFailed && sendsFailed === 0,
      followups,
      tasks,
      bids,
      plans,
      plan_pay: planPay,
      plan_emails: planEmails,
      plan_tickets: planTickets,
      public_requests: publicRequests,
      cron_stamped: cronStamped,
      at: new Date().toISOString(),
    },
    { status: passFailed ? 500 : 200 },
  );
}

export const Route = createFileRoute("/api/cron/reminders")({
  server: {
    handlers: {
      POST: ({ request }) => run(request),
      GET: ({ request }) => run(request),
    },
  },
});
