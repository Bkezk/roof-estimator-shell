/**
 * My Work — the server side (src/lib/my-work.ts has the pure rules). Every signed-in user may
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
import { seesEveryone } from "@/lib/access";
import {
  WORK_TICKET_STAGES,
  visibleUserIds,
  type FollowupIn,
  type TaskIn,
  type TicketIn,
} from "@/lib/my-work";

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

    const [tickets, tasks, followups] = await Promise.all([tq, kq, fq]);
    if (tickets.error) throw new Error(`Tickets: ${tickets.error.message}`);
    if (tasks.error) throw new Error(`Tasks: ${tasks.error.message}`);
    if (followups.error) throw new Error(`Follow-ups: ${followups.error.message}`);

    // Labels for tasks (their building) and follow-ups (their customer): best effort — a caller
    // who may not read buildings or accounts simply gets the rows without them.
    const buildingIds = [
      ...new Set((tasks.data ?? []).map((t) => t.building_id).filter((x): x is string => !!x)),
    ];
    const accountIds = [
      ...new Set((followups.data ?? []).map((f) => f.account_id).filter((x): x is string => !!x)),
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
    const names: Record<string, string> = {};
    for (const p of people) names[p.id] = p.name;

    return {
      tickets: (tickets.data ?? []) as TicketIn[],
      tasks: (tasks.data ?? []).map((t) => ({
        ...t,
        building_label: t.building_id ? (buildingLabel.get(t.building_id) ?? null) : null,
      })),
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
        account_name: f.account_id ? (accountName.get(f.account_id) ?? null) : null,
      })),
      names,
      people,
      canPick,
      scope,
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
