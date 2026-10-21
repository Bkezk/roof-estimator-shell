/**
 * The Owner view's Business tab (owner, Oct 8: "go ahead and build the business tab"): the
 * arithmetic (owner-business.ts), the server function against a fake database, the ?status=
 * search for the Unpaid tile's click-through, and the screens.
 */
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));

import { BUSINESS_HREFS, businessNumbers, daysOld, money, monthRange } from "@/lib/owner-business";
import { listOwnerBusiness } from "@/lib/owner-business.functions";
import { invoiceSearch } from "@/lib/invoice-search";
import { fakeSupabase } from "@/test/fake-supabase";

const read = (p: string) => readFileSync(p, "utf8").replace(/\s+/g, " ");

describe("months and ages", () => {
  it("monthRange on a mid-month day and a February", () => {
    expect(monthRange("2026-10-08")).toEqual({ start: "2026-10-01", end: "2026-10-31" });
    expect(monthRange("2026-02-10")).toEqual({ start: "2026-02-01", end: "2026-02-28" });
  });
  it("daysOld: whole days to now, never below 0, null for nothing", () => {
    const now = "2026-10-08T15:00:00Z";
    expect(daysOld("2026-10-01T09:00:00Z", now)).toBe(7);
    expect(daysOld("2026-10-08", now)).toBe(0);
    expect(daysOld("2026-10-09T00:00:00Z", now)).toBe(0);
    expect(daysOld(null, now)).toBeNull();
    expect(daysOld("garbage", now)).toBeNull();
  });
  it("money: an empty queue reads — (never $0); otherwise whole dollars", () => {
    expect(money(0, 0)).toBe("—");
    expect(money(1234.56, 2)).toBe("$1,235");
  });
});

describe("businessNumbers", () => {
  const now = "2026-10-08T15:00:00Z";
  const input = {
    today: "2026-10-08",
    now,
    tickets: [
      {
        stage: "done",
        stage_changed_at: "2026-10-01T10:00:00Z",
        scheduled_date: "2026-09-29",
        invoice_id: null,
      },
      {
        stage: "done",
        stage_changed_at: "2026-10-07T10:00:00Z",
        scheduled_date: null,
        invoice_id: null,
      },
      {
        stage: "done",
        stage_changed_at: "2026-09-20T10:00:00Z",
        scheduled_date: null,
        invoice_id: "inv",
      },
      {
        stage: "authorized",
        stage_changed_at: "2026-10-02T10:00:00Z",
        scheduled_date: null,
        invoice_id: null,
      },
      {
        stage: "scheduled",
        stage_changed_at: null,
        scheduled_date: "2026-10-01",
        invoice_id: null,
      },
      {
        stage: "scheduled",
        stage_changed_at: null,
        scheduled_date: "2026-10-08",
        invoice_id: null,
      },
      { stage: "open", stage_changed_at: null, scheduled_date: "2026-09-15", invoice_id: null },
      { stage: "closed", stage_changed_at: null, scheduled_date: "2026-09-01", invoice_id: "x" },
    ],
    invoices: [
      { status: "final", total: "1200.50", invoice_date: "2026-10-02" },
      { status: "sent", total: 800, invoice_date: "2026-09-10" },
      { status: "paid", total: 500, invoice_date: "2026-10-05" },
      { status: "paid", total: 2000, invoice_date: "2026-09-25" },
      { status: "draft", total: 999, invoice_date: "2026-10-06" },
      { status: "void", total: 999, invoice_date: "2026-10-06" },
    ],
    pos: [
      { approved: false, price: 150 },
      { approved: false, price: "49.99" },
      { approved: true, price: 1000 },
    ],
    opps: [
      {
        status: "open",
        est_value: 10000,
        expected_close: "2026-10-20",
        updated_at: "2026-10-01T00:00:00Z",
      },
      {
        status: "quoted",
        est_value: "2500",
        expected_close: "2026-11-02",
        updated_at: "2026-10-01T00:00:00Z",
      },
      {
        status: "contacted",
        est_value: null,
        expected_close: null,
        updated_at: "2026-10-01T00:00:00Z",
      },
      {
        status: "won",
        est_value: 7000,
        expected_close: "2026-10-01",
        updated_at: "2026-10-03T00:00:00Z",
      },
      {
        status: "won",
        est_value: 7000,
        expected_close: "2026-09-01",
        updated_at: "2026-09-03T00:00:00Z",
      },
      { status: "lost", est_value: 100, expected_close: null, updated_at: "2026-10-04T00:00:00Z" },
    ],
    snoozed: 3,
    untouched: { tickets: 2, opps: 1 },
  };
  const n = businessNumbers(input);
  it("Authorized, not invoiced: Authorized tickets with no invoice (the Awaiting invoice queue), oldest first; Done tickets on the second line", () => {
    expect(n.toInvoice).toEqual({ count: 1, oldestDays: 6 });
    expect(n.toAuthorize).toEqual({ count: 2, oldestDays: 7 });
  });
  it("Unpaid: final + sent, their total and the oldest invoice date", () => {
    expect(n.unpaid).toEqual({ count: 2, total: 2000.5, oldestDays: 28 });
  });
  it("Invoiced this month is no longer a tile (owner, Oct 21: the margin report has the month)", () => {
    expect(n).not.toHaveProperty("invoiced");
  });
  it("Purchase orders waiting: the unapproved ones", () => {
    expect(n.pos).toEqual({ count: 2, total: 199.99 });
  });
  it("Pipeline: open statuses and their value; closing this month", () => {
    expect(n.pipeline.open).toEqual({ count: 3, value: 12500 });
    expect(n.pipeline.closingThisMonth).toEqual({ count: 1, value: 10000 });
  });
  it("Won / Lost this month counts BIDS (owner, Oct 21): won by the Won-on day (the status stamp's office day when none), lost by the day the status changed", () => {
    const bids = [
      // Won on a day this month (counted), whatever the stamp says.
      {
        status: "won",
        won_on: "2026-10-03",
        status_changed_at: "2026-09-30T23:30:00Z",
        updated_at: "2026-09-30T23:30:00Z",
      },
      // No Won-on day yet: the stamp's office day (Oct 1 Eastern) counts.
      {
        status: "won",
        won_on: null,
        status_changed_at: "2026-10-01T12:00:00Z",
        updated_at: "2026-10-05T00:00:00Z",
      },
      // Legacy "accepted" reads as won.
      {
        status: "accepted",
        won_on: "2026-10-20",
        status_changed_at: null,
        updated_at: "2026-10-20T00:00:00Z",
      },
      // Won last month: not this month.
      {
        status: "won",
        won_on: "2026-09-03",
        status_changed_at: null,
        updated_at: "2026-10-03T00:00:00Z",
      },
      // Lost this month / last month.
      {
        status: "lost",
        won_on: null,
        status_changed_at: "2026-10-04T00:00:00Z",
        updated_at: "2026-10-04T00:00:00Z",
      },
      {
        status: "lost",
        won_on: null,
        status_changed_at: "2026-09-04T00:00:00Z",
        updated_at: "2026-10-04T00:00:00Z",
      },
      // Still in play: neither.
      {
        status: "submitted",
        won_on: null,
        status_changed_at: "2026-10-04T00:00:00Z",
        updated_at: "2026-10-04T00:00:00Z",
      },
    ];
    const r = businessNumbers({ ...input, bids });
    expect(r.pipeline.wonThisMonth).toBe(3);
    expect(r.pipeline.lostThisMonth).toBe(1);
    // The opportunities' won / lost no longer feed the tile (two won opps this month in `input`).
    expect(businessNumbers({ ...input, bids: [] }).pipeline.wonThisMonth).toBe(0);
  });
  it("Going stale: open / scheduled past their day; untouched from the rpc; snoozed as given", () => {
    expect(n.stale).toEqual({ pastDue: 2, untouchedTickets: 2, untouchedOpps: 1, snoozed: 3 });
    expect(businessNumbers({ ...input, untouched: null }).stale.untouchedTickets).toBeNull();
  });
  it("nothing at all: counts 0, totals 0, no oldest", () => {
    const empty = businessNumbers({
      ...input,
      tickets: [],
      invoices: [],
      pos: [],
      opps: [],
      snoozed: 0,
    });
    expect(empty.toInvoice).toEqual({ count: 0, oldestDays: null });
    expect(empty.unpaid).toEqual({ count: 0, total: 0, oldestDays: null });
    expect(empty.pipeline.open).toEqual({ count: 0, value: 0 });
  });
});

describe("listOwnerBusiness (server)", () => {
  // The viewer's day is honoured only within a day of the real Eastern date (work-counts.ts
  // viewerToday), so the clock is pinned to the fixtures' day; the pin broke on Oct 12.
  beforeAll(() => vi.useFakeTimers({ now: new Date("2026-10-08T15:00:00Z"), toFake: ["Date"] }));
  afterAll(() => vi.useRealTimers());
  const ME = "00000000-0000-4000-8000-000000000001";
  const world = (role: string) =>
    fakeSupabase(
      {
        profiles: [{ id: ME, role, access: [], full_name: "B", email: "b@x" }],
        service_jobs: [
          {
            id: "j1",
            stage: "done",
            stage_changed_at: "2026-10-01T10:00:00Z",
            scheduled_date: null,
            invoice_id: null,
            deleted_at: null,
          },
          {
            id: "j2",
            stage: "done",
            stage_changed_at: "2026-10-01T10:00:00Z",
            scheduled_date: null,
            invoice_id: null,
            deleted_at: "2026-10-02T00:00:00Z",
          },
          {
            id: "j3",
            stage: "invoiced",
            stage_changed_at: null,
            scheduled_date: null,
            invoice_id: "i",
            deleted_at: null,
          },
        ],
        invoices: [
          { id: "i1", status: "final", total: 100, invoice_date: "2026-10-01" },
          { id: "i2", status: "paid", total: 50, invoice_date: "2026-10-01" },
        ],
        service_job_purchase_orders: [
          { id: "p1", service_job_id: "j1", approved: false, price: 10 },
          { id: "p2", service_job_id: "j1", approved: true, price: 20 },
          // On a deleted ticket: never counted (owner, Oct 21; po-waiting.test.ts).
          { id: "p3", service_job_id: "j2", approved: false, price: 36 },
        ],
        bids: [
          {
            id: "b1",
            status: "won",
            won_on: "2026-10-03",
            status_changed_at: null,
            updated_at: "2026-10-03T00:00:00Z",
            deleted_at: null,
          },
          // Deleted: never counted.
          {
            id: "b2",
            status: "won",
            won_on: "2026-10-03",
            status_changed_at: null,
            updated_at: "2026-10-03T00:00:00Z",
            deleted_at: "2026-10-04T00:00:00Z",
          },
          {
            id: "b3",
            status: "lost",
            won_on: null,
            status_changed_at: "2026-10-05T00:00:00Z",
            updated_at: "2026-10-05T00:00:00Z",
            deleted_at: null,
          },
        ],
        crm_opportunities: [
          {
            id: "o1",
            status: "open",
            est_value: 300,
            expected_close: null,
            updated_at: null,
            deleted_at: null,
          },
          {
            id: "o2",
            status: "open",
            est_value: 300,
            expected_close: null,
            updated_at: null,
            deleted_at: "2026-01-01T00:00:00Z",
          },
        ],
        crm_followups: [
          { id: "f1", status: "open", snoozed_until: "2099-01-01T00:00:00Z" },
          { id: "f2", status: "open", snoozed_until: "2000-01-01T00:00:00Z" },
          { id: "f3", status: "open", snoozed_until: null },
        ],
      },
      {
        rpcs: {
          crm_untouched: () => [
            { kind: "ticket", item_id: "j1" },
            { kind: "opportunity", item_id: "o1" },
            { kind: "opportunity", item_id: "o3" },
          ],
        },
      },
    );
  const call = (env: ReturnType<typeof fakeSupabase>) =>
    (
      listOwnerBusiness as unknown as (a: {
        data: unknown;
        context: unknown;
      }) => Promise<Awaited<ReturnType<typeof businessNumbers>>>
    )({
      data: { today: "2026-10-08" },
      context: { supabase: env.db, userId: ME },
    });
  it("an admin gets the numbers: deleted rows and approved orders left out, the rpc's untouched counts, snoozed = still snoozed", async () => {
    const r = await call(world("admin"));
    expect(r.today).toBe("2026-10-08");
    // j1 is Done (the second line); nothing Authorized in this world.
    expect(r.toInvoice.count).toBe(0);
    expect(r.toAuthorize.count).toBe(1);
    expect(r.unpaid).toMatchObject({ count: 1, total: 100 });
    expect(r.pos).toEqual({ count: 1, total: 10 });
    expect(r.pipeline.open).toEqual({ count: 1, value: 300 });
    expect(r.pipeline.wonThisMonth).toBe(1);
    expect(r.pipeline.lostThisMonth).toBe(1);
    expect(r.stale).toMatchObject({ untouchedTickets: 1, untouchedOpps: 2, snoozed: 1 });
  });
  it("anyone else is refused, like the People tab", async () => {
    await expect(call(world("manager"))).rejects.toThrow("Forbidden: admin only");
    await expect(call(world("user"))).rejects.toThrow("Forbidden: admin only");
  });
});

describe("the click-throughs", () => {
  it("?status= on the Invoices list: a status chip, or unpaid (final + sent); junk dropped", () => {
    expect(invoiceSearch({ status: "unpaid" })).toEqual({ status: "unpaid" });
    expect(invoiceSearch({ status: "paid" })).toEqual({ status: "paid" });
    expect(invoiceSearch({ status: "nope" })).toEqual({});
    expect(invoiceSearch({ tab: "to-invoice", status: "sent" })).toEqual({
      tab: "to-invoice",
      status: "sent",
    });
  });
  it("the list honours it: the chip, the page prop and the server's final + sent", () => {
    expect(read("src/components/service/invoices-page.tsx")).toContain(
      "useState<StatusFilter>(initialStatus)",
    );
    expect(read("src/components/service/invoices-page.tsx")).toContain("> Unpaid </Chip>");
    expect(read("src/lib/invoices.functions.ts")).toContain(
      'if (data.status === "unpaid") q = q.in("status", ["final", "sent"]);',
    );
    expect(read("src/routes/service.invoices.tsx")).toContain("status={status}");
  });
  it("every tile goes to the list filtered to what it counts", () => {
    expect(BUSINESS_HREFS).toEqual({
      // The Authorized tickets it counts: the Awaiting invoice queue (owner, Oct 12, item 6).
      toInvoice: "/service/invoices?tab=to-invoice",
      unpaid: "/service/invoices?status=unpaid",
      pipeline: "/opportunities?status=allopen",
      // Won / Lost this month: the bids (owner, Oct 21).
      bids: "/bids",
      // The tickets carrying an order still waiting (owner, Oct 21; po-waiting.test.ts).
      pos: "/service?po=waiting",
      pastDue: "/service?overdue=1",
      // The untouched items sit in each page's Needs action strip; neither page takes a filter.
      untouchedTickets: "/service",
      untouchedOpps: "/opportunities",
      snoozed: "/my-work",
    });
  });
  it("the Owner page has People / Business tabs (Oct 21: moved up from the Owner view) and Business is admin-only like the rest", () => {
    const page = read("src/components/owner-page.tsx");
    expect(page).toContain('onClick={() => props.onTab("business")}');
    expect(page).toContain("<OwnerBusiness />");
    const biz = read("src/components/owner-business.tsx");
    expect(biz).toContain("enabled: !!session && visibleToOwner(profile),");
    expect(biz).toContain('title="Authorized, not invoiced"');
    expect(biz).toContain('title="Unpaid"');
    expect(biz).toContain('title="Pipeline"');
    expect(biz).toContain('title="Won / Lost this month"');
    expect(biz).toContain("href={BUSINESS_HREFS.bids}");
    expect(biz).not.toContain("By the opportunity's last update");
    expect(biz).toContain("Going stale");
  });
});
