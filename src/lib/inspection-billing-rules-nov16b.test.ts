/**
 * Audit of Nov 16, fixes 1 to 10 and 28 (owner: "go for everything"). The audit proved, in the
 * browser and on the live database, that the "only a manager bills an inspection" rule of that
 * morning could be got around, and that its tests only compared source text. These tests run
 * the server functions against the in-memory client:
 *
 *   1  a sales login cannot change an authorized inspection's Type and back (saveServiceJob);
 *   4  "billed" is read from the invoices, not from the ticket's pointer (getOrCreateInvoice,
 *      createAnotherInvoice, setServiceStage);
 *   5  a deleted draft never leaves the ticket pointing at it without saying so (voidInvoice);
 *   6  a finished inspection is not open work (tile, filter, Tech Board, customer delete);
 *   7  the Owner tile counts what the other three lists count;
 *   8  the office is told when a billed inspection is authorized;
 *   9  the waiting lists are filtered in the database;
 *   28 a link that is not a page of this site is dropped, never followed and never a reason to
 *      lose the notice.
 *
 * The database half (supabase/migrations/20261116150000_inspection_billing_rules.sql) was run
 * on the live database as four different logins in a rolled-back transaction; the record is
 * docs/qa/audit-fixes-2026-11-16.md. Here the file is only checked to be the one applied.
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const notify = vi.hoisted(() =>
  vi.fn<(ids: string[], msg: { kind: string; title: string }, sb: unknown) => Promise<number>>(
    async () => 1,
  ),
);
vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));
vi.mock("@/lib/notify.server", () => ({
  serverClient: async (fallback: unknown) => fallback,
  notify,
}));
vi.mock("@/lib/service-crew.server", () => ({
  syncCrewLead: vi.fn(async () => {}),
  writeCrew: vi.fn(async () => 0),
  readCrew: vi.fn(async () => []),
}));

import { keepsCustomer } from "@/lib/crm-account";
import { deleteAccount } from "@/lib/crm.functions";
import { frameHeadersFor, FRAME_HEADERS, isLovablePreviewHost } from "@/lib/frame-rule";
import { createAnotherInvoice, getOrCreateInvoice, voidInvoice } from "@/lib/invoices.functions";
import { followupItem } from "@/lib/my-work";
import { businessNumbers } from "@/lib/owner-business";
import { saveServiceJob, setServiceStage } from "@/lib/service.functions";
import { finishedUnassigned } from "@/lib/service-schedule";
import { afterTicketStage } from "@/lib/ticket-events.server";
import { filterTickets, type ListTicket } from "@/lib/ticket-list-filter";
import {
  AWAITS_INVOICE_OR,
  INSPECTION_BILL_MANAGER,
  INSPECTION_STAGE_MESSAGE,
  isFinishedInspection,
  NOT_FINISHED_INSPECTION_OR,
  TYPE_LOCK_MESSAGE,
  typeChangeProblem,
  typeLockedFor,
} from "@/lib/ticket-stage";
import { getWorkCounts } from "@/lib/work-counts.functions";
import { isOpenTicket, SERVICE_OPEN_WORK } from "@/lib/work-counts";
import { fakeSupabase } from "@/test/fake-supabase";

type Row = Record<string, unknown>;
type Env = ReturnType<typeof fakeSupabase>;
const MGR = "3c3c3c3c-3c3c-43c3-83c3-3c3c3c3c3c3c";
const SALES = "5a5a5a5a-5a5a-45a5-85a5-5a5a5a5a5a5a";
const NOSVC = "6b6b6b6b-6b6b-46b6-86b6-6b6b6b6b6b6b";
const JOB = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const INV = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const GONE = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const ACC = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const manager = { role: "manager", access: [], technician: false };
const sales = { role: "user", access: ["service", "invoices", "customers"], technician: false };

const profiles = [
  { id: MGR, ...manager, full_name: "Mia Manager", email: "m@x" },
  { id: SALES, ...sales, full_name: "Sam Sales", email: "s@x" },
  // Customers and Invoices, no Service: may delete a draft, may not write the ticket.
  {
    id: NOSVC,
    role: "user",
    access: ["invoices", "customers"],
    technician: false,
    full_name: "Nia",
    email: "n@x",
  },
];
const job = (over: Row = {}): Row => ({
  id: JOB,
  number: 6090,
  customer_name: "Made Up Roofing Customer",
  description: "Yearly inspection",
  service_type: "inspection",
  stage: "authorized",
  technician_id: null,
  scheduled_date: "2026-11-10",
  completed_at: "2026-11-11T15:00:00Z",
  stage_changed_at: "2026-11-12T15:00:00Z",
  field_status: null,
  helper_count: 0,
  account_id: null,
  site_id: null,
  invoice_id: null,
  deleted_at: null,
  created_at: "2026-11-01T12:00:00Z",
  updated_at: "2026-11-12T15:00:00Z",
  ...over,
});
const invoice = (over: Row = {}): Row => ({
  id: INV,
  service_job_id: JOB,
  status: "draft",
  number: null,
  display_number: "6090",
  total: 0,
  created_at: "2026-11-13T12:00:00Z",
  ...over,
});
const world = (j: Row, invoices: Row[] = []): Env =>
  fakeSupabase({
    profiles,
    service_jobs: [j],
    invoices,
    invoice_lines: [],
    service_job_events: [],
    crm_followups: [],
    crm_accounts: [],
    crm_opportunities: [],
    crm_settings: [{ id: 1, ticket_first_days: 1, ticket_every_days: 3 }],
  });
const callAs = <T>(fn: unknown, env: { db: unknown }, userId: string, data: Row): Promise<T> =>
  (fn as (a: { data: Row; context: unknown }) => Promise<T>)({
    data,
    context: { supabase: env.db, userId },
  });
const ticketNow = (env: Env) => env.tables["service_jobs"]![0]!;

beforeEach(() => vi.clearAllMocks());

// ---- 1 ------------------------------------------------------------------------------------------

describe("fix 1: to or from Inspection is a manager's once the ticket is Authorized or billed", () => {
  it("the rule: locked for everyone but a manager, only where Inspection is concerned", () => {
    const authorized = { service_type: "inspection", stage: "authorized", invoice_id: null };
    expect(typeChangeProblem(sales, authorized, "repair")).toBe(TYPE_LOCK_MESSAGE);
    expect(typeChangeProblem(manager, authorized, "repair")).toBeNull();
    // The reverse: an authorized repair retyped as Inspection left every waiting list.
    expect(typeChangeProblem(sales, { ...authorized, service_type: "repair" }, "inspection")).toBe(
      TYPE_LOCK_MESSAGE,
    );
    // Between the other types nothing is locked, and keeping the type is no change.
    expect(
      typeChangeProblem(sales, { ...authorized, service_type: "repair" }, "warranty"),
    ).toBeNull();
    expect(typeChangeProblem(sales, authorized, "inspection")).toBeNull();
    // Before Authorized, with no invoice: the office still corrects a wrong type.
    const open = { service_type: "repair", stage: "scheduled", invoice_id: null };
    expect(typeChangeProblem(sales, open, "inspection")).toBeNull();
    // An invoice locks it at any stage (a billed ticket moved back to Open).
    expect(typeChangeProblem(sales, { ...open, invoice_id: INV }, "inspection")).toBe(
      TYPE_LOCK_MESSAGE,
    );
    expect(typeLockedFor(sales, { stage: "closed" })).toBe(true);
    expect(typeLockedFor(manager, { stage: "closed", invoice_id: INV })).toBe(false);
  });

  const save = (env: Env, who: string, service_type: string) =>
    callAs<Row>(saveServiceJob, env, who, {
      id: JOB,
      customer_name: "Made Up Roofing Customer",
      description: "Yearly inspection",
      service_type,
      scheduled_date: "2026-11-10",
    });

  it("a sales login cannot turn an authorized inspection into a repair (the first half of the swap)", async () => {
    const env = world(job());
    await expect(save(env, SALES, "repair")).rejects.toThrow(TYPE_LOCK_MESSAGE);
    expect(ticketNow(env)["service_type"]).toBe("inspection");
    expect(env.writes.filter((w) => w.table === "service_jobs")).toEqual([]);
  });
  it("nor an authorized repair into an inspection (it left the Awaiting invoice lists)", async () => {
    const env = world(job({ service_type: "repair" }));
    await expect(save(env, SALES, "inspection")).rejects.toThrow(TYPE_LOCK_MESSAGE);
    expect(ticketNow(env)["service_type"]).toBe("repair");
  });
  it("a manager still may; and anyone still moves an authorized repair to a warranty", async () => {
    const byManager = world(job());
    await save(byManager, MGR, "repair");
    expect(ticketNow(byManager)["service_type"]).toBe("repair");
    const bySales = world(job({ service_type: "repair" }));
    await save(bySales, SALES, "warranty");
    expect(ticketNow(bySales)["service_type"]).toBe("warranty");
  });
});

// ---- 4 ------------------------------------------------------------------------------------------

describe("fix 4: billed means a live invoice exists, not that the ticket points somewhere", () => {
  it("a sales login is refused on an inspection whose pointer names an invoice that is gone", async () => {
    // What the audit produced on the live database: invoice_id set, no such invoice.
    const env = world(job({ invoice_id: GONE }));
    await expect(callAs(getOrCreateInvoice, env, SALES, { job_id: JOB })).rejects.toThrow(
      INSPECTION_BILL_MANAGER,
    );
    await expect(callAs(createAnotherInvoice, env, SALES, { job_id: JOB })).rejects.toThrow(
      INSPECTION_BILL_MANAGER,
    );
    expect(env.tables["invoices"]).toEqual([]);
  });
  it("a void invoice does not count either", async () => {
    const env = world(job({ invoice_id: INV }), [invoice({ status: "void" })]);
    await expect(callAs(createAnotherInvoice, env, SALES, { job_id: JOB })).rejects.toThrow(
      INSPECTION_BILL_MANAGER,
    );
  });
  it("once a manager's invoice is live, sales gets it back like any ticket's", async () => {
    const env = world(job({ invoice_id: INV }), [invoice()]);
    const r = await callAs<{ invoice: Row }>(getOrCreateInvoice, env, SALES, { job_id: JOB });
    expect(r.invoice["id"]).toBe(INV);
  });

  const move = (env: Env, stage: string) =>
    callAs<void>(setServiceStage, env, MGR, { id: JOB, stage });
  it("a manager cannot close an inspection on a pointer to a deleted invoice", async () => {
    const env = world(job({ invoice_id: GONE }));
    await expect(move(env, "closed")).rejects.toThrow(INSPECTION_STAGE_MESSAGE);
    await expect(move(env, "invoiced")).rejects.toThrow(INSPECTION_STAGE_MESSAGE);
    expect(ticketNow(env)["stage"]).toBe("authorized");
  });
  it("with a live invoice the inspection goes on; a repair never needed one for this check", async () => {
    const billed = world(job({ invoice_id: INV }), [invoice({ status: "final" })]);
    await move(billed, "invoiced");
    expect(ticketNow(billed)["stage"]).toBe("invoiced");
    const repair = world(job({ service_type: "repair" }));
    await move(repair, "closed");
    expect(ticketNow(repair)["stage"]).toBe("closed");
  });
});

// ---- 5 ------------------------------------------------------------------------------------------

describe("fix 5: a deleted draft never leaves the ticket pointing at it in silence", () => {
  /** The client of a person with no Service access: a ticket update matches no row, no error. */
  type Db = { from: (table: string) => Record<string, unknown> };
  const cannotWriteTickets = (env: Env) => ({
    ...(env.db as unknown as Db),
    from: (table: string) => {
      const b = (env.db as unknown as Db).from(table);
      if (table !== "service_jobs") return b;
      return {
        ...b,
        update: () => ({ eq: async () => ({ data: null, error: null }) }),
      };
    },
  });
  it("with Service access the draft goes and the pointer is cleared", async () => {
    const env = world(job({ invoice_id: INV }), [invoice()]);
    await callAs<void>(voidInvoice, env, MGR, { id: INV });
    expect(env.tables["invoices"]).toEqual([]);
    expect(ticketNow(env)["invoice_id"]).toBeNull();
  });
  it("without it (the update changes no row) the person is told, not left with a wrong ticket", async () => {
    const env = world(job({ invoice_id: INV }), [invoice()]);
    await expect(
      callAs<void>(voidInvoice, { db: cannotWriteTickets(env) }, NOSVC, { id: INV }),
    ).rejects.toThrow(/the ticket was not updated: it still points at this invoice/);
  });
  it("the invoice makers no longer drop a failed pointer write", () => {
    const src = readFileSync("src/lib/invoices.functions.ts", "utf8");
    expect(src).not.toMatch(
      /await sb\.from\("service_jobs"\)\.update\(\{ invoice_id: inv\.id \}\)\.eq\("id", job\.id\);/,
    );
    expect(src).toContain("The invoice was made, but the ticket was not updated");
  });
});

// ---- 6 ------------------------------------------------------------------------------------------

describe("fix 6: an inspection that ends at Authorized is finished, not open work", () => {
  const finished = { stage: "authorized", service_type: "inspection", invoice_id: null };
  const billed = { ...finished, invoice_id: INV };
  const repair = { ...finished, service_type: "repair" };
  it("the rule", () => {
    expect(isFinishedInspection(finished)).toBe(true);
    expect(isFinishedInspection(billed)).toBe(false);
    expect(isFinishedInspection(repair)).toBe(false);
    expect(isFinishedInspection({ ...finished, stage: "done" })).toBe(false);
    expect(isOpenTicket(finished)).toBe(false);
    expect(isOpenTicket(billed)).toBe(true);
    expect(isOpenTicket(repair)).toBe(true);
    expect(isOpenTicket({ stage: "closed", service_type: "repair" })).toBe(false);
    expect(NOT_FINISHED_INSPECTION_OR).toBe(
      "stage.neq.authorized,service_type.neq.inspection,invoice_id.not.is.null",
    );
  });
  it("the Service list's Open work filter leaves it out", () => {
    const t = (number: number, over: Partial<ListTicket>): ListTicket =>
      ({
        number,
        stage: "authorized",
        service_type: "repair",
        scheduled_date: null,
        technician_id: null,
        technician_name: null,
        customer_name: "Made Up",
        site_name: null,
        site_address: null,
        description: null,
        po_number: null,
        job_number: null,
        centerpoint_ticket: null,
        centerpoint_invoice: null,
        ...over,
      }) as ListTicket;
    const rows = [
      t(1, {}),
      t(2, { service_type: "inspection" }),
      t(3, { service_type: "inspection", invoice_id: INV }),
    ];
    const shown = filterTickets(rows, {
      search: "",
      stage: SERVICE_OPEN_WORK,
      type: "all",
      tech: "all",
      mineId: null,
      overdueOnly: false,
      today: "2026-11-16",
    } as never);
    expect(shown.map((r) => r.number)).toEqual([1, 3]);
  });
  it("the Tech Board's Finished, no technician group leaves it out", () => {
    const base = { technician_id: null, stage_changed_at: "2026-11-12T15:00:00Z", updated_at: "x" };
    const rows = [
      { n: 1, ...base, ...repair },
      { n: 2, ...base, ...finished },
      { n: 3, ...base, ...billed },
    ];
    expect(finishedUnassigned(rows).map((r) => r.n)).toEqual([1, 3]);
  });
  it("the Tickets in progress tile does not count it", async () => {
    const env = fakeSupabase({
      profiles,
      service_jobs: [
        job({ id: "j1", service_type: "repair" }),
        job({ id: "j2" }),
        job({ id: "j3", invoice_id: INV }),
        job({ id: "j4", stage: "done" }),
      ],
      crm_opportunities: [],
      crm_followups: [],
    });
    const r = await callAs<{ openTickets: number }>(getWorkCounts, env, MGR, {
      today: "2026-11-16",
    });
    expect(r.openTickets).toBe(3);
  });
  it("it no longer stops its customer being deleted; a repair at Authorized still does", async () => {
    expect(keepsCustomer("authorized")).toBe(true);
    expect(keepsCustomer("authorized", { service_type: "inspection", invoice_id: null })).toBe(
      false,
    );
    expect(keepsCustomer("authorized", { service_type: "inspection", invoice_id: INV })).toBe(true);
    const book = (j: Row) =>
      fakeSupabase({
        profiles,
        crm_accounts: [{ id: ACC, name: "Made Up Customer", deleted_at: null }],
        crm_sites: [],
        crm_contacts: [],
        crm_opportunities: [],
        service_jobs: [j],
      });
    const held = book(job({ account_id: ACC, service_type: "repair" }));
    await expect(callAs(deleteAccount, held, MGR, { id: ACC })).rejects.toThrow(/1 open ticket/);
    const free = book(job({ account_id: ACC }));
    await callAs(deleteAccount, free, MGR, { id: ACC });
    expect(free.tables["crm_accounts"]![0]!["deleted_at"]).toBeTruthy();
  });
  it("the four reads say it in the database too", () => {
    const flat = (p: string) => readFileSync(p, "utf8").replace(/\s+/g, " ");
    expect(flat("src/lib/work-counts.functions.ts")).toContain(
      '.in("stage", [...OPEN_TICKET_STAGES]) // Not an inspection that ends at Authorized: it is finished (audit, Nov 16, fix 6). .or(NOT_FINISHED_INSPECTION_OR),',
    );
    const crm = flat("src/lib/crm.functions.ts");
    expect(crm).toContain('.or(NOT_FINISHED_INSPECTION_OR, { referencedTable: "jobs" })');
    expect((crm.match(/\.or\(NOT_FINISHED_INSPECTION_OR/g) ?? []).length).toBe(2);
    expect(flat("src/lib/service.functions.ts")).toMatch(
      /\.in\("stage", \[\.\.\.FINISHED_UNASSIGNED_STAGES\]\)[^;]*\.or\(NOT_FINISHED_INSPECTION_OR\)/,
    );
  });
});

// ---- 7, 9 ---------------------------------------------------------------------------------------

describe("fixes 7 and 9: the Owner tile agrees with the lists, and the lists filter in the database", () => {
  it("an inspection with a draft is on the tile, as it is in the queue; a finished one is not", () => {
    const t = (over: Row) => ({
      stage: "authorized",
      stage_changed_at: "2026-11-14T12:00:00Z",
      scheduled_date: null,
      invoice_id: null,
      ...over,
    });
    const n = businessNumbers({
      today: "2026-11-16",
      now: "2026-11-16T12:00:00Z",
      tickets: [
        t({ service_type: "inspection", invoice_id: INV }),
        t({ service_type: "inspection" }),
        t({ service_type: "repair", invoice_id: INV }),
        t({ service_type: "repair" }),
      ] as never,
      opps: [],
      snoozed: 0,
    });
    expect(n.toInvoice.count).toBe(3);
  });
  it("Work Overview and the Owner page filter before the row limit", () => {
    const flat = (p: string) => readFileSync(p, "utf8").replace(/\s+/g, " ");
    expect(AWAITS_INVOICE_OR).toBe("service_type.neq.inspection,invoice_id.not.is.null");
    expect(flat("src/lib/my-work.functions.ts")).toMatch(
      /\.eq\("stage", TO_INVOICE_STAGE\)[^;]*\.or\(AWAITS_INVOICE_OR\)[^;]*\.limit\(LIMIT\)/,
    );
    // Later on Nov 16 the Owner page's read shrank to the Authorized tickets alone.
    expect(flat("src/lib/owner-business.functions.ts")).toMatch(
      /\.eq\("stage", "authorized"\)[^;]*\.or\(AWAITS_INVOICE_OR\) \.limit\(LIMIT\)/,
    );
  });
});

// ---- 8 ------------------------------------------------------------------------------------------

describe("fix 8: the office hears about a billed inspection that is authorized", () => {
  const tables = () => ({
    profiles: [
      { id: MGR, role: "manager", access: [], full_name: "Mia Manager", email: "m@x" },
      { id: SALES, ...sales, full_name: "Sam Sales", email: "s@x" },
    ],
    crm_followups: [],
    crm_settings: [{ id: 1, ticket_first_days: 1, ticket_every_days: 3 }],
  });
  const actor = { id: "someone-else", name: "Someone" };
  const kinds = () => notify.mock.calls.map((c) => c[1].kind);
  it("an inspection that ends at Authorized: nobody is told (nothing to invoice)", async () => {
    const env = fakeSupabase(tables(), { rpcs: { ticket_authorizers: () => [MGR] } });
    await afterTicketStage(job() as never, "done", actor, env.db as never);
    expect(kinds()).not.toContain("ticket_authorized");
  });
  it("one with an invoice: the office is told, as for a repair", async () => {
    const env = fakeSupabase(tables(), { rpcs: { ticket_authorizers: () => [MGR] } });
    await afterTicketStage(job({ invoice_id: INV }) as never, "done", actor, env.db as never);
    expect(kinds()).toContain("ticket_authorized");
  });
});

// ---- 28 -----------------------------------------------------------------------------------------

describe("fix 28: a link that is not a page of this site", () => {
  it("a follow-up row on Work Overview never leads off the site", () => {
    const f = (url: string) =>
      followupItem(
        {
          id: "f1",
          kind: "ticket",
          item_id: JOB,
          title: "Ticket #6090",
          url,
          status: "open",
          assignee_id: MGR,
          due_at: "2026-11-16T13:00:00Z",
          next_remind_at: null,
          snoozed_until: null,
          reminders_sent: 0,
          every_days: 3,
        } as never,
        {},
        (iso: string) => iso.slice(0, 10),
      ).href;
    // "/\host" is another site to a browser; the old check (starts with "/", not "//") let it by.
    expect(f("/\\evil.example/x")).toBe("/my-work");
    expect(f("//evil.example/x")).toBe("/my-work");
    expect(f("x")).toBe("/my-work");
    expect(f(`/service?id=${JOB}`)).toBe(`/service?id=${JOB}`);
  });
  it("the sender drops a bad link and still sends the notice", () => {
    const src = readFileSync("src/lib/notify.server.ts", "utf8");
    expect(src).toContain("const msg: Outgoing = { ...sent, url: notificationPath(sent.url) };");
    // Every use after that line reads the cleaned message.
    const body = src.slice(src.indexOf("export async function notify("));
    expect(body.slice(0, body.indexOf("\n}\n"))).not.toMatch(
      /\bsent\.(url|title|body|kind)\b(?!\))/,
    );
  });
  it("a preview name is believed only under Lovable's own domains", () => {
    const id = "c13d501c-079a-45a8-b496-b026f4e6f451";
    expect(isLovablePreviewHost(`project--${id}.anything.example`)).toBe(false);
    expect(isLovablePreviewHost(`id-preview--${id}.evil.example`)).toBe(false);
    expect(frameHeadersFor(`project--${id}.anything.example`)).toBe(FRAME_HEADERS);
    // The real ones still get no rule, or the editor's preview pane goes blank.
    expect(isLovablePreviewHost(`id-preview--${id}.lovable.app`)).toBe(true);
    expect(isLovablePreviewHost(`project--${id}-dev.lovable.app`)).toBe(true);
    expect(isLovablePreviewHost(`${id}.lovableproject.com`)).toBe(true);
  });
});

// ---- the database file --------------------------------------------------------------------------

describe("the database rules that were applied", () => {
  const sql = readFileSync(
    "supabase/migrations/20261116150000_inspection_billing_rules.sql",
    "utf8",
  );
  it("the five rules and the link check are in the file, with the app's own messages", () => {
    for (const name of [
      "invoices_inspection_rule",
      "invoices_ticket_pointer",
      "service_jobs_invoice_pointer_rule",
      "service_jobs_type_rule",
    ]) {
      expect(sql).toContain(`create or replace function public.${name}()`);
      expect(sql).toContain(`create trigger ${name}`);
      expect(sql).toContain(
        `revoke all on function public.${name}() from public, anon, authenticated`,
      );
    }
    expect(sql).toContain(`raise exception '${INSPECTION_BILL_MANAGER}'`);
    expect(sql).toContain(`raise exception '${TYPE_LOCK_MESSAGE}'`);
    expect(sql).toContain(`raise exception '${INSPECTION_STAGE_MESSAGE}'`);
    expect(sql).toContain("crm_followups_url_internal");
  });
  it("the follow-up link check is the notifications' own pattern, or empty", async () => {
    const { NOTIFICATION_LINK_SQL } = await import("@/lib/notification-link");
    expect(sql).toContain(`check (url = '' or url ~ '${NOTIFICATION_LINK_SQL}')`);
  });
});
