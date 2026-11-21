/**
 * Roof Care break test, Nov 20: the fixes for tickets and notices (numbers 16, 17, 18 and 30;
 * docs/qa/roof-care-break-fixes-tickets-2026-11-20.md).
 *
 *  16  Inspection tickets the site makes are announced: the 8:00 run says "Opened" and starts
 *      the timers, once, one notice per person; safe to run twice and after a failed send.
 *  17  A property or a customer is not deleted while one of its plans is in force or waiting
 *      for its payment.
 *  18  A plan's inspection ticket is not moved to another property or customer, nor changed to
 *      another kind of ticket.
 *  30  Owner Business wording, and the checklist row on a narrow phone.
 *
 * The server functions run against an in-memory stand-in for the database (src/test/
 * fake-supabase.ts); the database's own rules were run on the live database in rolled-back
 * trials (the record above), and here their words are held equal to the app's.
 *
 * THE NAMES AND NUMBERS HERE ARE MADE UP.
 */
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));
type Sent = { kind: string; title: string; body: string; url: string; followup_id?: string };
const sent = vi.hoisted(() =>
  vi.fn<(ids: string[], msg: Sent, sb: unknown) => Promise<number>>(async (ids) => ids.length),
);
vi.mock("@/lib/notify.server", () => ({
  notify: sent,
  serverClient: async (sb: unknown) => sb,
  hasServiceRole: () => true,
}));

import {
  careTicketMoveProblem,
  customerHeldMessage,
  holdingPlan,
  planHoldWords,
  propertyHeldMessage,
} from "@/lib/care-plan-guards";
import { deleteAccount, deleteSite } from "@/lib/crm.functions";
import {
  careAssignedNotice,
  careNoticeGroups,
  careOpenedNotice,
  careTicketLine,
  dueWindow,
  type CareTicketToAnnounce,
} from "@/lib/roof-care-ticket-announce";
import {
  claimCareTickets,
  dispatchCareTicketAnnouncements,
  finishCareTickets,
} from "@/lib/roof-care-ticket-announce.server";
import { saveServiceJob } from "@/lib/service.functions";
import { ChecklistRows } from "@/components/service/inspection-section";
import { fakeSupabase, type FakeRpc } from "@/test/fake-supabase";

type Row = Record<string, unknown>;
type Env = ReturnType<typeof fakeSupabase>;
const read = (p: string) => readFileSync(p, "utf8");
const flat = (p: string) => read(p).replace(/\s+/g, " ");

const ADMIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MANAGER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TECH = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OFFICE = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const ACC = "11111111-1111-4111-8111-111111111111";
const ACC2 = "11111111-1111-4111-8111-111111111112";
const SITE = "22222222-2222-4222-8222-222222222221";
const SITE2 = "22222222-2222-4222-8222-222222222222";
const SITE3 = "22222222-2222-4222-8222-222222222223";
const PLAN = "33333333-3333-4333-8333-333333333331";
const job = (n: number) => `44444444-4444-4444-8444-4444444440${String(n).padStart(2, "0")}`;
const visit = (n: number) => `55555555-5555-4555-8555-5555555550${String(n).padStart(2, "0")}`;

// A Friday, 9:00 on the office's clock; the same day at 7:30; the Saturday after.
const MORNING = new Date("2026-11-20T14:00:00Z");
const BEFORE_EIGHT = new Date("2026-11-20T12:30:00Z");
const SATURDAY = new Date("2026-11-21T15:00:00Z");

const profiles = [
  { id: ADMIN, role: "admin", access: [], technician: false, full_name: "Ada Admin", email: "a@x" },
  {
    id: MANAGER,
    role: "manager",
    access: [],
    technician: false,
    full_name: "Mo Manager",
    email: "m@x",
  },
  {
    id: TECH,
    role: "user",
    access: ["service"],
    technician: true,
    full_name: "Tia Tech",
    email: "t@x",
  },
  {
    id: OFFICE,
    role: "user",
    access: ["customers", "service"],
    technician: false,
    full_name: "Pat Office",
    email: "p@x",
  },
];

/** A plan inspection ticket as the morning run makes it. */
const careJob = (n: number, over: Row = {}): Row => ({
  id: job(n),
  number: 7000 + n,
  account_id: ACC,
  site_id: SITE,
  customer_name: "Made Up Mills",
  site_name: `Plant ${n}`,
  description: "Care plan inspection (Roof Care), visit 1 of 2",
  service_type: "inspection",
  stage: "open",
  technician_id: null,
  scheduled_date: null,
  roof_care_visit_id: visit(n),
  invoice_id: null,
  notes_tech_visible: true,
  helper_count: 0,
  deleted_at: null,
  created_by: null,
  updated_by_name: "Roof Care plans",
  ...over,
});
const careVisit = (n: number): Row => ({
  id: visit(n),
  plan_id: PLAN,
  kind: "visit1",
  due_from: "2026-11-25",
  due_by: "2026-12-30",
});

/** The two database functions of 20261120700000, over the in-memory tables. */
const announceRpcs = (timer?: FakeRpc): Record<string, FakeRpc> => ({
  roof_care_ticket_announce_claim: (args, tables) => {
    const ids = (args["p_ids"] as string[] | null | undefined) ?? null;
    const notices = (tables["roof_care_ticket_notices"] ??= []);
    const out: Row[] = [];
    for (const j of tables["service_jobs"] ?? []) {
      if (!j["roof_care_visit_id"] || j["deleted_at"]) continue;
      if (!["open", "scheduled"].includes(String(j["stage"]))) continue;
      if (ids && !ids.includes(String(j["id"]))) continue;
      if (notices.some((n) => n["service_job_id"] === j["id"])) continue;
      notices.push({ service_job_id: j["id"], claimed_at: "now", announced_at: null });
      const v = (tables["roof_care_visits"] ?? []).find((x) => x["id"] === j["roof_care_visit_id"]);
      out.push({
        id: j["id"],
        number: j["number"],
        customer_name: j["customer_name"],
        site_name: j["site_name"],
        description: j["description"],
        stage: j["stage"],
        account_id: j["account_id"],
        technician_id: j["technician_id"],
        scheduled_date: j["scheduled_date"],
        plan: "care",
        visit_kind: v?.["kind"] ?? null,
        due_from: v?.["due_from"] ?? null,
        due_by: v?.["due_by"] ?? null,
      });
    }
    return out;
  },
  roof_care_ticket_announce_finish: (args, tables) => {
    const ids = args["p_ids"] as string[];
    const notices = (tables["roof_care_ticket_notices"] ??= []);
    const mine = notices.filter(
      (n) => ids.includes(String(n["service_job_id"])) && n["announced_at"] == null,
    );
    if (args["p_written"]) for (const n of mine) n["announced_at"] = "now";
    else tables["roof_care_ticket_notices"] = notices.filter((n) => !mine.includes(n));
    return mine.length;
  },
  // Nov 20, evening (20261120840000): who was told which ticket, so a retry tells only who has
  // not heard. Tested in roof-care-go-aheads-nov20-evening.test.ts.
  roof_care_ticket_told_list: (args, tables) =>
    (tables["roof_care_ticket_told"] ?? []).filter((r) =>
      (args["p_ids"] as string[]).includes(String(r["service_job_id"])),
    ),
  roof_care_ticket_told_mark: (args, tables) => {
    const rows = (tables["roof_care_ticket_told"] ??= []);
    let n = 0;
    for (const j of args["p_jobs"] as string[])
      for (const who of args["p_people"] as string[]) {
        if (rows.some((r) => r["service_job_id"] === j && r["profile_id"] === who)) continue;
        rows.push({ service_job_id: j, profile_id: who });
        n++;
      }
    return n;
  },
  followup_sync_upsert:
    timer ??
    ((args) => ({
      action: "started",
      id: `f-${String(args["p_item_id"])}`,
      due_at: "2026-11-23T13:00:00Z",
      every_days: 2,
      first_remind_at: "2026-11-23T13:00:00Z",
    })),
});

const world = (jobs: Row[], over: Record<string, Row[]> = {}, timer?: FakeRpc): Env =>
  fakeSupabase(
    {
      profiles,
      crm_settings: [{ id: 1 }],
      service_jobs: jobs,
      roof_care_visits: jobs.map((_, i) => careVisit(i + 1)),
      roof_care_ticket_notices: [],
      ...over,
    },
    { rpcs: announceRpcs(timer) },
  );
const marks = (env: Env) =>
  (env.tables["roof_care_ticket_notices"] ?? []).map(
    (n) => `${String(n["service_job_id"]).slice(-2)}:${n["announced_at"] ? "told" : "held"}`,
  );
const callAs = <T>(fn: unknown, env: { db: unknown }, userId: string, data: Row): Promise<T> =>
  (fn as (a: { data: Row; context: unknown }) => Promise<T>)({
    data,
    context: { supabase: env.db, userId },
  });

beforeEach(() => {
  sent.mockReset();
  sent.mockImplementation(async (ids) => ids.length);
});

// ---- 16 -----------------------------------------------------------------------------------------

describe("16. the words of the announcement", () => {
  const t = (n: number, over: Partial<CareTicketToAnnounce> = {}): CareTicketToAnnounce => ({
    id: job(n),
    number: 7000 + n,
    customer_name: "Made Up Mills",
    site_name: `Plant ${n}`,
    description: "Care plan inspection (Roof Care), visit 1 of 2",
    stage: "open",
    account_id: ACC,
    technician_id: null,
    scheduled_date: null,
    plan: "care",
    visit_kind: "visit1",
    due_from: "2026-11-25",
    due_by: "2026-12-30",
    ...over,
  });

  it("the due window is said in plain dates, and the year once when it is the same", () => {
    expect(dueWindow(t(1))).toBe("Nov 25 to Dec 30, 2026");
    expect(dueWindow(t(1, { due_from: "2026-12-20", due_by: "2027-01-19" }))).toBe(
      "Dec 20, 2026 to Jan 19, 2027",
    );
    expect(dueWindow(t(1, { due_from: null }))).toBeNull();
    expect(careTicketLine(t(1))).toBe("#7001 Plant 1 (Made Up Mills), due Nov 25 to Dec 30, 2026");
  });

  it("one ticket: the usual Opened notice, with who made it, its window and who has it", () => {
    expect(careOpenedNotice([t(1)])).toEqual({
      title: "Opened: Ticket #7001 Made Up Mills — Care plan inspection (Roof Care), visit 1 of 2",
      body: "The site made it for the Roof Care plan at Plant 1 (Made Up Mills). Due between Nov 25 and Dec 30, 2026. Nobody is assigned yet.",
      url: `/service?id=${job(1)}`,
    });
    const assigned = careOpenedNotice(
      [t(1, { technician_id: TECH, scheduled_date: "2026-11-27" })],
      "Tia Tech",
    );
    expect(assigned?.body).toContain("Assigned to Tia Tech for Nov 27, 2026.");
  });

  it("several tickets: ONE notice that names each ticket and its window", () => {
    const n = careOpenedNotice([
      t(1),
      t(2),
      t(3, { due_from: "2026-12-01", due_by: "2027-01-05" }),
    ]);
    expect(n?.title).toBe("3 Roof Care plan inspection tickets opened");
    expect(n?.body).toBe(
      "The site made them for their plans. #7001 Plant 1 (Made Up Mills), due Nov 25 to Dec 30, 2026. #7002 Plant 2 (Made Up Mills), due Nov 25 to Dec 30, 2026. #7003 Plant 3 (Made Up Mills), due Dec 1, 2026 to Jan 5, 2027.",
    );
    expect(n?.url).toBe("/service");
    // A long morning names ten and counts the rest.
    const many = careOpenedNotice(Array.from({ length: 13 }, (_, i) => t(i + 1)));
    expect(many?.title).toBe("13 Roof Care plan inspection tickets opened");
    expect(many?.body).toContain("#7010 ");
    expect(many?.body).not.toContain("#7011 ");
    expect(many?.body.endsWith("And 3 more.")).toBe(true);
    expect(careOpenedNotice([])).toBeNull();
    expect(careAssignedNotice([t(1)])).toBeNull();
    expect(careAssignedNotice([t(1), t(2)])?.title).toBe(
      "2 Roof Care plan inspections assigned to you",
    );
  });

  it("a ticket's own technician is left out of its Opened notice; the same tickets share one send", () => {
    const list = [t(1), t(2, { technician_id: MANAGER })];
    const groups = careNoticeGroups(list, [ADMIN, MANAGER, ADMIN]);
    expect(groups).toEqual([
      { ids: [ADMIN], tickets: list },
      { ids: [MANAGER], tickets: [list[0]] },
    ]);
    expect(careNoticeGroups([t(1)], [ADMIN, MANAGER])).toEqual([
      { ids: [ADMIN, MANAGER], tickets: [t(1)] },
    ]);
  });
});

describe("16. the 8:00 run announces the tickets the site made", () => {
  it("one ticket: the admins and the managers hear Opened once, and it is marked announced", async () => {
    const env = world([careJob(1)]);
    const r = await dispatchCareTicketAnnouncements(env.db, MORNING);
    expect(r).toMatchObject({ tickets_checked: 1, tickets_announced: 1, tickets_held: 0 });
    expect(sent).toHaveBeenCalledTimes(1);
    const [ids, msg] = sent.mock.calls[0]!;
    expect([...ids].sort()).toEqual([ADMIN, MANAGER]);
    expect(msg.kind).toBe("ticket_watch");
    expect(msg.title).toBe(
      "Opened: Ticket #7001 Made Up Mills — Care plan inspection (Roof Care), visit 1 of 2",
    );
    expect(msg.body).toContain("Due between Nov 25 and Dec 30, 2026.");
    expect(msg.url).toBe(`/service?id=${job(1)}`);
    expect(marks(env)).toEqual(["01:told"]);
    // The ticket's own row is never written: its "last changed" stays a person's.
    expect(env.writes.filter((w) => w.table === "service_jobs")).toEqual([]);
  });

  it("three tickets in a morning: ONE notice per person, naming each ticket and its window", async () => {
    const env = world([careJob(1), careJob(2), careJob(3)]);
    const r = await dispatchCareTicketAnnouncements(env.db, MORNING);
    expect(r).toMatchObject({ tickets_checked: 3, tickets_announced: 3, notices_sent: 1 });
    expect(sent).toHaveBeenCalledTimes(1);
    const [ids, msg] = sent.mock.calls[0]!;
    expect([...ids].sort()).toEqual([ADMIN, MANAGER]);
    expect(msg.title).toBe("3 Roof Care plan inspection tickets opened");
    for (const n of [7001, 7002, 7003]) expect(msg.body).toContain(`#${n} Plant`);
    expect(msg.body.match(/due Nov 25 to Dec 30, 2026/g)).toHaveLength(3);
    expect(marks(env)).toEqual(["01:told", "02:told", "03:told"]);
  });

  it("run twice in a minute: the second run finds nothing and sends nothing", async () => {
    const env = world([careJob(1), careJob(2)]);
    await dispatchCareTicketAnnouncements(env.db, MORNING);
    const again = await dispatchCareTicketAnnouncements(
      env.db,
      new Date(MORNING.getTime() + 20_000),
    );
    expect(again).toMatchObject({ tickets_checked: 0, tickets_announced: 0, notices_sent: 0 });
    expect(sent).toHaveBeenCalledTimes(1);
  });

  it("a ticket another run holds at this moment is not taken", async () => {
    const env = world([careJob(1), careJob(2)], {
      roof_care_ticket_notices: [{ service_job_id: job(1), claimed_at: "now", announced_at: null }],
    });
    const r = await dispatchCareTicketAnnouncements(env.db, MORNING);
    expect(r.tickets_checked).toBe(1);
    expect(sent.mock.calls[0]![1].title).toContain("Ticket #7002");
    expect(marks(env)).toEqual(["01:held", "02:told"]);
  });

  it("a failed send marks nothing: the tickets are given back and the next run tells them", async () => {
    const env = world([careJob(1), careJob(2)]);
    sent.mockRejectedValueOnce(new Error("the notices table is down"));
    const first = await dispatchCareTicketAnnouncements(env.db, MORNING);
    expect(first).toMatchObject({ tickets_announced: 0, tickets_held: 2, tickets_errors: 1 });
    expect(marks(env)).toEqual([]);
    const second = await dispatchCareTicketAnnouncements(
      env.db,
      new Date(MORNING.getTime() + 60_000),
    );
    expect(second).toMatchObject({ tickets_checked: 2, tickets_announced: 2, tickets_held: 0 });
    expect(sent).toHaveBeenCalledTimes(2);
    expect(marks(env)).toEqual(["01:told", "02:told"]);
  });

  it("when the people cannot be read nothing is marked (not 'nobody is to be told')", async () => {
    const env = world([careJob(1)], { profiles: [] });
    const r = await dispatchCareTicketAnnouncements(env.db, MORNING);
    expect(r).toMatchObject({ tickets_announced: 0, tickets_held: 1 });
    expect(sent).not.toHaveBeenCalled();
    expect(marks(env)).toEqual([]);
  });

  it("tickets the app already announced, deleted ones and finished ones are left alone", async () => {
    const env = world(
      [
        careJob(1),
        careJob(2, { deleted_at: "2026-11-19T10:00:00Z" }),
        careJob(3, { stage: "done" }),
      ],
      {
        roof_care_ticket_notices: [
          { service_job_id: job(1), claimed_at: "then", announced_at: "then" },
        ],
      },
    );
    const r = await dispatchCareTicketAnnouncements(env.db, MORNING);
    expect(r.tickets_checked).toBe(0);
    expect(sent).not.toHaveBeenCalled();
  });

  it("a ticket with a technician starts their timer and tells them Assigned to you, as any new ticket", async () => {
    const env = world([
      careJob(1, { technician_id: TECH, scheduled_date: "2026-11-23", stage: "scheduled" }),
    ]);
    const r = await dispatchCareTicketAnnouncements(env.db, MORNING);
    expect(r).toMatchObject({ tickets_announced: 1, timers_started: 1, notices_sent: 2 });
    const timer = env.rpcCalls.find((c) => c.fn === "followup_sync_upsert")!;
    expect(timer.args).toMatchObject({
      p_kind: "ticket",
      p_item_id: job(1),
      p_assignee_id: TECH,
      p_account_id: ACC,
      p_due_date: "2026-11-23",
      p_url: `/service?id=${job(1)}`,
    });
    // No person made it: the timer has no "created by".
    expect("p_created_by" in timer.args).toBe(false);
    const toTech = sent.mock.calls.find(([ids]) => ids.includes(TECH))!;
    expect(toTech[0]).toEqual([TECH]);
    expect(toTech[1].kind).toBe("assigned");
    expect(toTech[1].title).toBe(
      "Assigned to you: Ticket #7001 Made Up Mills — Care plan inspection (Roof Care), visit 1 of 2",
    );
    expect(toTech[1].body).toContain("Roof Care plans assigned this to you.");
    expect(toTech[1].followup_id).toBe(`f-${job(1)}`);
    const toOffice = sent.mock.calls.find(([ids]) => ids.includes(ADMIN))!;
    expect(toOffice[1].body).toContain("Assigned to Tia Tech for Nov 23, 2026.");
  });

  it("several tickets for one technician: one Assigned notice, a timer each", async () => {
    const mine = { technician_id: TECH, scheduled_date: "2026-11-23", stage: "scheduled" };
    const env = world([careJob(1, mine), careJob(2, mine)]);
    const r = await dispatchCareTicketAnnouncements(env.db, MORNING);
    expect(r.timers_started).toBe(2);
    const toTech = sent.mock.calls.filter(([ids]) => ids.includes(TECH));
    expect(toTech).toHaveLength(1);
    expect(toTech[0]![1].title).toBe("2 Roof Care plan inspections assigned to you");
  });

  it("a timer that cannot be started holds that ticket back; the others are marked", async () => {
    const env = world(
      [careJob(1, { technician_id: TECH, scheduled_date: "2026-11-23" }), careJob(2)],
      {},
      () => {
        throw new Error("the timer function failed");
      },
    );
    const r = await dispatchCareTicketAnnouncements(env.db, MORNING);
    expect(r).toMatchObject({ tickets_announced: 1, tickets_held: 1 });
    expect(marks(env)).toEqual(["02:told"]);
  });

  it("nothing before 8:00 on the office's clock, nor on a weekend: the database is not even asked", async () => {
    for (const at of [BEFORE_EIGHT, SATURDAY]) {
      const env = world([careJob(1)]);
      const r = await dispatchCareTicketAnnouncements(env.db, at);
      expect(r.tickets_checked).toBe(0);
      expect(env.rpcCalls).toEqual([]);
    }
    expect(sent).not.toHaveBeenCalled();
  });

  it("the 8:00 route runs the pass and reports it", () => {
    const route = flat("src/routes/api.cron.reminders.ts");
    expect(route).toContain("const t = await dispatchCareTicketAnnouncements(supabaseAdmin);");
    expect(route).toContain("sendsFailed += t.tickets_errors;");
    expect(route).toContain("plan_tickets: planTickets,");
  });
});

describe("16. a ticket the app announces is told there, and marked the same way", () => {
  it("the app takes its tickets first, and gets only the ones nobody has told", async () => {
    const env = world([careJob(1), careJob(2)], {
      roof_care_ticket_notices: [
        { service_job_id: job(2), claimed_at: "then", announced_at: "then" },
      ],
    });
    expect(await claimCareTickets(env.db, [job(1), job(2)])).toEqual([job(1)]);
    await finishCareTickets(env.db, [job(1)], true);
    expect(marks(env)).toEqual(["02:told", "01:told"]);
    // The 8:00 run then has nothing to say about either.
    expect((await dispatchCareTicketAnnouncements(env.db, MORNING)).tickets_checked).toBe(0);
    expect(sent).not.toHaveBeenCalled();
  });

  it("an announcement that failed gives the ticket back, and the 8:00 run tells it", async () => {
    const env = world([careJob(1)]);
    expect(await claimCareTickets(env.db, [job(1)])).toEqual([job(1)]);
    await finishCareTickets(env.db, [job(1)], false);
    expect(marks(env)).toEqual([]);
    expect((await dispatchCareTicketAnnouncements(env.db, MORNING)).tickets_announced).toBe(1);
  });

  it("where the marks cannot be reached (the preview has no server key) the app announces as before", async () => {
    const env = fakeSupabase({ service_jobs: [careJob(1)] });
    expect(await claimCareTickets(env.db, [job(1)])).toBeNull();
    expect(await claimCareTickets(env.db, [])).toEqual([]);
  });

  it("announceCarePlanTickets takes, announces, then marks told or gives back", () => {
    const src = flat("src/lib/service.functions.ts");
    const fn = src.slice(src.indexOf("export async function announceCarePlanTickets("));
    const body = fn.slice(0, fn.indexOf("export async function moveCarePlanTicketDate("));
    const order = [
      "const mine = await claimCareTickets(sb, jobIds);",
      "for (const id of mine ?? jobIds) {",
      "await syncTicketFollowup(row, actor, sb, null);",
      "told = true;",
      "if (mine) await finishCareTickets(sb, [id], told);",
    ].map((s) => body.indexOf(s));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("the database half is the file that was applied: one run per ticket, marked only when told", () => {
    const sql = flat("supabase/migrations/20261120700000_roof_care_ticket_notices.sql");
    expect(sql).toContain(
      "service_job_id uuid primary key references public.service_jobs (id) on delete cascade,",
    );
    expect(sql).toContain("and n.claimed_at < now() - interval '15 minutes';");
    expect(sql).toContain("on conflict (service_job_id) do nothing returning service_job_id");
    expect(sql).toContain("and j.stage in ('open', 'scheduled')");
    expect(sql).toContain(
      "set announced_at = now() where service_job_id = any (p_ids) and announced_at is null;",
    );
    // Tickets that existed before are never announced again; no signed-in person can run it.
    expect(sql).toContain(
      "select j.id, j.created_at, j.created_at from public.service_jobs j where j.roof_care_visit_id is not null",
    );
    expect(sql).toContain(
      "revoke all on function public.roof_care_ticket_announce_claim(uuid[]) from public, anon, authenticated;",
    );
    // roof_care_make_tickets itself is not replaced here.
    expect(sql).not.toContain("function public.roof_care_make_tickets");
  });
});

// ---- 17 -----------------------------------------------------------------------------------------

describe("17. a plan in force or waiting for its payment holds its property and its customer", () => {
  const plan = (over: Row = {}): Row => ({
    id: PLAN,
    account_id: ACC,
    site_id: SITE,
    plan: "care",
    plan_number: 1004,
    status: "active",
    ...over,
  });
  const crm = (plans: Row[], over: Record<string, Row[]> = {}): Env =>
    fakeSupabase({
      profiles,
      crm_accounts: [
        { id: ACC, name: "Made Up Mills", kind: "company", phone: "1", deleted_at: null },
        { id: ACC2, name: "Other Made Up Co", kind: "company", phone: "1", deleted_at: null },
      ],
      crm_sites: [
        { id: SITE, account_id: ACC, name: "Main plant", deleted_at: null },
        { id: SITE2, account_id: ACC, name: "Warehouse", deleted_at: null },
        { id: SITE3, account_id: ACC2, name: "Depot", deleted_at: null },
      ],
      crm_contacts: [],
      service_jobs: [],
      crm_opportunities: [],
      roof_care_plans: plans,
      ...over,
    });
  const siteNow = (env: Env, id: string) => env.tables["crm_sites"]!.find((s) => s["id"] === id)!;

  it("the words name the plan and say what to do", () => {
    const p = { plan: "care", plan_number: 1004, status: "active", site_name: "Main plant" };
    expect(planHoldWords(p)).toBe("Roof Care plan #1004 at Main plant (in force)");
    expect(planHoldWords({ ...p, plan: "guard", status: "awaiting_payment" })).toBe(
      "Roof Guard plan #1004 at Main plant (waiting for its payment)",
    );
    expect(propertyHeldMessage(p)).toBe(
      "This property cannot be deleted: it has the Roof Care plan #1004 at Main plant (in force). End the plan first (open the property and press End plan), then delete the property.",
    );
    expect(customerHeldMessage(p)).toContain(
      "This customer cannot be deleted: it has the Roof Care plan #1004",
    );
    // One in force is named before one that waits; ended plans hold nothing.
    expect(
      holdingPlan([
        { plan: "watch", plan_number: 1001, status: "ended" },
        { plan: "guard", plan_number: 1002, status: "awaiting_payment" },
        { plan: "care", plan_number: 1009, status: "active" },
      ])?.plan_number,
    ).toBe(1009);
    expect(holdingPlan([{ plan: "watch", plan_number: 1001, status: "ended" }])).toBeNull();
  });

  it("deleting the property is refused before anything is written, for a plan in force and one that waits", async () => {
    for (const status of ["active", "awaiting_payment"]) {
      const env = crm([plan({ status })]);
      await expect(callAs(deleteSite, env, OFFICE, { id: SITE })).rejects.toThrow(
        `This property cannot be deleted: it has the Roof Care plan #1004 at Main plant ${status === "active" ? "(in force)" : "(waiting for its payment)"}. End the plan first`,
      );
      expect(env.writes).toEqual([]);
      expect(siteNow(env, SITE)["deleted_at"]).toBeNull();
    }
  });

  it("a property whose plans have all ended, and one with no plan, is deleted as before", async () => {
    const env = crm([plan({ status: "ended" })]);
    await callAs(deleteSite, env, OFFICE, { id: SITE });
    expect(siteNow(env, SITE)["deleted_at"]).toBeTruthy();
    await callAs(deleteSite, env, OFFICE, { id: SITE2 });
    expect(siteNow(env, SITE2)["deleted_at"]).toBeTruthy();
  });

  it("deleting the customer is refused: by a plan on its name, and by one at one of its properties", async () => {
    const env = crm([plan()]);
    await expect(callAs(deleteAccount, env, OFFICE, { id: ACC })).rejects.toThrow(
      "This customer cannot be deleted: it has the Roof Care plan #1004 at Main plant (in force). End the plan first (open the property and press End plan), then delete the customer.",
    );
    expect(env.writes).toEqual([]);
    // The plan still names an earlier customer; the property is this customer's now.
    const moved = crm([plan({ account_id: ACC2, status: "awaiting_payment" })]);
    await expect(callAs(deleteAccount, moved, OFFICE, { id: ACC })).rejects.toThrow(
      "(waiting for its payment)",
    );
    expect(moved.writes).toEqual([]);
  });

  it("a customer whose plans have all ended is deleted as before, its properties with it", async () => {
    const env = crm([plan({ status: "ended" })]);
    await callAs(deleteAccount, env, OFFICE, { id: ACC });
    expect(env.tables["crm_accounts"]!.find((a) => a["id"] === ACC)!["deleted_at"]).toBeTruthy();
    expect(siteNow(env, SITE)["deleted_at"]).toBeTruthy();
    expect(siteNow(env, SITE3)["deleted_at"]).toBeNull();
  });

  it("the database refuses in the same words, for both ways of deleting", () => {
    const sql = flat("supabase/migrations/20261120710000_roof_care_plan_holds_property.sql");
    const p = { plan: "care", plan_number: 1004, status: "active", site_name: "Main plant" };
    const said = (template: string) => template.replace("%", planHoldWords(p));
    const site =
      "This property cannot be deleted: it has the %. End the plan first (open the property and press End plan), then delete the property.";
    const account =
      "This customer cannot be deleted: it has the %. End the plan first (open the property and press End plan), then delete the customer.";
    expect(sql).toContain(`raise exception '${site}', v_plan`);
    expect(sql).toContain(`raise exception '${account}', v_plan`);
    expect(said(site)).toBe(propertyHeldMessage(p));
    expect(said(account)).toBe(customerHeldMessage(p));
    expect(sql).toContain("where p.status in ('active', 'awaiting_payment')");
    expect(sql).toContain(
      "when 'awaiting_payment' then ' (waiting for its payment)' else ' (in force)' end",
    );
    for (const table of ["crm_sites", "crm_accounts"])
      expect(sql).toContain(
        `create trigger ${table}_plan_hold before delete or update of deleted_at on public.${table} for each row execute function public.${table}_plan_hold();`,
      );
    // Only the step from live to deleted is refused: putting one back never is.
    expect(sql).toContain(
      "if tg_op = 'UPDATE' and not (old.deleted_at is null and new.deleted_at is not null) then return new; end if;",
    );
  });
});

// ---- 18 -----------------------------------------------------------------------------------------

describe("18. a plan's inspection ticket stays at its property, with its customer, an inspection", () => {
  const cur = {
    number: 7001,
    roof_care_visit_id: visit(1),
    site_id: SITE,
    account_id: ACC,
    service_type: "inspection",
  };
  const same = { site_id: SITE, account_id: ACC, service_type: "inspection" };

  it("the rule: each of the three is refused in plain words; nothing else is its business", () => {
    expect(careTicketMoveProblem(cur, same)).toBeNull();
    expect(careTicketMoveProblem(cur, { ...same, site_id: SITE2 })).toBe(
      "Ticket #7001 is a Roof Care plan inspection for its property. It cannot be moved to another property. For work somewhere else, open a new ticket there.",
    );
    expect(careTicketMoveProblem(cur, { ...same, site_id: null })).toContain("another property");
    expect(careTicketMoveProblem(cur, { ...same, account_id: ACC2 })).toBe(
      "Ticket #7001 is a Roof Care plan inspection for its customer. It cannot be moved to another customer. For work for someone else, open a new ticket for them.",
    );
    expect(careTicketMoveProblem(cur, { ...same, service_type: "repair" })).toBe(
      "Ticket #7001 is a Roof Care plan inspection. It cannot be changed to another kind of ticket. For a repair, start a repair ticket from this inspection once it is done.",
    );
    // A ticket that is not a plan's inspection moves freely.
    expect(
      careTicketMoveProblem(
        { ...cur, roof_care_visit_id: null },
        { site_id: SITE3, account_id: ACC2, service_type: "repair" },
      ),
    ).toBeNull();
  });

  const ticketWorld = (j: Row): Env =>
    fakeSupabase({
      profiles,
      service_jobs: [j],
      service_job_events: [],
      service_job_crew: [],
      crm_followups: [],
      crm_opportunities: [],
      crm_settings: [{ id: 1, ticket_first_days: 1, ticket_every_days: 3 }],
      crm_accounts: [
        { id: ACC, name: "Made Up Mills", deleted_at: null },
        { id: ACC2, name: "Other Made Up Co", deleted_at: null },
      ],
      crm_sites: [
        { id: SITE, account_id: ACC, name: "Plant 1", deleted_at: null },
        { id: SITE2, account_id: ACC, name: "Warehouse", deleted_at: null },
        { id: SITE3, account_id: ACC2, name: "Depot", deleted_at: null },
      ],
    });
  const save = (env: Env, over: Row) =>
    callAs<Row>(saveServiceJob, env, MANAGER, {
      id: job(1),
      customer_name: "Made Up Mills",
      description: "Care plan inspection (Roof Care), visit 1 of 2",
      service_type: "inspection",
      account_id: ACC,
      site_id: SITE,
      scheduled_date: "2026-11-27",
      ...over,
    });
  const ticketNow = (env: Env) => env.tables["service_jobs"]![0]!;

  it("the ticket page's save refuses each move before it writes, a manager's too", async () => {
    for (const [over, words] of [
      [{ site_id: SITE2 }, "It cannot be moved to another property."],
      [{ account_id: ACC2, site_id: SITE3 }, "It cannot be moved to another property."],
      [{ service_type: "repair" }, "It cannot be changed to another kind of ticket."],
    ] as const) {
      const env = ticketWorld(careJob(1));
      await expect(save(env, over)).rejects.toThrow(words);
      expect(env.writes.filter((w) => w.table === "service_jobs")).toEqual([]);
      expect(ticketNow(env)).toMatchObject({
        site_id: SITE,
        account_id: ACC,
        service_type: "inspection",
      });
    }
  });

  it("its technician, date and description change as before", async () => {
    const env = ticketWorld(careJob(1));
    await save(env, { technician_id: TECH, description: "Care plan inspection, gate code 12" });
    expect(ticketNow(env)).toMatchObject({
      technician_id: TECH,
      scheduled_date: "2026-11-27",
      description: "Care plan inspection, gate code 12",
      stage: "scheduled",
      site_id: SITE,
    });
  });

  it("a ticket that is not a plan's inspection is moved and retyped as before", async () => {
    const env = ticketWorld(careJob(1, { roof_care_visit_id: null, service_type: "repair" }));
    await save(env, { site_id: SITE2, service_type: "warranty" });
    expect(ticketNow(env)).toMatchObject({ site_id: SITE2, service_type: "warranty" });
  });

  it("the database refuses in the same words, in a rule of its own", () => {
    const sql = flat("supabase/migrations/20261120720000_care_ticket_stays_put.sql");
    const said = (next: Partial<typeof same>) =>
      careTicketMoveProblem(cur, { ...same, ...next })!.replace("#7001", "#%");
    for (const next of [{ site_id: SITE2 }, { account_id: ACC2 }, { service_type: "repair" }])
      expect(sql).toContain(`raise exception '${said(next)}', old.number`);
    expect(sql).toContain(
      "create trigger service_jobs_care_ticket_stays before update of site_id, account_id, service_type on public.service_jobs for each row execute function public.service_jobs_care_ticket_stays();",
    );
    // Only a ticket that is, and stays, a plan's inspection; the customer may follow the
    // property (two customers merged). The two older rules are not touched.
    expect(sql).toContain(
      "if old.roof_care_visit_id is null or new.roof_care_visit_id is null then return new; end if;",
    );
    expect(sql).toContain("where s.id = new.site_id and s.account_id = new.account_id)");
    expect(sql).not.toContain("function public.service_jobs_care_plan_rule");
    expect(sql).not.toContain("function public.service_jobs_cleaning_rule");
  });
});

// ---- 30 -----------------------------------------------------------------------------------------

describe("30. wording, and the checklist on a narrow phone", () => {
  it("Owner Business: a plan's revenue counts when the plan's own invoice is final", () => {
    const chart = flat("src/components/margin-line-charts.tsx");
    expect(chart).toContain(
      "A plan’s revenue counts here when the plan’s own invoice is final: the year’s price, billed when the plan is sold. What an inspection cost counts when that inspection’s invoice is final.",
    );
    expect(chart).not.toContain("counts here when an inspection’s invoice is final");
  });

  it("the ticket's invoice block no longer calls a plan inspection's invoice its share of the plan", () => {
    const block = flat("src/components/service/invoice-block.tsx");
    expect(block).not.toContain("bills this visit’s share of the plan");
    expect(block).toContain(
      "The plan’s year is billed on the plan’s own invoice, so this inspection’s invoice is for nothing and keeps what the visit cost.",
    );
    expect(block).toContain("a storm inspection beyond the ones the plan includes");
  });

  // Later on Nov 20 each row got a Pictures button (pictures on any row), so the label may now
  // narrow and break after its slash on any phone (under 640 px), not only under 390 px.
  it("the checklist row may narrow on a phone only, and drops its buttons a line under 390 px", () => {
    const src = flat("src/components/service/inspection-section.tsx");
    expect(src).toContain('className="flex items-center gap-1 max-[389px]:flex-wrap"');
    expect(src).toContain("disabled:cursor-default max-sm:min-w-0 max-[389px]:basis-auto");
    expect(src).toContain('className="flex shrink-0 items-center gap-0.5 max-[389px]:ml-auto"');
    expect(src).toContain("max-sm:min-w-0 max-sm:[overflow-wrap:anywhere]");
    expect(src).toContain('<wbr className="sm:hidden" />');
    // Every new class is behind a width: on a computer the row is as it was.
    const row = src.slice(
      src.indexOf('data-line="checklist-row"') - 200,
      src.indexOf("N/A </Button>"),
    );
    expect(row).not.toMatch(/(?<![\]:])\bmin-w-0\b/);
    expect(row).not.toMatch(/(?<![\]:])\bflex-wrap\b/);
  });

  it("a label with a slash keeps its words and may break after the slash; others are untouched", () => {
    const items = [
      { id: "a", label: "Gutters/downspouts", status: null, note: "" },
      { id: "b", label: "Seams", status: null, note: "" },
    ];
    const html = renderToStaticMarkup(
      createElement(ChecklistRows, { items, readOnly: false, onChange: () => {} }),
    );
    const labels = [...html.matchAll(/data-line="checklist-label"[^>]*>(.*?)<\/span>/g)].map(
      (m) => m[1]!,
    );
    expect(labels).toEqual(['Gutters/<wbr class="sm:hidden"/>downspouts', "Seams"]);
    expect(html.match(/data-line="checklist-row"/g)).toHaveLength(2);
  });
});
