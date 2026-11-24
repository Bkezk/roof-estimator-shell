/**
 * "A Roof Care plan expired" — SERVER ONLY (uses notify.server.ts; load it with
 * `await import("@/lib/roof-care-notify.server")` inside a handler, as the bid notices are).
 *
 * The owner, Nov 19: "we need to be notified … when a plan expires so we can reach out to
 * renew". The database's morning run ends a plan whose twelve months are over as "Expired"
 * (roof_care_expire, 20261119900000_roof_care_expiry.sql). This pass tells the admins and the
 * managers once for each such plan, with a link to the property, where it is renewed.
 *
 * Each plan is claimed before anything is sent, as the bid notices are: one conditional update
 * stamps expiry_notified_at only where it is still empty, so the scheduled run and an office
 * user's page load at once send one notice between them. A send that fails puts the stamp back.
 * Nothing goes out before 8:00 on the office's clock, nor on a Saturday or Sunday (owner, Nov
 * 13 and 18): a plan that ran out on a weekend is told on Monday. A plan that expired more than
 * two weeks ago is not told at all: it would be old news.
 */
import { databaseRpc } from "@/lib/database-rpc";
import { shortDay } from "@/lib/followup-rules";
import { notify, serverClient, type Client } from "@/lib/notify.server";
import { exceptActor } from "@/lib/own-notices.server";
import {
  PLAN_CARD_WAIT_MINUTES,
  PLAN_PAY_REMIND_DAYS,
  planNeedsPaymentNotice,
} from "@/lib/roof-care-pay-notice";
import { planName } from "@/lib/roof-care-plan";
import { localYmd, TASK_TZ } from "@/lib/tasks";
import { isWeekend, morningReached, plusDays } from "@/lib/working-days";

export const PLAN_EXPIRED_KIND = "plan_expired";
/** A plan that ran out longer ago than this is not told. */
export const PLAN_EXPIRED_TELL_DAYS = 14;

export interface PlanExpiredResult {
  plans_checked: number;
  plans_notified: number;
  /** Claimed by another pass first: nothing sent. */
  plans_skipped: number;
  plans_errors: number;
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The words of the notice. */
export function planExpiredNotice(p: {
  plan: unknown;
  site_id: string;
  ended_on: string | null;
  site: string | null;
  account: string | null;
}) {
  const where = [p.site, p.account].map((x) => (x ?? "").trim()).filter(Boolean);
  const place = where.length ? `${where[0]}${where[1] ? ` (${where[1]})` : ""}` : "a property";
  return {
    kind: PLAN_EXPIRED_KIND,
    title: `${planName(p.plan)} plan expired: ${place}`,
    body: `Its plan year ended${p.ended_on ? ` ${shortDay(p.ended_on)}` : ""}. The minor repairs and leak calls it included have stopped. Reach out to renew it: open the property and press Renew for another year.`,
    url: `/properties/${p.site_id}`,
  };
}

export async function dispatchPlanExpiredNotices(
  sb: Client,
  now: Date = new Date(),
): Promise<PlanExpiredResult> {
  const out: PlanExpiredResult = {
    plans_checked: 0,
    plans_notified: 0,
    plans_skipped: 0,
    plans_errors: 0,
  };
  const today = localYmd(now, TASK_TZ);
  if (!morningReached(now) || isWeekend(today)) return out;
  const admin = await serverClient(sb);
  const { data: plans, error } = await admin
    .from("roof_care_plans")
    .select("id, plan, site_id, account_id, ended_on")
    .eq("status", "ended")
    .eq("ended_reason", "Expired")
    .is("expiry_notified_at", null)
    .gte("ended_on", plusDays(today, -PLAN_EXPIRED_TELL_DAYS))
    .limit(200);
  if (error) throw new Error(error.message);
  out.plans_checked = plans?.length ?? 0;
  if (!plans?.length) return out;
  const { data: people, error: pErr } = await admin
    .from("profiles")
    .select("id, role")
    .in("role", ["admin", "manager"]);
  if (pErr) throw new Error(pErr.message);
  const to = (people ?? []).map((p) => p.id);
  const [{ data: sites }, { data: accounts }] = await Promise.all([
    admin
      .from("crm_sites")
      .select("id, name")
      .in("id", [...new Set(plans.map((p) => p.site_id))]),
    admin
      .from("crm_accounts")
      .select("id, name")
      .in("id", [...new Set(plans.map((p) => p.account_id))]),
  ]);
  const siteName = new Map((sites ?? []).map((s) => [s.id, s.name]));
  const accountName = new Map((accounts ?? []).map((a) => [a.id, a.name]));
  const stamp = now.toISOString();
  for (const p of plans) {
    // Claim: stamped only where it is still empty.
    const { data: won, error: cErr } = await admin
      .from("roof_care_plans")
      .update({ expiry_notified_at: stamp })
      .eq("id", p.id)
      .is("expiry_notified_at", null)
      .select("id");
    if (cErr) {
      out.plans_errors++;
      console.error(`Plan expired notice: plan ${p.id} could not be claimed —`, cErr.message);
      continue;
    }
    if (!won?.length) {
      out.plans_skipped++;
      continue;
    }
    try {
      await notify(
        to,
        planExpiredNotice({
          ...p,
          site: siteName.get(p.site_id) ?? null,
          account: accountName.get(p.account_id) ?? null,
        }),
        admin,
      );
      out.plans_notified++;
    } catch (e) {
      out.plans_errors++;
      console.error(`Plan expired notice: plan ${p.id} —`, errText(e));
      // Put back for the next pass, only where the row still carries this pass's stamp.
      await admin
        .from("roof_care_plans")
        .update({ expiry_notified_at: null })
        .eq("id", p.id)
        .eq("expiry_notified_at", stamp);
    }
  }
  return out;
}

// ── Signed and not paid (owner, Nov 24; roof-care-pay-notice.ts) ────────────────────────────

export interface PlanPayNoticeResult {
  plans_notified: number;
  plans_errors: number;
}

/**
 * Tell the admins and the managers about plans that wait for their payment.
 *
 * With `planId`: that plan's first notice, at once (the sign-up just happened; the person who
 * signed it is told only with "My own changes" on). A card plan is not told here: the database
 * holds it back while the customer is at the card screen. Without `planId`: the pass. At any
 * hour it sends the notice of a sign-up that has not gone out, a card plan's once
 * PLAN_CARD_WAIT_MINUTES have gone by with no payment. The reminder every
 * PLAN_PAY_REMIND_DAYS days goes only from 8:00 on the office's clock on a working day, as
 * every reminder does.
 *
 * The database claims each plan before anything is sent (roof_care_pay_notice_claim), so two
 * passes at once send one notice between them. A send that fails puts the stamp back.
 */
export async function dispatchPlanPayNotices(
  sb: Client,
  opts: { planId?: string; actorId?: string | null; now?: Date } = {},
): Promise<PlanPayNoticeResult> {
  const out: PlanPayNoticeResult = { plans_notified: 0, plans_errors: 0 };
  const now = opts.now ?? new Date();
  const reminders = !opts.planId && morningReached(now) && !isWeekend(localYmd(now, TASK_TZ));
  const admin = await serverClient(sb);
  const { data: plans, error } = await databaseRpc(admin)("roof_care_pay_notice_claim", {
    p_plan: opts.planId ?? null,
    p_days: PLAN_PAY_REMIND_DAYS,
    p_reminders: reminders,
    p_card_wait: PLAN_CARD_WAIT_MINUTES,
  });
  if (error) throw new Error(error.message);
  if (!plans?.length) return out;
  const release = async (p: { plan_id: string; was: string | null }) => {
    const { error: rErr } = await databaseRpc(admin)("roof_care_pay_notice_release", {
      p_plan: p.plan_id,
      p_was: p.was,
    });
    if (rErr)
      console.error(`Plan not paid notice: plan ${p.plan_id} was not put back —`, rErr.message);
  };
  const { data: people, error: pErr } = await admin
    .from("profiles")
    .select("id, role")
    .in("role", ["admin", "manager"]);
  if (pErr) {
    for (const p of plans) await release(p);
    throw new Error(pErr.message);
  }
  const everyone = (people ?? []).map((p) => p.id);
  for (const p of plans) {
    try {
      const to = p.first ? await exceptActor(everyone, opts.actorId, admin) : everyone;
      if (to.length) await notify(to, planNeedsPaymentNotice(p), admin);
      out.plans_notified++;
    } catch (e) {
      out.plans_errors++;
      console.error(`Plan not paid notice: plan ${p.plan_id} —`, errText(e));
      await release(p);
    }
  }
  return out;
}

/** The first notice of one plan, right after its sign-up. Never throws: the sign-up stands. */
export async function tellPlanSignedNotPaid(
  sb: Client,
  planId: string,
  actorId: string,
): Promise<void> {
  try {
    await dispatchPlanPayNotices(sb, { planId, actorId });
  } catch (e) {
    console.error(`Plan not paid notice: plan ${planId} —`, errText(e));
  }
}
