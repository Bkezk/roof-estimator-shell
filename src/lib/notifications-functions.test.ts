/**
 * The Notifications inbox's server functions (owner, Oct 12), against the in-memory client:
 *   listMyNotifications  — own rows only, newest first, keyset paging on created_at + id (rows
 *                          sharing a timestamp are neither skipped nor repeated), unreadOnly,
 *                          one kind or several;
 *   markNotificationRead — read / unread toggle, own row only (a stray id changes nothing);
 *   markAllNotificationsRead — every unread row of the caller's, nobody else's;
 *   unreadNotificationCount  — a real count (count: "exact", head: true), not the bell's 30.
 * Plus the pure helpers the bell and the page share: the badge, the kind labels and chips, the
 * day groups.
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));

import {
  KIND_LABELS,
  NOTIFICATIONS_PAGE,
  cursorOf,
  dayLabel,
  groupByDay,
  kindChips,
  kindLabel,
  listMyNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  unreadBadge,
  unreadNotificationCount,
} from "@/lib/notifications.functions";

import { fakeSupabase } from "@/test/fake-supabase";

type Row = Record<string, unknown>;
const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const src = readFileSync("src/lib/notifications.functions.ts", "utf8");

type Fn<A, R> = (a: { data?: A; context: unknown }) => Promise<R>;
const call = <A, R>(fn: unknown, data?: A, userId = ME) =>
  (fn as Fn<A, R>)({ data, context: { supabase: env.db, userId } } as never);
/** Refused input (the stand-in throws while validating; the real function rejects). */
const refuses = (fn: unknown, data: unknown) =>
  expect(Promise.resolve().then(() => call(fn, data))).rejects.toThrow();

const row = (id: number, created_at: string, extra: Row = {}): Row => ({
  id,
  user_id: ME,
  kind: "assigned",
  title: `n${id}`,
  body: null,
  url: `/service?id=${id}`,
  followup_id: null,
  created_at,
  read_at: null,
  email_sent_at: null,
  email_error: null,
  push_sent_at: null,
  push_error: null,
  ...extra,
});

let env: ReturnType<typeof fakeSupabase>;
beforeEach(() => {
  // Newest first, as the server orders them (the stand-in keeps insertion order). Rows 5, 4, 3
  // share one timestamp — one reminder pass inserted them together.
  env = fakeSupabase({
    notifications: [
      row(7, "2026-10-12T15:00:00+00:00", { kind: "mention", read_at: null }),
      row(6, "2026-10-12T14:00:00+00:00", {
        kind: "task_overdue",
        read_at: "2026-10-12T14:30:00Z",
      }),
      row(5, "2026-10-11T09:00:00+00:00", { kind: "followup" }),
      row(4, "2026-10-11T09:00:00+00:00", { kind: "followup", read_at: "2026-10-11T10:00:00Z" }),
      row(3, "2026-10-11T09:00:00+00:00", { kind: "followup" }),
      row(2, "2026-10-01T09:00:00+00:00", { kind: "ticket_done" }),
      row(1, "2025-12-31T23:00:00+00:00", { kind: "test" }),
      row(99, "2026-10-12T16:00:00+00:00", { user_id: OTHER }),
    ],
  });
});

const ids = (rows: Row[]) => rows.map((r) => r["id"]);

describe("listMyNotifications", () => {
  it("own rows only, by default one page of NOTIFICATIONS_PAGE", async () => {
    const rows = await call<object, Row[]>(listMyNotifications);
    expect(ids(rows)).toEqual([7, 6, 5, 4, 3, 2, 1]);
    expect(NOTIFICATIONS_PAGE).toBe(50);
    expect(src).toContain('.order("created_at", { ascending: false })');
    expect(src).toContain('.order("id", { ascending: false })');
    expect(src).toContain('.eq("user_id", context.userId)');
  });
  it("limit caps the page", async () => {
    const rows = await call<object, Row[]>(listMyNotifications, { limit: 2 });
    expect(ids(rows)).toEqual([7, 6]);
  });
  it("the cursor is created_at AND id: rows sharing the timestamp are neither skipped nor repeated", async () => {
    // Page 1 ended on row 5 (09:00); rows 4 and 3 share that second.
    const page = await call<object, Row[]>(listMyNotifications, {
      limit: 3,
      before: cursorOf({ id: 5, created_at: "2026-10-11T09:00:00+00:00" }),
    });
    expect(ids(page)).toEqual([4, 3, 2]);
    const next = await call<object, Row[]>(listMyNotifications, {
      limit: 3,
      before: cursorOf({ id: 2, created_at: "2026-10-01T09:00:00+00:00" }),
    });
    expect(ids(next)).toEqual([1]);
  });
  it("a cursor on the last of a shared second goes straight to older rows", async () => {
    const page = await call<object, Row[]>(listMyNotifications, {
      before: { id: 3, created_at: "2026-10-11T09:00:00+00:00" },
    });
    expect(ids(page)).toEqual([2, 1]);
  });
  it("unreadOnly keeps read_at null rows (and pages within them)", async () => {
    const rows = await call<object, Row[]>(listMyNotifications, { unreadOnly: true });
    expect(ids(rows)).toEqual([7, 5, 3, 2, 1]);
    const page = await call<object, Row[]>(listMyNotifications, {
      unreadOnly: true,
      limit: 2,
      before: { id: 5, created_at: "2026-10-11T09:00:00+00:00" },
    });
    expect(ids(page)).toEqual([3, 2]);
  });
  it("kind: one string, or the several a label stands for", async () => {
    expect(ids(await call<object, Row[]>(listMyNotifications, { kind: "followup" }))).toEqual([
      5, 4, 3,
    ]);
    expect(
      ids(
        await call<object, Row[]>(listMyNotifications, {
          kind: ["mention", "task_overdue", "task"],
        }),
      ),
    ).toEqual([7, 6]);
  });
  it("rejects a bad cursor or an empty kind list", async () => {
    await refuses(listMyNotifications, { before: { id: 1, created_at: "yesterday" } });
    await refuses(listMyNotifications, { kind: [] });
    await refuses(listMyNotifications, { limit: 0 });
  });
});

describe("markNotificationRead", () => {
  it("read, then unread again (a to-do), own row only", async () => {
    const r1 = await call<object, { id: number; read_at: string | null }>(markNotificationRead, {
      id: 5,
      read: true,
    });
    expect(r1.id).toBe(5);
    expect(r1.read_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(env.tables["notifications"]!.find((r) => r["id"] === 5)!["read_at"]).toBe(r1.read_at);
    const r2 = await call<object, { id: number; read_at: string | null }>(markNotificationRead, {
      id: 5,
      read: false,
    });
    expect(r2.read_at).toBeNull();
    expect(env.tables["notifications"]!.find((r) => r["id"] === 5)!["read_at"]).toBeNull();
    expect(env.writes.map((w) => w.filters)).toEqual([
      ["eq id=5", `eq user_id=${ME}`],
      ["eq id=5", `eq user_id=${ME}`],
    ]);
  });
  it("someone else's row: nothing changes and it says so", async () => {
    await expect(
      call<object, unknown>(markNotificationRead, { id: 99, read: true }),
    ).rejects.toThrow(/not yours/);
    expect(env.writes).toEqual([]);
    expect(env.tables["notifications"]!.find((r) => r["id"] === 99)!["read_at"]).toBeNull();
  });
  it("needs an integer id and a boolean", async () => {
    await refuses(markNotificationRead, { id: "5", read: true });
    await refuses(markNotificationRead, { id: 5 });
  });
});

describe("markAllNotificationsRead", () => {
  it("every unread row of mine, none of anyone else's; answers how many", async () => {
    const r = await call<undefined, { marked: number }>(markAllNotificationsRead);
    expect(r.marked).toBe(5);
    const mine = env.tables["notifications"]!.filter((x) => x["user_id"] === ME);
    expect(mine.every((x) => x["read_at"])).toBe(true);
    // The already-read rows keep their own read_at.
    expect(mine.find((x) => x["id"] === 6)!["read_at"]).toBe("2026-10-12T14:30:00Z");
    expect(env.tables["notifications"]!.find((x) => x["id"] === 99)!["read_at"]).toBeNull();
    expect(env.writes).toHaveLength(1);
    expect(env.writes[0]!.filters).toEqual([`eq user_id=${ME}`, "is read_at=null"]);
  });
  it("nothing unread: zero, no write", async () => {
    for (const r of env.tables["notifications"]!) r["read_at"] = "2026-10-12T00:00:00Z";
    const r = await call<undefined, { marked: number }>(markAllNotificationsRead);
    expect(r.marked).toBe(0);
    expect(env.writes).toEqual([]);
  });
});

describe("unreadNotificationCount", () => {
  it("counts every unread row of mine, however many (not the bell's 30)", async () => {
    expect(await call<undefined, number>(unreadNotificationCount)).toBe(5);
    for (let i = 0; i < 120; i++)
      env.tables["notifications"]!.push(row(1000 + i, "2026-09-01T00:00:00+00:00"));
    expect(await call<undefined, number>(unreadNotificationCount)).toBe(125);
    expect(await call<undefined, number>(unreadNotificationCount, undefined, OTHER)).toBe(1);
  });
  it("is a head request with an exact count", () => {
    const fn = src.slice(src.indexOf("export const unreadNotificationCount"));
    const body = fn.slice(0, fn.indexOf("\n  });\n"));
    expect(body).toContain('.select("id", { count: "exact", head: true })');
    expect(body).toContain('.is("read_at", null)');
    expect(body).toContain("return count ?? 0;");
  });
});

describe("the shared helpers", () => {
  it("the badge is the real count, 99+ past two digits", () => {
    expect(unreadBadge(0)).toBe("0");
    expect(unreadBadge(12)).toBe("12");
    expect(unreadBadge(99)).toBe("99");
    expect(unreadBadge(100)).toBe("99+");
    expect(unreadBadge(1234)).toBe("99+");
  });
  it("kind labels: the owner's list, unknown kinds Other", () => {
    expect(kindLabel("assigned")).toBe("Assigned");
    expect(kindLabel("followup")).toBe("Reminder");
    expect(kindLabel("untouched")).toBe("Untouched");
    expect(kindLabel("ticket_done")).toBe("Ticket done");
    expect(kindLabel("ticket_authorized")).toBe("Ready to invoice");
    expect(kindLabel("mention")).toBe("Mention");
    expect(kindLabel("task")).toBe("Task");
    expect(kindLabel("task_today")).toBe("Task");
    expect(kindLabel("task_overdue")).toBe("Task");
    expect(kindLabel("bid_due")).toBe("Bid due"); // "Bid due tomorrow" (owner, Oct 12)
    expect(kindLabel("bid_overdue")).toBe("Bid past due"); // the past-due repeat (Oct 13)
    expect(kindLabel("bid_reminder")).toBe("Bid reminder"); // the estimator's own date (Oct 13)
    expect(kindLabel("storm")).toBe("Storm");
    expect(kindLabel("lead")).toBe("Lead");
    expect(kindLabel("reassigned")).toBe("Reassigned");
    expect(kindLabel("date_moved")).toBe("Date moved");
    expect(kindLabel("back_from_hold")).toBe("Back from hold");
    expect(kindLabel("test")).toBe("Other");
    expect(kindLabel("")).toBe("Other");
    expect(kindLabel(null)).toBe("Other");
    expect(new Set(Object.values(KIND_LABELS)).size).toBe(15);
  });
  it("chips: one per label present, in the owner's order, carrying the raw kinds", () => {
    expect(
      kindChips(["task_overdue", "test", "mention", "task", "followup", "mention", "nonsense"]),
    ).toEqual([
      { label: "Reminder", kinds: ["followup"] },
      { label: "Mention", kinds: ["mention"] },
      { label: "Task", kinds: ["task", "task_overdue"] },
      { label: "Other", kinds: ["nonsense", "test"] },
    ]);
    expect(kindChips([])).toEqual([]);
  });
  it("day labels: Today, Yesterday, weekday + date this year, date + year before", () => {
    const now = new Date(2026, 9, 12, 8, 0); // Mon Oct 12 2026, local
    expect(dayLabel(new Date(2026, 9, 12, 0, 1).toISOString(), now)).toBe("Today");
    expect(dayLabel(new Date(2026, 9, 11, 23, 59).toISOString(), now)).toBe("Yesterday");
    expect(dayLabel(new Date(2026, 9, 9, 12, 0).toISOString(), now)).toBe("Friday, Oct 9");
    expect(dayLabel(new Date(2025, 11, 31, 12, 0).toISOString(), now)).toBe("Dec 31, 2025");
    expect(dayLabel("not a date", now)).toBe("Earlier");
  });
  it("groups keep the order given and merge neighbours of one day", () => {
    const now = new Date(2026, 9, 12, 8, 0);
    const at = (d: number, h: number) => new Date(2026, 9, d, h).toISOString();
    const g = groupByDay(
      [
        { id: 1, created_at: at(12, 7) },
        { id: 2, created_at: at(12, 1) },
        { id: 3, created_at: at(11, 20) },
        { id: 4, created_at: at(9, 9) },
      ],
      now,
    );
    expect(g.map((x) => [x.label, x.rows.map((r) => r.id)])).toEqual([
      ["Today", [1, 2]],
      ["Yesterday", [3]],
      ["Friday, Oct 9", [4]],
    ]);
  });
});
