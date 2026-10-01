/**
 * The Owner view on My Work — the server side (src/lib/owner-view.ts has the pure rules and the
 * column definitions). Admins only: `listOwnerView` reads the caller's own profile row and
 * throws "Forbidden: admin only" unless its role is admin (`visibleToOwner` = isAdmin) — never a
 * flag from the client. Reads run under the caller's own client (admins read everything by RLS).
 *
 * Last activity reads the last 14 days of each source in bulk (newest first); anyone with nothing
 * in that window gets one newest-row lookup per source. `audit_log` is read defensively: until
 * that table exists (or if it cannot be read) it counts as no rows.
 */
import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware.hardened";
import type { Database } from "@/integrations/supabase/types";
import { WORK_TICKET_STAGES, addDays, mergeWork, type TicketIn } from "@/lib/my-work";
import {
  DONE_TICKET_STAGES,
  bucketCounts,
  bucketsFor,
  doneThisWeek,
  lastActivity,
  oppCounts,
  roleLabel,
  sortOwnerRows,
  staleness,
  visibleToOwner,
  weekRange,
  type OwnerRow,
} from "@/lib/owner-view";
import { localYmd, zonedTime } from "@/lib/tasks";
import { OPEN_OPP_STATUSES } from "@/lib/work-counts";

export interface OwnerViewResult {
  /** The office's day (YYYY-MM-DD, Eastern) the numbers are for. */
  today: string;
  /** When the numbers were read (ISO): "2 h ago" is relative to this. */
  at: string;
  /** One per profile, most overdue first, then by name. */
  rows: OwnerRow[];
  /** Did audit_log answer (false until that table exists)? */
  auditLog: boolean;
}

const LIMIT = 1000;
/** Bulk window for Last activity; older activity is looked up per person. */
const ACTIVITY_DAYS = 14;

type Sb = SupabaseClient<Database>;
type Hit = { who: string | null | undefined; at: string | null | undefined };

const nameOf = (p: { full_name: string | null; email: string }) =>
  (p.full_name ?? "").trim() || p.email;

function must<T>(label: string, r: { data: T | null; error: { message: string } | null }): T {
  if (r.error) throw new Error(`${label}: ${r.error.message}`);
  return (r.data ?? []) as T;
}

export const listOwnerView = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<OwnerViewResult> => {
    const sb = context.supabase;
    // The role comes from the caller's own profile row — never from the client.
    const { data: me, error: meErr } = await sb
      .from("profiles")
      .select("id, role")
      .eq("id", context.userId)
      .maybeSingle();
    if (meErr) throw new Error(meErr.message);
    if (!me || !visibleToOwner(me)) throw new Error("Forbidden: admin only");

    const now = new Date();
    const today = localYmd(now);
    const week = weekRange(today);
    const weekFrom = zonedTime(week.start, "00:00").toISOString();
    const weekTo = zonedTime(addDays(week.end, 1), "00:00").toISOString();
    const since = new Date(now.getTime() - ACTIVITY_DAYS * 86_400_000).toISOString();

    const [profiles, tickets, tasks, followups, opps, doneTickets, doneTasks] = await Promise.all([
      sb.from("profiles").select("id, full_name, email, role, technician"),
      sb
        .from("service_jobs")
        .select(
          "id, number, customer_name, site_name, site_address, description, service_type, stage, scheduled_date, technician_id",
        )
        .is("deleted_at", null)
        .in("stage", [...WORK_TICKET_STAGES])
        .not("technician_id", "is", null)
        .limit(LIMIT),
      sb
        .from("tasks")
        .select("id, title, due_date, status, building_id, assignee, assignee_name")
        .neq("status", "done")
        .not("assignee", "is", null)
        .limit(LIMIT),
      // Every column: snoozed_until may not exist yet (see my-work.functions.ts).
      sb.from("crm_followups").select("*").eq("status", "open").limit(LIMIT),
      sb
        .from("crm_opportunities")
        .select("assignee_id, status, expected_close, est_value")
        .is("deleted_at", null)
        .in("status", [...OPEN_OPP_STATUSES])
        .not("assignee_id", "is", null)
        .limit(LIMIT),
      sb
        .from("service_jobs")
        .select("technician_id, stage, completed_at")
        .is("deleted_at", null)
        .in("stage", [...DONE_TICKET_STAGES])
        .gte("completed_at", weekFrom)
        .lt("completed_at", weekTo)
        .limit(LIMIT),
      sb
        .from("tasks")
        .select("assignee, status, done_at")
        .eq("status", "done")
        .gte("done_at", weekFrom)
        .lt("done_at", weekTo)
        .limit(LIMIT),
    ]);
    const people = must("Profiles", profiles);
    const items = mergeWork(
      {
        tickets: must("Tickets", tickets) as TicketIn[],
        tasks: must("Tasks", tasks),
        followups: must("Follow-ups", followups).map((f) => ({
          id: f.id,
          title: f.title,
          url: f.url,
          due_at: f.due_at,
          status: f.status,
          kind: f.kind,
          item_id: f.item_id,
          assignee_id: f.assignee_id,
        })),
      },
      (iso) => localYmd(new Date(iso)),
    );
    const buckets = bucketCounts(items, today);
    const oppsBy = oppCounts(must("Opportunities", opps), today);
    const doneBy = doneThisWeek(
      must("Done tickets", doneTickets),
      must("Done tasks", doneTasks),
      today,
    );
    const { latest, auditLog } = await loadLastActivity(
      sb,
      people.map((p) => p.id),
      since,
    );

    const rows: OwnerRow[] = people.map((p) => {
      const b = bucketsFor(buckets, p.id);
      const o = oppsBy[p.id] ?? { open: 0, overdue: 0, value: 0 };
      const last = latest.get(p.id) ?? null;
      return {
        id: p.id,
        name: nameOf(p),
        role: roleLabel(p),
        dueToday: b.today,
        overdue: b.overdue + o.overdue,
        overdueOpps: o.overdue,
        doneThisWeek: doneBy[p.id] ?? 0,
        openOpps: o.open,
        oppValue: o.value,
        lastActivity: last,
        stale: staleness(last, today, roleLabel(p) === "Admin") === "stale",
      };
    });
    return { today, at: now.toISOString(), rows: sortOwnerRows(rows), auditLog };
  });

/** One source of activity: its table, the person column(s) and the timestamp column. */
interface Source {
  table: string;
  who: string[];
  at: string;
  /** Extra filter (tasks: done ones only). */
  only?: [string, string];
}

const SOURCES: Source[] = [
  { table: "service_job_events", who: ["by_user"], at: "at" },
  { table: "crm_contact_log", who: ["by_user"], at: "at" },
  { table: "tasks", who: ["assignee"], at: "done_at", only: ["status", "done"] },
  // A time entry is the technician's work, and the activity of whoever logged it.
  { table: "service_time_entries", who: ["technician_id", "created_by"], at: "created_at" },
  { table: "audit_log", who: ["by_user"], at: "at" },
];

/**
 * The latest activity per person. The bulk read covers the last ACTIVITY_DAYS days; anyone with
 * nothing there gets one newest-row lookup per source. audit_log errors (missing table) = no rows.
 */
async function loadLastActivity(
  typed: Sb,
  ids: string[],
  since: string,
): Promise<{ latest: Map<string, string>; auditLog: boolean }> {
  // Untyped: audit_log is not in the generated types until its migration lands.
  const sb = typed as unknown as SupabaseClient;
  const hits = new Map<string, (string | null | undefined)[]>();
  const add = (h: Hit) => {
    if (!h.who || !h.at) return;
    const list = hits.get(h.who) ?? [];
    list.push(h.at);
    hits.set(h.who, list);
  };
  const toHits = (src: Source, rows: Record<string, string | null>[]) => {
    for (const r of rows) for (const w of src.who) add({ who: r[w], at: r[src.at] });
  };

  let auditLog = true;
  const bulk = await Promise.all(
    SOURCES.map((src) => {
      let q = sb
        .from(src.table)
        .select([...src.who, src.at].join(", "))
        .gte(src.at, since)
        .order(src.at, { ascending: false })
        .limit(LIMIT);
      if (src.only) q = q.eq(src.only[0], src.only[1]);
      return q;
    }),
  );
  bulk.forEach((r, i) => {
    const src = SOURCES[i]!;
    if (r.error) {
      if (src.table === "audit_log") {
        auditLog = false;
        return;
      }
      throw new Error(`Activity (${src.table}): ${r.error.message}`);
    }
    toHits(src, (r.data ?? []) as unknown as Record<string, string | null>[]);
  });

  // Nothing in the window: the newest row per source for that person.
  const quiet = ids.filter((id) => !hits.has(id));
  const sources = SOURCES.filter((s) => s.table !== "audit_log" || auditLog);
  const lookups = quiet.flatMap((id) =>
    sources.flatMap((src) =>
      src.who.map(async (w) => {
        let q = sb
          .from(src.table)
          .select(src.at)
          .eq(w, id)
          .not(src.at, "is", null)
          .order(src.at, { ascending: false })
          .limit(1);
        if (src.only) q = q.eq(src.only[0], src.only[1]);
        const r = await q;
        if (r.error) {
          if (src.table === "audit_log") return;
          throw new Error(`Activity (${src.table}): ${r.error.message}`);
        }
        const row = ((r.data ?? []) as unknown as Record<string, string | null>[])[0];
        if (row) add({ who: id, at: row[src.at] });
      }),
    ),
  );
  await Promise.all(lookups);

  const latest = new Map<string, string>();
  for (const [id, dates] of hits) {
    const last = lastActivity(dates);
    if (last) latest.set(id, last);
  }
  return { latest, auditLog };
}
