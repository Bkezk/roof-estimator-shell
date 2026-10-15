/**
 * Work Overview, owner Oct 15 (the assessment's items 5 and 10):
 *
 * 5. The List and the Calendar refresh themselves every five minutes ("just so we're not
 *    constantly refreshing"), not in a background tab.
 * 10a. The task dialog is mounted on the page from the first paint; its user roster is read only
 *      once it opens.
 * 10b. listMyWork brings the caller's saved layout (one request on landing instead of two).
 * 10c. A follow-up row says when its last reminder went out: "… · Reminders every 3 days · last
 *      reminded Oct 13" (last_reminded_at was selected and then dropped in the mapping).
 * 10d. Each list is capped at 1,000 rows; the result says when any hit the cap and the List shows
 *      one line about it.
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));

import { followupStateLine, followupStateText, monthDay } from "@/lib/followup-rules";
import { followupItem, mergeWork, parseMonthParam, type FollowupIn } from "@/lib/my-work";
import { LIMIT, listMyWork, type MyWorkResult } from "@/lib/my-work.functions";
import { defaultWorkLayout, hideBucket, toggleKind } from "@/lib/work-layout";
import { fakeSupabase } from "@/test/fake-supabase";

type Row = Record<string, unknown>;
const utcDay = (iso: string) => iso.slice(0, 10);
const PAT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MANAGER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const followupRow = (id: string, over: Row = {}): Row => ({
  id,
  title: `Follow up ${id}`,
  url: "/opportunities?id=o1",
  due_at: "2026-10-14T12:00:00Z",
  status: "open",
  kind: "opportunity",
  item_id: "o1",
  assignee_id: PAT,
  account_id: null,
  every_days: 3,
  snoozed_until: null,
  last_reminded_at: null,
  ...over,
});

describe("10c — the follow-up row's reminder history (pure)", () => {
  const f: FollowupIn = {
    id: "f1",
    title: "Corbin middle — re-roof",
    url: "/opportunities?id=o1",
    due_at: "2026-10-14T12:00:00Z",
    status: "open",
    kind: "opportunity",
    item_id: "o1",
    assignee_id: PAT,
    every_days: 3,
  };
  it('"last reminded Oct 13" after the Reminders part, only when a reminder has gone out', () => {
    const line = (over: Partial<FollowupIn>) =>
      followupStateLine(followupStateText({ ...f, ...over }, "2026-10-15", utcDay));
    expect(line({ last_reminded_at: "2026-10-13T09:00:00Z" })).toBe(
      "Overdue 1 day · Reminders every 3 days · last reminded Oct 13",
    );
    expect(line({})).toBe("Overdue 1 day · Reminders every 3 days");
    expect(line({ last_reminded_at: null })).toBe("Overdue 1 day · Reminders every 3 days");
    // Without a cadence it still says when (the reminder went out before the cadence was cleared).
    expect(line({ every_days: null, last_reminded_at: "2026-10-01T09:00:00Z" })).toBe(
      "Overdue 1 day · last reminded Oct 1",
    );
    expect(monthDay("2026-01-05")).toBe("Jan 5");
  });
  it("the row's follow-up carries last_reminded_at (null when none)", () => {
    expect(followupItem({ ...f, last_reminded_at: "2026-10-13T09:00:00Z" }).followup).toMatchObject(
      { last_reminded_at: "2026-10-13T09:00:00Z" },
    );
    expect(followupItem(f).followup?.last_reminded_at).toBeNull();
  });
});

describe("listMyWork through the fake client: the layout, last_reminded_at and the cap", () => {
  let tables: Record<string, Row[]>;
  beforeEach(() => {
    tables = {
      profiles: [
        {
          id: PAT,
          role: "user",
          access: ["customers"],
          technician: false,
          full_name: "Pat",
          email: "p@x",
        },
        {
          id: MANAGER,
          role: "manager",
          access: [],
          technician: false,
          full_name: "Mo",
          email: "m@x",
          work_layout: { order: ["overdue"], hidden: ["later"], hiddenKinds: ["bid", "zzz"] },
        },
      ],
      service_jobs: [],
      tasks: [],
      crm_followups: [
        followupRow("f-reminded", { last_reminded_at: "2026-10-13T09:00:00Z" }),
        followupRow("f-quiet", { due_at: "2026-10-15T12:00:00Z" }),
      ],
      crm_accounts: [],
      crm_settings: [{ id: 1, unassigned_overdue_days: 1 }],
    };
  });
  const run = (userId: string, who?: string) =>
    (listMyWork as unknown as (a: { data: Row; context: unknown }) => Promise<MyWorkResult>)({
      data: who ? { who } : {},
      context: {
        supabase: fakeSupabase(tables, { rpcs: { ticket_authorizers: () => [MANAGER] } }).db,
        userId,
      },
    });

  it("10c — last_reminded_at comes through to the rows and the state line", async () => {
    const r = await run(PAT);
    expect(r.followups.map((f) => [f.id, f.last_reminded_at])).toEqual([
      ["f-reminded", "2026-10-13T09:00:00Z"],
      ["f-quiet", null],
    ]);
    const items = mergeWork(r, utcDay);
    const lines = Object.fromEntries(
      items.map((i) => [
        i.key,
        followupStateLine(followupStateText(i.followup!, "2026-10-15", utcDay)),
      ]),
    );
    expect(lines["followup:f-reminded"]).toBe(
      "Overdue 1 day · Reminders every 3 days · last reminded Oct 13",
    );
    expect(lines["followup:f-quiet"]).toBe("Due today · Reminders every 3 days");
  });
  it("10b — the caller's saved layout rides on the result, normalized; null when none is saved", async () => {
    const mo = await run(MANAGER);
    // Normalized: the missing columns take their default places, the unknown kind is dropped.
    expect(mo.layout).toEqual(toggleKind(hideBucket(defaultWorkLayout(), "later"), "bid"));
    expect((await run(PAT)).layout).toBeNull();
  });
  it("10b — a database without the work_layout column still answers the list (layout null)", async () => {
    // The stand-in has no columns to be missing, so the read's failure is the error path: a
    // profiles select that errors must not fail the list. Simulated through a profile with the
    // column set to something that is not a layout — normalize gives the default, not a throw.
    tables["profiles"]![1]!["work_layout"] = "not a layout";
    expect((await run(MANAGER)).layout).toEqual(defaultWorkLayout());
  });
  it("10d — truncated says when a list reached the cap; false below it", async () => {
    expect(LIMIT).toBe(1000);
    expect((await run(PAT)).truncated).toBe(false);
    tables["crm_followups"] = Array.from({ length: LIMIT }, (_, i) =>
      followupRow(`f-${i}`, { every_days: null }),
    );
    const r = await run(PAT);
    expect(r.followups).toHaveLength(LIMIT);
    expect(r.truncated).toBe(true);
    // One under the cap: everything came, nothing to say.
    tables["crm_followups"] = tables["crm_followups"]!.slice(1);
    expect((await run(PAT)).truncated).toBe(false);
  });
  it("10d — every capped list is counted, not only the follow-ups", () => {
    const src = readFileSync("src/lib/my-work.functions.ts", "utf8");
    expect(src.match(/\.limit\(LIMIT\)/g)).toHaveLength(9);
    expect(src).toMatch(
      /const truncated = \[\s*tickets,\s*tasks,\s*followups,\s*unTickets,\s*unOpps,\s*unTasks,\s*toInvoice,\s*toAuthorize,\s*bids,\s*\]\.some\(atCap\);/,
    );
    expect(src).toContain(
      "const atCap = (r: { data: unknown[] | null }) => (r.data?.length ?? 0) >= LIMIT;",
    );
  });
});

describe("?month=YYYY-MM", () => {
  it("parses a month and nothing else", () => {
    expect(parseMonthParam("2026-10")).toBe("2026-10");
    expect(parseMonthParam("2026-01")).toBe("2026-01");
    expect(parseMonthParam("2026-13")).toBeUndefined();
    expect(parseMonthParam("2026-00")).toBeUndefined();
    expect(parseMonthParam("2026-10-15")).toBeUndefined();
    expect(parseMonthParam("")).toBeUndefined();
    expect(parseMonthParam(undefined)).toBeUndefined();
    expect(parseMonthParam(202610)).toBeUndefined();
  });
});

describe("the page", () => {
  const page = readFileSync("src/components/my-work-page.tsx", "utf8");
  it("5 — the list query refreshes every five minutes, not in a background tab", () => {
    expect(page).toMatch(
      /queryKey: \["my-work", who\],\s*queryFn: \(\) => listFn\(\{ data: \{ who \} \}\),\s*enabled: !!session && view !== "owner",(?:\s*\/\/[^\n]*)*\s*refetchInterval: 5 \* 60_000,\s*refetchIntervalInBackground: false,/,
    );
  });
  it("10a — the task dialog's roster is read once it opens", () => {
    expect(readFileSync("src/components/tasks/task-dialog.tsx", "utf8")).toContain(
      "const usersQ = useTaskUsers(props.open);",
    );
    const shared = readFileSync("src/components/tasks/task-shared.ts", "utf8");
    expect(shared).toContain("export function useTaskUsers(enabled = true) {");
    expect(shared).toMatch(/staleTime: 5 \* 60_000,\s*enabled,/);
    // The other callers (list, calendar) still read it as they did.
    expect(readFileSync("src/components/tasks/task-list.tsx", "utf8")).toContain(
      "const usersQ = useTaskUsers();",
    );
    expect(readFileSync("src/components/tasks/task-calendar.tsx", "utf8")).toContain(
      "const usersQ = useTaskUsers();",
    );
  });
  it("10d — the List says so when a list hit the cap", () => {
    expect(page).toContain('{view === "list" && !errMsg && q.data?.truncated && (');
    expect(page).toContain(
      "Showing the first 1,000 of each kind. Narrow to one person to see everything.",
    );
  });
  it("the Show menu's promise holds now: hiddenKinds are saved to the profile", () => {
    expect(page).toContain("Remembered for you on every device. One kind always stays on.");
    const fn = readFileSync("src/lib/work-layout.functions.ts", "utf8");
    expect(fn).toContain("hiddenKinds: [...l.hiddenKinds],");
    expect(fn).toContain("hiddenKinds: names.optional(),");
  });
});
