/**
 * The Owner view on Work Overview — the server side (src/lib/owner-view.ts has the pure rules and the
 * column definitions). Admins only: `listOwnerView` reads the caller's own profile row and
 * throws "Forbidden: admin only" unless its role is admin (`visibleToOwner` = isAdmin) — never a
 * flag from the client. Reads run under the caller's own client (admins read everything by RLS).
 *
 * Last activity reads the last 14 days of each source in bulk (newest first); anyone with nothing
 * in that window gets one newest-row lookup per source. `audit_log` is read defensively: until
 * that table exists (or if it cannot be read) it counts as no rows.
 *
 * `getOwnerPersonDetail` is the expanded row (one person's items and last five actions), loaded
 * on demand; the same admin check comes first.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware.hardened";
import type { Database } from "@/integrations/supabase/types";
import { WORK_TICKET_STAGES, addDays, mergeWork, type TicketIn } from "@/lib/my-work";
import {
  DONE_TICKET_STAGES,
  bucketCounts,
  bucketsFor,
  detailGroups,
  doneItemsFor,
  doneThisWeek,
  lastActivity,
  oppCounts,
  personNumbers,
  recentActivity,
  roleLabel,
  sortOwnerRows,
  staleness,
  visibleToOwner,
  weekRange,
  type ActivityItem,
  type ActivityRow,
  type DetailItem,
  type DoneItem,
  type OwnerRow,
} from "@/lib/owner-view";
import { localYmd, zonedTime } from "@/lib/tasks";
import { OPEN_OPP_STATUSES, parseTodayInput, viewerToday } from "@/lib/work-counts";

export interface OwnerViewResult {
  /** The day (YYYY-MM-DD) the numbers are for: the viewer's (sent by the browser, as Work Overview
   *  uses), else the office's (Eastern) — viewerToday. */
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
  // The viewer's day (audit, Oct 2: the Owner view used the Eastern day, Work Overview the browser's).
  .validator((d: unknown) => parseTodayInput(d))
  .handler(async ({ data, context }): Promise<OwnerViewResult> => {
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
    const today = viewerToday(data.today, now);
    const week = weekRange(today);
    const weekFrom = zonedTime(week.start, "00:00").toISOString();
    const weekTo = zonedTime(addDays(week.end, 1), "00:00").toISOString();
    const since = new Date(now.getTime() - ACTIVITY_DAYS * 86_400_000).toISOString();

    const [profiles, tickets, tasks, followups, opps, doneTickets, doneTasks] = await Promise.all([
      sb.from("profiles").select("id, full_name, email, role, technician, access"),
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
        .select("id, assignee_id, status, expected_close, est_value")
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
    const followupRows = must("Follow-ups", followups);
    const items = mergeWork(
      {
        tickets: must("Tickets", tickets) as TicketIn[],
        tasks: must("Tasks", tasks),
        followups: followupRows.map((f) => ({
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
    // An overdue opportunity with an open follow-up is already in the Overdue bucket as that
    // follow-up: counted once (owner-view.ts oppCounts).
    const oppsBy = oppCounts(must("Opportunities", opps), today, followupRows);
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
      const last = latest.get(p.id) ?? null;
      return {
        id: p.id,
        name: nameOf(p),
        role: roleLabel(p),
        ...personNumbers(bucketsFor(buckets, p.id), oppsBy[p.id]),
        doneThisWeek: doneBy[p.id] ?? 0,
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

// ---- one person's detail (the expanded row) ------------------------------------------------

export interface OwnerPersonDetail {
  /** Their Work Overview items due today — what the row's Due today counts. */
  today: DetailItem[];
  /** Their overdue Work Overview items and opportunities past expected close — the row's Overdue. */
  overdue: DetailItem[];
  /** Tickets completed and tasks done this Mon–Sun week — the row's Done this week. */
  doneThisWeek: DoneItem[];
  /** Their last five actions, newest first. */
  recent: ActivityItem[];
}

/** Rows read per activity source (some are dropped as repeats before the newest five). */
const RECENT_PER_SOURCE = 20;

/**
 * The expanded row: one person's Today / Overdue / Done this week items and last five actions,
 * loaded on demand. Admins only, like `listOwnerView`: the caller's own profile role is checked
 * before anything else is read; `userId` only says whose detail to read.
 */
export const getOwnerPersonDetail = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => ({
    ...z.object({ userId: z.string().uuid() }).parse(d),
    ...parseTodayInput(d),
  }))
  .handler(async ({ data, context }): Promise<OwnerPersonDetail> => {
    const sb = context.supabase;
    // The role comes from the caller's own profile row — never from the client.
    const { data: me, error: meErr } = await sb
      .from("profiles")
      .select("id, role")
      .eq("id", context.userId)
      .maybeSingle();
    if (meErr) throw new Error(meErr.message);
    if (!me || !visibleToOwner(me)) throw new Error("Forbidden: admin only");

    const userId = data.userId;
    const now = new Date();
    const today = viewerToday(data.today, now);
    const week = weekRange(today);
    const weekFrom = zonedTime(week.start, "00:00").toISOString();
    const weekTo = zonedTime(addDays(week.end, 1), "00:00").toISOString();
    const toYmd = (iso: string) => localYmd(new Date(iso));
    // Untyped for the activity reads: audit_log may not exist yet (read defensively).
    const raw = sb as unknown as SupabaseClient;

    const [tickets, tasks, followups, opps, doneTickets, doneTasks] = await Promise.all([
      sb
        .from("service_jobs")
        .select(
          "id, number, customer_name, site_name, site_address, description, service_type, stage, scheduled_date, technician_id",
        )
        .is("deleted_at", null)
        .in("stage", [...WORK_TICKET_STAGES])
        .eq("technician_id", userId)
        .limit(LIMIT),
      sb
        .from("tasks")
        .select("id, title, due_date, status, building_id, assignee, assignee_name")
        .neq("status", "done")
        .eq("assignee", userId)
        .limit(LIMIT),
      // Every column: snoozed_until may not exist yet (see my-work.functions.ts).
      sb
        .from("crm_followups")
        .select("*")
        .eq("status", "open")
        .eq("assignee_id", userId)
        .limit(LIMIT),
      sb
        .from("crm_opportunities")
        .select("id, title, account_id, assignee_id, status, expected_close, est_value")
        .is("deleted_at", null)
        .in("status", [...OPEN_OPP_STATUSES])
        .eq("assignee_id", userId)
        .limit(LIMIT),
      sb
        .from("service_jobs")
        .select(
          "id, number, description, customer_name, site_name, service_type, technician_id, stage, completed_at",
        )
        .is("deleted_at", null)
        .in("stage", [...DONE_TICKET_STAGES])
        .eq("technician_id", userId)
        .gte("completed_at", weekFrom)
        .lt("completed_at", weekTo)
        .limit(LIMIT),
      sb
        .from("tasks")
        .select("id, title, building_id, assignee, status, done_at")
        .eq("status", "done")
        .eq("assignee", userId)
        .gte("done_at", weekFrom)
        .lt("done_at", weekTo)
        .limit(LIMIT),
    ]);
    const ticketRows = must("Tickets", tickets) as TicketIn[];
    const taskRows = must("Tasks", tasks);
    const followupRows = must("Follow-ups", followups);
    const oppRows = must("Opportunities", opps);
    const doneTicketRows = must("Done tickets", doneTickets);
    const doneTaskRows = must("Done tasks", doneTasks);

    const activity = await loadPersonActivity(raw, userId);

    // Labels: buildings (tasks), customers (follow-ups, opportunities), ticket numbers and
    // opportunity titles (activity lines). Best effort: an unreadable label is left blank.
    const buildingIds = uniq(
      [...taskRows, ...doneTaskRows, ...activity.tasks].map((t) => t.building_id),
    );
    const accountIds = uniq([...followupRows, ...oppRows].map((r) => r.account_id));
    const ticketIds = uniq([
      ...activity.events.map((e) => e.service_job_id),
      ...activity.contacts.filter((c) => c.kind === "ticket").map((c) => c.item_id),
      ...activity.times.map((t) => t.service_job_id),
    ]);
    const oppIds = uniq(
      activity.contacts.filter((c) => c.kind === "opportunity").map((c) => c.item_id),
    );
    const [buildings, accounts, ticketRefs, oppRefs] = await Promise.all([
      buildingIds.length
        ? sb.from("buildings").select("id, name, address1, city").in("id", buildingIds)
        : null,
      accountIds.length ? sb.from("crm_accounts").select("id, name").in("id", accountIds) : null,
      ticketIds.length ? sb.from("service_jobs").select("id, number").in("id", ticketIds) : null,
      oppIds.length ? sb.from("crm_opportunities").select("id, title").in("id", oppIds) : null,
    ]);
    const buildingLabel = new Map(
      (buildings?.data ?? []).map((b) => [
        b.id,
        [b.name, [b.address1, b.city].filter(Boolean).join(", ")].filter(Boolean).join(" · "),
      ]),
    );
    const accountName = new Map((accounts?.data ?? []).map((a) => [a.id, a.name]));
    const ticketById = new Map((ticketRefs?.data ?? []).map((t) => [t.id, t]));
    const oppById = new Map((oppRefs?.data ?? []).map((o) => [o.id, o]));
    const label = (id: string | null) => (id ? (buildingLabel.get(id) ?? null) : null);

    const items = mergeWork(
      {
        tickets: ticketRows,
        tasks: taskRows.map((t) => ({ ...t, building_label: label(t.building_id) })),
        followups: followupRows.map((f) => ({
          id: f.id,
          title: f.title,
          url: f.url,
          due_at: f.due_at,
          status: f.status,
          kind: f.kind,
          item_id: f.item_id,
          assignee_id: f.assignee_id,
          account_name: f.account_id ? (accountName.get(f.account_id) ?? null) : null,
        })),
      },
      toYmd,
    );
    const groups = detailGroups(
      userId,
      items,
      oppRows.map((o) => ({
        ...o,
        customer: o.account_id ? (accountName.get(o.account_id) ?? null) : null,
      })),
      today,
      followupRows,
    );
    const done = doneItemsFor(
      userId,
      doneTicketRows,
      doneTaskRows.map((t) => ({ ...t, building_label: label(t.building_id) })),
      week,
      toYmd,
    );

    const ref = (id: string) => ticketById.get(id) ?? null;
    const rows: ActivityRow[] = [
      ...activity.events.map((e): ActivityRow => ({
        source: "event",
        at: e.at,
        kind: e.kind,
        stage: e.stage,
        field_status: e.field_status,
        note: e.note,
        ticketId: e.service_job_id,
        ticket: ref(e.service_job_id),
      })),
      ...activity.contacts.map((c): ActivityRow => ({
        source: "contact",
        at: c.at,
        kind: c.kind,
        method: c.method,
        itemId: c.item_id,
        ticket: c.kind === "ticket" ? ref(c.item_id) : null,
        opportunity: c.kind === "opportunity" ? (oppById.get(c.item_id) ?? null) : null,
      })),
      ...activity.tasks.map((t): ActivityRow => ({
        source: "task",
        at: t.done_at,
        title: t.title,
        building_id: t.building_id,
      })),
      ...activity.times.map((t): ActivityRow => ({
        source: "time",
        at: t.created_at,
        kind: t.kind,
        hours: t.hours,
        origin: t.source,
        loggedByThem: t.created_by === userId,
        ticketId: t.service_job_id,
        ticket: ref(t.service_job_id),
      })),
      ...activity.audit.map((a): ActivityRow => ({
        source: "audit",
        at: a.at,
        entity: a.entity,
        entity_id: a.entity_id,
        action: a.action,
        summary: a.summary,
      })),
    ];

    return {
      today: groups.today,
      overdue: groups.overdue,
      doneThisWeek: done,
      recent: recentActivity(rows, 5),
    };
  });

const uniq = (ids: (string | null | undefined)[]): string[] => [
  ...new Set(ids.filter((x): x is string => !!x)),
];

interface PersonActivity {
  events: {
    service_job_id: string;
    kind: string;
    stage: string | null;
    field_status: string | null;
    note: string | null;
    at: string;
  }[];
  contacts: { kind: string; item_id: string; method: string; at: string }[];
  tasks: { title: string; building_id: string | null; done_at: string }[];
  times: {
    id: number;
    service_job_id: string;
    kind: string;
    hours: number;
    source: string;
    created_by: string | null;
    created_at: string;
  }[];
  audit: {
    at: string;
    entity: string;
    entity_id: string | null;
    action: string;
    summary: string | null;
  }[];
}

/**
 * The newest rows of each activity source for one person (the same sources and person columns
 * as Last activity). audit_log errors (missing table) count as no rows.
 */
async function loadPersonActivity(sb: SupabaseClient, userId: string): Promise<PersonActivity> {
  const newest = (table: string, cols: string, who: string, at: string) =>
    sb
      .from(table)
      .select(cols)
      .eq(who, userId)
      .not(at, "is", null)
      .order(at, { ascending: false })
      .limit(RECENT_PER_SOURCE);
  const timeCols = "id, service_job_id, kind, hours, source, created_by, created_at";
  const [events, contacts, tasks, timesBy, timesFor, audit] = await Promise.all([
    newest(
      "service_job_events",
      "service_job_id, kind, stage, field_status, note, at",
      "by_user",
      "at",
    ),
    newest("crm_contact_log", "kind, item_id, method, at", "by_user", "at"),
    newest("tasks", "title, building_id, done_at", "assignee", "done_at").eq("status", "done"),
    newest("service_time_entries", timeCols, "created_by", "created_at"),
    newest("service_time_entries", timeCols, "technician_id", "created_at"),
    newest("audit_log", "at, entity, entity_id, action, summary", "by_user", "at"),
  ]);
  const rowsOf = <T>(label: string, r: { data: unknown; error: { message: string } | null }) => {
    if (r.error) throw new Error(`Activity (${label}): ${r.error.message}`);
    return (r.data ?? []) as T[];
  };
  // One entry both logged by and credited to them is one action.
  const times = new Map<number, PersonActivity["times"][number]>();
  for (const t of [
    ...rowsOf<PersonActivity["times"][number]>("service_time_entries", timesBy),
    ...rowsOf<PersonActivity["times"][number]>("service_time_entries", timesFor),
  ])
    times.set(t.id, t);
  return {
    events: rowsOf("service_job_events", events),
    contacts: rowsOf("crm_contact_log", contacts),
    tasks: rowsOf("tasks", tasks),
    times: [...times.values()],
    audit: audit.error ? [] : ((audit.data ?? []) as unknown as PersonActivity["audit"]),
  };
}
