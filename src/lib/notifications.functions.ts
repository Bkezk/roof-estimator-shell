/**
 * The Notifications inbox (owner, Oct 12): the full page under /notifications and the header
 * bell's data. Every function runs under the caller's client, so RLS keeps each user to their
 * own rows (notifications_read / notifications_update). Delivery is notify.server.ts'; the
 * follow-up side (listNotifications of the old bell, reminder settings) stays in
 * followups.functions.ts.
 *
 * Paging is a keyset like listMovements (inventory.functions.ts): newest first, `before` is the
 * oldest row already shown (its created_at AND id, so rows sharing a timestamp — one reminder
 * pass inserts several at once — are neither skipped nor repeated). A page shorter than `limit`
 * is the end.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware.hardened";
import type { Database } from "@/integrations/supabase/types";
import {
  SHARED_KINDS,
  noticeExclusions,
  offCategories,
  type NoticeCategory,
} from "@/lib/notice-categories";

export type NotificationRow = Database["public"]["Tables"]["notifications"]["Row"];

/** Rows per page (the bell asks for 30, the page for this). */
export const NOTIFICATIONS_PAGE = 50;

/** The oldest row shown: the next page is what came strictly before it. */
export interface NotificationCursor {
  created_at: string;
  id: number;
}

export const cursorOf = (r: Pick<NotificationRow, "created_at" | "id">): NotificationCursor => ({
  created_at: r.created_at,
  id: r.id,
});

const kindSchema = z.string().trim().min(1).max(40);
const listSchema = z.object({
  limit: z.number().int().min(1).max(200).optional(),
  before: z
    .object({ created_at: z.string().datetime({ offset: true }), id: z.number().int() })
    .optional(),
  unreadOnly: z.boolean().optional(),
  /** One kind string, or several (a label such as Task covers task / task_today / task_overdue). */
  kind: z.union([kindSchema, z.array(kindSchema).min(1).max(20)]).optional(),
});
export type ListMyNotificationsArgs = z.infer<typeof listSchema>;

type Db = SupabaseClient<Database>;

/**
 * The notice categories the caller turned off (Account › Notifications › Which notices you get;
 * notice-categories.ts): their own profiles row, which RLS shows them. A row that cannot be read
 * — the migration not applied yet — turns nothing off.
 */
async function myOffCategories(sb: Db, userId: string): Promise<NoticeCategory[]> {
  const { data } = await sb
    .from("profiles")
    .select("notify_leads, notify_opportunities, notify_service, notify_bids, notify_storms")
    .eq("id", userId)
    .maybeSingle();
  return data ? offCategories(data) : [];
}

/** PostgREST's list form for `in`: the kinds are plain identifiers, nothing to quote. */
const inList = (xs: readonly string[]) => `(${xs.join(",")})`;

/**
 * Leave out the rows of the caller's off categories, in SQL (the list is paged and the count a
 * head request, so not in the server function): `kind not in (…)` for the kind-only kinds of
 * those categories, and for each off category with a link prefix "kind not in (the shared kinds)
 * or url is null or url not like 'prefix%'" — a shared-kind row (assigned, followup, reminder,
 * untouched) is dropped only when its link opens there. Older rows from before the switch was
 * turned off go with it, so the bell clears at once; turning it back on shows them again.
 */
function excludeOff<Q extends { not(c: string, op: string, v: string): Q; or(f: string): Q }>(
  q: Q,
  off: readonly NoticeCategory[],
): Q {
  const ex = noticeExclusions(off);
  if (ex.kinds.length) q = q.not("kind", "in", inList(ex.kinds));
  for (const prefix of ex.urlPrefixes)
    q = q.or(`kind.not.in.${inList(SHARED_KINDS)},url.is.null,url.not.like.${prefix}%`);
  return q;
}

/**
 * One page of the signed-in user's inbox, newest first (created_at desc, id desc). With
 * `before`, the rows that share its timestamp but have a smaller id come first, then everything
 * older: two reads merged, because PostgREST has no row-value comparison.
 */
export const listMyNotifications = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => listSchema.parse(d ?? {}))
  .handler(async ({ data, context }): Promise<NotificationRow[]> => {
    const sb: Db = context.supabase;
    const limit = data.limit ?? NOTIFICATIONS_PAGE;
    const off = await myOffCategories(sb, context.userId);
    const base = () => {
      let q = sb
        .from("notifications")
        .select("*")
        .eq("user_id", context.userId)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(limit);
      q = excludeOff(q, off);
      if (data.unreadOnly) q = q.is("read_at", null);
      if (Array.isArray(data.kind)) q = q.in("kind", data.kind);
      else if (data.kind) q = q.eq("kind", data.kind);
      return q;
    };
    if (!data.before) {
      const { data: rows, error } = await base();
      if (error) throw new Error(error.message);
      return rows ?? [];
    }
    const { created_at, id } = data.before;
    const [tail, older] = await Promise.all([
      base().eq("created_at", created_at).lt("id", id),
      base().lt("created_at", created_at),
    ]);
    if (tail.error) throw new Error(tail.error.message);
    if (older.error) throw new Error(older.error.message);
    return [...(tail.data ?? []), ...(older.data ?? [])].slice(0, limit);
  });

/**
 * Read or unread, one row (unread again makes it a to-do). Only the caller's own row: RLS, and
 * the user_id filter, so a stale id from someone else's inbox changes nothing and says so.
 */
export const markNotificationRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ id: z.number().int(), read: z.boolean() }).parse(d))
  .handler(async ({ data, context }): Promise<{ id: number; read_at: string | null }> => {
    const read_at = data.read ? new Date().toISOString() : null;
    const { error, count } = await context.supabase
      .from("notifications")
      .update({ read_at }, { count: "exact" })
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    if (!count) throw new Error("That notification is not yours, or it was removed");
    return { id: data.id, read_at };
  });

/** Every unread row of the caller's read now; answers how many that was. */
export const markAllNotificationsRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ marked: number }> => {
    const { error, count } = await context.supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() }, { count: "exact" })
      .eq("user_id", context.userId)
      .is("read_at", null);
    if (error) throw new Error(error.message);
    return { marked: count ?? 0 };
  });

/**
 * The real unread count (the old bell counted within its latest 30 rows): a head request, less
 * the rows of the categories the caller turned off (the same exclusion as the list).
 */
export const unreadNotificationCount = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<number> => {
    const sb: Db = context.supabase;
    const off = await myOffCategories(sb, context.userId);
    const { error, count } = await excludeOff(
      sb
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("user_id", context.userId)
        .is("read_at", null),
      off,
    );
    if (error) throw new Error(error.message);
    return count ?? 0;
  });

// ── Pure helpers shared by the bell and the page ───────────────────────────────────────────

/** The badge: a real count, "99+" past two digits. */
export const unreadBadge = (n: number): string => (n > 99 ? "99+" : String(n));

/**
 * What a kind string is called (owner's list). Unknown kinds — "test", "note", whatever a later
 * module adds — are "Other". The kind strings are the ones the modules send to notify():
 * followups.server.ts, notify.server.ts, ticket-events.server.ts, tasks-notify.server.ts,
 * storms.server.ts, leads.server.ts, service-field.functions.ts, bids-notify.server.ts.
 */
export const KIND_LABELS: Readonly<Record<string, string>> = {
  assigned: "Assigned",
  followup: "Reminder",
  reminder: "Reminder",
  untouched: "Untouched",
  ticket_done: "Ticket done",
  ticket_authorized: "Ready to invoice",
  ready_to_invoice: "Ready to invoice",
  mention: "Mention",
  task: "Task",
  task_today: "Task",
  task_overdue: "Task",
  // "Bid due tomorrow" (bids-notify.server.ts; owner, Oct 12), the past-due repeat and the
  // estimator's own "Remind me on" (owner, Oct 13; Admin › Reminders › Bids).
  bid_due: "Bid due",
  bid_overdue: "Bid past due",
  bid_reminder: "Bid reminder",
  storm: "Storm",
  lead: "Lead",
  bid: "Lead",
  rfp: "Lead",
  reassigned: "Reassigned",
  date_moved: "Date moved",
  rescheduled: "Date moved",
  back_from_hold: "Back from hold",
  hold_over: "Back from hold",
  unhold: "Back from hold",
};
export const OTHER_KIND_LABEL = "Other";

export const kindLabel = (kind: string | null | undefined): string =>
  (kind && KIND_LABELS[kind]) || OTHER_KIND_LABEL;

/** The label order of the kind filter: the owner's list, Other last. */
export const KIND_LABEL_ORDER: readonly string[] = [
  "Assigned",
  "Reminder",
  "Untouched",
  "Ticket done",
  "Ready to invoice",
  "Mention",
  "Task",
  "Bid due",
  "Bid past due",
  "Bid reminder",
  "Storm",
  "Lead",
  "Reassigned",
  "Date moved",
  "Back from hold",
  OTHER_KIND_LABEL,
];

/**
 * The kind filter's chips from the kinds present: one chip per label, each carrying the raw
 * kind strings it stands for (the server filters `kind in (...)`), in the owner's order.
 */
export function kindChips(kinds: Iterable<string>): { label: string; kinds: string[] }[] {
  const byLabel = new Map<string, Set<string>>();
  for (const k of kinds) {
    const label = kindLabel(k);
    (byLabel.get(label) ?? byLabel.set(label, new Set()).get(label)!).add(k);
  }
  return KIND_LABEL_ORDER.filter((l) => byLabel.has(l)).map((label) => ({
    label,
    kinds: [...byLabel.get(label)!].sort(),
  }));
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * The day group a row belongs to, in the viewer's local time: "Today", "Yesterday", then
 * "Friday, Oct 10" within the year and "Oct 10, 2025" before it. An unreadable time is "Earlier".
 */
export function dayLabel(iso: string, now: Date = new Date()): string {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return "Earlier";
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(t)) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  const md = `${MONTHS[t.getMonth()]} ${t.getDate()}`;
  if (t.getFullYear() === now.getFullYear()) return `${DAYS[t.getDay()]}, ${md}`;
  return `${md}, ${t.getFullYear()}`;
}

/** Rows grouped by day, in the order given (newest first keeps Today on top). */
export function groupByDay<T extends { created_at: string }>(
  rows: readonly T[],
  now: Date = new Date(),
): { label: string; rows: T[] }[] {
  const out: { label: string; rows: T[] }[] = [];
  for (const r of rows) {
    const label = dayLabel(r.created_at, now);
    const last = out[out.length - 1];
    if (last && last.label === label) last.rows.push(r);
    else out.push({ label, rows: [r] });
  }
  return out;
}
