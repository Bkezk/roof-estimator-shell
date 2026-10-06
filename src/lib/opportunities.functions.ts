/**
 * Opportunities — a potential new customer, or new work for one (design §11). Assigned to a
 * user with an expected close date; the follow-up timer (followups.server.ts) reminds them
 * until it is Won / Lost / No response.
 *
 * A deleted opportunity (deleted_at set) stays readable by id — an old `/opportunities?id=…`
 * link shows it with a "Deleted on <date>" banner, read-only — but nothing changes it: saving,
 * a status change, logging a contact, snoozing its follow-up are refused with OPP_DELETED
 * (audit, Oct 2: through an old link the status could be changed, a new follow-up started and
 * the assignee reminded about an opportunity the list hides). Deleting closes its open
 * follow-up; an admin or a manager may restore it (restoreOpportunity), which does not reopen
 * the follow-up (the next status change syncs a fresh one).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware.hardened";
import type { Database } from "@/integrations/supabase/types";
import { canAccess, seesEveryone } from "@/lib/access";
import { opportunityDateProblem } from "@/lib/ticket-date";
import { dateMoveNote, dateMoveProblem } from "@/lib/followup-rules";
import { LOG_NOTE_METHOD } from "@/lib/contact-log.functions";
import {
  assigneeProblem,
  OPP_CUSTOMER_REQUIRED,
  opportunityProblem,
  oppStatusProblem,
} from "@/lib/opportunity-form";
import { hasContactMethod } from "@/lib/crm-account";
import { addDays } from "@/lib/my-work";
import { localYmd as easternYmd } from "@/lib/tasks";

export type OpportunityRow = Database["public"]["Tables"]["crm_opportunities"]["Row"];
export const OPP_STATUSES = ["open", "contacted", "quoted", "won", "lost", "no_response"] as const;
export type OppStatus = (typeof OPP_STATUSES)[number];
export const OPP_STATUS_LABELS: Record<OppStatus, string> = {
  open: "Open",
  contacted: "Contacted",
  quoted: "Quoted",
  won: "Won",
  lost: "Lost",
  no_response: "No response",
};
export const OPP_CLOSING: readonly OppStatus[] = ["won", "lost", "no_response"];
/** The plain refusal for any change to a deleted opportunity. */
export const OPP_DELETED = "This opportunity was deleted";

export type OpportunityWithNames = OpportunityRow & {
  assignee_name: string | null;
  account_name: string | null;
  site_name: string | null;
  /** The linked bid's name (bid_id), when the caller may read it. */
  bid_name: string | null;
  /** After a save: what happened to the follow-up worth telling (SNOOZE_CLEARED_NOTE). */
  followup_note?: string | null;
};

type Ctx = { supabase: SupabaseClient<Database>; userId: string };
async function me(ctx: Ctx) {
  const { data } = await ctx.supabase
    .from("profiles")
    .select("role, access, full_name, email")
    .eq("id", ctx.userId)
    .maybeSingle();
  if (!data) throw new Error("Profile not found");
  return data;
}
const nameOf = (p: { full_name: string | null; email: string }) =>
  (p.full_name ?? "").trim() || p.email;

/**
 * Refuse a change to an opportunity that is gone: "Opportunity not found" when it cannot be read,
 * OPP_DELETED when it was deleted. Called before anything is written.
 */
export async function assertLiveOpportunity(sb: SupabaseClient<Database>, id: string) {
  const { data, error } = await sb
    .from("crm_opportunities")
    .select("id, deleted_at")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Opportunity not found");
  if (data.deleted_at) throw new Error(OPP_DELETED);
}

/**
 * The people an opportunity can be assigned to, and whose names the lists show: every user
 * (crm_user_options — SECURITY DEFINER; it answers anyone with Customers, Service or Estimate
 * access, i.e. everyone who may assign). It used to be technician_options, the Service roster,
 * which answers only Service users, so a Customers-only user got an empty assignee box and
 * nameless rows (audit, Oct 2).
 */
export interface AssigneeOption {
  id: string;
  name: string;
}
async function userOptions(sb: SupabaseClient<Database>): Promise<AssigneeOption[]> {
  const { data, error } = await sb.rpc("crm_user_options");
  if (error) throw new Error(error.message);
  return (data ?? []).map((u) => ({ id: u.id, name: (u.full_name ?? "").trim() || u.email }));
}

/** The assignee box and the "Also escalate to" picker (Admin › Reminders). */
export const listAssigneeOptions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AssigneeOption[]> =>
    (await userOptions(context.supabase)).sort((a, b) => a.name.localeCompare(b.name)),
  );

async function withNames(sb: SupabaseClient<Database>, rows: OpportunityRow[]) {
  const accountIds = [...new Set(rows.map((r) => r.account_id).filter((x): x is string => !!x))];
  const siteIds = [...new Set(rows.map((r) => r.site_id).filter((x): x is string => !!x))];
  const bidIds = [...new Set(rows.map((r) => r.bid_id).filter((x): x is string => !!x))];
  const [{ data: people }, { data: accounts }, { data: sites }, { data: bids }] = await Promise.all(
    [
      sb.rpc("crm_user_options"),
      accountIds.length
        ? sb.from("crm_accounts").select("id, name").in("id", accountIds)
        : Promise.resolve({ data: [] as { id: string; name: string }[] }),
      siteIds.length
        ? sb.from("crm_sites").select("id, name").in("id", siteIds)
        : Promise.resolve({ data: [] as { id: string; name: string }[] }),
      bidIds.length
        ? sb.from("bids").select("id, name").in("id", bidIds)
        : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    ],
  );
  const names = new Map<string, string>();
  for (const t of people ?? []) names.set(t.id, (t.full_name ?? "").trim() || t.email);
  // Anyone left (a user with no page grants sees only their own: profiles RLS lets them read
  // their own row).
  const missing = [
    ...new Set(rows.map((r) => r.assignee_id).filter((x): x is string => !!x && !names.has(x))),
  ];
  if (missing.length) {
    const { data: own } = await sb
      .from("profiles")
      .select("id, full_name, email")
      .in("id", missing);
    for (const t of own ?? []) names.set(t.id, (t.full_name ?? "").trim() || t.email);
  }
  const accs = new Map<string, string>();
  for (const a of accounts ?? []) accs.set(a.id, a.name);
  const siteNames = new Map<string, string>();
  for (const x of sites ?? []) siteNames.set(x.id, x.name);
  const bidNames = new Map<string, string>();
  for (const b of bids ?? []) bidNames.set(b.id, b.name);
  return rows.map((r) => ({
    ...r,
    assignee_name: r.assignee_id ? (names.get(r.assignee_id) ?? null) : null,
    account_name: r.account_id ? (accs.get(r.account_id) ?? null) : null,
    site_name: r.site_id ? (siteNames.get(r.site_id) ?? null) : null,
    bid_name: r.bid_id ? (bidNames.get(r.bid_id) ?? null) : null,
  })) as OpportunityWithNames[];
}

export const listOpportunities = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<OpportunityWithNames[]> => {
    const { data, error } = await context.supabase
      .from("crm_opportunities")
      .select("*")
      .is("deleted_at", null)
      .order("updated_at", { ascending: false })
      .limit(1000);
    if (error) throw new Error(error.message);
    return withNames(context.supabase, data ?? []);
  });

export const getOpportunity = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<OpportunityWithNames> => {
    const { data: row, error } = await context.supabase
      .from("crm_opportunities")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Opportunity not found");
    const [r] = await withNames(context.supabase, [row]);
    return r as OpportunityWithNames;
  });

export type OppEventRow = Database["public"]["Tables"]["crm_opportunity_events"]["Row"];

/**
 * The opportunity's log, oldest first: 'created', every change of status and of assignee —
 * written by the database (trigger crm_opportunities_log,
 * 20261001130000_opened_and_stage_dates.sql). Read under the opportunity's own rule (the table's
 * RLS: whoever reads the opportunity), so someone who cannot read it gets nothing.
 */
export const listOpportunityEvents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<OppEventRow[]> => {
    const { data: rows, error } = await context.supabase
      .from("crm_opportunity_events")
      .select("*")
      .eq("opportunity_id", data.id)
      .order("at", { ascending: true })
      .order("id", { ascending: true })
      .limit(500);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v == null || v === "" ? null : v));
const oppSchema = z.object({
  id: z.string().uuid().optional(),
  /** Required (owner, Oct 2); nullable here so a missing one gets the plain message. */
  account_id: z.string().uuid().nullable().optional(),
  /** The customer's site: required; the only live site is filled in when none is sent. */
  site_id: z.string().uuid().nullable().optional(),
  title: z.string().trim().min(1, "Title is required").max(200),
  description: optText(2000),
  assignee_id: z.string().uuid().nullable().optional(),
  expected_close: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  status: z.enum(OPP_STATUSES).optional(),
  lead_source: optText(120),
  est_value: z.number().finite().nonnegative().nullable().optional(),
  bid_id: z.string().uuid().nullable().optional(),
  notes: optText(10000),
});
export type OpportunityInput = z.input<typeof oppSchema>;

/**
 * Create (no id) or update. A new opportunity with no expected close gets today +
 * crm_settings.opportunity_close_days. The assignee is required (lib/opportunity-form.ts
 * assigneeProblem). So are the customer (OPP_CUSTOMER_REQUIRED), a way to reach them by the
 * customer rule, hasContactMethod (OPP_CUSTOMER_NO_CONTACT, for older data), and the site, which
 * is the customer's: one live site is filled in, several need one picked, none needs one added
 * (opportunityProblem; owner, Oct 2 — every save from now on; older rows still open). The
 * follow-up timer is synced after every save.
 */
export const saveOpportunity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => oppSchema.parse(d))
  .handler(async ({ data, context }): Promise<OpportunityWithNames> => {
    const p = await me(context);
    if (!canAccess(p, "customers") && !(data.assignee_id === context.userId || data.id))
      throw new Error("Forbidden: Customers access required");
    const sb = context.supabase;
    const { id, ...fields } = data;
    // A deleted opportunity is read-only (an old link still opens it).
    if (id) await assertLiveOpportunity(sb, id);
    // Every opportunity keeps a date (owner, Oct 1): an update may not clear it.
    const dateProblem = opportunityDateProblem({ id, expected_close: fields.expected_close });
    if (dateProblem) throw new Error(dateProblem);
    // Owner, Oct 1: someone always follows an opportunity up; an update may not clear it.
    const whoProblem = assigneeProblem({ id, assignee_id: fields.assignee_id });
    if (whoProblem) throw new Error(whoProblem);
    // Owner, Oct 2: every opportunity names its customer (reachable) and its site.
    const account_id = fields.account_id ?? null;
    if (!account_id) throw new Error(OPP_CUSTOMER_REQUIRED);
    const { data: acc, error: aErr } = await sb
      .from("crm_accounts")
      .select("id, email, phone, mobile")
      .eq("id", account_id)
      .maybeSingle();
    if (aErr) throw new Error(aErr.message);
    if (!acc) throw new Error("Customer not found");
    let site_id: string | null = null;
    let siteCount = 0;
    if (fields.site_id) {
      const { data: s, error: sErr } = await sb
        .from("crm_sites")
        .select("account_id")
        .eq("id", fields.site_id)
        .maybeSingle();
      if (sErr) throw new Error(sErr.message);
      if (!s || s.account_id !== account_id)
        throw new Error("That property does not belong to the customer");
      site_id = fields.site_id;
    } else {
      // The customer's live sites (the count is all of them; two rows are enough to read).
      const {
        data: live,
        count,
        error: lErr,
      } = await sb
        .from("crm_sites")
        .select("id", { count: "exact" })
        .eq("account_id", account_id)
        .is("deleted_at", null)
        .limit(2);
      if (lErr) throw new Error(lErr.message);
      siteCount = count ?? live?.length ?? 0;
      // One site: it is the one (the form picks it too).
      site_id = siteCount === 1 && live?.[0] ? live[0].id : null;
    }
    const customerProblem = opportunityProblem({
      account_id,
      site_id,
      siteCount,
      hasContact: hasContactMethod(acc),
    });
    if (customerProblem) throw new Error(customerProblem);
    // The stored expected close: once set, only an admin or a manager moves it (owner, Oct 1).
    let oldClose: string | null = null;
    let oldStatus: string | null = null;
    if (id) {
      const { data: cur, error: cErr } = await sb
        .from("crm_opportunities")
        .select("expected_close, status")
        .eq("id", id)
        .maybeSingle();
      if (cErr) throw new Error(cErr.message);
      oldClose = cur?.expected_close ?? null;
      oldStatus = cur?.status ?? null;
      const moveProblem = dateMoveProblem({
        profile: p,
        oldYmd: oldClose,
        newYmd: fields.expected_close,
      });
      if (moveProblem) throw new Error(moveProblem);
    }
    // Won / Lost / No response are a manager's (lib/opportunity-form.ts oppStatusProblem).
    const statusProblem = oppStatusProblem({ profile: p, from: oldStatus, to: fields.status });
    if (statusProblem) throw new Error(statusProblem);
    let expected = fields.expected_close ?? null;
    if (!id && !expected) {
      const { data: s } = await sb
        .from("crm_settings")
        .select("opportunity_close_days")
        .eq("id", 1)
        .maybeSingle();
      expected = defaultExpectedClose(s?.opportunity_close_days ?? 30);
    }
    const patch = {
      account_id,
      site_id,
      title: fields.title,
      description: fields.description ?? null,
      ...(fields.assignee_id ? { assignee_id: fields.assignee_id } : {}),
      // An update that leaves the date out keeps it (opportunityDateProblem: never cleared).
      ...(id && fields.expected_close === undefined ? {} : { expected_close: expected }),
      ...(fields.status ? { status: fields.status } : {}),
      lead_source: fields.lead_source ?? null,
      est_value: fields.est_value ?? null,
      // Left out = kept: the bid link is written by /estimate (linkBid), and a form opened
      // before it was linked must not clear it.
      ...(fields.bid_id === undefined ? {} : { bid_id: fields.bid_id }),
      notes: fields.notes ?? null,
      updated_by_name: nameOf(p),
    };
    let row: OpportunityRow;
    if (id) {
      const { data: r, error } = await sb
        .from("crm_opportunities")
        .update(patch)
        .eq("id", id)
        .is("deleted_at", null)
        .select("*")
        .maybeSingle();
      if (error) throw new Error(error.message);
      // Deleted between the check and the write, or not the caller's to change (RLS).
      if (!r) throw new Error("Opportunity not found, or not yours to change");
      row = r;
      // Every move goes in the contact log as a plain note (not a contact: it does not stamp
      // contacted_at — 20261001030000_followups_manager_only.sql). Best effort: already saved.
      const note = dateMoveNote("Expected close", oldClose, row.expected_close);
      if (note) {
        const { error: logErr } = await sb.from("crm_contact_log").insert({
          kind: "opportunity",
          item_id: row.id,
          method: LOG_NOTE_METHOD,
          note,
          by_user: context.userId,
          by_name: nameOf(p),
        });
        if (logErr) console.error("Could not log the expected close move", logErr.message);
      }
    } else {
      const { data: r, error } = await sb
        .from("crm_opportunities")
        .insert({ ...patch, created_by: context.userId })
        .select("*")
        .single();
      if (error) throw new Error(error.message);
      row = r;
    }
    const synced = await syncOppFollowup(row, oldStatus, context, nameOf(p));
    const [r] = await withNames(sb, [row]);
    return {
      ...(r as OpportunityWithNames),
      followup_note: synced === "snooze_cleared" ? SNOOZE_CLEARED_NOTE : null,
    };
  });

/** What the Save toast adds when the moved date cleared a running snooze (audit, Oct 2). */
export const SNOOZE_CLEARED_NOTE = "snooze cleared: the reminders follow the new date";

/**
 * A new opportunity's expected close when none is given: today + opportunity_close_days, today
 * being the office's day (America/New_York, lib/tasks.ts) — it was the UTC day, a day ahead
 * every evening after 8 pm Eastern (audit, Oct 2).
 */
export const defaultExpectedClose = (closeDays: number, now: Date = new Date()): string =>
  addDays(easternYmd(now), closeDays);

/** Is the opportunity open again after Won / Lost / No response? */
const isReopen = (from: string | null, to: string) =>
  !!from && OPP_CLOSING.includes(from as OppStatus) && !OPP_CLOSING.includes(to as OppStatus);

/** Keep the opportunity's follow-up in step after a save or a status change. */
async function syncOppFollowup(
  row: OpportunityRow,
  prevStatus: string | null,
  ctx: Ctx,
  actorName: string,
) {
  const { syncFollowup } = await import("@/lib/followups.server");
  return syncFollowup(
    {
      kind: "opportunity",
      itemId: row.id,
      accountId: row.account_id,
      assigneeId: row.assignee_id,
      title: row.title,
      url: `/opportunities?id=${row.id}`,
      closing: OPP_CLOSING.includes(row.status as OppStatus),
      closeReason: `status ${row.status}`,
      dueDate: row.expected_close,
      actorId: ctx.userId,
      actorName,
      reopened: isReopen(prevStatus, row.status),
    },
    ctx.supabase,
  );
}

export const setOpportunityStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z.object({ id: z.string().uuid(), status: z.enum(OPP_STATUSES) }).parse(d),
  )
  .handler(async ({ data, context }): Promise<void> => {
    const p = await me(context);
    await assertLiveOpportunity(context.supabase, data.id);
    const { data: cur, error: curErr } = await context.supabase
      .from("crm_opportunities")
      .select("status")
      .eq("id", data.id)
      .maybeSingle();
    if (curErr) throw new Error(curErr.message);
    const prevStatus = cur?.status ?? null;
    // Won / Lost / No response are a manager's (lib/opportunity-form.ts oppStatusProblem).
    const statusProblem = oppStatusProblem({ profile: p, from: prevStatus, to: data.status });
    if (statusProblem) throw new Error(statusProblem);
    const { data: row, error } = await context.supabase
      .from("crm_opportunities")
      .update({ status: data.status, updated_by_name: nameOf(p) })
      .eq("id", data.id)
      .is("deleted_at", null)
      .select("*")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Opportunity not found, or not yours to change");
    await syncOppFollowup(row, prevStatus, context, nameOf(p));
  });

/**
 * The live tickets started from this opportunity ("Start a ticket" writes
 * service_jobs.from_opportunity_id), oldest first, for the header's "Ticket #6004". Read under
 * the tickets' own RLS: someone without Service access gets none.
 */
export const listOpportunityTickets = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<{ id: string; number: number }[]> => {
    const { data: rows, error } = await context.supabase
      .from("service_jobs")
      .select("id, number")
      .eq("from_opportunity_id", data.id)
      .is("deleted_at", null)
      .order("number", { ascending: true })
      .limit(50);
    if (error) throw new Error(error.message);
    return (rows ?? []).map((r) => ({ id: r.id, number: r.number }));
  });

/**
 * "Start a bid" links back (audit, Oct 2: crm_opportunities.bid_id was never written). /estimate
 * calls this once the bid it opened with `?opportunity=<id>` is first saved. The caller must be
 * able to read both the opportunity (its RLS: Customers, Estimate, or the assignee) and the bid
 * (Estimate); an opportunity already linked to another bid keeps that link. The write itself is
 * the server's (an estimator without Customers access cannot update the opportunity under RLS).
 */
export const linkBid = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z.object({ opportunityId: z.string().uuid(), bidId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }): Promise<{ linked: boolean }> => {
    const sb = context.supabase;
    await assertLiveOpportunity(sb, data.opportunityId);
    const [{ data: opp, error: oErr }, { data: bid, error: bErr }] = await Promise.all([
      sb.from("crm_opportunities").select("id, bid_id").eq("id", data.opportunityId).maybeSingle(),
      sb.from("bids").select("id").eq("id", data.bidId).maybeSingle(),
    ]);
    if (oErr) throw new Error(oErr.message);
    if (bErr) throw new Error(bErr.message);
    if (!opp) throw new Error("Opportunity not found");
    if (!bid) throw new Error("Bid not found");
    if (opp.bid_id === data.bidId) return { linked: true };
    if (opp.bid_id) throw new Error("This opportunity is already linked to another bid");
    const { serverClient } = await import("@/lib/notify.server");
    const admin = await serverClient(sb);
    const p = await me(context);
    const { data: rows, error } = await admin
      .from("crm_opportunities")
      .update({ bid_id: data.bidId, updated_by_name: nameOf(p) })
      .eq("id", data.opportunityId)
      .is("bid_id", null)
      .select("id");
    if (error) throw new Error(error.message);
    return { linked: !!rows?.length };
  });

/**
 * Soft delete. Its open follow-up is closed in the same call (reason 'deleted', under the system
 * flag — syncFollowup), so no reminder goes out for it. A second delete changes nothing.
 */
export const deleteOpportunity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<void> => {
    const p = await me(context);
    if (!canAccess(p, "customers")) throw new Error("Forbidden: Customers access required");
    await assertLiveOpportunity(context.supabase, data.id);
    const { error } = await context.supabase
      .from("crm_opportunities")
      .update({ deleted_at: new Date().toISOString(), updated_by_name: nameOf(p) })
      .eq("id", data.id)
      .is("deleted_at", null);
    if (error) throw new Error(error.message);
    const { syncFollowup } = await import("@/lib/followups.server");
    await syncFollowup(
      {
        kind: "opportunity",
        itemId: data.id,
        accountId: null,
        assigneeId: null,
        title: "",
        url: "",
        closing: true,
        closeReason: "deleted",
        dueDate: null,
        actorId: context.userId,
        actorName: null,
      },
      context.supabase,
    );
  });

/**
 * Undo a delete: admins and managers only. Clears deleted_at; the follow-up closed by the delete
 * stays closed (the next save or status change syncs a fresh one).
 */
export const restoreOpportunity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<void> => {
    const p = await me(context);
    if (!seesEveryone(p)) throw new Error("Only an admin or a manager can restore an opportunity");
    const { data: rows, error } = await context.supabase
      .from("crm_opportunities")
      .update({ deleted_at: null, updated_by_name: nameOf(p) })
      .eq("id", data.id)
      .not("deleted_at", "is", null)
      .select("id");
    if (error) throw new Error(error.message);
    if (!rows?.length) throw new Error("This opportunity is not deleted");
  });
