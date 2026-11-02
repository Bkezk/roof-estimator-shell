/**
 * Work Overview, Nov 2 (the audit in docs/qa/work-overview-audit-2026-11-02.md; the owner: "fix
 * all 3"):
 *
 *  1. A Done ticket waiting to be authorized was two different rows depending on the Show picker:
 *     its "Authorize ticket #…" follow-up row (Everyone, or the named authorizer's Mine — the
 *     timer's due day, the authorizer's name, "Done — to authorize") or the ticket row (Mine for
 *     any other admin or manager — its scheduled day, the technician, "Done"). Same ticket, two
 *     calendar days. Now it is one row whatever the scope: the ticket row, on the day it was
 *     closed out, "Done — to authorize", with the technician and the authorizer named, and the
 *     Authorize timer attached when the viewer holds it (Snooze, the reminder line).
 *  2. A plain user who invoices saw the Authorized — to invoice rows with no technician name:
 *     names came from work_people() (admins and managers only). technician_options() answers
 *     anyone with Service, so listMyWork reads it for a caller who cannot pick.
 *  3. "Assign to…" from the List on an unassigned ticket with no date sent `date: null` and the
 *     server refused ("Pick a date — every ticket needs a follow-up date"). Now the pick opens
 *     the assign-for-a-day dialog (the Calendar's, with a day input defaulting to today), and
 *     assignPlan itself never makes a ticket plan without a day.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));

import {
  AUTHORIZE_FOLLOWUP_STATUS,
  itemsByDay,
  mergeWork,
  toAuthorizeItem,
  type FollowupIn,
  type TicketIn,
  type WorkItem,
} from "@/lib/my-work";
import { listMyWork, type MyWorkResult } from "@/lib/my-work.functions";
import { assignNeedsDay, assignPlan } from "@/lib/my-work-actions";
import { fakeSupabase } from "@/test/fake-supabase";

type Row = Record<string, unknown>;
type Fn<T = unknown> = (a: { data?: unknown; context: unknown }) => Promise<T>;
const read = (p: string) => readFileSync(p, "utf8");
const utcDay = (iso: string) => iso.slice(0, 10);

const ticket = (over: Partial<TicketIn> = {}): TicketIn => ({
  id: "t1",
  number: 6029,
  customer_name: "5K, Inc",
  site_name: null,
  site_address: null,
  description: "",
  service_type: "leak",
  stage: "done",
  scheduled_date: "2026-10-22",
  technician_id: "ted",
  completed_at: "2026-10-15T14:33:00Z",
  stage_changed_at: "2026-10-15T14:34:00Z",
  ...over,
});
const authorize = (over: Partial<FollowupIn> = {}): FollowupIn => ({
  id: "f1",
  title: "Authorize Ticket #6029 5K, Inc",
  url: "/service?id=t1",
  due_at: "2026-10-16T14:33:00Z",
  status: "open",
  kind: "invoice",
  item_id: "t1",
  assignee_id: "brandon",
  every_days: 3,
  snoozed_until: null,
  ...over,
});
const names = { ted: "Ted", brandon: "Brandon" };

describe("1. one Needs authorization row, whatever the Show picker", () => {
  const everyone = () =>
    mergeWork(
      { tickets: [], tasks: [], followups: [authorize()], toAuthorize: [ticket()], names },
      utcDay,
    );
  const mine = () =>
    mergeWork(
      {
        tickets: [],
        tasks: [],
        followups: [],
        toAuthorize: [ticket()],
        names,
        authorizerId: "brandon",
      },
      utcDay,
    );
  it("the same key, day, status and people under Everyone (timer listed) and Mine (timer not listed)", () => {
    const [a] = everyone();
    const [m] = mine();
    expect(everyone()).toHaveLength(1);
    expect(mine()).toHaveLength(1);
    const same = (i: WorkItem) => ({
      key: i.key,
      kind: i.kind,
      date: i.date,
      status: i.status,
      assigneeName: i.assigneeName,
      reviewerName: i.reviewerName,
      needsAuth: i.needsAuth,
      waitingSince: i.waitingSince,
    });
    expect(same(a!)).toEqual(same(m!));
    expect(same(a!)).toEqual({
      key: "ticket:t1",
      kind: "ticket",
      // The day it was closed out — not the timer's due day (Oct 16), not the scheduled day (Oct 22).
      date: "2026-10-15",
      status: AUTHORIZE_FOLLOWUP_STATUS,
      assigneeName: "Ted",
      reviewerName: "Brandon",
      needsAuth: true,
      waitingSince: "2026-10-15T14:33:00Z",
    });
    // The Calendar puts it on the same day either way.
    expect([...itemsByDay(everyone()).keys()]).toEqual(["2026-10-15"]);
    expect([...itemsByDay(mine()).keys()]).toEqual(["2026-10-15"]);
  });
  it("the viewer who holds the timer gets it on the row (Snooze, the reminder line); the other does not", () => {
    expect(everyone()[0]!.followup).toMatchObject({ id: "f1", every_days: 3 });
    expect(mine()[0]!.followup).toBeNull();
  });
  it("without a close-out stamp the day is the stage stamp's, then the scheduled day; the authorizer is named from the timer or the named authorizer", () => {
    expect(
      toAuthorizeItem(ticket({ completed_at: null }), names, utcDay, null, "brandon"),
    ).toMatchObject({ date: "2026-10-15", reviewerName: "Brandon" });
    expect(
      toAuthorizeItem(ticket({ completed_at: null, stage_changed_at: null }), names, utcDay),
    ).toMatchObject({ date: "2026-10-22", reviewerName: null });
    expect(toAuthorizeItem(ticket(), names, utcDay, authorize())).toMatchObject({
      reviewerName: "Brandon",
      followup: { id: "f1" },
    });
  });
  it("a timer whose ticket is not in the queue (a viewer without the queue) still lists as before", () => {
    const alone = mergeWork({ tickets: [], tasks: [], followups: [authorize()] }, utcDay);
    expect(alone.map((i) => i.key)).toEqual(["followup:f1"]);
    expect(alone[0]).toMatchObject({ kind: "followup", needsAuth: true });
  });
  it("the row names the authorizer; the server sends the named authorizer", () => {
    const page = read("src/components/my-work-page.tsx");
    expect(page).toContain("item.needsAuth && item.reviewerName");
    expect(page).toContain("Authorizer: {item.reviewerName}");
    const fns = read("src/lib/my-work.functions.ts");
    expect(fns).toMatch(/authorizerId:/);
  });
});

describe("2. a plain user who invoices gets the technicians' names", () => {
  const ME = "11111111-1111-4111-8111-111111111111";
  const TED = "22222222-2222-4222-8222-222222222222";
  const profiles: Row[] = [
    {
      id: ME,
      role: "user",
      access: ["service", "invoices"],
      technician: false,
      full_name: "Mark",
      email: "mark@x",
    },
    {
      id: TED,
      role: "user",
      access: ["service"],
      technician: true,
      full_name: "Ted",
      email: "t@x",
    },
  ];
  const authorized: Row = {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    number: 6026,
    customer_name: "Acme",
    site_name: null,
    site_address: null,
    description: "",
    service_type: "leak",
    stage: "authorized",
    scheduled_date: "2026-10-16",
    technician_id: TED,
    stage_changed_at: "2026-10-14T14:20:00Z",
    deleted_at: null,
  };
  const run = (me: Row) => {
    const env = fakeSupabase(
      {
        profiles: [me, profiles[1]!],
        service_jobs: [authorized],
        tasks: [],
        crm_followups: [],
        crm_accounts: [],
        crm_settings: [{ id: 1, unassigned_overdue_days: 1 }],
      },
      { rpcs: { ticket_authorizers: () => [] } },
    );
    return {
      env,
      result: (listMyWork as unknown as Fn<MyWorkResult>)({
        data: {},
        context: { supabase: env.db, userId: ME },
      }),
    };
  };
  it("the names map holds the technician (through technician_options), not only the caller", async () => {
    const { env, result } = run(profiles[0]!);
    const r = await result;
    expect(r.canPick).toBe(false);
    expect(r.people).toEqual([]);
    expect(r.toInvoice.map((t) => t.number)).toEqual([6026]);
    expect(r.names).toEqual({ [ME]: "Mark", [TED]: "Ted" });
    expect(env.rpcCalls.map((c) => c.fn)).toContain("technician_options");
    const [row] = mergeWork(r);
    expect(row).toMatchObject({ key: `ticket:${authorized["id"]}`, assigneeName: "Ted" });
  });
  it("a caller without Service access is not asked for the roster (the rpc would answer nothing)", async () => {
    const { env, result } = run({ ...profiles[0]!, access: ["customers"] });
    const r = await result;
    expect(r.names).toEqual({ [ME]: "Mark" });
    expect(env.rpcCalls.map((c) => c.fn)).not.toContain("technician_options");
  });
});

describe("3. Assign to… on an unassigned ticket with no date", () => {
  const ME = "33333333-3333-4333-8333-333333333333";
  const BOB = "44444444-4444-4444-8444-444444444444";
  const office = { id: ME, role: "user", access: ["service", "customers"], technician: false };
  const undated: WorkItem = {
    key: "ticket:t9",
    kind: "ticket",
    title: "#6050 Leak",
    where: null,
    date: null,
    status: "Open",
    done: false,
    href: "/service?id=t9",
    assigneeId: null,
    assigneeName: null,
    followup: null,
    unassigned: true,
  };
  it("assignNeedsDay: an unassigned ticket without a day, and nothing else", () => {
    expect(assignNeedsDay(undated)).toBe(true);
    expect(assignNeedsDay({ ...undated, date: "2026-11-03" })).toBe(false);
    expect(assignNeedsDay({ ...undated, kind: "task" })).toBe(false);
    expect(assignNeedsDay({ ...undated, unassigned: false })).toBe(false);
  });
  it("assignPlan never sends a ticket without a day: null without one, the day when given", () => {
    expect(assignPlan(undated, BOB, office)).toBeNull();
    expect(assignPlan(undated, BOB, office, "2026-11-03")).toEqual({
      kind: "ticket",
      id: "t9",
      technicianId: BOB,
      date: "2026-11-03",
    });
  });
  it("the List's pick opens the day dialog with today, and the dialog takes a day", () => {
    const hook = read("src/components/my-work-actions.tsx");
    expect(hook).toContain("if (assignNeedsDay(item)) {");
    expect(hook).toContain("setDrop({ item, day: localYmd(new Date()), editDay: true });");
    expect(hook).toContain('id="assign-day"');
    expect(hook).toContain('type="date"');
  });
});
