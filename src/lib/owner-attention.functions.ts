/**
 * The Owner page's "Needs attention" list — the server side (src/lib/owner-attention.ts has the
 * rules). Admins only, the same rule as listOwnerView and listOwnerBusiness: the caller's own
 * profile row decides, never a flag from the client. Every read runs under the caller's client
 * (an admin reads everything by RLS); nothing is written.
 *
 * crm_untouched() is read defensively, as the Business tab reads it: when the rpc is missing or
 * refuses, those rows are left out and the list says so (`untouchedRead` false), never a guess.
 * The settings row is read whole, so the two limits of this list's own read as their defaults
 * until their migration (20261115120000_owner_attention_limits.sql) is applied.
 *
 * Every row is read (owner, Nov 16, audit fix 21). Each read used to stop at 1,000 rows in no
 * set order, so past 1,000 live rows some went missing without a word; now each pages by id to
 * its end (read-all.ts readAll, as the Owner view's counts do). The inspections' ids used to go
 * into one request's URL; now they go 100 at a time (chunk-ids.ts readInChunks). A chunk that
 * cannot be read still stops the whole list with its error, as before: a repair ticket or bid
 * left unread would put its inspection on the list wrongly.
 */
import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware.hardened";
import type { Database } from "@/integrations/supabase/types";
import {
  attentionLimits,
  attentionList,
  planRunsUnpaid,
  type AttBid,
  type AttFollowup,
  type AttInvoice,
  type AttOpp,
  type AttTicket,
  type AttUntouched,
  type AttentionList,
  type AttCareCardBack,
  type AttPublicRequest,
  type AttCareCarried,
  type AttCareExpired,
  type AttCareNoPayment,
  type AttCareSize,
  type AttCareRefund,
  type AttCareRenewal,
  type AttCareUnbilled,
  type AttCareUnpaid,
  type AttCareVisit,
} from "@/lib/owner-attention";
import type { PublicPlanKey } from "@/lib/public-forms";
import { requestAsk, requestFrom } from "@/lib/public-requests";
import { localYmd, TASK_TZ } from "@/lib/tasks";
import { readInChunks } from "@/lib/chunk-ids";
import {
  cardBackOf,
  cardBackWhy,
  EXPIRED_LISTED_DAYS,
  isExpired,
  payWords,
  planName,
  renewalOpen,
  runsLate,
  VISIT_LABEL,
  visitState,
  visitUnbilled,
} from "@/lib/roof-care-plan";
import { tripUnbilled } from "@/lib/roof-care-no-access";
import { plansOfSites } from "@/lib/roof-care-plan.functions";
import { visibleToOwner } from "@/lib/owner-view";
import { plusDays } from "@/lib/working-days";
import { PAGE, afterId, readAll } from "@/lib/read-all";
import { OPEN_OPP_STATUSES, parseTodayInput, viewerToday } from "@/lib/work-counts";

type Sb = SupabaseClient<Database>;

function must<T>(label: string, r: { data: T | null; error: { message: string } | null }): T {
  if (r.error) throw new Error(`${label}: ${r.error.message}`);
  return (r.data ?? []) as T;
}

const TICKET_COLUMNS =
  "id, number, customer_name, service_type, stage, stage_changed_at, completed_at, updated_at, created_at, scheduled_date, technician_id, inspection, inspection_outcome, inspection_outcome_at, inspection_outcome_by";

async function untouchedRows(sb: Sb): Promise<AttUntouched[] | null> {
  try {
    const { data, error } = await sb.rpc("crm_untouched");
    if (error || !Array.isArray(data)) return null;
    return data as AttUntouched[];
  } catch {
    return null;
  }
}

export const listOwnerAttention = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => parseTodayInput(d))
  .handler(async ({ data, context }): Promise<AttentionList> => {
    const sb = context.supabase;
    const { data: me, error: meErr } = await sb
      .from("profiles")
      .select("id, role")
      .eq("id", context.userId)
      .maybeSingle();
    if (meErr) throw new Error(meErr.message);
    if (!me || !visibleToOwner(me)) throw new Error("Forbidden: admin only");

    const now = new Date();
    const today = viewerToday(data.today, now);

    const [work, inspections, opps, bids, invoices, followups, settings, profiles, untouched] =
      await Promise.all([
        // The work still to be done or reviewed: Open / Scheduled / Done.
        readAll((after) =>
          afterId(
            sb
              .from("service_jobs")
              .select(TICKET_COLUMNS)
              .is("deleted_at", null)
              .in("stage", ["open", "scheduled", "done"])
              .order("id")
              .limit(PAGE),
            after,
          ),
        ),
        // Every finished inspection past Done (the Done ones are in the read above).
        readAll((after) =>
          afterId(
            sb
              .from("service_jobs")
              .select(TICKET_COLUMNS)
              .is("deleted_at", null)
              .not("inspection", "is", null)
              .in("stage", ["authorized", "invoiced", "closed"])
              .order("id")
              .limit(PAGE),
            after,
          ),
        ),
        readAll((after) =>
          afterId(
            sb
              .from("crm_opportunities")
              .select("id, title, status, assignee_id, created_at, expected_close")
              .is("deleted_at", null)
              .is("assignee_id", null)
              .in("status", [...OPEN_OPP_STATUSES])
              .order("id")
              .limit(PAGE),
            after,
          ),
        ),
        // Drafts and submitted bids; the legacy statuses fold into those two (bid-status.ts), so
        // only the finished ones are left out.
        readAll((after) =>
          afterId(
            sb
              .from("bids")
              .select(
                "id, name, kind, status, due_date, submitted_at, status_changed_at, updated_at, reminder_on, grand_total, created_by",
              )
              .is("deleted_at", null)
              .not("status", "in", "(won,accepted,lost,denied)")
              .order("id")
              .limit(PAGE),
            after,
          ),
        ),
        // invoice_date: an invoice with no due date is late 30 days after it (Nov 16, fix 11).
        readAll((after) =>
          afterId(
            sb
              .from("invoices")
              .select(
                "id, number, display_number, status, total, paid_amount, due_date, invoice_date, bill_to",
              )
              .eq("status", "final")
              .order("id")
              .limit(PAGE),
            after,
          ),
        ),
        readAll((after) =>
          afterId(
            sb
              .from("crm_followups")
              .select("id, kind, item_id, status, snoozed_until, assignee_id")
              .eq("status", "open")
              .order("id")
              .limit(PAGE),
            after,
          ),
        ),
        sb.from("crm_settings").select("*").eq("id", 1).maybeSingle(),
        readAll((after) =>
          afterId(
            sb.from("profiles").select("id, full_name, email").order("id").limit(PAGE),
            after,
          ),
        ),
        untouchedRows(sb),
      ]);

    const tickets = [
      ...must<AttTicket[]>("tickets", work),
      ...must<AttTicket[]>("inspections", inspections),
    ];
    // What came of each finished inspection: a live repair ticket or bid made from it. The ids
    // go 100 to a request, each read to its end; an error stops the list (see the top).
    const inspectionIds = tickets.filter((t) => !!t.inspection).map((t) => t.id);
    const [repairs, bidsFrom] = await Promise.all([
      readInChunks(inspectionIds, async (chunk) => ({
        data: must(
          "repair tickets",
          await readAll((after) =>
            afterId(
              sb
                .from("service_jobs")
                .select("id, from_job_id")
                .is("deleted_at", null)
                .in("from_job_id", chunk)
                .order("id")
                .limit(PAGE),
              after,
            ),
          ),
        ),
        error: null,
      })),
      readInChunks(inspectionIds, async (chunk) => ({
        data: must(
          "bids from inspections",
          await readAll((after) =>
            afterId(
              sb
                .from("bids")
                .select("id, from_job_id")
                .is("deleted_at", null)
                .in("from_job_id", chunk)
                .order("id")
                .limit(PAGE),
              after,
            ),
          ),
        ),
        error: null,
      })),
    ]);
    const fromIds = (rows: { from_job_id: string | null }[]) =>
      rows.map((r) => r.from_job_id).filter((id): id is string => !!id);

    if (settings.error) throw new Error(`settings: ${settings.error.message}`);
    const names: Record<string, string> = {};
    for (const p of must<{ id: string; full_name: string | null; email: string | null }[]>(
      "people",
      profiles,
    ))
      names[p.id] = (p.full_name ?? "").trim() || (p.email ?? "").trim();

    const care = await careVisitsOfPlans(sb, today);
    const cardBack = await careCardBackOwed(sb);
    const publicRequests = await publicRequestsWaiting(sb);
    return attentionList({
      today,
      now: now.toISOString(),
      limits: attentionLimits(settings.data),
      tickets,
      untouched,
      opps: must<AttOpp[]>("opportunities", opps),
      bids: must<AttBid[]>("bids", bids),
      invoices: must<AttInvoice[]>("invoices", invoices),
      followups: must<AttFollowup[]>("follow-ups", followups),
      repairFrom: fromIds(repairs),
      bidFrom: fromIds(bidsFrom),
      names,
      careVisits: care.notDone,
      careUnbilled: care.unbilled,
      careUnpaid: care.unpaid,
      careRefunds: care.refunds,
      careNoPayment: care.noPayment,
      careSizes: care.sizes,
      careCardBack: cardBack,
      publicRequests,
      careRenewals: care.renewals,
      careCarried: care.carried,
      careExpired: care.expired,
    });
  });

/**
 * The inspections of the Roof Care plans in force that the list has a rule for (owner, Nov 18
 * and 19): the ones still to do (the rule lists those past their last day, and those a
 * push-back carried past the plan year), and the ones done with their share of the plan on no
 * invoice.
 */
/**
 * Card money that has to go back to a customer and is not marked sent back (owner, Nov 20). The
 * plan it came in for may have ended long ago, so this is read on its own, not from the plans
 * in force.
 */
/**
 * Requests from the two public pages that nobody has matched or dismissed (Nov 21). Read with
 * the caller's sign-in: the Owner page's readers hold Customers access, which the table asks.
 */
export async function publicRequestsWaiting(sb: Sb): Promise<AttPublicRequest[]> {
  const read = await readAll((after) =>
    afterId(
      sb
        .from("public_requests")
        .select(
          "id, reference, kind, created_at, contact_name, company, plan, services, several_buildings, shown_price, opportunity_id",
        )
        .eq("status", "new")
        .order("id")
        .limit(PAGE),
      after,
    ),
  );
  if (read.error) throw new Error(`Requests from the public pages: ${read.error.message}`);
  const data = read.data;
  return (data ?? []).map((r) => ({
    id: r.id,
    reference: r.reference,
    from: requestFrom(r),
    ask: requestAsk({
      kind: r.kind === "care" ? "care" : "service",
      plan: (r.plan as PublicPlanKey | null) ?? null,
      services: r.services ?? [],
      several_buildings: r.several_buildings,
      shown_price: r.shown_price,
    }),
    kind: r.kind === "care" ? "care" : "service",
    sent_on: localYmd(new Date(r.created_at), TASK_TZ),
    opportunity_id: r.opportunity_id,
  }));
}

export async function careCardBackOwed(sb: Sb): Promise<AttCareCardBack[]> {
  const { data: cards, error } = await sb
    .from("roof_care_card_payments")
    .select(
      "id, plan_id, outcome, reason, amount, over, owed, ref, paid_on, sent_back_on, sent_back_ref, sent_back_by_name",
    )
    .is("sent_back_on", null)
    .order("paid_on", { ascending: true });
  if (error) throw new Error(`Roof Care card payments: ${error.message}`);
  const owed = (cards ?? []).flatMap((c) => {
    const back = cardBackOf(c);
    return back ? [{ plan_id: c.plan_id, back }] : [];
  });
  if (!owed.length) return [];
  const plans = await readInChunks([...new Set(owed.map((o) => o.plan_id))], (chunk) =>
    sb.from("roof_care_plans").select("id, plan, site_id, account_id").in("id", chunk),
  );
  const [sites, accounts] = await Promise.all([
    readInChunks([...new Set(plans.map((p) => p.site_id))], (chunk) =>
      sb.from("crm_sites").select("id, name").in("id", chunk),
    ),
    readInChunks([...new Set(plans.map((p) => p.account_id))], (chunk) =>
      sb.from("crm_accounts").select("id, name").in("id", chunk),
    ),
  ]);
  const planOf = new Map(plans.map((p) => [p.id, p]));
  const siteName = new Map(sites.map((x) => [x.id, (x.name ?? "").trim()]));
  const accountName = new Map(accounts.map((x) => [x.id, (x.name ?? "").trim()]));
  return owed.flatMap(({ plan_id, back }) => {
    const p = planOf.get(plan_id);
    if (!p) return [];
    const where = [siteName.get(p.site_id), accountName.get(p.account_id)].filter(Boolean);
    return [
      {
        payment_id: back.id,
        site_id: p.site_id,
        title: `${planName(p.plan)} · ${where[0] ?? "Property"}${where[1] ? ` (${where[1]})` : ""}`,
        amount: back.owed,
        ref: back.ref,
        paid_on: back.paid_on,
        why: cardBackWhy(back),
      },
    ];
  });
}

async function careVisitsOfPlans(
  sb: Sb,
  today: string,
): Promise<{
  notDone: AttCareVisit[];
  unbilled: AttCareUnbilled[];
  unpaid: AttCareUnpaid[];
  refunds: AttCareRefund[];
  noPayment: AttCareNoPayment[];
  sizes: AttCareSize[];
  renewals: AttCareRenewal[];
  carried: AttCareCarried[];
  expired: AttCareExpired[];
}> {
  const { data: active, error } = await sb
    .from("roof_care_plans")
    .select("site_id")
    .in("status", ["active", "awaiting_payment"]);
  if (error) throw new Error(`Roof Care plans: ${error.message}`);
  // Ended early with a refund not yet sent (Nov 19).
  const { data: owed, error: oErr } = await sb
    .from("roof_care_plans")
    .select("id, plan, site_id, account_id, ended_on, refund_due")
    .eq("status", "ended")
    .gt("refund_due", 0)
    .is("refund_sent_on", null);
  if (oErr) throw new Error(`Roof Care plans: ${oErr.message}`);
  // Expired in the last 60 days (Nov 19).
  const { data: ran, error: rErr } = await sb
    .from("roof_care_plans")
    .select("site_id")
    .eq("status", "ended")
    .eq("ended_reason", "Expired")
    .gte("ended_on", plusDays(today, -EXPIRED_LISTED_DAYS));
  if (rErr) throw new Error(`Roof Care plans: ${rErr.message}`);
  const siteIds = [
    ...new Set([
      ...(active ?? []).map((p) => p.site_id),
      ...(owed ?? []).map((p) => p.site_id),
      ...(ran ?? []).map((p) => p.site_id),
    ]),
  ];
  if (!siteIds.length)
    return {
      notDone: [],
      unbilled: [],
      unpaid: [],
      refunds: [],
      noPayment: [],
      sizes: [],
      renewals: [],
      carried: [],
      expired: [],
    };
  const all = await plansOfSites(sb, siteIds, { money: true, noAccess: true });
  const live = all.filter((p) => p.status !== "ended");
  // An expired plan is the office's to chase unless the property has a plan in force or waiting.
  // One a manager closed out is done with.
  const ranOut = all.filter(
    (p) => isExpired(p) && !p.closed_out && !live.some((x) => x.site_id === p.site_id),
  );
  const plans = live.filter((p) => p.status === "active");
  const [sites, accounts] = await Promise.all([
    readInChunks(siteIds, (chunk) => sb.from("crm_sites").select("id, name").in("id", chunk)),
    readInChunks(
      [
        ...new Set([
          ...live.map((p) => p.account_id),
          ...ranOut.map((p) => p.account_id),
          ...(owed ?? []).map((p) => p.account_id),
        ]),
      ],
      (chunk) => sb.from("crm_accounts").select("id, name").in("id", chunk),
    ),
  ]);
  const siteName = new Map(sites.map((x) => [x.id, (x.name ?? "").trim()]));
  const accountName = new Map(accounts.map((x) => [x.id, (x.name ?? "").trim()]));
  const notDone: AttCareVisit[] = [];
  const unbilled: AttCareUnbilled[] = [];
  const titleOf = (p: { plan: unknown; site_id: string; account_id: string }) => {
    const where = [siteName.get(p.site_id), accountName.get(p.account_id)].filter(Boolean);
    return `${planName(p.plan)} · ${where[0] ?? "Property"}${where[1] ? ` (${where[1]})` : ""}`;
  };
  // Signed and waiting for its payment (Nov 19).
  const unpaid: AttCareUnpaid[] = live
    .filter((p) => p.status === "awaiting_payment")
    .map((p) => ({
      plan_id: p.id,
      site_id: p.site_id,
      title: titleOf(p),
      signed_on: p.signed_on,
      // What is left to pay: a renewal can have half taken off.
      price: Math.max(0, p.price - p.renewal_credit),
      invoice: p.invoice
        ? {
            id: p.invoice.id,
            number: p.invoice.number,
            status: p.invoice.status,
            paid_amount: p.invoice.paid_amount,
          }
        : null,
      pay: payWords(p.pay_method, p.pay_note),
      renewal: !!p.renewed_from,
    }));
  // The last 60 days of a plan year (Nov 19): what is still owed, and whether the renewal is
  // made. One the renewal took half off for is no longer owed.
  const renewalOf = new Map(
    live
      .filter((p) => p.status === "awaiting_payment" && p.renewed_from)
      .map((p) => [p.renewed_from!, p]),
  );
  const renewals: AttCareRenewal[] = [];
  const carried: AttCareCarried[] = [];
  const refunds: AttCareRefund[] = (owed ?? []).map((p) => ({
    plan_id: p.id,
    site_id: p.site_id,
    title: titleOf(p),
    ended_on: p.ended_on,
    amount: Number(p.refund_due) || 0,
  }));
  // In force with nothing paid toward it (Nov 20). A plan paid for the year before it starts
  // only: one signed before that was billed at each inspection. A manager's free year owes
  // nothing and is left out.
  const noPayment: AttCareNoPayment[] = plans
    .filter((p) => planRunsUnpaid(p))
    .map((p) => ({
      plan_id: p.id,
      site_id: p.site_id,
      title: titleOf(p),
      starts_on: p.starts_on,
      price: Math.max(0, p.price - p.renewal_credit),
      invoice: p.invoice
        ? { id: p.invoice.id, number: p.invoice.number, status: p.invoice.status }
        : null,
    }));
  // Priced on a size typed by hand that nobody checked (Nov 20): in force or waiting.
  const sizes: AttCareSize[] = live
    .filter((p) => p.size?.unchecked)
    .map((p) => ({
      plan_id: p.id,
      site_id: p.site_id,
      title: titleOf(p),
      roof_sqft: p.roof_sqft,
      signed_on: p.signed_on,
    }));
  for (const p of plans) {
    const title = titleOf(p);
    const last = [...p.visits].filter((v) => v.kind === "visit1" || v.kind === "visit2").pop();
    if (renewalOpen(p, today)) {
      const renewal = renewalOf.get(p.id) ?? null;
      const owed =
        renewal?.renewal_choice === "half_off"
          ? 0
          : p.visits.filter(
              (v) =>
                (v.kind === "visit1" || v.kind === "visit2") && visitState(v, today) !== "done",
            ).length;
      renewals.push({
        plan_id: p.id,
        site_id: p.site_id,
        title,
        renews_on: p.renews_on,
        owed,
        renewed: !!renewal,
        price: p.price,
      });
    }
    // A charged return trip after a visit with no access (Nov 19, late): its inspection is
    // signed off and the charge is on no invoice.
    for (const n of p.no_access ?? []) {
      const ticket = p.visits.find((v) => v.id === n.visit_id)?.ticket ?? null;
      if (ticket && tripUnbilled(n, ticket.stage))
        unbilled.push({
          visit_id: `trip:${n.id}`,
          job_id: ticket.id,
          number: ticket.number,
          title,
          label: "Return trip after no access",
          amount: n.amount ?? 0,
          since: ticket.completed_at,
          trip: true,
        });
    }
    for (const v of p.visits) {
      // One carried from last plan year has its own row, with its last day; a lost one is over.
      if (v.kind === "carried") {
        const state = visitState(v, today);
        if (state !== "done" && state !== "lost")
          carried.push({ visit_id: v.id, site_id: p.site_id, title, due_by: v.due_by });
        continue;
      }
      if (visitState(v, today) === "done") {
        if (visitUnbilled(v) && v.ticket)
          unbilled.push({
            visit_id: v.id,
            job_id: v.ticket.id,
            number: v.ticket.number,
            title,
            label: VISIT_LABEL[v.kind],
            amount: v.amount,
            since: v.ticket.completed_at,
          });
        continue;
      }
      notDone.push({
        visit_id: v.id,
        site_id: p.site_id,
        title,
        label: VISIT_LABEL[v.kind],
        due_by: v.due_by,
        amount: v.amount,
        pastPlanYear: runsLate(p) && v.id === last?.id,
      });
    }
  }
  const expired: AttCareExpired[] = ranOut.map((p) => ({
    plan_id: p.id,
    site_id: p.site_id,
    title: titleOf(p),
    expired_on: p.ended_on ?? p.renews_on,
    owed: p.visits.filter(
      (v) => (v.kind === "visit1" || v.kind === "visit2") && visitState(v, today) !== "done",
    ).length,
    price: p.price,
  }));
  return { notDone, unbilled, unpaid, refunds, noPayment, sizes, renewals, carried, expired };
}
