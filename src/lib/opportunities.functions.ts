/**
 * Opportunities — a potential new customer, or new work for one (design §11). Assigned to a
 * user with an expected close date; the follow-up timer (followups.server.ts) reminds them
 * until it is Won / Lost / No response. Any status is set by whoever may edit the opportunity
 * (owner, Oct 12; the closing ones were a manager's from Oct 2) — the status log says who. A
 * linked bid drives the status one way (syncOpportunityFromBid): submitted → quoted, won → won,
 * lost → lost; the opportunity's own status never changes the bid.
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
import { CLAIM_NEEDS_TICK, CLAIM_TAKEN, canAccess, canClaim, seesEveryone } from "@/lib/access";
import { opportunityDateProblem } from "@/lib/ticket-date";
import { dateMoveNote, dateMoveProblem } from "@/lib/followup-rules";
import { CONTACT_METHODS, LOG_NOTE_METHOD } from "@/lib/contact-log.functions";
import { assigneeProblem, OPP_CUSTOMER_REQUIRED, opportunityProblem } from "@/lib/opportunity-form";
import { hasContactMethod } from "@/lib/crm-account";
import { type MentionOutcome, NO_MENTIONS } from "@/lib/mentions";
import { addDays } from "@/lib/my-work";
import { OPEN_OPP_STATUSES } from "@/lib/work-counts";
import { localYmd as easternYmd } from "@/lib/tasks";
import { oppStatusFromBid } from "@/lib/bid-status";

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

/** One contact from the log, as the list row shows it. */
export interface LastContact {
  method: string;
  at: string;
  by_name: string | null;
  note: string | null;
}

export type OpportunityWithNames = OpportunityRow & {
  assignee_name: string | null;
  account_name: string | null;
  site_name: string | null;
  /** The linked bid's name (bid_id), when the caller may read it. */
  bid_name: string | null;
  /** The linked bid's status (draft / submitted / won / lost), when the caller may read it. */
  bid_status: string | null;
  /** The linked bid's grand total as last saved. */
  bid_grand_total: number | null;
  /** When the linked bid was first submitted (bids.submitted_at), if it was. */
  bid_submitted_at: string | null;
  /**
   * The open follow-up's snoozed_until when it is on hold (owner, Oct 13): the list row, the
   * header and the Customers strip read "on hold until …" instead of Overdue until that day
   * (work-counts.ts isOppHeld). Null when there is no hold or the caller cannot read follow-ups.
   */
  hold_until: string | null;
  /** The open follow-up's next reminder (owner, Nov 4: the list row); null without one. */
  next_remind_at: string | null;
  /** The latest contact logged (called / texted / emailed / visited / other), or null. */
  last_contact: LastContact | null;
  /** After a save: what happened to the follow-up worth telling (SNOOZE_CLEARED_NOTE). */
  followup_note?: string | null;
  /** After a save: how many people the Notes' @mentions told (owner, Oct 14). */
  mentioned?: number;
  /** After a save: why the people named in Notes were not told; null when they were. */
  mention_error?: string | null;
};

type Ctx = { supabase: SupabaseClient<Database>; userId: string };
/**
 * The caller's profile as the rules read it. `technician` is what canClaim needs (Oct 20: it was
 * left out, so claimOpportunity answered CLAIM_NEEDS_TICK to everyone — the test passed because
 * the fake client returned whole rows whatever was selected; it projects columns now).
 */
async function me(ctx: Ctx) {
  const { data } = await ctx.supabase
    .from("profiles")
    .select("role, access, technician, full_name, email")
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
      bidIds.length ? linkedBids(sb, bidIds) : Promise.resolve({ data: [] as LinkedBid[] }),
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
  const bidRows = new Map<string, LinkedBid>();
  for (const b of bids ?? []) bidRows.set(b.id, b);
  // The open follow-ups: each opportunity's hold (snoozed_until; owner, Oct 13) and next
  // reminder (owner, Nov 4: the list row says when the assignee is next reminded). Best effort —
  // a caller who cannot read follow-ups sees neither, never an error.
  const holds = new Map<string, string>();
  const nextRemind = new Map<string, string>();
  // The latest contact per opportunity (owner, Nov 4: "Last contact: Called Nov 4 …" on the
  // list row — the one question the list is for is who still needs a call). Contacts only
  // (called / texted / emailed / visited / other), not notes, comments or "Service done".
  const lastContact = new Map<string, LastContact>();
  if (rows.length) {
    const ids = rows.map((r) => r.id);
    const [{ data: open }, { data: contacts }] = await Promise.all([
      sb
        .from("crm_followups")
        .select("item_id, snoozed_until, next_remind_at")
        .eq("kind", "opportunity")
        .eq("status", "open")
        .in("item_id", ids)
        .limit(1000),
      sb
        .from("crm_contact_log")
        .select("item_id, method, at, by_name, note")
        .eq("kind", "opportunity")
        .in("method", [...CONTACT_METHODS])
        .in("item_id", ids)
        .order("at", { ascending: false })
        .limit(2000),
    ]);
    for (const h of open ?? []) {
      if (h.snoozed_until) holds.set(h.item_id, h.snoozed_until);
      if (h.next_remind_at) nextRemind.set(h.item_id, h.next_remind_at);
    }
    // The newest row per item (the read is newest first, so the cap keeps the recent ones; the
    // comparison does not lean on the order).
    for (const c of contacts ?? []) {
      const prev = lastContact.get(c.item_id);
      if (!prev || c.at > prev.at)
        lastContact.set(c.item_id, {
          method: c.method,
          at: c.at,
          by_name: c.by_name,
          note: c.note,
        });
    }
  }
  return rows.map((r) => {
    const bid = r.bid_id ? bidRows.get(r.bid_id) : undefined;
    return {
      ...r,
      hold_until: holds.get(r.id) ?? null,
      next_remind_at: nextRemind.get(r.id) ?? null,
      last_contact: lastContact.get(r.id) ?? null,
      assignee_name: r.assignee_id ? (names.get(r.assignee_id) ?? null) : null,
      account_name: r.account_id ? (accs.get(r.account_id) ?? null) : null,
      site_name: r.site_id ? (siteNames.get(r.site_id) ?? null) : null,
      bid_name: bid?.name ?? null,
      bid_status: bid?.status ?? null,
      bid_grand_total: bid ? Number(bid.grand_total ?? 0) : null,
      bid_submitted_at: bid?.submitted_at ?? null,
    };
  }) as OpportunityWithNames[];
}

/** What the opportunity page and list show of the linked bid (the bid card, the status chip). */
interface LinkedBid {
  id: string;
  name: string;
  status: string | null;
  grand_total: number | null;
  submitted_at: string | null;
}
/**
 * The linked bids: name, status, total and when first submitted (owner, Oct 12). Before
 * 20261012100000 adds bids.submitted_at the named read fails (42703); then the columns that exist.
 */
async function linkedBids(sb: SupabaseClient<Database>, ids: string[]) {
  const full = await sb
    .from("bids")
    .select("id, name, status, grand_total, submitted_at")
    .in("id", ids);
  if (!full.error) return { data: (full.data ?? []) as LinkedBid[] };
  if (full.error.code !== "42703") throw new Error(full.error.message);
  const { data, error } = await sb
    .from("bids")
    .select("id, name, status, grand_total")
    .in("id", ids);
  if (error) throw new Error(error.message);
  return { data: (data ?? []).map((b) => ({ ...b, submitted_at: null })) as LinkedBid[] };
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
  // Left out = kept (owner, Nov 4: the form has no Notes box any more — what the next person
  // should know goes on the timeline; notes saved before stay as they are).
  notes: z
    .string()
    .trim()
    .max(10000)
    .nullable()
    .optional()
    .transform((v) => (v === undefined ? undefined : v === null || v === "" ? null : v)),
});
export type OpportunityInput = z.input<typeof oppSchema>;

/**
 * Create (no id) or update. A new opportunity with no expected close gets today +
 * crm_settings.opportunity_close_days. The assignee is optional since Oct 7 (the front desk logs
 * a call with nobody on it; Work Overview lists it under Unassigned — lib/opportunity-form.ts
 * assigneeProblem). Required are the customer (OPP_CUSTOMER_REQUIRED), a way to reach them by the
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
    let oldNotes: string | null = null;
    if (id) {
      const { data: cur, error: cErr } = await sb
        .from("crm_opportunities")
        .select("expected_close, status, notes")
        .eq("id", id)
        .maybeSingle();
      if (cErr) throw new Error(cErr.message);
      oldClose = cur?.expected_close ?? null;
      oldStatus = cur?.status ?? null;
      oldNotes = cur?.notes ?? null;
      const moveProblem = dateMoveProblem({
        profile: p,
        oldYmd: oldClose,
        newYmd: fields.expected_close,
      });
      if (moveProblem) throw new Error(moveProblem);
    }
    // Any status is the editor's to set (owner, Oct 12; Won / Lost / No response were a
    // manager's from Oct 2): the log says who.
    let expected = fields.expected_close ?? null;
    if (!id && !expected) {
      // Admin › Reminders' close window through `opportunity_close_days()` (20261020120000:
      // crm_settings itself is an admin's and a manager's to read now; the front desk still
      // enters opportunities). Missing before that migration: the default.
      const { data: days } = await sb.rpc("opportunity_close_days");
      expected = defaultExpectedClose(typeof days === "number" ? days : 30);
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
      ...(fields.notes === undefined ? {} : { notes: fields.notes }),
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
    // @mentions in Notes (owner, Oct 14): the names newly written since the stored text are told;
    // a re-save does not tell anyone twice. sendMentions never throws.
    let mentions: MentionOutcome = NO_MENTIONS;
    if (row.notes?.includes("@")) {
      const { sendMentions } = await import("@/lib/mention-notify");
      mentions = await sendMentions(context, {
        text: row.notes,
        previous: oldNotes,
        writer: nameOf(p),
        where: `opportunity "${row.title}"`,
        url: `/opportunities?id=${row.id}`,
      });
    }
    const [r] = await withNames(sb, [row]);
    return {
      ...(r as OpportunityWithNames),
      followup_note: synced === "snooze_cleared" ? SNOOZE_CLEARED_NOTE : null,
      ...mentions,
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
  row: Pick<
    OpportunityRow,
    "id" | "account_id" | "assignee_id" | "title" | "status" | "expected_close"
  >,
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

/**
 * "This database function is not installed yet" (a migration not applied): PostgREST's PGRST202,
 * "Could not find the function …". Nothing else (Nov 13 audit, finding 9): the two callers below
 * used to treat ANY error that named their function as this one, so a refusal such as
 * "permission denied for function move_opportunity_from_ticket" was swallowed: the ticket saved
 * and the opportunity silently stayed where it was. Such an error is now thrown and shown.
 */
export const isMissingDatabaseFunction = (
  e: { code?: string; message?: string } | null | undefined,
): boolean =>
  !!e && (e.code === "PGRST202" || /Could not find the function/i.test(e.message ?? ""));

/**
 * The bid drives its opportunity (owner, Oct 12), after a bid's status is written (bids.functions.ts
 * saveBid / setBidStatus): the database function sync_opportunity_from_bid (20261012100000) finds
 * the live opportunity linked to the bid (crm_opportunities.bid_id, else bids.opportunity_id),
 * applies the mapping (lib/bid-status.ts oppStatusFromBid: submitted → quoted from open /
 * contacted only; won → won; lost → lost) and writes the status under the flag the closing-rule
 * trigger honours — so a non-manager marking a bid Won closes the opportunity, by design. The
 * status log row comes from the database (crm_opportunities_log); the follow-up closes or
 * reopens here as for a manual status change (syncOppFollowup). Nothing moves the other way:
 * the opportunity's status never changes the bid. Best effort by the caller: the bid is saved
 * either way; a failure here is thrown so the caller can say so.
 */
export async function syncOpportunityFromBid(
  ctx: Ctx,
  bidId: string,
): Promise<{ action: string; opportunity_id?: string; from?: string; to?: string }> {
  const { data, error } = await ctx.supabase.rpc("sync_opportunity_from_bid", { p_bid: bidId });
  if (error) {
    // Before 20261012100000 is applied there is no function: the bid is saved, the opportunity
    // keeps its status (as before Oct 12).
    if (isMissingDatabaseFunction(error)) return { action: "none" };
    throw new Error(error.message);
  }
  const out = (data ?? { action: "none" }) as {
    action: string;
    opportunity_id?: string;
    from?: string;
    to?: string;
  };
  if (out.action !== "updated" || !out.opportunity_id) return out;
  const { data: row, error: rErr } = await ctx.supabase
    .from("crm_opportunities")
    .select("*")
    .eq("id", out.opportunity_id)
    .maybeSingle();
  if (rErr) throw new Error(rErr.message);
  if (row) {
    const p = await me(ctx);
    await syncOppFollowup(row, out.from ?? null, ctx, nameOf(p));
  }
  return out;
}

/**
 * The Undo on a bid's status takes its opportunity back too (the Nov 13 audit, finding 4): the
 * database function undo_opportunity_from_bid (20261113150000) reverts the opportunity's last
 * status step when that step is the caller's own, minutes old, still in place, and the bid is
 * Draft again; anything else is left as somebody's later decision. The follow-up reopens or
 * closes here as for a status set by hand (syncOppFollowup). `none` before the migration.
 */
export async function undoOpportunityFromBid(
  ctx: Ctx,
  bidId: string,
): Promise<{ action: string; opportunity_id?: string; from?: string; to?: string }> {
  const { data, error } = await ctx.supabase.rpc("undo_opportunity_from_bid", { p_bid: bidId });
  if (error) {
    if (isMissingDatabaseFunction(error)) return { action: "none" };
    throw new Error(error.message);
  }
  const out = (data ?? { action: "none" }) as {
    action: string;
    opportunity_id?: string;
    from?: string;
    to?: string;
  };
  if (out.action !== "updated" || !out.opportunity_id) return out;
  const { data: row, error: rErr } = await ctx.supabase
    .from("crm_opportunities")
    .select("*")
    .eq("id", out.opportunity_id)
    .maybeSingle();
  if (rErr) throw new Error(rErr.message);
  if (row) {
    const p = await me(ctx);
    await syncOppFollowup(row, out.from ?? null, ctx, nameOf(p));
  }
  return out;
}

/** The opportunity's new status for a bid status, or null (the pure twin, for the pages). */
export { oppStatusFromBid };

/** What a ticket did to its opportunity, for the toast that says so (lib/ticket-moves.ts). */
export interface OpportunityMove {
  opportunity_id: string;
  title: string;
  from: string;
  to: string;
  ticket: number;
}

/**
 * A ticket moves its opportunity (owner, Nov 13), after the ticket is written (service.functions.ts
 * saveServiceJob, service-inspection.functions.ts createRepairFromInspection and
 * answerInspectionOpportunity): the database function move_opportunity_from_ticket
 * (20261113100000) applies the rule (lib/ticket-moves.ts is its pure twin) with its own rights,
 * because the people who create tickets do not all have the right to edit opportunities — it checks
 * that the caller is one of them. The status log row comes from the database and names the ticket
 * (crm_opportunity_events.note); the follow-up closes here exactly as for a status set by hand
 * (syncOppFollowup). What the follow-up needs of the opportunity comes back in the function's own
 * answer: the caller may not be able to read the opportunity, and nothing here is read with the
 * server's rights (the preview has no service key). Null when nothing moved. Before the migration
 * is applied there is no function: the ticket is saved and the opportunity keeps its status.
 */
export async function moveOpportunityFromTicket(
  ctx: Ctx,
  jobId: string,
  to?: "lost" | "no_response",
): Promise<OpportunityMove | null> {
  const { data, error } = await ctx.supabase.rpc("move_opportunity_from_ticket", {
    p_job: jobId,
    ...(to ? { p_to: to } : {}),
  });
  if (error) {
    if (isMissingDatabaseFunction(error)) return null;
    throw new Error(error.message);
  }
  const out = (data ?? { action: "none" }) as Partial<OpportunityMove> & {
    action: string;
    account_id?: string | null;
    assignee_id?: string | null;
    expected_close?: string | null;
  };
  if (out.action !== "updated" || !out.opportunity_id || !out.to) return null;
  const p = await me(ctx);
  await syncOppFollowup(
    {
      id: out.opportunity_id,
      account_id: out.account_id ?? null,
      assignee_id: out.assignee_id ?? null,
      title: out.title ?? "",
      status: out.to,
      expected_close: out.expected_close ?? null,
    },
    out.from ?? null,
    ctx,
    nameOf(p),
  );
  return {
    opportunity_id: out.opportunity_id,
    title: out.title ?? "",
    from: out.from ?? "",
    to: out.to,
    ticket: out.ticket ?? 0,
  };
}

/** What a new ticket did to its opportunity, as the pages get it back for the toast. */
export interface OpportunityMoved {
  /** The opportunity's move, when the ticket made one. */
  opportunity_move?: OpportunityMove;
  /** The ticket is saved, the opportunity is not moved: why, to be said out loud. */
  opportunity_move_error?: string;
}

/**
 * After a ticket is written: move its opportunity (opportunities.functions.ts
 * moveOpportunityFromTicket). The ticket stands either way — a failure here is handed back to be
 * said out loud, never thrown (a thrown error would read as "the ticket was not created" and the
 * office would make it twice).
 */
export async function movedByTicket(ctx: Ctx, jobId: string): Promise<OpportunityMoved> {
  try {
    const move = await moveOpportunityFromTicket(ctx, jobId);
    return move ? { opportunity_move: move } : {};
  } catch (e) {
    return { opportunity_move_error: e instanceof Error ? e.message : String(e) };
  }
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
    // Any status is the editor's to set (owner, Oct 12): the log (crm_opportunity_events) says who.
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
 * The Assignee box on a saved opportunity saves at change (owner, Nov 4), the way the Status
 * does: handing it to someone is an action — their follow-up timer starts and they are told
 * "assigned to you" (never the person making the change), the one before loses theirs — and
 * the rest of the form stays pending for Save. Whoever may edit the opportunity (RLS) hands it
 * over; the status log (crm_opportunity_events, the database's) says who.
 */
export const setOpportunityAssignee = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z.object({ id: z.string().uuid(), assignee_id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }): Promise<{ id: string; assignee_id: string | null }> => {
    const p = await me(context);
    await assertLiveOpportunity(context.supabase, data.id);
    const { data: row, error } = await context.supabase
      .from("crm_opportunities")
      .update({ assignee_id: data.assignee_id, updated_by_name: nameOf(p) })
      .eq("id", data.id)
      .is("deleted_at", null)
      .select("*")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Opportunity not found, or not yours to change");
    await syncOppFollowup(row, row.status, context, nameOf(p));
    return { id: row.id, assignee_id: row.assignee_id };
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
 * Once both links are written the bid drives the opportunity (syncOpportunityFromBid; owner, Oct
 * 12, A), so a bid already Submitted / Won / Lost moves it the moment it is linked.
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
    const linked = !!rows?.length;
    // The bid side knows its opportunity too (bids.opportunity_id; owner, Oct 12: "From
    // opportunity: …" on the Bids page and in the estimator, and the bid → opportunity sync).
    if (linked) {
      const { error: bErr } = await admin
        .from("bids")
        .update({ opportunity_id: data.opportunityId })
        .eq("id", data.bidId);
      if (bErr) throw new Error(bErr.message);
      // Owner, Oct 12 (A): the bid drives its opportunity from the moment they are linked — a
      // bid saved as Submitted / Won / Lost before the link moves the opportunity now (a draft
      // moves nothing; the function answers 'unchanged'). Both links are written first.
      await syncOpportunityFromBid(context, data.bidId);
    }
    return { linked };
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
 * Undo a delete: admins and managers only. Clears deleted_at and syncs the follow-up again
 * (owner item 7, Oct 12): an assigned, open opportunity gets its timer back ("started"; the
 * assignee hears "Opportunity assigned to you" unless they are the restorer); a closed or
 * unassigned one gets none. Before Oct 12 the follow-up stayed closed until the next change.
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
      .select("*");
    if (error) throw new Error(error.message);
    const row = rows?.[0];
    if (!row) throw new Error("This opportunity is not deleted");
    await syncOppFollowup(row, null, context, nameOf(p));
  });

/**
 * Claim an unassigned opportunity for yourself (owner, Oct 8; the Work Overview unassigned
 * list and calendar). Anyone `canClaim`; the opportunity must be open and have no assignee. A
 * dropped day becomes its expected close under the manager date rule (dateMoveProblem, as
 * saveOpportunity: once set, only an admin or a manager moves it; owner item 7, Oct 12 — it used
 * to be overwritten silently). Owner, Oct 15: someone who may not move it still claims it — the
 * day is ignored, the stored date stays, and the result says so (`dateKept`) for the page's
 * toast. No day keeps whatever it had. The update is the caller's own under
 * crm_opportunities_write (Customers access). The follow-up is synced as a save would: the
 * claimer's timer starts (they are the actor, so no "assigned to you" notice goes to them).
 */
export const claimOpportunity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .nullable()
          .optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const p = await me(context);
    if (!canClaim(p)) throw new Error(CLAIM_NEEDS_TICK);
    const sb = context.supabase;
    const { data: cur, error: cErr } = await sb
      .from("crm_opportunities")
      .select("assignee_id, status, deleted_at, expected_close")
      .eq("id", data.id)
      .maybeSingle();
    if (cErr) throw new Error(cErr.message);
    if (!cur || cur.deleted_at) throw new Error("Opportunity not found");
    if (cur.assignee_id) throw new Error(CLAIM_TAKEN);
    if (!(OPEN_OPP_STATUSES as readonly string[]).includes(cur.status))
      throw new Error("Only an open opportunity can be claimed");
    // The dropped day under the manager date rule (dateMoveProblem, as saveOpportunity). Owner,
    // Oct 15: someone who may not move a stored expected close still gets the opportunity — the
    // claim goes through WITHOUT the day (`dateKept`), and the page's toast says the date stayed.
    // Until then the drop failed outright ("Only a manager can move the date") and the person
    // was left with nothing.
    const dateKept =
      !!data.date &&
      !!dateMoveProblem({ profile: p, oldYmd: cur.expected_close, newYmd: data.date });
    const newDate = data.date && !dateKept ? data.date : null;
    const { data: row, error } = await sb
      .from("crm_opportunities")
      .update({
        assignee_id: context.userId,
        assigned_at: new Date().toISOString(),
        updated_by_name: nameOf(p),
        ...(newDate ? { expected_close: newDate } : {}),
      })
      .eq("id", data.id)
      .is("assignee_id", null)
      .select("*")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error(CLAIM_TAKEN);
    await syncOppFollowup(row, cur.status, context, nameOf(p));
    return {
      id: row.id,
      assignee_id: row.assignee_id,
      expected_close: row.expected_close,
      /** True when the dropped day was ignored: the caller may not move a stored expected close. */
      dateKept,
    };
  });

/**
 * Put someone on an opportunity nobody is on (owner, Oct 15: "Assign to…" on a Work Overview
 * Unassigned row). An admin's or a manager's (`seesEveryone`; claimOpportunity is the
 * self-service twin for anyone `canClaim`). The opportunity must be live, open and have no
 * assignee — `.is("assignee_id", null)` means two people cannot both hand it out. Its date is
 * untouched unless a `date` is sent (Oct 20: the row dropped on a calendar day by someone who
 * assigns rather than claims): then the day becomes its expected close under the manager date
 * rule, exactly as claimOpportunity — a caller who may not move a stored date still assigns it,
 * the day is ignored and the result says so (`dateKept`). The follow-up is synced as a save
 * would: the assignee's timer starts and they get the "assigned to you" notice (the manager is
 * the actor).
 */
export const assignOpportunity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        assignee_id: z.string().uuid(),
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .nullable()
          .optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const p = await me(context);
    if (!seesEveryone(p))
      throw new Error("Only an admin or a manager assigns an opportunity to someone");
    const sb = context.supabase;
    const { data: cur, error: cErr } = await sb
      .from("crm_opportunities")
      .select("assignee_id, status, deleted_at, expected_close")
      .eq("id", data.id)
      .maybeSingle();
    if (cErr) throw new Error(cErr.message);
    if (!cur) throw new Error("Opportunity not found");
    if (cur.deleted_at) throw new Error(OPP_DELETED);
    if (cur.assignee_id) throw new Error(CLAIM_TAKEN);
    if (!(OPEN_OPP_STATUSES as readonly string[]).includes(cur.status))
      throw new Error("Only an open opportunity can be assigned");
    // The dropped day under the manager date rule (dateMoveProblem), as claimOpportunity.
    const dateKept =
      !!data.date &&
      !!dateMoveProblem({ profile: p, oldYmd: cur.expected_close, newYmd: data.date });
    const newDate = data.date && !dateKept ? data.date : null;
    const { data: row, error } = await sb
      .from("crm_opportunities")
      .update({
        assignee_id: data.assignee_id,
        assigned_at: new Date().toISOString(),
        updated_by_name: nameOf(p),
        ...(newDate ? { expected_close: newDate } : {}),
      })
      .eq("id", data.id)
      .is("assignee_id", null)
      .select("*")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error(CLAIM_TAKEN);
    await syncOppFollowup(row, cur.status, context, nameOf(p));
    return {
      id: row.id,
      assignee_id: row.assignee_id,
      expected_close: row.expected_close,
      /** True when the sent day was ignored: the caller may not move a stored expected close. */
      dateKept,
    };
  });
