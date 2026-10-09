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
import { isOffice, seesEveryone } from "@/lib/access";
import {
  UNASSIGNED_OVERDUE_DAYS_DEFAULT,
  WORK_TICKET_STAGES,
  visibleUserIds,
  type FollowupIn,
  type OppIn,
  type TaskIn,
  type TicketIn,
  type UnassignedRows,
} from "@/lib/my-work";
import { OPEN_OPP_STATUSES } from "@/lib/work-counts";

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
  /** May the caller pick Everyone / another person? */
  canPick: boolean;
  /** Whose items came back: "all" or the profile ids. */
  scope: string[] | "all";
  /** Does the caller review Done tickets (the Needs authorization tab; M9, owner Oct 5)? */
  authorizer: boolean;
  /**
   * Nobody's work (owner, Oct 7): tickets without a technician, open opportunities without an
   * assignee and, since Oct 9, open tasks without one, for everyone but a technician-only user
   * (`isOffice`), whatever `who` asks for — null for a technician. No date window: an unassigned
   * ticket stays listed however old.
   */
  unassigned: UnassignedRows | null;
  /** Setup's "needs assignment" timer: unassigned work is flagged overdue after this many days. */
  unassignedOverdueDays: number;
}

const LIMIT = 1000;
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
    const showUnassigned = isOffice(me);
    const uTickets = showUnassigned
      ? sb
          .from("service_jobs")
          .select(
            "id, number, customer_name, site_name, site_address, description, service_type, stage, scheduled_date, technician_id, created_at",
          )
          .is("deleted_at", null)
          .in("stage", [...WORK_TICKET_STAGES])
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
    // The "needs assignment" timer (Setup › Reminders; 20261007100000_unassigned_overdue.sql).
    // Until that migration is applied the column is missing and the default stands.
    const uDays = showUnassigned
      ? sb.from("crm_settings").select("unassigned_overdue_days").eq("id", 1).maybeSingle()
      : Promise.resolve({ data: null, error: null });

    // ticket_authorizers: 20261005150000_ticket_authorizer.sql; until it is applied, nobody.
    const [tickets, tasks, followups, auth, unTickets, unOpps, unTasks, days] = await Promise.all([
      tq,
      kq,
      fq,
      sb.rpc("ticket_authorizers"),
      uTickets,
      uOpps,
      uTasks,
      uDays,
    ]);
    const unassignedOverdueDays =
      !days.error && typeof days.data?.unassigned_overdue_days === "number"
        ? days.data.unassigned_overdue_days
        : UNASSIGNED_OVERDUE_DAYS_DEFAULT;
    if (unTickets.error) throw new Error(`Unassigned tickets: ${unTickets.error.message}`);
    if (unOpps.error) throw new Error(`Unassigned opportunities: ${unOpps.error.message}`);
    if (unTasks.error) throw new Error(`Unassigned tasks: ${unTasks.error.message}`);
    const authorizer =
      !auth.error && (auth.data ?? []).some((id: unknown) => id === context.userId);
    if (tickets.error) throw new Error(`Tickets: ${tickets.error.message}`);
    if (tasks.error) throw new Error(`Tasks: ${tasks.error.message}`);
    if (followups.error) throw new Error(`Follow-ups: ${followups.error.message}`);

    // Labels for tasks (their building) and follow-ups (their customer): best effort — a caller
    // who may not read buildings or accounts simply gets the rows without them.
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
        ].filter((x): x is string => !!x),
      ),
    ];
    const [buildings, accounts, people] = await Promise.all([
      buildingIds.length
        ? sb.from("buildings").select("id, name, address1, city").in("id", buildingIds)
        : Promise.resolve({
            data: [] as { id: string; name: string; address1: string; city: string | null }[],
          }),
      accountIds.length
        ? sb.from("crm_accounts").select("id, name").in("id", accountIds)
        : Promise.resolve({ data: [] as { id: string; name: string }[] }),
      canPick ? loadPeople(sb) : Promise.resolve([] as WorkPerson[]),
    ]);
    const buildingLabel = new Map(
      (buildings.data ?? []).map((b) => [
        b.id,
        [b.name, [b.address1, b.city].filter(Boolean).join(", ")].filter(Boolean).join(" · "),
      ]),
    );
    const accountName = new Map((accounts.data ?? []).map((a) => [a.id, a.name]));
    const withBuilding = (t: TaskIn): TaskIn => ({
      ...t,
      building_label: t.building_id ? (buildingLabel.get(t.building_id) ?? null) : null,
    });
    const names: Record<string, string> = {};
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
        account_name: f.account_id ? (accountName.get(f.account_id) ?? null) : null,
      })),
      names,
      people,
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
    };
  });

/**
 * Everyone an admin or a manager can pick: `work_people()` (SECURITY DEFINER; profiles RLS hides
 * other users' rows from a manager). Until that migration is applied, the ticket assignee roster
 * `technician_options()` stands in.
 */
async function loadPeople(sb: SupabaseClient<Database>): Promise<WorkPerson[]> {
  const all = await sb.rpc("work_people");
  const rows = all.error ? (await sb.rpc("technician_options")).data : all.data;
  return (rows ?? [])
    .map((r) => ({ id: r.id, name: nameOf(r), technician: r.technician }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
