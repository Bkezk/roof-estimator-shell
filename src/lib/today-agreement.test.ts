/**
 * Audit, Oct 2 — "today", and reading one follow-up:
 *
 *  4. The opportunity's follow-up strip turned red at 12:00 UTC on the due day (it compared the
 *     instant); My Work says "Due today" then. Now both compare calendar days.
 *  7. Two "today"s: My Work used the browser's day; the Opportunities list, the counts strip and
 *     the Owner view used America/New_York. At 23:30 in Chicago (00:30 Eastern, the next day)
 *     an opportunity due that day was "overdue" in three places and "due today" on My Work. Now
 *     the browser sends its day (my-work.ts localYmd) and the server uses it.
 *  9. The strip searched the first 1,000 rows of listFollowups and said "No open follow-up"
 *     past them; now it reads the one item's open follow-up.
 * 14f. A new opportunity's default expected close was today + N on the UTC day.
 */
import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));
vi.mock("@/lib/notify.server", () => ({
  serverClient: async (fallback: unknown) => fallback,
  notify: vi.fn(async () => 0),
}));

import { isFollowupOverdue } from "@/lib/followup-rules";
import { localYmd as browserYmd } from "@/lib/my-work";
import { isOverdueOpp, viewerToday } from "@/lib/work-counts";
import { getWorkCounts } from "@/lib/work-counts.functions";
import { listOwnerView } from "@/lib/owner-view.functions";
import { followupForItem, listFollowups } from "@/lib/followups.functions";
import { defaultExpectedClose, saveOpportunity } from "@/lib/opportunities.functions";
import { fakeSupabase } from "@/test/fake-supabase";

type Row = Record<string, unknown>;
const read = (p: string) => readFileSync(p, "utf8");
const ADMIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const REP = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OPP = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const ACC = "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1";

const call = <T = void>(fn: unknown, data: Row | undefined, db: unknown, userId = ADMIN) =>
  (fn as (a: { data: Row | undefined; context: unknown }) => Promise<T>)({
    data,
    context: { supabase: db, userId },
  });

const savedTz = process.env["TZ"];
beforeAll(() => {
  // The browser of the owner's Chicago rep.
  process.env["TZ"] = "America/Chicago";
  vi.useFakeTimers({ toFake: ["Date"] });
});
afterEach(() => vi.setSystemTime(new Date("2026-10-02T15:00:00Z")));
afterAll(() => {
  vi.useRealTimers();
  if (savedTz === undefined) delete process.env["TZ"];
  else process.env["TZ"] = savedTz;
});

describe("item 4 — the strip is red only once the due day has passed", () => {
  const f = (due_at: string) => ({ due_at, status: "open" });
  it("due today (12:00 UTC, already past at 15:00 UTC): not red", () => {
    vi.setSystemTime(new Date("2026-10-02T15:00:00Z")); // 10:00 in Chicago
    const today = browserYmd(new Date());
    expect(today).toBe("2026-10-02");
    expect(isFollowupOverdue(f("2026-10-02T12:00:00.000Z"), today)).toBe(false);
  });
  it("due yesterday: red", () => {
    vi.setSystemTime(new Date("2026-10-02T15:00:00Z"));
    expect(isFollowupOverdue(f("2026-10-01T12:00:00.000Z"), browserYmd(new Date()))).toBe(true);
  });
  it("a closed one is never red", () => {
    expect(
      isFollowupOverdue({ due_at: "2026-09-01T12:00:00Z", status: "closed" }, "2026-10-02"),
    ).toBe(false);
  });
  it("the page uses it, with the viewer's day (not Date.now())", () => {
    const page = read("src/components/opportunities-page.tsx");
    expect(page).toContain("const overdue = isFollowupOverdue(f, localYmd(new Date()));");
    expect(page).not.toContain("new Date(f.due_at).getTime() < Date.now()");
  });
});

describe("item 7 — at 23:30 in Chicago all four say the same day", () => {
  // 23:30 CDT on Oct 2 = 04:30 UTC Oct 3 = 00:30 EDT Oct 3.
  const AT = new Date("2026-10-03T04:30:00Z");
  const due = "2026-10-02"; // an opportunity due "today" for the Chicago rep
  const tables = () => ({
    profiles: [
      {
        id: ADMIN,
        role: "admin",
        access: [],
        full_name: "Ann Admin",
        email: "a@x",
        technician: false,
      },
      {
        id: REP,
        role: "user",
        access: ["customers"],
        full_name: "Rae Rep",
        email: "r@x",
        technician: false,
      },
    ],
    crm_opportunities: [
      {
        id: OPP,
        assignee_id: REP,
        status: "open",
        expected_close: due,
        est_value: 1000,
        deleted_at: null,
      },
    ],
    service_jobs: [],
    tasks: [],
    crm_followups: [],
    service_job_events: [],
    crm_contact_log: [],
    service_time_entries: [],
    audit_log: [],
  });

  it("My Work's day, the list's, the counts' and the Owner view's are all Oct 2", async () => {
    vi.setSystemTime(AT);
    const myWork = browserYmd(new Date());
    expect(myWork).toBe("2026-10-02");

    // The Opportunities list's day is My Work's (the same helper), so the opportunity is not
    // overdue there.
    const page = read("src/components/opportunities-page.tsx");
    expect(page).toContain('import { localYmd } from "@/lib/my-work";');
    expect(page).not.toContain('import { localYmd } from "@/lib/tasks";');
    expect(isOverdueOpp({ status: "open", expected_close: due }, myWork)).toBe(false);

    // The counts strip's server function, given the browser's day.
    const counts = await call<Row>(getWorkCounts, { today: myWork }, fakeSupabase(tables()).db);
    expect(counts["today"]).toBe("2026-10-02");
    expect(counts["overdueOpps"]).toBe(0);

    // The Owner view, given the browser's day (owner-view.tsx sends it).
    const owner = await call<{ today: string; rows: Row[] }>(
      listOwnerView,
      { today: myWork },
      fakeSupabase(tables()).db,
    );
    expect(owner.today).toBe("2026-10-02");
    const rae = owner.rows.find((r) => r["id"] === REP)!;
    expect(rae["overdue"]).toBe(0);
    expect(read("src/components/owner-view.tsx")).toContain(
      "queryFn: () => fn({ data: { today: localYmd(new Date()) } }),",
    );
  });

  it("without a day sent, the server falls back to the office's (Eastern) day", async () => {
    vi.setSystemTime(AT);
    expect(viewerToday(undefined)).toBe("2026-10-03");
    const counts = await call<Row>(getWorkCounts, undefined, fakeSupabase(tables()).db);
    expect(counts["today"]).toBe("2026-10-03");
    // A nonsense or far-off day is not trusted.
    expect(viewerToday("2026-02-31")).toBe("2026-10-03");
    expect(viewerToday("2026-09-01")).toBe("2026-10-03");
    expect(viewerToday("2026-10-04")).toBe("2026-10-04"); // within a day (east of New York)
  });
});

describe("item 7 — the Customers counts strip sends the viewer's day too", () => {
  it("the strip calls getWorkCounts with localYmd(new Date()) and keys the query by it", () => {
    const src = readFileSync("src/components/work-counts-strip.tsx", "utf8");
    expect(src).toContain('import { localYmd } from "@/lib/my-work";');
    expect(src).toContain("const today = localYmd(new Date());");
    expect(src).toContain("queryFn: () => countsFn({ data: { today } }),");
    expect(src).toContain("queryKey: [...WORK_COUNTS_KEY, today],");
    expect(src).not.toContain("queryFn: () => countsFn(),");
  });
});

describe("item 9 — the strip reads its own item's follow-up", () => {
  it("found past the first 1,000 open follow-ups", async () => {
    const rows: Row[] = Array.from({ length: 1000 }, (_, i) => ({
      id: `f${i}`,
      kind: "ticket",
      item_id: `t${i}`,
      assignee_id: REP,
      status: "open",
      due_at: "2026-10-01T12:00:00Z",
    }));
    rows.push({
      id: "mine",
      kind: "opportunity",
      item_id: OPP,
      assignee_id: REP,
      status: "open",
      due_at: "2027-01-01T12:00:00Z",
    });
    const env = fakeSupabase({
      crm_followups: rows,
      profiles: [{ id: REP, full_name: "Rae Rep", email: "r@x" }],
    });
    // What the strip used to search: the first 1,000.
    const all = await call<Row[]>(listFollowups, {}, env.db);
    expect(all.some((f) => f["item_id"] === OPP)).toBe(false);
    // What it reads now.
    const one = await call<Row | null>(
      followupForItem,
      { kind: "opportunity", item_id: OPP },
      env.db,
    );
    expect(one).toMatchObject({ id: "mine", assignee_name: "Rae Rep" });
    const none = await call<Row | null>(
      followupForItem,
      { kind: "opportunity", item_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" },
      env.db,
    );
    expect(none).toBeNull();
    const page = read("src/components/opportunities-page.tsx");
    expect(page).toContain("const oneFn = useServerFn(followupForItem);");
    expect(page).not.toContain("useServerFn(listFollowups)");
  });
});

describe("item 14f — the default expected close counts from the Eastern day", () => {
  it("Oct 1, 22:00 Eastern (Oct 2 UTC) + 30 days = Oct 31", async () => {
    const at = new Date("2026-10-02T02:00:00Z");
    expect(defaultExpectedClose(30, at)).toBe("2026-10-31");
    vi.setSystemTime(at);
    const env = fakeSupabase({
      profiles: [{ id: ADMIN, role: "admin", access: [], full_name: "Ann", email: "a@x" }],
      crm_opportunities: [],
      crm_followups: [],
      // Every opportunity names a reachable customer and a site (owner, Oct 2).
      crm_accounts: [{ id: ACC, name: "Bell County Schools", phone: "606-555-0100" }],
      crm_sites: [{ id: "s1", account_id: ACC, name: "Gym", deleted_at: null }],
      crm_settings: [
        { id: 1, opportunity_close_days: 30, opportunity_first_days: 3, opportunity_every_days: 7 },
      ],
    });
    const row = await call<Row>(
      saveOpportunity,
      { title: "New one", account_id: ACC, assignee_id: ADMIN },
      env.db,
    );
    expect(row["expected_close"]).toBe("2026-10-31");
  });
});
