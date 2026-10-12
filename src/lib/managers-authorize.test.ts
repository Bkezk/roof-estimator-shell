/**
 * Managers authorize Done tickets too (owner, Oct 12: "make managers able to authorize,
 * apparently they do that sometimes"). A manager could already press "Mark authorized"
 * (invoice-block gates on managesTickets; stageProblem lets a manager set any stage). What they
 * lacked: the Done notice (`ticket_done`) went only to ticket_authorizers() — the chosen person,
 * else Brandon, else every admin, never a manager unless chosen — and Work Overview's "Needs
 * authorization" held only the kind-"invoice" follow-up, which is assigned to authorizers[0]
 * alone. So a manager who was not the named authorizer was never told and never saw the queue.
 *
 *  1. 20261012170000_managers_authorize.sql: ticket_authorizers() = the named person (chosen,
 *     else Brandon) first, then every other admin and manager by created_at, id, no repeats.
 *  2. afterTicketStage: ticket_done to every id the rpc returns minus the actor; the Authorize
 *     follow-up stays with authorizers[0].
 *  3. listMyWork: every admin and manager gets the Done queue (`toAuthorize`), whatever `who`
 *     asks for; mergeWork lists each ticket once under Needs authorization — the follow-up row
 *     when it is among the viewer's follow-ups (the named authorizer's: Snooze / Close, the
 *     reminder line), else the ticket row — with "Waiting N days" since its close-out.
 *  4. The words: BUCKET_HELP.authorize, the Service rates picker's sentence.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const notify = vi.hoisted(() =>
  vi.fn<(ids: string[], msg: { kind: string; title: string }, sb: unknown) => Promise<number>>(
    async () => 1,
  ),
);
vi.mock("@/lib/notify.server", () => ({
  serverClient: async (fallback: unknown) => fallback,
  notify,
}));
vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));

import { afterTicketStage } from "@/lib/ticket-events.server";
import type { Client } from "@/lib/notify.server";
import {
  BUCKET_HELP,
  TO_AUTHORIZE_STAGE,
  authorizeWaitingSince,
  bucketOf,
  flagUnassigned,
  listGroups,
  mergeWork,
  toAuthorizeItem,
  toAuthorizeItems,
  type FollowupIn,
  type TicketIn,
} from "@/lib/my-work";
import { listMyWork, type MyWorkResult } from "@/lib/my-work.functions";
import { fakeSupabase } from "@/test/fake-supabase";

type Row = Record<string, unknown>;
const read = (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : "");
const flat = (s: string) => s.replace(/--[^\n]*/g, "").replace(/\s+/g, " ");
const utcDay = (iso: string) => iso.slice(0, 10);
const TODAY = "2026-10-12";

const DIR = "supabase/migrations";
const FILE = "20261012170000_managers_authorize.sql";

// ── 1. The migration ────────────────────────────────────────────────────────────────────────

describe("1. the migration: the named authorizer first, then every other admin and manager", () => {
  const raw = read(`${DIR}/${FILE}`);
  const sql = flat(raw);
  const fn = sql.slice(
    sql.indexOf("create or replace function public.ticket_authorizers()"),
    sql.indexOf("$$;", sql.indexOf("create or replace function public.ticket_authorizers()")),
  );
  it("exists and is the last word on ticket_authorizers()", () => {
    expect(raw).not.toBe("");
    const defs = readdirSync(DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .filter((f) =>
        readFileSync(`${DIR}/${f}`, "utf8").includes(
          "create or replace function public.ticket_authorizers(",
        ),
      );
    expect(defs.at(-1)).toBe(FILE);
  });
  it("keeps the signature: setof uuid, stable, security definer, search_path public", () => {
    expect(fn).toContain(
      "returns setof uuid language sql stable security definer set search_path = public as $$",
    );
  });
  it("chosen (settings, while admin / manager) → Brandon (same) → named = one of them", () => {
    const chosen = fn.indexOf(
      "chosen as ( select p.id, p.created_at from public.service_settings s join public.profiles p on p.id = s.authorizer_id where s.id = 1 and p.role in ('admin', 'manager') )",
    );
    const brandon = fn.indexOf(
      "fallback as ( select p.id, p.created_at from public.profiles p where lower(p.email) = 'brandon@flatroofonline.com' and p.role in ('admin', 'manager') and not exists (select 1 from chosen) )",
    );
    const named = fn.indexOf(
      "named as ( select id, created_at from chosen union all select id, created_at from fallback )",
    );
    expect(chosen).toBeGreaterThan(0);
    expect(brandon).toBeGreaterThan(chosen);
    expect(named).toBeGreaterThan(brandon);
    expect(raw).not.toMatch(/= 'Brandon@/);
  });
  it("then every other admin and manager, without repeating the named one", () => {
    expect(fn).toContain(
      "others as ( select p.id, p.created_at from public.profiles p where p.role in ('admin', 'manager') and not exists (select 1 from named n where n.id = p.id) )",
    );
    // No "admins only" leg any more.
    expect(fn).not.toContain("where p.role = 'admin' ");
  });
  it("the named one is rank 0 and comes first; the rest by created_at, id", () => {
    expect(fn).toContain(
      "select id from ( select id, created_at, 0 as rank from named union all select id, created_at, 1 as rank from others ) a order by rank, created_at, id;",
    );
  });
  it("keeps the grants: not public or anon; authenticated and service_role", () => {
    expect(sql).toContain("revoke all on function public.ticket_authorizers() from public, anon;");
    expect(sql).toContain(
      "grant execute on function public.ticket_authorizers() to authenticated, service_role;",
    );
  });
  it("is idempotent and leaves the default-authorizer trigger alone", () => {
    expect(raw).not.toMatch(/create function|create table|create trigger|add column|drop/i);
    expect(sql).not.toContain("default_authorizer_on_profile");
    expect(sql).toContain("comment on column public.service_settings.authorizer_id is");
  });
});

// ── 2. The Done notice ──────────────────────────────────────────────────────────────────────

describe("2. a ticket reaching Done tells every authorizer; the follow-up stays with the first", () => {
  const BRANDON = "brandon";
  const MANAGER = "manager-1";
  const ADMIN2 = "admin-2";
  const TECH = { id: "tech-1", name: "Ted Tech" };
  const row = (over: Row = {}) => ({
    id: "job-1",
    number: 6012,
    customer_name: "Acme",
    description: "Leak",
    stage: "done",
    account_id: null,
    technician_id: "tech-1",
    created_by: "office-1",
    deleted_at: null as string | null,
    ...over,
  });
  let tables: Record<string, Row[]>;
  let authorizers: string[];
  const client = () =>
    fakeSupabase(tables, { rpcs: { ticket_authorizers: () => authorizers } }).db as Client;
  let errorLog: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    vi.clearAllMocks();
    authorizers = [BRANDON, MANAGER, ADMIN2];
    tables = {
      profiles: [
        { id: "tech-1", full_name: "Ted Tech", email: "t@x", technician: true },
        { id: "office-1", full_name: "Olive Office", email: "o@x", technician: false },
        { id: BRANDON, full_name: "Brandon", email: "b@x", technician: false },
        { id: MANAGER, full_name: "Mo Manager", email: "m@x", technician: false },
        { id: ADMIN2, full_name: "Al Admin", email: "al@x", technician: false },
      ],
      crm_followups: [],
      crm_settings: [
        {
          id: 1,
          opportunity_close_days: 30,
          opportunity_first_days: 3,
          opportunity_every_days: 7,
          ticket_first_days: 1,
          ticket_every_days: 3,
        },
      ],
    };
    errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => errorLog.mockRestore());

  it("ticket_done goes to all three (the whole list, not truncated); the Authorize follow-up to the first", async () => {
    await afterTicketStage(row(), "scheduled", TECH, client());
    expect(notify).toHaveBeenCalledTimes(1);
    const [ids, msg] = notify.mock.calls[0]!;
    expect(ids).toEqual([BRANDON, MANAGER, ADMIN2]);
    expect(msg.kind).toBe("ticket_done");
    expect(tables["crm_followups"]).toHaveLength(1);
    expect(tables["crm_followups"]![0]).toMatchObject({
      kind: "invoice",
      item_id: "job-1",
      assignee_id: BRANDON,
      title: "Authorize Ticket #6012 Acme — Leak",
    });
  });
  it("the manager who marks it Done himself is left out; the others are told", async () => {
    await afterTicketStage(row(), "scheduled", { id: MANAGER, name: "Mo" }, client());
    expect(notify.mock.calls[0]![0]).toEqual([BRANDON, ADMIN2]);
    expect(tables["crm_followups"]![0]).toMatchObject({ assignee_id: BRANDON });
  });
  it("the code keeps every id the rpc returns", () => {
    const src = read("src/lib/ticket-events.server.ts");
    const ids = src.slice(
      src.indexOf("export async function authorizerIds"),
      src.indexOf("\n}\n", src.indexOf("export async function authorizerIds")),
    );
    expect(ids).toContain(
      'return (data ?? []).filter((x): x is string => typeof x === "string" && !!x);',
    );
    expect(ids).not.toMatch(/slice|\[0\]/);
    expect(src).toContain("const others = reviewers.filter((id) => id !== actor.id);");
    expect(src).toContain(
      "const reviewers = authorizers.length ? authorizers : office.map((u) => u.id);",
    );
    expect(src).toContain("authorizers[0] ??");
  });
});

// ── 3. Work Overview ────────────────────────────────────────────────────────────────────────

const ticket = (over: Partial<TicketIn> = {}): TicketIn => ({
  id: "t1",
  number: 6012,
  customer_name: "Bell County BOE",
  site_name: null,
  site_address: null,
  description: "Leak",
  service_type: "leak",
  stage: "done",
  scheduled_date: "2026-10-01",
  technician_id: "ted",
  completed_at: "2026-10-08T15:00:00Z",
  stage_changed_at: "2026-10-08T15:30:00Z",
  ...over,
});
const authorize = (over: Partial<FollowupIn> = {}): FollowupIn => ({
  id: "f1",
  title: "Authorize Ticket #6012 Bell County BOE — Leak",
  url: "/service?id=t1",
  due_at: "2026-10-12T12:00:00Z",
  status: "open",
  kind: "invoice",
  item_id: "t1",
  assignee_id: "brandon",
  every_days: 1,
  snoozed_until: null,
  ...over,
});

describe("3a. the pure rules", () => {
  it("a Done ticket is a Needs authorization row: not done, needsAuth, waiting since its close-out", () => {
    expect(TO_AUTHORIZE_STAGE).toBe("done");
    const item = toAuthorizeItem(ticket(), { ted: "Ted" }, utcDay)!;
    expect(item).toMatchObject({
      key: "ticket:t1",
      kind: "ticket",
      title: "#6012 Leak",
      status: "Done",
      done: false,
      needsAuth: true,
      waitingSince: "2026-10-08T15:00:00Z",
      assigneeName: "Ted",
      href: "/service?id=t1",
      followup: null,
    });
    expect(bucketOf(item, TODAY, utcDay)).toBe("authorize");
    expect(bucketOf({ ...item, date: null }, TODAY, utcDay)).toBe("authorize");
    // Without a close-out stamp: the stage stamp; without either: nothing.
    expect(authorizeWaitingSince(ticket({ completed_at: null }))).toBe("2026-10-08T15:30:00Z");
    expect(authorizeWaitingSince({ completed_at: null, stage_changed_at: null })).toBeNull();
    expect(
      toAuthorizeItem(ticket({ completed_at: null, stage_changed_at: null }))!.waitingSince,
    ).toBeNull();
  });
  it("any other stage is not a row; toAuthorizeItems drops it and sorts the rest", () => {
    expect(toAuthorizeItem(ticket({ stage: "scheduled" }))).toBeNull();
    expect(toAuthorizeItem(ticket({ stage: "authorized" }))).toBeNull();
    const items = toAuthorizeItems(
      [
        ticket({ id: "b", scheduled_date: "2026-10-03" }),
        ticket({ id: "x", stage: "authorized" }),
        ticket({ id: "a", scheduled_date: "2026-10-02" }),
      ],
      {},
      utcDay,
    );
    expect(items.map((i) => i.key)).toEqual(["ticket:a", "ticket:b"]);
    expect(toAuthorizeItems(null)).toEqual([]);
  });
  it("mergeWork: a manager without the follow-up sees the ticket row under Needs authorization", () => {
    const items = mergeWork(
      { tickets: [], tasks: [], followups: [], toAuthorize: [ticket()] },
      utcDay,
    );
    expect(items.map((i) => i.key)).toEqual(["ticket:t1"]);
    expect(items[0]).toMatchObject({ needsAuth: true, waitingSince: "2026-10-08T15:00:00Z" });
    const groups = listGroups(items, TODAY, { authorize: true, toYmd: utcDay });
    expect(groups.find((g) => g.bucket === "authorize")!.items.map((i) => i.key)).toEqual([
      "ticket:t1",
    ]);
    expect(groups.filter((g) => g.items.length > 0).map((g) => g.bucket)).toEqual(["authorize"]);
  });
  it("mergeWork: with its Authorize follow-up listed, that row alone — carrying the ticket's waiting time", () => {
    const items = mergeWork(
      { tickets: [], tasks: [], followups: [authorize()], toAuthorize: [ticket()] },
      utcDay,
    );
    expect(items.map((i) => i.key)).toEqual(["followup:f1"]);
    expect(items[0]).toMatchObject({
      needsAuth: true,
      waitingSince: "2026-10-08T15:00:00Z",
      followup: { id: "f1", every_days: 1 },
    });
    // A closed follow-up is no row, so the ticket row stands.
    const closed = mergeWork(
      {
        tickets: [],
        tasks: [],
        followups: [authorize({ status: "closed" })],
        toAuthorize: [ticket()],
      },
      utcDay,
    );
    expect(closed.map((i) => i.key)).toEqual(["ticket:t1"]);
    // A ticket's own reminder (kind "ticket") is not the Authorize row: both are listed.
    const own = mergeWork(
      {
        tickets: [],
        tasks: [],
        followups: [
          authorize({ id: "f2", kind: "ticket", assignee_id: "ted", title: "Follow up" }),
        ],
        toAuthorize: [ticket()],
      },
      utcDay,
    );
    expect(own.map((i) => i.key).sort()).toEqual(["followup:f2", "ticket:t1"]);
    // The follow-up alone (a viewer without the queue, as before): untouched, no waiting time.
    const alone = mergeWork({ tickets: [], tasks: [], followups: [authorize()] }, utcDay);
    expect(alone.map((i) => i.key)).toEqual(["followup:f1"]);
    expect(alone[0]!.waitingSince).toBeUndefined();
  });
  it("the Done row the server still sends among `tickets` stays dropped; the queue's row is the one listed", () => {
    const items = mergeWork(
      { tickets: [ticket()], tasks: [], followups: [], toAuthorize: [ticket()] },
      utcDay,
    );
    expect(items.map((i) => i.key)).toEqual(["ticket:t1"]);
    expect(items[0]!.needsAuth).toBe(true);
  });
});

describe("3b. listMyWork, through the fake client", () => {
  const MANAGER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const BRANDON = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const TECH = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const OFFICE = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const profiles: Row[] = [
    { id: MANAGER, role: "manager", access: [], technician: false, full_name: "Mo", email: "m@x" },
    {
      id: BRANDON,
      role: "admin",
      access: [],
      technician: false,
      full_name: "Brandon",
      email: "b@x",
    },
    {
      id: TECH,
      role: "user",
      access: ["service"],
      technician: true,
      full_name: "Ted",
      email: "t@x",
    },
    {
      id: OFFICE,
      role: "user",
      access: ["service", "customers", "invoices"],
      technician: false,
      full_name: "Olive",
      email: "o@x",
    },
  ];
  const job = (over: Row = {}): Row => ({
    id: "j-done",
    number: 6012,
    customer_name: "Bell County BOE",
    site_name: null,
    site_address: null,
    description: "Leak",
    service_type: "leak",
    stage: "done",
    scheduled_date: "2026-10-01",
    technician_id: TECH,
    created_at: "2026-09-20T12:00:00Z",
    completed_at: "2026-10-08T15:00:00Z",
    stage_changed_at: "2026-10-08T15:30:00Z",
    deleted_at: null,
    ...over,
  });
  const authorizeFollowup: Row = {
    id: "f-auth",
    title: "Authorize Ticket #6012 Bell County BOE — Leak",
    url: "/service?id=j-done",
    due_at: "2026-10-09T12:00:00Z",
    status: "open",
    kind: "invoice",
    item_id: "j-done",
    assignee_id: BRANDON,
    account_id: null,
    every_days: 1,
    snoozed_until: null,
  };
  let tables: Record<string, Row[]>;
  /** What the database answers for ticket_authorizers(): after the migration, Brandon then Mo. */
  let authorizers: string[];
  beforeEach(() => {
    authorizers = [BRANDON, MANAGER];
    tables = {
      profiles,
      service_jobs: [
        job(),
        // A second Done ticket, nobody's, no follow-up yet (older close-out: first in the queue).
        job({
          id: "j-done-nobody",
          number: 6013,
          technician_id: null,
          completed_at: "2026-10-06T09:00:00Z",
          stage_changed_at: "2026-10-06T09:00:00Z",
        }),
        job({ id: "j-deleted", number: 6001, deleted_at: "2026-10-01T00:00:00Z" }),
        job({
          id: "j-sched",
          number: 6003,
          stage: "scheduled",
          scheduled_date: "2026-10-14",
          completed_at: null,
          stage_changed_at: null,
        }),
        job({ id: "j-authorized", number: 6004, stage: "authorized" }),
      ],
      tasks: [],
      crm_followups: [authorizeFollowup],
      crm_opportunities: [],
      crm_settings: [{ id: 1, unassigned_overdue_days: 1 }],
    };
  });
  const run = async (userId: string, who?: string) => {
    const r = await (
      listMyWork as unknown as (a: { data: Row; context: unknown }) => Promise<MyWorkResult>
    )({
      data: who ? { who } : {},
      context: {
        supabase: fakeSupabase(tables, { rpcs: { ticket_authorizers: () => authorizers } }).db,
        userId,
      },
    });
    const items = flagUnassigned(mergeWork(r, utcDay), TODAY, r.unassignedOverdueDays);
    const groups = listGroups(items, TODAY, {
      authorize: r.authorizer,
      invoice: r.invoicer,
      unassigned: !!r.unassigned,
      toYmd: utcDay,
    });
    const by = Object.fromEntries(groups.map((g) => [g.bucket, g.items]));
    const where = (key: string) =>
      groups.filter((g) => g.items.some((i) => i.key === key)).map((g) => g.bucket);
    return { r, items, by, where };
  };

  it("a manager who is not the named authorizer (Mine): both Done tickets, as ticket rows", async () => {
    const { r, by, where } = await run(MANAGER);
    expect(r.authorizer).toBe(true);
    // The queue: live Done tickets only, whatever `who` (the fake keeps the table's order; the
    // completed_at ordering is pinned on the query below).
    expect(r.toAuthorize.map((t) => t.id)).toEqual(["j-done", "j-done-nobody"]);
    expect(r.toAuthorize[0]).toMatchObject({
      stage: "done",
      completed_at: "2026-10-08T15:00:00Z",
      stage_changed_at: "2026-10-08T15:30:00Z",
    });
    // Brandon's follow-up is not among Mo's own follow-ups: the ticket rows stand.
    expect(r.followups).toEqual([]);
    expect(by["authorize"]!.map((i) => i.key)).toEqual(["ticket:j-done", "ticket:j-done-nobody"]);
    expect(by["authorize"]![0]).toMatchObject({
      needsAuth: true,
      done: false,
      waitingSince: "2026-10-08T15:00:00Z",
      assigneeName: "Ted",
    });
    expect(where("ticket:j-done")).toEqual(["authorize"]);
    expect(where("ticket:j-done-nobody")).toEqual(["authorize"]);
    // Never Unassigned, never overdue, never to-invoice.
    expect(by["unassigned"] ?? []).toEqual([]);
    expect(by["overdue"] ?? []).toEqual([]);
    expect(by["invoice"]!.map((i) => i.key)).toEqual(["ticket:j-authorized"]);
  });
  it("the same manager before the migration is applied (the rpc names only Brandon): still the whole queue", async () => {
    authorizers = [BRANDON];
    const { r, by } = await run(MANAGER);
    expect(r.authorizer).toBe(true);
    expect(r.toAuthorize.map((t) => t.id)).toEqual(["j-done", "j-done-nobody"]);
    expect(by["authorize"]!.map((i) => i.key)).toEqual(["ticket:j-done", "ticket:j-done-nobody"]);
  });
  it("the named authorizer (Mine): one row per ticket — the follow-up row for his, with the waiting time", async () => {
    const { r, by, where } = await run(BRANDON);
    expect(r.authorizer).toBe(true);
    expect(r.toAuthorize.map((t) => t.id)).toEqual(["j-done", "j-done-nobody"]);
    expect(r.followups.map((f) => f.id)).toEqual(["f-auth"]);
    // compareWork: by day — the ticket's Oct 1, the follow-up's due day Oct 9.
    expect(by["authorize"]!.map((i) => i.key)).toEqual(["ticket:j-done-nobody", "followup:f-auth"]);
    expect(by["authorize"]![1]).toMatchObject({
      needsAuth: true,
      waitingSince: "2026-10-08T15:00:00Z",
      followup: { id: "f-auth", every_days: 1 },
    });
    expect(where("ticket:j-done")).toEqual([]);
  });
  it("Everyone (the manager): the follow-up row is listed for the ticket that has one, the ticket row for the other", async () => {
    const { r, by, where } = await run(MANAGER, "all");
    expect(r.followups.map((f) => f.id)).toEqual(["f-auth"]);
    expect(by["authorize"]!.map((i) => i.key)).toEqual(["ticket:j-done-nobody", "followup:f-auth"]);
    expect(where("ticket:j-done")).toEqual([]);
    // One person's view (Ted's): his Scheduled ticket, and still the whole queue as ticket rows.
    const ted = await run(MANAGER, TECH);
    expect(ted.r.tickets.map((t) => t.id)).toEqual(["j-sched"]);
    expect(ted.by["authorize"]!.map((i) => i.key)).toEqual([
      "ticket:j-done",
      "ticket:j-done-nobody",
    ]);
  });
  it("a technician gets nothing of it; an office user (plain, Invoices) neither — as before", async () => {
    const tech = await run(TECH);
    expect(tech.r.authorizer).toBe(false);
    expect(tech.r.toAuthorize).toEqual([]);
    expect(tech.by["authorize"]).toBeUndefined();
    expect(tech.items.map((i) => i.key)).toEqual(["ticket:j-sched"]);
    const office = await run(OFFICE);
    expect(office.r.authorizer).toBe(false);
    expect(office.r.toAuthorize).toEqual([]);
    expect(office.by["authorize"]).toBeUndefined();
    // The office user still invoices (seesInvoices), unchanged.
    expect(office.r.invoicer).toBe(true);
  });
  it("the query, pinned: managesTickets, the Done stage, live rows, completed_at then stage_changed_at, the to-invoice pattern", () => {
    const fn = read("src/lib/my-work.functions.ts");
    const q = fn.slice(fn.indexOf("const reviewer = managesTickets(me);"), fn.indexOf("let bq ="));
    expect(q).toContain(
      '"id, number, customer_name, site_name, site_address, description, service_type, stage, scheduled_date, technician_id, completed_at, stage_changed_at",',
    );
    expect(q).toContain('.is("deleted_at", null)');
    expect(q).toContain('.eq("stage", TO_AUTHORIZE_STAGE)');
    expect(q).toContain('.order("completed_at", { ascending: true, nullsFirst: false })');
    expect(q).toContain('.order("stage_changed_at", { ascending: true, nullsFirst: false })');
    expect(q).toContain(".limit(LIMIT)");
    expect(q).not.toMatch(/scope|\.in\("technician_id"/);
    expect(fn).toContain(
      "reviewer || (!auth.error && (auth.data ?? []).some((id: unknown) => id === context.userId));",
    );
    expect(fn).toContain("toAuthorize: (toAuthorize.data ?? []) as TicketIn[],");
  });
});

// ── 4. The words ────────────────────────────────────────────────────────────────────────────

describe("4. the words", () => {
  it("BUCKET_HELP.authorize: any admin or manager; the named authorizer gets the reminders", () => {
    expect(BUCKET_HELP.authorize).toBe(
      "Tickets the technician has completed. Any admin or manager can review the close-out and mark them Authorized; the named authorizer gets the reminders.",
    );
  });
  it("the page shows Waiting N days on a Needs authorization row as on a to-invoice row", () => {
    const page = read("src/components/my-work-page.tsx");
    expect(page).toContain("{(item.toInvoice || item.needsAuth) && (");
    expect(page).toContain("<WaitingSince since={item.waitingSince ?? null} today={today} />");
    expect(page).toContain("function WaitingSince({ since, today }");
    expect(page).toContain("authorize={!!q.data?.authorizer}");
  });
  it("Setup › Service rates no longer says one person authorizes", () => {
    const ui = read("src/components/service-rates-settings.tsx");
    expect(ui).toContain(
      "Owns the &quot;Authorize ticket&quot; reminder when a ticket is Done. Every admin",
    );
    expect(ui).toContain(
      "and manager is told the ticket is done, sees it under Needs authorization on Work",
    );
    expect(ui).toContain("Overview and can mark it Authorized.");
    expect(ui).not.toContain("Any manager can still mark a ticket");
    // The Reminders page says nothing about who authorizes (nothing to keep accurate there).
    expect(read("src/components/reminders-settings.tsx")).not.toMatch(/authoriz/i);
    expect(read("src/routes/admin.reminders.tsx")).not.toMatch(/authoriz/i);
  });
});
