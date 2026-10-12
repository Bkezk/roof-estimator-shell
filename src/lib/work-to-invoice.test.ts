/**
 * Work Overview's "Authorized — to invoice" column (owner, Oct 12, item 3): the Authorized
 * tickets, for whoever sees invoices (`seesInvoices`), right after Needs authorization, each row
 * saying how long it has waited (the Invoices queue's number). Nobody else has the column — not
 * even among the layout's hidden chips. No reminder timer (accounting is in Sage).
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));

import {
  BUCKET_EMPTY,
  BUCKET_LABELS,
  LIST_BUCKETS,
  TO_INVOICE_STAGE,
  bucketOf,
  listGroups,
  mergeWork,
  ticketItem,
  toInvoiceItems,
  waitingDays,
  type TicketIn,
} from "@/lib/my-work";
import { listMyWork, type MyWorkResult } from "@/lib/my-work.functions";
import { normalizeWorkLayout } from "@/lib/work-layout";
import { fakeSupabase } from "@/test/fake-supabase";

type Row = Record<string, unknown>;
const read = (p: string) => readFileSync(p, "utf8");
const utcDay = (iso: string) => iso.slice(0, 10);
const TODAY = "2026-10-12";

const ticket = (over: Partial<TicketIn> = {}): TicketIn => ({
  id: "t1",
  number: 6010,
  customer_name: "Acme",
  site_name: null,
  site_address: null,
  description: "Leak",
  service_type: "leak",
  stage: "authorized",
  scheduled_date: "2026-10-01",
  technician_id: "tech-1",
  stage_changed_at: "2026-10-05T14:00:00Z",
  ...over,
});

describe("the bucket", () => {
  it("sits right after Needs authorization, labelled and with its empty line", () => {
    expect(TO_INVOICE_STAGE).toBe("authorized");
    expect(LIST_BUCKETS.indexOf("invoice")).toBe(LIST_BUCKETS.indexOf("authorize") + 1);
    expect(BUCKET_LABELS.invoice).toBe("Authorized — to invoice");
    expect(BUCKET_EMPTY.invoice).toBe("Nothing waiting to be invoiced.");
  });
  it("an Authorized ticket is a to-invoice row, never overdue, never Done, whatever its date", () => {
    const item = ticketItem(ticket(), {}, null, utcDay);
    expect(item).toMatchObject({
      toInvoice: true,
      waitingSince: "2026-10-05T14:00:00Z",
      done: false,
      status: "Authorized",
      href: "/service?id=t1",
    });
    expect(bucketOf(item, TODAY, utcDay)).toBe("invoice");
    expect(bucketOf({ ...item, date: null }, TODAY, utcDay)).toBe("invoice");
    // A Done or Scheduled ticket is untouched by the new flag.
    expect(ticketItem(ticket({ stage: "done" })).toInvoice).toBeUndefined();
    expect(bucketOf(ticketItem(ticket({ stage: "scheduled" })), TODAY, utcDay)).toBe("overdue");
  });
  it("Waiting N days is the Invoices queue's number: whole days since it reached Authorized", () => {
    expect(waitingDays("2026-10-05T14:00:00Z", TODAY, utcDay)).toBe(7);
    expect(waitingDays(`${TODAY}T01:00:00Z`, TODAY, utcDay)).toBe(0);
    expect(waitingDays(null, TODAY, utcDay)).toBeNull();
    expect(waitingDays(undefined, TODAY, utcDay)).toBeNull();
  });
  it("mergeWork lists the server's to-invoice rows once, and ignores any other stage in them", () => {
    const rows = mergeWork(
      {
        tickets: [ticket({ id: "mine", stage: "scheduled", scheduled_date: TODAY })],
        tasks: [],
        followups: [],
        toInvoice: [ticket(), ticket({ id: "t2", stage: "done" }), ticket({ id: "mine" })],
      },
      utcDay,
    );
    expect(rows.map((r) => r.key).sort()).toEqual(["ticket:mine", "ticket:t1"]);
    expect(rows.find((r) => r.key === "ticket:t1")!.toInvoice).toBe(true);
    expect(toInvoiceItems([ticket({ stage: "done" })])).toEqual([]);
    expect(toInvoiceItems(null)).toEqual([]);
  });
  it("shows for whoever invoices, empty or not; never for anyone else unless something is in it", () => {
    const forInvoicer = listGroups([], TODAY, { invoice: true }).map((g) => g.bucket);
    expect(forInvoicer).toEqual(["overdue", "week", "later", "waiting", "invoice"]);
    expect(listGroups([], TODAY).map((g) => g.bucket)).not.toContain("invoice");
    // The authorizer's column and this one, in that order, for someone who is both.
    expect(listGroups([], TODAY, { authorize: true, invoice: true }).map((g) => g.bucket)).toEqual([
      "overdue",
      "week",
      "later",
      "waiting",
      "authorize",
      "invoice",
    ]);
    const withOne = listGroups([ticketItem(ticket(), {}, null, utcDay)], TODAY, {});
    expect(withOne.find((g) => g.bucket === "invoice")!.items).toHaveLength(1);
  });
  it("a layout saved before it existed gets it after Needs authorization, wherever that sits", () => {
    expect(
      normalizeWorkLayout({
        order: ["unassigned", "overdue", "week", "later", "waiting", "authorize", "nodate", "done"],
        hidden: [],
      }).order,
    ).toEqual(LIST_BUCKETS);
    // Needs authorization moved to the front: the new column follows it there. (A saved "nodate"
    // or "done" — the groups removed Oct 12 — is dropped like any unknown name.)
    expect(
      normalizeWorkLayout({ order: ["done", "authorize", "week"], hidden: [] }).order.join(","),
    ).toBe("authorize,invoice,unassigned,overdue,week,later,waiting");
  });
});

describe("the server (listMyWork)", () => {
  const MANAGER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const TECH = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const BILLER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const profiles: Row[] = [
    { id: MANAGER, role: "manager", access: [], technician: false, full_name: "Mo", email: "m@x" },
    {
      id: TECH,
      role: "user",
      access: ["service"],
      technician: true,
      full_name: "Ted",
      email: "t@x",
    },
    // A plain user with the Invoices tick (seesInvoices; owner, Oct 8).
    {
      id: BILLER,
      role: "user",
      access: ["service", "invoices"],
      technician: false,
      full_name: "Bea",
      email: "b@x",
    },
  ];
  const jobs = (): Row[] => [
    {
      id: "j-auth",
      number: 6010,
      customer_name: "Acme",
      site_name: null,
      site_address: null,
      description: "Leak",
      service_type: "leak",
      stage: "authorized",
      scheduled_date: "2026-10-01",
      technician_id: TECH,
      stage_changed_at: "2026-10-05T14:00:00Z",
      deleted_at: null,
    },
    {
      id: "j-auth-nobody",
      number: 6011,
      customer_name: "Bell",
      site_name: null,
      site_address: null,
      description: "",
      service_type: "leak",
      stage: "authorized",
      scheduled_date: "2026-10-02",
      technician_id: null,
      stage_changed_at: "2026-10-06T14:00:00Z",
      deleted_at: null,
    },
    {
      id: "j-sched",
      number: 6012,
      customer_name: "Corbin",
      site_name: null,
      site_address: null,
      description: "",
      service_type: "leak",
      stage: "scheduled",
      scheduled_date: "2026-10-14",
      technician_id: TECH,
      stage_changed_at: null,
      deleted_at: null,
    },
  ];
  let tables: Record<string, Row[]>;
  beforeEach(() => {
    tables = {
      profiles,
      service_jobs: jobs(),
      tasks: [],
      crm_followups: [],
      crm_opportunities: [],
      crm_settings: [{ id: 1, unassigned_overdue_days: 1 }],
    };
  });
  const run = (userId: string) =>
    (listMyWork as unknown as (a: { data: Row; context: unknown }) => Promise<MyWorkResult>)({
      data: {},
      context: { supabase: fakeSupabase(tables).db, userId },
    });

  it("a manager gets the Authorized tickets (with or without a technician), longest first, apart from the lists", async () => {
    const r = await run(MANAGER);
    expect(r.invoicer).toBe(true);
    expect(r.toInvoice.map((t) => t.id)).toEqual(["j-auth", "j-auth-nobody"]);
    expect(r.toInvoice[0]!.stage_changed_at).toBe("2026-10-05T14:00:00Z");
    // The ordinary ticket list still carries open / scheduled / done only.
    expect(r.tickets.map((t) => t.stage)).not.toContain("authorized");
  });
  it("a plain user with the Invoices tick gets them too; a technician never does", async () => {
    expect((await run(BILLER)).invoicer).toBe(true);
    expect((await run(BILLER)).toInvoice).toHaveLength(2);
    const tech = await run(TECH);
    expect(tech.invoicer).toBe(false);
    expect(tech.toInvoice).toEqual([]);
  });
  it("the query is the Authorized stage, by seesInvoices, and the page passes the flag on", () => {
    const fn = read("src/lib/my-work.functions.ts");
    expect(fn).toContain("const invoicer = seesInvoices(me);");
    expect(fn).toContain('.eq("stage", TO_INVOICE_STAGE)');
    expect(fn).toContain('.order("stage_changed_at", { ascending: true, nullsFirst: false })');
    const page = read("src/components/my-work-page.tsx");
    expect(page).toContain("invoice={!!q.data?.invoicer}");
    expect(page).toContain("listGroups(items, today, { authorize, invoice, unassigned })");
    expect(page).toContain(
      "{item.toInvoice && <WaitingToInvoice since={item.waitingSince ?? null} today={today} />}",
    );
    // Nine columns at most now.
    expect(page).toContain('9: "xl:grid-cols-9"');
    expect(page).toContain("GRID_COLS[Math.min(9, Math.max(1, count))]");
    // No new reminder timer (owner: accounting is in Sage): no follow-up kind for it.
    expect(read("src/lib/followups.server.ts")).not.toContain('"to_invoice"');
  });
});
