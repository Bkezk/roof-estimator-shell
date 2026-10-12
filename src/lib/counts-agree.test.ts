/**
 * Counts agree with Work Overview everywhere (owner, Oct 12, item 6).
 *
 *  - Customers "Tickets in progress" (was "Open tickets") and a customer's open_jobs count Open /
 *    Scheduled / Done / Authorized — everything not yet invoiced or closed, which is what Work
 *    Overview shows across its groups (work, Needs authorization, Authorized — to invoice).
 *  - "Overdue tickets" is isOverdueTicket (Open / Scheduled past the day) EXCLUDING tickets with
 *    no technician (Unassigned on Work Overview, with its own flag) and EXCLUDING tickets whose
 *    follow-up is on hold (snoozed_until on a later day — Waiting there). The list badge keeps the
 *    ticket's own days but hides for an unassigned ticket. Owner › Business "Past due" is the same.
 *  - Owner › Business "Authorized, not invoiced" counts Authorized tickets with no invoice — the
 *    Awaiting invoice queue and Work Overview's to-invoice group — aged from stage_changed_at, and
 *    links to that queue; its second line is the Done tickets still to be authorized.
 *  - The "untouched" links open the pages whose Needs action strip lists them.
 */
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));

import { OPEN_TICKET_STAGES as CUSTOMER_OPEN_STAGES } from "@/lib/crm-account";
import { TO_INVOICE_STAGE, WORK_TICKET_STAGES } from "@/lib/my-work";
import { BUSINESS_HREFS, TO_INVOICE_STAGES, businessNumbers } from "@/lib/owner-business";
import { listOwnerBusiness } from "@/lib/owner-business.functions";
import { AWAITING_INVOICE_STAGE } from "@/lib/service-schedule";
import { filterTickets, TECH_ALL } from "@/lib/ticket-list-filter";
import {
  OPEN_TICKET_STAGES,
  WORK_TILES,
  countsAsOverdueTicket,
  heldTicketIds,
  isOverdueTicket,
  ticketOverdueDays,
} from "@/lib/work-counts";
import { getWorkCounts } from "@/lib/work-counts.functions";
import { fakeSupabase } from "@/test/fake-supabase";

type Row = Record<string, unknown>;
const read = (p: string) => readFileSync(p, "utf8");
const TODAY = "2026-10-12";
const PAST = "2026-10-01";
const TECH = "tech-1";

describe("the open set", () => {
  it("Tickets in progress = open / scheduled / done / authorized — the customer's set, and every stage Work Overview shows", () => {
    expect([...OPEN_TICKET_STAGES]).toEqual(["open", "scheduled", "done", "authorized"]);
    expect([...OPEN_TICKET_STAGES]).toEqual([...CUSTOMER_OPEN_STAGES]);
    // Work Overview: Open / Scheduled as work, Done under Needs authorization, Authorized under
    // "Authorized — to invoice".
    expect([...WORK_TICKET_STAGES, "done", TO_INVOICE_STAGE]).toEqual([...OPEN_TICKET_STAGES]);
    expect(WORK_TILES[0]).toEqual({
      kind: "openTickets",
      label: "Tickets in progress",
      overdue: false,
    });
    expect(read("src/lib/work-counts.ts")).not.toContain("the same three as Work Overview");
  });
  it("a customer's open_jobs reads the same four stages (crm.functions.ts listAccounts, from crm-account.ts)", () => {
    const crm = read("src/lib/crm.functions.ts");
    const fn = crm.slice(crm.indexOf("export const listAccounts"));
    expect(fn.slice(0, 1600)).toContain('.in("stage", [...OPEN_TICKET_STAGES])');
    expect(crm.slice(0, crm.indexOf("\nexport "))).toMatch(
      /import \{[^}]*OPEN_TICKET_STAGES[^}]*\} from "@\/lib\/crm-account"/,
    );
    const page = read("src/components/customers-page.tsx");
    expect(page).toContain("} in progress`");
    expect(page).not.toContain("open ticket${");
  });
});

describe("the overdue rule", () => {
  it("a ticket with no technician is never overdue (it is Unassigned); an unknown technician leaves the date to decide", () => {
    const late = { stage: "scheduled", scheduled_date: PAST };
    expect(isOverdueTicket({ ...late, technician_id: TECH }, TODAY)).toBe(true);
    expect(isOverdueTicket({ ...late, technician_id: null }, TODAY)).toBe(false);
    expect(isOverdueTicket(late, TODAY)).toBe(true);
    // The badge: the ticket's own days, hidden for an unassigned ticket.
    expect(ticketOverdueDays({ ...late, technician_id: TECH }, TODAY)).toBe(11);
    expect(ticketOverdueDays({ ...late, technician_id: null }, TODAY)).toBeNull();
  });
  it("a held follow-up (snoozed_until on a later day) keeps its ticket out; on the hold's day it is back", () => {
    const rows = [
      { kind: "ticket", item_id: "held", status: "open", snoozed_until: "2026-10-13T12:00:00Z" },
      { kind: "ticket", item_id: "back", status: "open", snoozed_until: "2026-10-12T12:00:00Z" },
      { kind: "ticket", item_id: "past", status: "open", snoozed_until: "2026-10-01T12:00:00Z" },
      { kind: "ticket", item_id: "none", status: "open", snoozed_until: null },
      {
        kind: "ticket",
        item_id: "closed",
        status: "closed",
        snoozed_until: "2026-10-13T12:00:00Z",
      },
      { kind: "invoice", item_id: "other", status: "open", snoozed_until: "2026-10-13T12:00:00Z" },
    ];
    expect([...heldTicketIds(rows, TODAY)]).toEqual(["held"]);
    const late = { stage: "open", scheduled_date: PAST, technician_id: TECH };
    const held = heldTicketIds(rows, TODAY);
    expect(countsAsOverdueTicket({ id: "held", ...late }, TODAY, held)).toBe(false);
    expect(countsAsOverdueTicket({ id: "back", ...late }, TODAY, held)).toBe(true);
    expect(countsAsOverdueTicket({ id: "held", ...late, technician_id: null }, TODAY, held)).toBe(
      false,
    );
  });
  it("the Tickets list's Overdue filter follows: an unassigned ticket past its day is not in it", () => {
    const base = {
      number: 1,
      service_type: "leak",
      technician_name: null,
      customer_name: "Acme",
      site_name: null,
      site_address: null,
      description: null,
      po_number: null,
      job_number: null,
      centerpoint_ticket: null,
      centerpoint_invoice: null,
    };
    const out = filterTickets(
      [
        { ...base, number: 1, stage: "scheduled", scheduled_date: PAST, technician_id: TECH },
        { ...base, number: 2, stage: "scheduled", scheduled_date: PAST, technician_id: null },
      ],
      {
        mineId: null,
        stage: "all",
        overdueOnly: true,
        type: "all",
        tech: TECH_ALL,
        search: "",
        today: TODAY,
      },
    );
    expect(out.map((j) => j.number)).toEqual([1]);
  });
  it("the list badge gets the row (technician_id included); the open ticket's badge passes its technician", () => {
    const service = read("src/components/service-page.tsx");
    expect(service).toContain(
      '<OverdueBadge days={ticketOverdueDays({ ...j, stage }, today)} what="Was due" />',
    );
    expect(service.replace(/\s+/g, " ")).toContain(
      "scheduled_date: job.scheduled_date, // No technician: Unassigned, not overdue (owner, Oct 12, item 6). technician_id: job.technician_id, },",
    );
  });
});

describe("getWorkCounts (the strip; fake client)", () => {
  beforeAll(() => vi.useFakeTimers({ now: new Date(`${TODAY}T15:00:00Z`), toFake: ["Date"] }));
  afterAll(() => vi.useRealTimers());
  const job = (id: string, over: Row): Row => ({
    id,
    stage: "scheduled",
    scheduled_date: PAST,
    technician_id: TECH,
    deleted_at: null,
    ...over,
  });
  const env = () =>
    fakeSupabase({
      service_jobs: [
        job("late", {}), // counts: assigned, past its day
        job("nobody", { technician_id: null }), // Unassigned, not overdue
        job("held", {}), // its follow-up is on hold until tomorrow
        job("back", {}), // its hold ended (yesterday): counts
        job("done", { stage: "done" }), // finished: never overdue, still in progress
        job("auth", { stage: "authorized", scheduled_date: null }), // in progress
        job("today", { scheduled_date: TODAY }), // due today: not overdue
        job("gone", { deleted_at: "2026-10-02T00:00:00Z" }),
        job("billed", { stage: "invoiced" }),
      ],
      crm_followups: [
        {
          id: "f1",
          kind: "ticket",
          item_id: "held",
          status: "open",
          snoozed_until: "2026-10-13T12:00:00Z",
        },
        {
          id: "f2",
          kind: "ticket",
          item_id: "back",
          status: "open",
          snoozed_until: "2026-10-11T12:00:00Z",
        },
        { id: "f3", kind: "ticket", item_id: "late", status: "open", snoozed_until: null },
        {
          id: "f4",
          kind: "invoice",
          item_id: "late",
          status: "open",
          snoozed_until: "2026-10-20T12:00:00Z",
        },
      ],
      crm_opportunities: [],
    });
  const call = (e: ReturnType<typeof fakeSupabase>) =>
    (
      getWorkCounts as unknown as (a: {
        data: unknown;
        context: unknown;
      }) => Promise<{ openTickets: number; overdueTickets: number; today: string }>
    )({ data: { today: TODAY }, context: { supabase: e.db, userId: "me" } });
  it("Tickets in progress counts open / scheduled / done / authorized; Overdue leaves out the unassigned and the held", async () => {
    const r = await call(env());
    expect(r.today).toBe(TODAY);
    expect(r.openTickets).toBe(7);
    expect(r.overdueTickets).toBe(2); // late, back
  });
});

describe("Owner › Business", () => {
  it("Authorized, not invoiced: TO_INVOICE_STAGES is the Awaiting invoice stage; aged from stage_changed_at; the Done tickets on a second line", () => {
    expect([...TO_INVOICE_STAGES]).toEqual([AWAITING_INVOICE_STAGE]);
    expect([...TO_INVOICE_STAGES]).toEqual([TO_INVOICE_STAGE]);
    const n = businessNumbers({
      today: TODAY,
      now: `${TODAY}T15:00:00Z`,
      tickets: [
        {
          stage: "authorized",
          stage_changed_at: "2026-10-02T12:00:00Z",
          scheduled_date: null,
          invoice_id: null,
        },
        {
          stage: "authorized",
          stage_changed_at: "2026-10-10T12:00:00Z",
          scheduled_date: null,
          invoice_id: null,
        },
        {
          stage: "authorized",
          stage_changed_at: "2026-09-01T12:00:00Z",
          scheduled_date: null,
          invoice_id: "inv",
        },
        {
          stage: "done",
          stage_changed_at: "2026-10-05T12:00:00Z",
          scheduled_date: null,
          invoice_id: null,
        },
      ],
      invoices: [],
      pos: [],
      opps: [],
      snoozed: 0,
      untouched: null,
    });
    expect(n.toInvoice).toEqual({ count: 2, oldestDays: 10 });
    expect(n.toAuthorize).toEqual({ count: 1, oldestDays: 7 });
    expect(BUSINESS_HREFS.toInvoice).toBe("/service/invoices?tab=to-invoice");
    const biz = read("src/components/owner-business.tsx");
    expect(biz).toContain('title="Authorized, not invoiced"');
    expect(biz).toContain('help="Tickets marked Authorized that have no invoice yet');
    expect(biz).toContain("done, awaiting authorization");
    expect(biz).not.toContain("Waiting to invoice");
  });
  it("Past due is the tile's rule: no unassigned ticket, no held ticket", () => {
    const late = { stage: "scheduled", stage_changed_at: null, scheduled_date: PAST };
    const n = businessNumbers({
      today: TODAY,
      now: `${TODAY}T15:00:00Z`,
      tickets: [
        { id: "a", ...late, technician_id: TECH },
        { id: "b", ...late, technician_id: null },
        { id: "c", ...late, technician_id: TECH },
        { id: "d", ...late, technician_id: TECH, stage: "done" },
      ],
      invoices: [],
      pos: [],
      opps: [],
      snoozed: 0,
      untouched: null,
      heldTickets: new Set(["c"]),
    });
    expect(n.stale.pastDue).toBe(1);
  });
  it("the untouched links open the pages whose Needs action strip lists them (no filter param exists)", () => {
    expect(BUSINESS_HREFS.untouchedTickets).toBe("/service");
    expect(BUSINESS_HREFS.untouchedOpps).toBe("/opportunities");
    expect(BUSINESS_HREFS).not.toHaveProperty("untouched");
    expect(read("src/components/service-page.tsx")).toContain(
      '<NeedsActionStrip kinds={["ticket"]} />',
    );
    expect(read("src/components/opportunities-page.tsx")).toContain(
      '<NeedsActionStrip kinds={["opportunity"]} />',
    );
    expect(read("src/lib/service-search.ts")).not.toMatch(/untouched|needs/);
    const biz = read("src/components/owner-business.tsx");
    expect(biz).toContain("href={BUSINESS_HREFS.untouchedTickets}");
    expect(biz).toContain("href={BUSINESS_HREFS.untouchedOpps}");
    expect(biz).not.toContain("BUSINESS_HREFS.untouched}");
  });
});

describe("listOwnerBusiness (fake client)", () => {
  beforeAll(() => vi.useFakeTimers({ now: new Date(`${TODAY}T15:00:00Z`), toFake: ["Date"] }));
  afterAll(() => vi.useRealTimers());
  const ME = "00000000-0000-4000-8000-000000000001";
  const job = (id: string, over: Row): Row => ({
    id,
    stage: "scheduled",
    stage_changed_at: null,
    scheduled_date: PAST,
    invoice_id: null,
    technician_id: TECH,
    deleted_at: null,
    ...over,
  });
  it("reads the Authorized tickets for the tile and the ticket holds for Past due", async () => {
    const e = fakeSupabase({
      profiles: [{ id: ME, role: "admin", access: [], full_name: "B", email: "b@x" }],
      service_jobs: [
        job("late", {}),
        job("nobody", { technician_id: null }),
        job("held", {}),
        job("auth", {
          stage: "authorized",
          stage_changed_at: "2026-10-09T12:00:00Z",
          scheduled_date: null,
        }),
        job("auth-billed", {
          stage: "authorized",
          stage_changed_at: "2026-10-09T12:00:00Z",
          invoice_id: "i",
        }),
        job("done", { stage: "done", stage_changed_at: "2026-10-11T12:00:00Z" }),
      ],
      invoices: [],
      service_job_purchase_orders: [],
      crm_opportunities: [],
      crm_followups: [
        {
          id: "f1",
          kind: "ticket",
          item_id: "held",
          status: "open",
          snoozed_until: "2026-10-14T12:00:00Z",
        },
        {
          id: "f2",
          kind: "ticket",
          item_id: "late",
          status: "open",
          snoozed_until: "2026-10-01T12:00:00Z",
        },
      ],
    });
    const r = await (
      listOwnerBusiness as unknown as (a: {
        data: unknown;
        context: unknown;
      }) => Promise<ReturnType<typeof businessNumbers>>
    )({ data: { today: TODAY }, context: { supabase: e.db, userId: ME } });
    expect(r.toInvoice).toEqual({ count: 1, oldestDays: 3 });
    expect(r.toAuthorize).toEqual({ count: 1, oldestDays: 1 });
    expect(r.stale.pastDue).toBe(1);
    expect(r.stale.snoozed).toBe(1);
  });
});
