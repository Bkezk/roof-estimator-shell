/**
 * Follow-up holds (owner, Oct 9). A snooze has a date and a reason; a held item waits under
 * "Waiting" on Work Overview and says who held it and why; logging a contact with "They asked to
 * try again on" holds the follow-up too (the assignee may); a hold is skipped by the untouched
 * escalation; the first reminder after a hold reads "Back from hold"; every hold is a line on
 * the item's record and counted. Pure rules (lib/followup-holds.ts, followup-rules.ts,
 * my-work.ts, work-layout.ts), the real server functions against the in-memory Supabase stand-in
 * (src/test/fake-supabase.ts; hold_followup is database code, mimicked here), the real reminder
 * pass, and pins on the migration, types and markup.
 */
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));

import { logContact } from "@/lib/contact-log.functions";
import {
  CONTACT_HOLD_NEEDS_NOTE,
  HOLD_ASSIGNEE_OR_MANAGER,
  HOLD_DATE_INVALID,
  HOLD_DATE_TOO_FAR,
  HOLD_DATE_TOO_SOON,
  HOLD_NEEDS_MIGRATION,
  HOLD_NEEDS_REASON,
  HOLD_PRESETS,
  NO_FOLLOWUP_TO_HOLD,
  backFromHold,
  backFromHoldNotice,
  firstReminderAfterHold,
  holdCountText,
  holdDateBounds,
  holdDateProblem,
  holdNote,
  holdReasonProblem,
  isHeldAt,
} from "@/lib/followup-holds";
import { FOLLOWUP_MANAGER_ONLY, followupStateLine, followupStateText } from "@/lib/followup-rules";
import { snoozeFollowup } from "@/lib/followups.functions";
import {
  BUCKET_EMPTY,
  BUCKET_LABELS,
  LIST_BUCKETS,
  bucketOf,
  followupItem,
  listBucketOf,
  listGroups,
  mergeWork,
  type FollowupIn,
} from "@/lib/my-work";
import { dispatchDueReminders, type Client } from "@/lib/notify.server";
import { ALL_DAY_HOUR, TASK_TZ, zonedTime } from "@/lib/tasks";
import { normalizeWorkLayout } from "@/lib/work-layout";
import { claimReminderInMemory } from "@/test/claim-reminder";
import { fakeSupabase, type FakeRpc } from "@/test/fake-supabase";

type Row = Record<string, unknown>;
const read = (p: string) => readFileSync(p, "utf8");
const flat = (s: string) => s.replace(/\s+/g, " ");
const utcDay = (iso: string) => iso.slice(0, 10);

// Friday, Oct 9 2026, 11:00 Eastern: the office's day is 2026-10-09.
const T0 = Date.parse("2026-10-09T15:00:00Z");
const TODAY = "2026-10-09";
const DAY = 86400000;

describe("the date and the reason", () => {
  it("tomorrow through 180 days out", () => {
    expect(holdDateBounds(TODAY)).toEqual({ min: "2026-10-10", max: "2027-04-07" });
    expect(holdDateProblem("2026-10-10", TODAY)).toBeNull();
    expect(holdDateProblem("2027-04-07", TODAY)).toBeNull();
    expect(holdDateProblem(TODAY, TODAY)).toBe(HOLD_DATE_TOO_SOON);
    expect(holdDateProblem("2026-10-01", TODAY)).toBe(HOLD_DATE_TOO_SOON);
    expect(holdDateProblem("2027-04-08", TODAY)).toBe(HOLD_DATE_TOO_FAR);
    expect(holdDateProblem("junk", TODAY)).toBe(HOLD_DATE_INVALID);
    expect(holdDateProblem("2026-02-30", TODAY)).toBe(HOLD_DATE_INVALID);
    expect(holdDateProblem(null, TODAY)).toBe(HOLD_DATE_INVALID);
  });
  it("a reason is 1 to 200 characters", () => {
    expect(holdReasonProblem("Customer asked to call back after the 15th")).toBeNull();
    expect(holdReasonProblem("")).toBe(HOLD_NEEDS_REASON);
    expect(holdReasonProblem("   ")).toBe(HOLD_NEEDS_REASON);
    expect(holdReasonProblem("x".repeat(201))).toBe(HOLD_NEEDS_REASON);
    expect(holdReasonProblem("x".repeat(200))).toBeNull();
  });
  it("the presets are 1 week, 2 weeks, 1 month", () => {
    expect(HOLD_PRESETS).toEqual([
      { label: "1 week", days: 7 },
      { label: "2 weeks", days: 14 },
      { label: "1 month", days: 30 },
    ]);
  });
  it("the Timeline line names the day, the holder and the reason", () => {
    expect(
      holdNote("2026-10-24", "Mo Manager", " Customer asked to call back after the 15th "),
    ).toBe("On hold until Oct 24, 2026 by Mo Manager: Customer asked to call back after the 15th");
    expect(holdNote("2026-10-24", null, "r")).toBe("On hold until Oct 24, 2026 by someone: r");
  });
});

describe("Work Overview: a held item waits", () => {
  const fu = (over: Partial<FollowupIn> = {}): FollowupIn => ({
    id: "f1",
    title: "Reroof — gym",
    url: "/opportunities?id=o1",
    due_at: "2026-10-03T12:00:00Z",
    status: "open",
    kind: "opportunity",
    item_id: "o1",
    assignee_id: "bob",
    every_days: 7,
    snoozed_until: "2026-10-24T12:00:00Z",
    hold_reason: "Customer asked to call back after the 15th",
    held_by_name: "Mo Manager",
    hold_count: 1,
    ...over,
  });
  it("the Waiting bucket sits after Later, before Needs authorization and No date", () => {
    expect(LIST_BUCKETS).toEqual([
      "unassigned",
      "overdue",
      "week",
      "later",
      "waiting",
      "authorize",
      "nodate",
      "done",
    ]);
    expect(BUCKET_LABELS.waiting).toBe("Waiting");
    expect(BUCKET_EMPTY.waiting).toBe("Nothing on hold.");
    expect(listGroups([], TODAY).map((g) => g.label)).toEqual([
      "Overdue",
      "This week",
      "Later",
      "Waiting",
      "No date",
      "Done — waiting on the office",
    ]);
  });
  it("an overdue item on hold moves out of Overdue into Waiting; back on the hold's day", () => {
    const held = followupItem(fu(), {}, utcDay);
    expect(bucketOf(held, TODAY, utcDay)).toBe("waiting");
    expect(listBucketOf(held, TODAY, utcDay)).toBe("waiting");
    // Not held: where its date puts it.
    expect(bucketOf(followupItem(fu({ snoozed_until: null }), {}, utcDay), TODAY, utcDay)).toBe(
      "overdue",
    );
    // The hold's own day: the morning reminder fires that day, so it is back.
    expect(bucketOf(held, "2026-10-24", utcDay)).toBe("overdue");
    expect(bucketOf(held, "2026-10-23", utcDay)).toBe("waiting");
    // A hold that already ended does not hold.
    expect(
      bucketOf(
        followupItem(fu({ snoozed_until: "2026-10-08T12:00:00Z" }), {}, utcDay),
        TODAY,
        utcDay,
      ),
    ).toBe("overdue");
  });
  it("Unassigned, Needs authorization and Done still win; a held ticket row waits too", () => {
    const held = followupItem(fu(), {}, utcDay);
    expect(bucketOf({ ...held, needsAuth: true }, TODAY, utcDay)).toBe("authorize");
    expect(bucketOf({ ...held, unassigned: true }, TODAY, utcDay)).toBe("unassigned");
    expect(bucketOf({ ...held, done: true }, TODAY, utcDay)).toBe("done");
    const items = mergeWork(
      {
        tickets: [
          {
            id: "j1",
            number: 7,
            customer_name: "Acme",
            site_name: null,
            site_address: null,
            description: "Leak",
            service_type: "repair",
            stage: "scheduled",
            scheduled_date: "2026-10-05",
            technician_id: "bob",
          },
        ],
        tasks: [],
        followups: [fu({ id: "f2", kind: "ticket", item_id: "j1" })],
      },
      utcDay,
    );
    const groups = listGroups(items, TODAY, { toYmd: utcDay });
    expect(groups.find((g) => g.bucket === "waiting")!.items.map((i) => i.key)).toEqual([
      "ticket:j1",
    ]);
    expect(groups.find((g) => g.bucket === "overdue")!.items).toEqual([]);
  });
  it("the row says until when, why and who; and how often it has been held", () => {
    const f = fu();
    expect(followupStateLine(followupStateText(f, TODAY, utcDay))).toBe(
      "Overdue 6 days · On hold until Sat, Oct 24 · Customer asked to call back after the 15th · held by Mo Manager · Reminders every 7 days",
    );
    expect(followupStateLine(followupStateText(fu({ hold_count: 3 }), TODAY, utcDay))).toBe(
      "Overdue 6 days · On hold until Sat, Oct 24 · Customer asked to call back after the 15th · held by Mo Manager · held 3 times · Reminders every 7 days",
    );
    // Held before, not now: the count stays on the row.
    expect(
      followupStateLine(
        followupStateText(fu({ snoozed_until: null, hold_count: 2 }), TODAY, utcDay),
      ),
    ).toBe("Overdue 6 days · held 2 times · Reminders every 7 days");
    expect(holdCountText(0)).toBeNull();
    expect(holdCountText(1)).toBeNull();
    expect(holdCountText(3)).toBe("held 3 times");
  });
  it("Back from hold: the hold ended and nothing was logged since", () => {
    const ended = fu({ snoozed_until: "2026-10-08T12:00:00Z" });
    expect(backFromHold(ended, TODAY, utcDay)).toBe(true);
    expect(backFromHold(fu({ snoozed_until: "2026-10-09T12:00:00Z" }), TODAY, utcDay)).toBe(true);
    expect(backFromHold(fu(), TODAY, utcDay)).toBe(false);
    expect(backFromHold({ ...ended, hold_reason: null }, TODAY, utcDay)).toBe(false);
    expect(backFromHold({ ...ended, status: "closed" }, TODAY, utcDay)).toBe(false);
    expect(backFromHold(null, TODAY, utcDay)).toBe(false);
  });
  it("a layout saved before Waiting existed gets it after Later, before No date", () => {
    const old = normalizeWorkLayout({
      order: ["unassigned", "overdue", "week", "later", "authorize", "nodate", "done"],
      hidden: ["nodate"],
    });
    expect(old.order).toEqual(LIST_BUCKETS);
    expect(old.hidden).toEqual(["nodate"]);
    const moved = normalizeWorkLayout({
      order: ["done", "later", "unassigned", "overdue", "week", "authorize", "nodate"],
      hidden: [],
    });
    expect(moved.order).toEqual([
      "done",
      "later",
      "waiting",
      "unassigned",
      "overdue",
      "week",
      "authorize",
      "nodate",
    ]);
  });
});

describe("the reminder rules", () => {
  const f = {
    status: "open",
    snoozed_until: "2026-10-09T12:00:00Z",
    hold_reason: "Customer asked to call back after the 15th",
    last_reminded_at: "2026-10-01T12:00:00Z",
  };
  const now = new Date(T0);
  it("isHeldAt: snoozed_until ahead of now", () => {
    expect(isHeldAt({ ...f, snoozed_until: "2026-10-24T12:00:00Z" }, now)).toBe(true);
    expect(isHeldAt(f, now)).toBe(false);
    expect(isHeldAt({ ...f, snoozed_until: null }, now)).toBe(false);
    expect(isHeldAt({ ...f, snoozed_until: "2026-10-24T12:00:00Z", status: "closed" }, now)).toBe(
      false,
    );
    expect(isHeldAt(undefined, now)).toBe(false);
  });
  it("the first reminder after a hold, and only that one", () => {
    expect(firstReminderAfterHold(f, now)).toBe(true);
    expect(firstReminderAfterHold({ ...f, last_reminded_at: null }, now)).toBe(true);
    // A reminder already went out after the hold ended.
    expect(firstReminderAfterHold({ ...f, last_reminded_at: "2026-10-09T12:30:00Z" }, now)).toBe(
      false,
    );
    expect(firstReminderAfterHold({ ...f, snoozed_until: "2026-10-24T12:00:00Z" }, now)).toBe(
      false,
    );
    expect(firstReminderAfterHold({ ...f, hold_reason: null }, now)).toBe(false);
  });
  it("reads Back from hold with the office's day and the reason", () => {
    expect(
      backFromHoldNotice({
        title: "Reroof — gym",
        snoozed_until: "2026-10-24T12:00:00Z",
        hold_reason: "Customer asked to call back after the 15th",
      }),
    ).toEqual({
      title: "Back from hold: Reroof — gym",
      body: "Held until Oct 24, 2026 — Customer asked to call back after the 15th. Time to follow up.",
    });
    // 08:00 Eastern is 12:00 UTC in October; 01:00 UTC is still the previous evening Eastern.
    expect(
      backFromHoldNotice({ title: "t", snoozed_until: "2026-10-24T01:00:00Z", hold_reason: "r" })
        .body,
    ).toBe("Held until Oct 23, 2026 — r. Time to follow up.");
  });
});

// ---- the server functions --------------------------------------------------------------------

const MGR = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const BOB = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const PAT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const JOB = "11111111-1111-4111-8111-111111111111";
const OPP = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const FU = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const FU_OPP = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const REASON = "Customer asked to call back after the 15th";

const manager = {
  id: MGR,
  role: "manager",
  access: [],
  technician: false,
  full_name: "Mo Manager",
  email: "mo@example.com",
};
const bob = {
  id: BOB,
  role: "user",
  access: ["service"],
  technician: true,
  full_name: "Bob Tech",
  email: "bob@example.com",
};
const pat = {
  id: PAT,
  role: "user",
  access: ["customers", "service"],
  technician: false,
  full_name: "Pat Sales",
  email: "pat@example.com",
};

const followup = (over: Row = {}): Row => ({
  id: FU,
  kind: "ticket",
  item_id: JOB,
  account_id: null,
  assignee_id: BOB,
  status: "open",
  title: "#7 Acme leak",
  url: `/service?id=${JOB}`,
  due_at: "2026-10-03T12:00:00.000Z",
  next_remind_at: "2026-10-09T12:00:00.000Z",
  every_days: 3,
  reminders_sent: 1,
  last_reminded_at: "2026-10-06T12:00:00.000Z",
  snoozed_until: null,
  hold_reason: null,
  hold_via: null,
  held_by: null,
  held_by_name: null,
  held_at: null,
  hold_count: 0,
  dispatch_errors: 0,
  last_dispatch_error: null,
  ...over,
});

/** hold_followup (20261009150000_followup_holds.sql) in memory: the same writes. */
const holdRpc: FakeRpc = (args, tables) => {
  const f = (tables["crm_followups"] ?? []).find((r) => r["id"] === args["p_followup"]);
  if (!f || f["status"] !== "open") throw new Error("That follow-up is not open");
  if (args["p_until"] === null) {
    Object.assign(f, {
      hold_reason: null,
      hold_via: null,
      held_by: null,
      held_by_name: null,
      held_at: null,
    });
    return { id: f["id"], cleared: true, hold_count: f["hold_count"] ?? 0 };
  }
  const at = zonedTime(String(args["p_until"]), "08:00").toISOString();
  const count = Number(f["hold_count"] ?? 0) + 1;
  Object.assign(f, {
    snoozed_until: at,
    next_remind_at: at,
    hold_reason: args["p_reason"],
    hold_via: args["p_via"],
    held_at: new Date().toISOString(),
    hold_count: count,
  });
  return {
    id: f["id"],
    cleared: false,
    until: args["p_until"],
    next_remind_at: at,
    hold_count: count,
  };
};

let env: ReturnType<typeof fakeSupabase>;
function setup(opts: { followups?: Row[]; rpcs?: Record<string, FakeRpc> } = {}) {
  env = fakeSupabase(
    {
      profiles: [manager, bob, pat],
      service_jobs: [{ id: JOB, technician_id: BOB, stage: "scheduled", deleted_at: null }],
      crm_opportunities: [{ id: OPP, assignee_id: PAT, status: "open", deleted_at: null }],
      crm_followups: opts.followups ?? [followup()],
      crm_contact_log: [],
      service_job_events: [],
      notifications: [],
      push_subscriptions: [],
    },
    { rpcs: { hold_followup: holdRpc, ...(opts.rpcs ?? {}) } },
  );
}
const call = <T = unknown>(fn: unknown, data: Row, userId: string) =>
  (fn as (a: { data: Row; context: unknown }) => Promise<T>)({
    data,
    context: { supabase: env.db, userId },
  });
const holdCalls = () => env.rpcCalls.filter((c) => c.fn === "hold_followup");
const fu = (id = FU) => env.tables["crm_followups"]!.find((r) => r["id"] === id)!;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
  vi.stubEnv("RESEND_API_KEY", "");
  setup();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("snoozeFollowup: a manager's hold with a date and a reason", () => {
  it("a manager: one hold_followup call (via snooze), a Timeline line on the ticket, the date back", async () => {
    const r = await call<{ until: string; hold_count: number }>(
      snoozeFollowup,
      { id: FU, until: "2026-10-24", reason: REASON },
      MGR,
    );
    expect(r).toEqual({ until: "2026-10-24", hold_count: 1 });
    expect(holdCalls()).toEqual([
      {
        fn: "hold_followup",
        args: { p_followup: FU, p_until: "2026-10-24", p_reason: REASON, p_via: "snooze" },
      },
    ]);
    // The row as the database left it: quiet until 08:00 Eastern on Oct 24.
    expect(fu()["snoozed_until"]).toBe("2026-10-24T12:00:00.000Z");
    expect(fu()["next_remind_at"]).toBe("2026-10-24T12:00:00.000Z");
    expect(fu()["hold_reason"]).toBe(REASON);
    // The hold history (owner's #6): a note on the ticket's Timeline.
    expect(env.tables["service_job_events"]).toEqual([
      expect.objectContaining({
        service_job_id: JOB,
        kind: "note",
        note: `On hold until Oct 24, 2026 by Mo Manager: ${REASON}`,
        by_user: MGR,
        by_name: "Mo Manager",
        meta: { hold_until: "2026-10-24", hold_via: "snooze", hold_reason: REASON },
      }),
    ]);
    // No direct write to the follow-up: the function is the one path.
    expect(env.writes.filter((w) => w.table === "crm_followups")).toEqual([]);
  });
  it("an opportunity's hold goes in its contact log as a plain note", async () => {
    setup({
      followups: [followup({ id: FU_OPP, kind: "opportunity", item_id: OPP, assignee_id: PAT })],
    });
    await call(snoozeFollowup, { id: FU_OPP, until: "2026-10-24", reason: REASON }, MGR);
    expect(env.tables["crm_contact_log"]).toEqual([
      expect.objectContaining({
        kind: "opportunity",
        item_id: OPP,
        method: "note",
        note: `On hold until Oct 24, 2026 by Mo Manager: ${REASON}`,
        by_user: MGR,
      }),
    ]);
    expect(env.tables["service_job_events"]).toEqual([]);
  });
  it("a rep (even the assignee) is refused before anything is written", async () => {
    await expect(
      call(snoozeFollowup, { id: FU, until: "2026-10-24", reason: REASON }, BOB),
    ).rejects.toThrow(FOLLOWUP_MANAGER_ONLY);
    expect(holdCalls()).toEqual([]);
    expect(env.writes).toEqual([]);
  });
  it("an old caller's days become a date (today + N, Eastern) with a stand-in reason", async () => {
    await call(snoozeFollowup, { id: FU, days: 7 }, MGR);
    expect(holdCalls()[0]!.args).toEqual({
      p_followup: FU,
      p_until: "2026-10-16",
      p_reason: "Snoozed 7 days",
      p_via: "snooze",
    });
  });
  it("a bad date or a missing reason is refused; no call", async () => {
    await expect(
      call(snoozeFollowup, { id: FU, until: TODAY, reason: REASON }, MGR),
    ).rejects.toThrow(HOLD_DATE_TOO_SOON);
    await expect(
      call(snoozeFollowup, { id: FU, until: "2027-04-08", reason: REASON }, MGR),
    ).rejects.toThrow(HOLD_DATE_TOO_FAR);
    // An empty reason fails validation (synchronously, in the validator).
    expect(() => call(snoozeFollowup, { id: FU, until: "2026-10-24", reason: "" }, MGR)).toThrow();
    expect(holdCalls()).toEqual([]);
  });
  it("without the migration the function is missing: loud, no fallback write", async () => {
    setup({
      rpcs: {
        hold_followup: () => {
          const e = new Error("Could not find the function public.hold_followup") as Error & {
            code: string;
          };
          e.code = "PGRST202";
          throw e;
        },
      },
    });
    await expect(
      call(snoozeFollowup, { id: FU, until: "2026-10-24", reason: REASON }, MGR),
    ).rejects.toThrow(HOLD_NEEDS_MIGRATION);
    expect(env.writes.filter((w) => w.table === "crm_followups")).toEqual([]);
  });
});

describe("logContact with 'They asked to try again on'", () => {
  it("the assignee: the contact row AND hold_followup (via contact, the note as the reason), one save", async () => {
    const r = await call<Row>(
      logContact,
      { kind: "ticket", item_id: JOB, method: "called", note: REASON, try_again_on: "2026-10-24" },
      BOB,
    );
    expect(env.tables["crm_contact_log"]).toEqual([
      expect.objectContaining({
        kind: "ticket",
        item_id: JOB,
        method: "called",
        note: REASON,
        by_user: BOB,
        by_name: "Bob Tech",
      }),
    ]);
    expect(holdCalls()).toEqual([
      {
        fn: "hold_followup",
        args: { p_followup: FU, p_until: "2026-10-24", p_reason: REASON, p_via: "contact" },
      },
    ]);
    expect(r["hold"]).toEqual({ until: "2026-10-24", hold_count: 1 });
    expect(fu()["hold_via"]).toBe("contact");
    expect(env.tables["service_job_events"]).toEqual([
      expect.objectContaining({
        kind: "note",
        note: `On hold until Oct 24, 2026 by Bob Tech: ${REASON}`,
      }),
    ]);
  });
  it("a manager may too; someone else (not the assignee) may not, and nothing is written", async () => {
    await call(
      logContact,
      { kind: "ticket", item_id: JOB, method: "texted", note: REASON, try_again_on: "2026-10-24" },
      MGR,
    );
    expect(holdCalls()).toHaveLength(1);
    setup();
    await expect(
      call(
        logContact,
        {
          kind: "ticket",
          item_id: JOB,
          method: "called",
          note: REASON,
          try_again_on: "2026-10-24",
        },
        PAT,
      ),
    ).rejects.toThrow(HOLD_ASSIGNEE_OR_MANAGER);
    expect(env.writes).toEqual([]);
    expect(holdCalls()).toEqual([]);
  });
  it("a date needs a note (the reason), a real date, and an open follow-up — checked before the contact is written", async () => {
    await expect(
      call(
        logContact,
        { kind: "ticket", item_id: JOB, method: "called", try_again_on: "2026-10-24" },
        BOB,
      ),
    ).rejects.toThrow(CONTACT_HOLD_NEEDS_NOTE);
    await expect(
      call(
        logContact,
        { kind: "ticket", item_id: JOB, method: "called", note: REASON, try_again_on: TODAY },
        BOB,
      ),
    ).rejects.toThrow(HOLD_DATE_TOO_SOON);
    expect(env.writes).toEqual([]);
    setup({ followups: [] });
    await expect(
      call(
        logContact,
        {
          kind: "ticket",
          item_id: JOB,
          method: "called",
          note: REASON,
          try_again_on: "2026-10-24",
        },
        BOB,
      ),
    ).rejects.toThrow(NO_FOLLOWUP_TO_HOLD);
    expect(env.writes).toEqual([]);
  });
  it("without a date, a contact after a hold ended clears the hold's record (the badge goes); a running hold stays", async () => {
    setup({
      followups: [
        followup({
          snoozed_until: "2026-10-08T12:00:00.000Z",
          hold_reason: REASON,
          hold_via: "snooze",
          held_by_name: "Mo Manager",
          hold_count: 1,
        }),
      ],
    });
    const r = await call<Row>(logContact, { kind: "ticket", item_id: JOB, method: "called" }, BOB);
    expect(r["hold"]).toBeNull();
    expect(holdCalls()).toEqual([
      {
        fn: "hold_followup",
        args: { p_followup: FU, p_until: null, p_reason: null, p_via: "contact" },
      },
    ]);
    expect(fu()["hold_reason"]).toBeNull();
    expect(fu()["hold_count"]).toBe(1);
    expect(env.tables["crm_contact_log"]).toHaveLength(1);

    // Still on hold until Oct 24: a call today does not end it.
    setup({
      followups: [followup({ snoozed_until: "2026-10-24T12:00:00.000Z", hold_reason: REASON })],
    });
    await call(logContact, { kind: "ticket", item_id: JOB, method: "called" }, BOB);
    expect(holdCalls()).toEqual([]);
    expect(fu()["hold_reason"]).toBe(REASON);
    // No hold at all: no call either.
    setup();
    await call(logContact, { kind: "ticket", item_id: JOB, method: "called" }, BOB);
    expect(holdCalls()).toEqual([]);
  });
});

// ---- the reminder pass -------------------------------------------------------------------------

function passClient(tables: Record<string, Row[]>, untouched: Row[]): Client {
  env = fakeSupabase(tables, {
    rpc: (fn, args) =>
      fn === "followup_claim_reminder" ? claimReminderInMemory(tables, args) : undefined,
    rpcs: {
      hold_followup: holdRpc,
      crm_untouched: () => untouched,
      escalation_recipients: () => ["boss-1"],
      notify_recipients: (args) =>
        ((args["ids"] ?? []) as string[]).map((id) => ({
          id,
          email: `${id}@example.test`,
          full_name: id,
          notify_email: false,
          notify_push: false,
        })),
      stamp_dispatch: () => null,
    },
  });
  return env.db as unknown as Client;
}
const notices = (kind: string) =>
  (env.tables["notifications"] ?? []).filter((n) => n["kind"] === kind);

describe("the reminder pass", () => {
  const untouchedJob: Row = {
    kind: "ticket",
    item_id: JOB,
    title: "#7 Acme leak",
    url: `/service?id=${JOB}`,
    account_name: "Acme",
    assignee_id: BOB,
    assignee_name: "Bob Tech",
    assigned_at: new Date(T0 - 5 * DAY).toISOString(),
    limit_days: 2,
  };
  const world = (f: Row) => ({
    crm_settings: [
      { id: 1, ticket_every_days: 3, opportunity_every_days: 7, last_dispatch_at: null },
    ],
    service_jobs: [{ id: JOB, technician_id: BOB, stage: "open", escalated_at: null }],
    crm_followups: [f],
    notifications: [],
    push_subscriptions: [],
  });
  it("escalateUntouched skips an item whose follow-up is on hold; escalates once the hold ends", async () => {
    const held = followup({
      snoozed_until: "2026-10-24T12:00:00.000Z",
      next_remind_at: "2026-10-24T12:00:00.000Z",
      hold_reason: REASON,
    });
    let r = await dispatchDueReminders(passClient(world(held), [untouchedJob]));
    expect(r).toMatchObject({ checked: 0, reminded: 0, escalated: 0, failed: 0 });
    expect(notices("untouched")).toEqual([]);
    expect(env.tables["service_jobs"]![0]!["escalated_at"]).toBeNull();

    // The same item, its hold over (and no reminder due): escalated as before.
    const over = followup({
      snoozed_until: "2026-10-08T12:00:00.000Z",
      next_remind_at: "2026-10-11T12:00:00.000Z",
      hold_reason: REASON,
    });
    r = await dispatchDueReminders(passClient(world(over), [untouchedJob]));
    expect(r).toMatchObject({ escalated: 1, failed: 0 });
    expect(notices("untouched")).toHaveLength(1);
    expect(notices("untouched")[0]!["user_id"]).toBe("boss-1");
  });
  it("the first reminder after a hold reads Back from hold; the next one reads as usual", async () => {
    // Held until 08:00 Eastern Oct 9 (= 12:00 UTC); the pass runs at 11:00 Eastern.
    const f = followup({
      snoozed_until: "2026-10-09T12:00:00.000Z",
      next_remind_at: "2026-10-09T12:00:00.000Z",
      hold_reason: REASON,
      held_by_name: "Mo Manager",
      last_reminded_at: "2026-10-06T12:00:00.000Z",
    });
    const client = passClient(world(f), []);
    const r = await dispatchDueReminders(client);
    expect(r).toMatchObject({ checked: 1, reminded: 1, failed: 0 });
    expect(notices("followup")).toEqual([
      expect.objectContaining({
        user_id: BOB,
        title: "Back from hold: #7 Acme leak",
        body: `Held until Oct 9, 2026 — ${REASON}. Time to follow up.`,
        url: `/service?id=${JOB}`,
        followup_id: FU,
      }),
    ]);
    // The claim moved the reminder on by every_days and stamped last_reminded_at after the hold.
    const row = env.tables["crm_followups"]![0]!;
    expect(row["reminders_sent"]).toBe(2);
    expect(Date.parse(String(row["last_reminded_at"]))).toBe(T0);
    // Three days on: due again; the record is still set (nothing logged), but it is not the
    // first reminder after the hold any more.
    vi.setSystemTime(T0 + 3 * DAY + 60000);
    await dispatchDueReminders(client);
    expect(notices("followup")).toHaveLength(2);
    expect(notices("followup")[1]!["title"]).toBe("Follow up: #7 Acme leak");
  });
  it("a reminder with no hold on record reads as before", async () => {
    await dispatchDueReminders(passClient(world(followup()), []));
    expect(notices("followup")[0]!["title"]).toBe("Follow up: #7 Acme leak");
  });
});

// ---- the migration, the types, the markup -----------------------------------------------------

describe("the migration 20261009150000_followup_holds.sql", () => {
  const sql = read("supabase/migrations/20261009150000_followup_holds.sql");
  const body = flat(sql.replace(/--[^\n]*/g, ""));
  it("adds the hold columns idempotently", () => {
    for (const col of [
      "hold_reason text",
      "hold_via text check (hold_via in ('snooze','contact'))",
      "held_by uuid references public.profiles(id) on delete set null",
      "held_by_name text",
      "held_at timestamptz",
      "hold_count integer not null default 0",
    ])
      expect(body).toContain(`alter table public.crm_followups add column if not exists ${col};`);
    expect(sql).toContain("comment on column public.crm_followups.hold_reason is");
    expect(sql).toContain("comment on column public.crm_followups.hold_count is");
  });
  it("hold_followup: security definer, the assignee or a manager, snooze a manager's, 08:00 Eastern, counted", () => {
    expect(body).toContain(
      "create or replace function public.hold_followup( p_followup uuid, p_until date, p_reason text, p_via text ) returns jsonb language plpgsql security definer set search_path = public as $$",
    );
    expect(body).toContain("if not (v_system or v_manager or f.assignee_id = auth.uid()) then");
    expect(body).toContain(
      "raise exception 'Only the assignee or a manager can put a follow-up on hold' using errcode = '42501';",
    );
    expect(body).toContain("if p_via = 'snooze' and not (v_system or v_manager) then");
    expect(body).toContain(
      "raise exception 'Only a manager can snooze or close a follow-up' using errcode = '42501';",
    );
    // The office's morning: lib/tasks.ts ALL_DAY_HOUR in TASK_TZ.
    expect(ALL_DAY_HOUR).toBe(8);
    expect(TASK_TZ).toBe("America/New_York");
    expect(body).toContain("v_at := (p_until + time '08:00') at time zone 'America/New_York';");
    expect(body).toContain("v_today date := (now() at time zone 'America/New_York')::date;");
    expect(body).toContain(
      "if p_until <= v_today then raise exception 'The hold date must be tomorrow or later';",
    );
    expect(body).toContain(
      "if p_until > v_today + 180 then raise exception 'The hold date can be at most 180 days out';",
    );
    expect(body).toContain(
      "if v_reason = '' or length(v_reason) > 200 then raise exception 'A hold needs a reason (1 to 200 characters)';",
    );
    expect(body).toContain(
      "set snoozed_until = v_at, next_remind_at = v_at, hold_reason = v_reason, hold_via = p_via, held_by = auth.uid(), held_by_name = v_name, held_at = now(), hold_count = hold_count + 1 where id = f.id;",
    );
    // p_until null clears the record only.
    expect(body).toContain(
      "set hold_reason = null, hold_via = null, held_by = null, held_by_name = null, held_at = null where id = f.id;",
    );
    // Under the trigger's flag, both ways.
    expect(body.match(/perform set_config\('jbk\.followup_sync', 'on', true\);/g)).toHaveLength(2);
    expect(body.match(/perform set_config\('jbk\.followup_sync', '', true\);/g)).toHaveLength(2);
  });
  it("grants: authenticated and service_role; not public, not anon; the trigger is untouched", () => {
    expect(body).toContain(
      "revoke all on function public.hold_followup(uuid, date, text, text) from public;",
    );
    expect(body).toContain(
      "revoke all on function public.hold_followup(uuid, date, text, text) from anon;",
    );
    expect(body).toContain(
      "grant execute on function public.hold_followup(uuid, date, text, text) to authenticated, service_role;",
    );
    expect(body).not.toMatch(/create (or replace )?function public\.crm_followups_manager_only/);
    expect(body).not.toMatch(/create trigger|drop trigger|create policy/);
  });
  it("types.ts knows the columns and the function", () => {
    const types = read("src/integrations/supabase/types.ts");
    const block = types.slice(
      types.indexOf("crm_followups: {"),
      types.indexOf("Relationships", types.indexOf("crm_followups: {")),
    );
    for (const line of [
      "hold_reason: string | null;",
      "hold_via: string | null;",
      "held_by: string | null;",
      "held_by_name: string | null;",
      "held_at: string | null;",
      "hold_count: number;",
    ])
      expect(block).toContain(line);
    expect(flat(types)).toContain(
      "hold_followup: { Args: { p_followup: string; p_until: string | null; p_reason: string | null; p_via: string; }; Returns: Json; };",
    );
  });
});

describe("the markup", () => {
  it("the Snooze popover: presets, Until a date (min tomorrow, max 180 days), a required reason, Put on hold", () => {
    const src = read("src/components/followup-controls.tsx");
    expect(src).toContain("HOLD_PRESETS.map((p) =>");
    expect(src).toContain("const { min, max } = holdDateBounds(today);");
    expect(src).toContain('<Label htmlFor="followup-hold-until">Until a date</Label>');
    expect(flat(src)).toContain('type="date" value={until} min={min} max={max}');
    expect(src).toContain('<Label htmlFor="followup-hold-reason">Reason</Label>');
    expect(src).toContain("maxLength={HOLD_REASON_MAX}");
    expect(src).toContain('placeholder="e.g. Customer asked to call back after the 15th"');
    expect(src).toContain("const ready = !!until && !dateProblem && !holdReasonProblem(reason);");
    expect(src).toContain("Put on hold");
    expect(src).not.toContain("DropdownMenu");
    expect(src).not.toMatch(/\[1, 3, 7\]/);
  });
  it("Work Overview and the opportunity strip send the hold; the mutation takes until + reason", () => {
    const page = read("src/components/my-work-page.tsx");
    expect(flat(page)).toContain(
      "<SnoozeMenu disabled={busy} today={today} onSnooze={(hold) => snooze.mutate({ id: f.id, ...hold })} />",
    );
    expect(page).toContain("const back = backFromHold(f, today);");
    expect(page).toContain('data-badge="back-from-hold"');
    expect(page).toContain("Back from hold");
    expect(page).toContain("{f.hold_reason}");
    const opp = read("src/components/opportunities-page.tsx");
    expect(opp).toContain("onSnooze={(hold) => snooze.mutate({ id: f.id, ...hold })}");
    const shared = read("src/components/followups-shared.ts");
    expect(shared).toContain(
      "mutationFn: (v: { id: string; until: string; reason: string }) => snoozeFn({ data: v }),",
    );
    expect(shared).toContain("toast.success(`On hold until ${shortDay(r.until)}`);");
  });
  it("the contact form: 'They asked to try again on' on the ticket and opportunity pages (both use LogContactButtons)", () => {
    const src = read("src/components/crm/contact-log.tsx");
    expect(src).toContain("They asked to try again on");
    expect(flat(src)).toContain(
      'type="date" className="h-8 w-48" value={tryAgain} min={bounds.min} max={bounds.max}',
    );
    expect(src).toContain("...(tryAgain ? { try_again_on: tryAgain } : {}),");
    expect(src).toContain("if (picked && !log.isPending && holdReady) log.mutate(picked);");
    expect(src).toContain(
      "`Logged: ${CONTACT_METHOD_LABELS[method]} · on hold until ${shortDay(row.hold.until)}`",
    );
    expect(read("src/components/service-page.tsx")).toContain(
      '<LogContactButtons kind="ticket" itemId={job.id} />',
    );
    expect(read("src/components/opportunities-page.tsx")).toMatch(
      /<LogContactButtons\s+kind="opportunity"/,
    );
  });
  it("listMyWork sends the hold's record with each follow-up", () => {
    const fn = read("src/lib/my-work.functions.ts");
    expect(fn).toContain("hold_reason: f.hold_reason ?? null,");
    expect(fn).toContain("held_by_name: f.held_by_name ?? null,");
    expect(fn).toContain("hold_count: f.hold_count ?? 0,");
  });
  it("followups.functions.ts never imports the server-only modules at its top level", () => {
    const fn = read("src/lib/followups.functions.ts");
    expect(fn).not.toMatch(/^import .* from "@\/lib\/(followups|notify)\.server";/m);
  });
});
