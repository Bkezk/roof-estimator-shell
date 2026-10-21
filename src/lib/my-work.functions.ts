/**
 * Work Overview — the server side (src/lib/my-work.ts has the pure rules). Every signed-in user may
 * call it; it returns only the caller's own tickets, tasks and follow-ups, unless the caller is an
 * admin or a manager, who may ask for everyone's or one person's (`visibleUserIds`).
 *
 * Reads run under the caller's own client, so RLS applies on top of the scoping: a technician
 * reads only their own tickets (service_jobs), a user without Customers only their own
 * follow-ups (crm_followups), and tasks are readable by Prospecting / Estimate users or their
 * assignee (20260930093000_manager_role.sql).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware.hardened";
import type { Database } from "@/integrations/supabase/types";
import { canAccess, isOffice, managesTickets, seesEveryone, seesInvoices } from "@/lib/access";
import { readInChunks } from "@/lib/chunk-ids";
import {
  TO_AUTHORIZE_STAGE,
  TO_INVOICE_STAGE,
  UNASSIGNED_OVERDUE_DAYS_DEFAULT,
  UNASSIGNED_TICKET_STAGES,
  WORK_TICKET_STAGES,
  visibleUserIds,
  type BidIn,
  type FollowupIn,
  type OppIn,
  type TaskIn,
  type TicketIn,
  type UnassignedRows,
} from "@/lib/my-work";
import { OPEN_OPP_STATUSES } from "@/lib/work-counts";
import { normalizeWorkLayout, type WorkLayout } from "@/lib/work-layout";

export interface WorkPerson {
  id: string;
  name: string;
  technician: boolean;
}

export interface MyWorkResult {
  tickets: TicketIn[];
  tasks: TaskIn[];
  followups: FollowupIn[];
  /** Display names by profile id (filled for admins and managers). */
  names: Record<string, string>;
  /** The "Show" picker's people: admins and managers only (empty for everyone else). */
  people: WorkPerson[];
  /**
   * Is `people` the whole roster (Oct 20)? True only when work_people() answered; false when
   * it failed and technician_options() stood in (Service people only), and for a caller who
   * cannot pick. The page second-guesses a remembered person only against a complete roster
   * (my-work.ts effectiveWho) — an incomplete one made it forget a real person.
   */
  rosterComplete: boolean;
  /** May the caller pick Everyone / another person? */
  canPick: boolean;
  /** Whose items came back: "all" or the profile ids. */
  scope: string[] | "all";
  /**
   * Does the caller review Done tickets (the Needs authorization tab; M9, owner Oct 5)? Since
   * Oct 12 every admin and manager (`managesTickets`; ticket_authorizers() names them all once
   * 20261012170000_managers_authorize.sql is applied, and the flag says so even before).
   */
  authorizer: boolean;
  /**
   * Nobody's work (owner, Oct 7): Open / Scheduled tickets without a technician (a Done one is
   * finished work, not listed; Oct 12), open opportunities without an
   * assignee and, since Oct 9, open tasks without one, for everyone but a technician-only user
   * (`isOffice`), whatever `who` asks for — null for a technician. No date window: an unassigned
   * ticket stays listed however old.
   */
  unassigned: UnassignedRows | null;
  /** Setup's "needs assignment" timer: unassigned work is flagged overdue after this many days. */
  unassignedOverdueDays: number;
  /** Does the caller invoice (`seesInvoices`)? Then the "Authorized — to invoice" column shows. */
  invoicer: boolean;
  /**
   * The Authorized tickets waiting for their invoice (owner, Oct 12), longest waiting first,
   * for an invoicer whatever `who` asks for (the queue is the office's); [] for anyone else.
   */
  toInvoice: TicketIn[];
  /**
   * The Done tickets waiting to be authorized (owner, Oct 12: "make managers able to authorize"),
   * longest waiting first, for an admin or a manager whatever `who` asks for (the queue is the
   * office's); [] for anyone else. The page lists each once under Needs authorization — as its
   * Authorize follow-up row when that is among `followups`, else as the ticket row (my-work.ts
   * mergeWork).
   */
  toAuthorize: TicketIn[];
  /**
   * Draft bids by due date (owner, Oct 12: "at the origination of bids we should have a bid due
   * date required so we can also have those show on this week, overdue, etc"), for a caller with
   * Estimate access ([] for anyone else): the drafts started by the people in scope (created_by),
   * every draft for Everyone. A submitted / won / lost bid is never sent.
   */
  bids: BidIn[];
  /**
   * The caller's saved Work Overview layout (owner, Oct 15: read with the list, so landing makes
   * one request instead of two); null when none is saved (the default: the page applies it and
   * drops the browser's copy — another device's Reset). Undefined when the read failed (the
   * column is not there yet: 20261007110000_work_layout.sql) — then the page seeds nothing and
   * keeps the browser's copy, rather than reading the failure as "no layout".
   */
  layout: WorkLayout | null | undefined;
  /**
   * Did any list hit `LIMIT` (owner, Oct 15)? Each kind is capped at 1,000 rows per request, so
   * Everyone may be missing some; the page says so and suggests narrowing to one person.
   */
  truncated: boolean;
}

/** Each list's cap (nine lists); `truncated` says whether any reached it. */
export const LIMIT = 1000;
const nameOf = (p: { full_name: string | null; email: string }) =>
  (p.full_name ?? "").trim() || p.email;

export const listMyWork = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ who: z.string().trim().max(64).optional() }).parse(d ?? {}))
  .handler(async ({ data, context }): Promise<MyWorkResult> => {
    const sb = context.supabase;
    const { data: me, error: meErr } = await sb
      .from("profiles")
      .select("id, role, access, technician, full_name, email")
      .eq("id", context.userId)
      .maybeSingle();
    if (meErr) throw new Error(meErr.message);
    if (!me) throw new Error("Profile not found");

    const canPick = seesEveryone(me);
    // The one scoping rule: a plain user's `who` is ignored (their own items only).
    const scope = visibleUserIds({ id: context.userId, role: me.role }, data.who);

    let tq = sb
      .from("service_jobs")
      .select(
        "id, number, customer_name, site_name, site_address, description, service_type, stage, scheduled_date, technician_id",
      )
      .is("deleted_at", null)
      .in("stage", [...WORK_TICKET_STAGES])
      .order("scheduled_date", { ascending: true, nullsFirst: false })
      .limit(LIMIT);
    tq = scope === "all" ? tq.not("technician_id", "is", null) : tq.in("technician_id", scope);
    // Owner, Oct 12: a Done ticket is finished work and is not listed at all (the "Done — waiting
    // on the office" group is gone, for everyone) — WORK_TICKET_STAGES is Open / Scheduled. The
    // authorizer sees it under Needs authorization through its Authorize follow-up (`fq`).

    let kq = sb
      .from("tasks")
      .select("id, title, due_date, status, building_id, assignee, assignee_name")
      .neq("status", "done")
      .order("due_date", { ascending: true, nullsFirst: false })
      .limit(LIMIT);
    kq = scope === "all" ? kq.not("assignee", "is", null) : kq.in("assignee", scope);

    // Every column: snoozed_until arrives with 20261001030000_followups_manager_only.sql, and a
    // named list would fail until that migration is applied.
    let fq = sb
      .from("crm_followups")
      .select("*")
      .eq("status", "open")
      .order("due_at", { ascending: true })
      .limit(LIMIT);
    if (scope !== "all") fq = fq.in("assignee_id", scope);

    // Unassigned work (owner, Oct 7): everyone but a technician-only user. RLS still applies — a
    // user without Customers or Estimate access reads no opportunities and simply gets none.
    // Open / Scheduled tickets only (owner, Oct 12: a Done ticket nobody is on is finished work,
    // not listed, never "Unassigned" and never overdue for want of a person).
    const showUnassigned = isOffice(me);
    const uTickets = showUnassigned
      ? sb
          .from("service_jobs")
          .select(
            "id, number, customer_name, site_name, site_address, description, service_type, stage, scheduled_date, technician_id, created_at",
          )
          .is("deleted_at", null)
          .in("stage", [...UNASSIGNED_TICKET_STAGES])
          .is("technician_id", null)
          .order("scheduled_date", { ascending: true, nullsFirst: false })
          .limit(LIMIT)
      : Promise.resolve({ data: [] as TicketIn[], error: null });
    const uOpps = showUnassigned
      ? sb
          .from("crm_opportunities")
          .select("id, title, status, expected_close, account_id, created_at")
          .is("deleted_at", null)
          .in("status", [...OPEN_OPP_STATUSES])
          .is("assignee_id", null)
          .order("expected_close", { ascending: true, nullsFirst: false })
          .limit(LIMIT)
      : Promise.resolve({
          data: [] as {
            id: string;
            title: string;
            status: string;
            expected_close: string | null;
            account_id: string | null;
            created_at: string;
          }[],
          error: null,
        });
    // Open tasks nobody is on (owner, Oct 9: tasks behave like services). RLS
    // tasks_read_unassigned (20261009100000) shows them to everyone but a technician-only user;
    // until it is applied an office user who is not the creator reads none, a manager all.
    const uTasks = showUnassigned
      ? sb
          .from("tasks")
          .select(
            "id, title, due_date, status, building_id, assignee, assignee_name, account_name, site_name, created_at",
          )
          .eq("status", "open")
          .is("assignee", null)
          .order("due_date", { ascending: true, nullsFirst: false })
          .limit(LIMIT)
      : Promise.resolve({ data: [] as TaskIn[], error: null });
    // The "needs assignment" timer (Admin › Reminders; 20261007100000_unassigned_overdue.sql),
    // through `unassigned_overdue_days()` (20261020120000: crm_settings itself is an admin's and
    // a manager's to read now). Until that migration is applied the function is missing (an
    // error, data null) and the default stands.
    const uDays = showUnassigned
      ? sb.rpc("unassigned_overdue_days")
      : Promise.resolve({ data: null, error: null });
    // The Authorized tickets, for whoever invoices (owner, Oct 12: "Authorized — to invoice" on
    // Work Overview; seesInvoices, the Invoice block's own rule). Whatever `who` asks for: the
    // queue is the office's, not a technician's — the same reading as Unassigned. Longest
    // waiting first (stage_changed_at, 20261006180000), with or without a technician.
    const invoicer = seesInvoices(me);
    const iTickets = invoicer
      ? sb
          .from("service_jobs")
          .select(
            "id, number, customer_name, site_name, site_address, description, service_type, stage, scheduled_date, technician_id, stage_changed_at",
          )
          .is("deleted_at", null)
          .eq("stage", TO_INVOICE_STAGE)
          .order("stage_changed_at", { ascending: true, nullsFirst: false })
          .limit(LIMIT)
      : Promise.resolve({ data: [] as TicketIn[], error: null });
    // The Done tickets, for every admin and manager (owner, Oct 12: "make managers able to
    // authorize, apparently they do that sometimes"; managesTickets — the Invoice block's "Mark
    // authorized" gate). Whatever `who` asks for, like the to-invoice queue. Longest waiting
    // first: by the close-out stamp (completed_at), then the stage stamp (20261006180000).
    const reviewer = managesTickets(me);
    const aTickets = reviewer
      ? sb
          .from("service_jobs")
          .select(
            "id, number, customer_name, site_name, site_address, description, service_type, stage, scheduled_date, technician_id, completed_at, stage_changed_at",
          )
          .is("deleted_at", null)
          .eq("stage", TO_AUTHORIZE_STAGE)
          .order("completed_at", { ascending: true, nullsFirst: false })
          .order("stage_changed_at", { ascending: true, nullsFirst: false })
          .limit(LIMIT)
      : Promise.resolve({ data: [] as TicketIn[], error: null });

    // Draft bids by due date (owner, Oct 12), for Estimate access only — the page the bids live
    // on (RLS bids_authenticated_all is the same gate). Mine / one person: the drafts that person
    // started (created_by); Everyone: every draft. due_date arrives with
    // 20261012140000_bid_due_date.sql; a draft without one (older) is listed under Later.
    const estimator = canAccess(me, "estimate");
    let bq = estimator
      ? sb
          .from("bids")
          .select("id, name, status, due_date, account_id, created_by")
          .is("deleted_at", null)
          .eq("status", "draft")
          .order("due_date", { ascending: true, nullsFirst: false })
          .limit(LIMIT)
      : null;
    if (bq && scope !== "all") bq = bq.in("created_by", scope);
    const bRows = bq ?? Promise.resolve({ data: [] as BidRow[], error: null });

    // The saved layout, with the lists (Oct 15; its own read, so a database without the column
    // — 20261007110000_work_layout.sql not applied — still answers the list, with no layout).
    const layoutRow = sb
      .from("profiles")
      .select("work_layout")
      .eq("id", context.userId)
      .maybeSingle();

    // ticket_authorizers: 20261005150000_ticket_authorizer.sql; until it is applied, nobody.
    const [
      tickets,
      tasks,
      followups,
      auth,
      unTickets,
      unOpps,
      unTasks,
      days,
      toInvoice,
      toAuthorize,
      bids,
      layoutRes,
    ] = await Promise.all([
      tq,
      kq,
      fq,
      sb.rpc("ticket_authorizers"),
      uTickets,
      uOpps,
      uTasks,
      uDays,
      iTickets,
      aTickets,
      bRows,
      layoutRow,
    ]);
    const layout = layoutRes.error
      ? undefined
      : layoutRes.data?.work_layout
        ? normalizeWorkLayout(layoutRes.data.work_layout)
        : null;
    const atCap = (r: { data: unknown[] | null }) => (r.data?.length ?? 0) >= LIMIT;
    const truncated = [
      tickets,
      tasks,
      followups,
      unTickets,
      unOpps,
      unTasks,
      toInvoice,
      toAuthorize,
      bids,
    ].some(atCap);
    if (toInvoice.error) throw new Error(`Tickets to invoice: ${toInvoice.error.message}`);
    if (toAuthorize.error) throw new Error(`Tickets to authorize: ${toAuthorize.error.message}`);
    if (bids.error) throw new Error(`Bids: ${bids.error.message}`);
    const unassignedOverdueDays =
      !days.error && typeof days.data === "number" ? days.data : UNASSIGNED_OVERDUE_DAYS_DEFAULT;
    if (unTickets.error) throw new Error(`Unassigned tickets: ${unTickets.error.message}`);
    if (unOpps.error) throw new Error(`Unassigned opportunities: ${unOpps.error.message}`);
    if (unTasks.error) throw new Error(`Unassigned tasks: ${unTasks.error.message}`);
    // Every admin and manager authorizes (owner, Oct 12); the rpc still answers for anyone it
    // names (it names only admins and managers, so the two agree once the migration is applied).
    const authorizer =
      reviewer || (!auth.error && (auth.data ?? []).some((id: unknown) => id === context.userId));
    if (tickets.error) throw new Error(`Tickets: ${tickets.error.message}`);
    if (tasks.error) throw new Error(`Tasks: ${tasks.error.message}`);
    if (followups.error) throw new Error(`Follow-ups: ${followups.error.message}`);

    // Labels for tasks (their building) and follow-ups (their customer): best effort — a caller
    // who may not read buildings or accounts simply gets the rows without them. Read 100 ids at
    // a time (Oct 21, seventh audit: one `.in` over every id — up to 1,000 per list — outgrew the
    // request URL past a few hundred and, best effort, blanked every label at once).
    const buildingIds = [
      ...new Set(
        [...(tasks.data ?? []), ...(unTasks.data ?? [])]
          .map((t) => t.building_id)
          .filter((x): x is string => !!x),
      ),
    ];
    const accountIds = [
      ...new Set(
        [
          ...(followups.data ?? []).map((f) => f.account_id),
          ...(unOpps.data ?? []).map((o) => o.account_id),
          ...(bids.data ?? []).map((b) => b.account_id),
        ].filter((x): x is string => !!x),
      ),
    ];
    // An opportunity follow-up's row shows the opportunity's real status (owner, Oct 12: it
    // always read "Open"); best effort too — a caller who may not read opportunities gets none.
    const oppIds = [
      ...new Set(
        (followups.data ?? []).filter((f) => f.kind === "opportunity").map((f) => f.item_id),
      ),
    ];
    const [buildings, accounts, roster, opps] = await Promise.all([
      readInChunks(buildingIds, (ids) =>
        sb.from("buildings").select("id, name, address1, city").in("id", ids),
      ),
      readInChunks(accountIds, (ids) => sb.from("crm_accounts").select("id, name").in("id", ids)),
      canPick ? loadPeople(sb) : Promise.resolve({ people: [] as WorkPerson[], complete: false }),
      readInChunks(oppIds, (ids) =>
        sb.from("crm_opportunities").select("id, status").in("id", ids),
      ),
    ]);
    const oppStatus = new Map(opps.map((o) => [o.id, o.status]));
    const buildingLabel = new Map(
      buildings.map((b) => [
        b.id,
        [b.name, [b.address1, b.city].filter(Boolean).join(", ")].filter(Boolean).join(" · "),
      ]),
    );
    const accountName = new Map(accounts.map((a) => [a.id, a.name]));
    const withBuilding = (t: TaskIn): TaskIn => ({
      ...t,
      building_label: t.building_id ? (buildingLabel.get(t.building_id) ?? null) : null,
    });
    const names: Record<string, string> = {};
    const people = roster.people;
    for (const p of people) names[p.id] = p.name;
    // The caller's own name, so their own cards say who (owner, Oct 9: "why doesnt this show
    // who its assigned to on the card?"); a plain user reads no other profile and holds no
    // other person's item.
    names[context.userId] ??= nameOf(me);

    return {
      tickets: (tickets.data ?? []) as TicketIn[],
      tasks: (tasks.data ?? []).map(withBuilding),
      followups: (followups.data ?? []).map((f) => ({
        id: f.id,
        title: f.title,
        url: f.url,
        due_at: f.due_at,
        status: f.status,
        kind: f.kind,
        item_id: f.item_id,
        assignee_id: f.assignee_id,
        every_days: f.every_days,
        snoozed_until: f.snoozed_until ?? null,
        // The hold's record (owner, Oct 9; missing until 20261009150000_followup_holds.sql).
        hold_reason: f.hold_reason ?? null,
        held_by_name: f.held_by_name ?? null,
        hold_count: f.hold_count ?? 0,
        // When its last reminder went out (owner, Oct 15: shown on the row).
        last_reminded_at: f.last_reminded_at ?? null,
        account_name: f.account_id ? (accountName.get(f.account_id) ?? null) : null,
        opportunity_status: f.kind === "opportunity" ? (oppStatus.get(f.item_id) ?? null) : null,
      })),
      names,
      people,
      rosterComplete: roster.complete,
      canPick,
      scope,
      authorizer,
      unassigned: showUnassigned
        ? {
            tickets: (unTickets.data ?? []) as TicketIn[],
            opportunities: (unOpps.data ?? []).map((o): OppIn => ({
              id: o.id,
              title: o.title,
              status: o.status,
              expected_close: o.expected_close,
              account_name: o.account_id ? (accountName.get(o.account_id) ?? null) : null,
              created_at: o.created_at,
            })),
            tasks: (unTasks.data ?? []).map(withBuilding),
          }
        : null,
      unassignedOverdueDays,
      invoicer,
      toInvoice: (toInvoice.data ?? []) as TicketIn[],
      toAuthorize: (toAuthorize.data ?? []) as TicketIn[],
      bids: (bids.data ?? []).map((b): BidIn => ({
        id: b.id,
        name: b.name,
        status: b.status,
        due_date: b.due_date,
        account_name: b.account_id ? (accountName.get(b.account_id) ?? null) : null,
        created_by: b.created_by,
      })),
      layout,
      truncated,
    };
  });

/** The bid columns Work Overview reads (`listMyWork`). */
type BidRow = Pick<
  Database["public"]["Tables"]["bids"]["Row"],
  "id" | "name" | "status" | "due_date" | "account_id" | "created_by"
>;

/**
 * Everyone an admin or a manager can pick: `work_people()` (SECURITY DEFINER; profiles RLS hides
 * other users' rows from a manager). Until that migration is applied, the ticket assignee roster
 * `technician_options()` stands in — an incomplete roster, and `complete` says so (Oct 20).
 */
async function loadPeople(
  sb: SupabaseClient<Database>,
): Promise<{ people: WorkPerson[]; complete: boolean }> {
  const all = await sb.rpc("work_people");
  const rows = all.error ? (await sb.rpc("technician_options")).data : all.data;
  const people = (rows ?? [])
    .map((r) => ({ id: r.id, name: nameOf(r), technician: r.technician }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { people, complete: !all.error };
}
