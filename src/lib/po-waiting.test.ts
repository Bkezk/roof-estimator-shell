/**
 * "Purchase orders waiting for approval" goes somewhere useful (owner, Oct 21: "when you click on
 * purchase orders awaiting approval it just takes you to the service list so its unclear which
 * ones need approval"): the tile links to the Tickets list filtered to the tickets that carry a
 * purchase order still waiting (?po=waiting), the list has a "PO waiting" chip for the same
 * filter, and neither the tile nor the list counts a purchase order on a deleted ticket (the
 * live database's one waiting order sat on a deleted ticket, so the tile showed $36 for nothing
 * anyone could find).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    let validate: (d: unknown) => unknown = (d) => d;
    const b = {
      middleware: () => b,
      validator: (v: (d: unknown) => unknown) => {
        validate = v;
        return b;
      },
      handler:
        (h: (a: { data: unknown; context: unknown }) => unknown) =>
        (arg: { data: unknown; context: unknown }) =>
          h({ data: validate(arg.data), context: arg.context }),
    };
    return b;
  },
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));
vi.mock("@/lib/ticket-events.server", () => ({
  afterTicketStage: vi.fn(async () => {}),
  afterTicketDispatch: vi.fn(async () => {}),
}));
vi.mock("@/lib/followups.server", () => ({ syncFollowup: vi.fn(async () => "none") }));
vi.mock("@/lib/service-crew.server", () => ({
  syncCrewLead: vi.fn(async () => {}),
  writeCrew: vi.fn(async () => 0),
  readCrew: vi.fn(async () => []),
}));

import { BUSINESS_HREFS } from "@/lib/owner-business";
import { listOwnerBusiness } from "@/lib/owner-business.functions";
import { listPoWaitingTicketIds } from "@/lib/service.functions";
import { parseServiceSearch } from "@/lib/service-search";
import { filterTickets, TECH_ALL, type ListTicket } from "@/lib/ticket-list-filter";
import { fakeSupabase } from "@/test/fake-supabase";

const read = (p: string) => readFileSync(p, "utf8");
const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const LIVE = "11111111-1111-4111-8111-111111111111";
const GONE = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";

const ticket = (n: number, over: Partial<ListTicket> = {}): ListTicket => ({
  number: n,
  stage: "scheduled",
  service_type: "leak",
  scheduled_date: "2026-10-05",
  technician_id: null,
  technician_name: null,
  customer_name: "Bell County BOE",
  site_name: null,
  site_address: null,
  description: null,
  po_number: null,
  job_number: null,
  centerpoint_ticket: null,
  centerpoint_invoice: null,
  ...over,
});

function world(role: string) {
  return fakeSupabase(
    {
      profiles: [{ id: ME, role, access: ["service"], full_name: "B", email: "b@x" }],
      service_jobs: [
        {
          id: LIVE,
          stage: "done",
          stage_changed_at: null,
          scheduled_date: null,
          invoice_id: null,
          deleted_at: null,
        },
        {
          id: GONE,
          stage: "done",
          stage_changed_at: null,
          scheduled_date: null,
          invoice_id: null,
          deleted_at: "2026-10-02T00:00:00Z",
        },
        {
          id: OTHER,
          stage: "open",
          stage_changed_at: null,
          scheduled_date: null,
          invoice_id: null,
          deleted_at: null,
        },
      ],
      service_job_purchase_orders: [
        { id: "p1", service_job_id: LIVE, approved: false, price: 10 },
        { id: "p2", service_job_id: LIVE, approved: true, price: 20 },
        { id: "p3", service_job_id: GONE, approved: false, price: 36 },
        { id: "p4", service_job_id: OTHER, approved: true, price: 5 },
      ],
      invoices: [],
      crm_opportunities: [],
      crm_followups: [],
    },
    { rpcs: { crm_untouched: () => [] } },
  );
}
type Call<T> = (a: { data?: unknown; context: unknown }) => Promise<T>;

describe("?po=waiting on the Tickets list", () => {
  it("parses on the list, is dropped on a ticket, and takes nothing else", () => {
    expect(parseServiceSearch({ po: "waiting" })).toEqual({ po: "waiting" });
    expect(parseServiceSearch({ stage: "openwork", po: "waiting" })).toEqual({
      stage: "openwork",
      po: "waiting",
    });
    expect(parseServiceSearch({ po: "approved" })).toEqual({});
    expect(parseServiceSearch({ id: LIVE, po: "waiting" })).toEqual({ id: LIVE });
  });
  it("the route hands it to the page and the list reads it as the PO waiting chip", () => {
    expect(read("src/routes/service.tsx")).toContain("po={search.po}");
    const page = read("src/components/service-page.tsx");
    expect(page).toContain('const poWaitingOnly = filters.po === "waiting";');
    expect(page).toContain("PO waiting");
    expect(page).toContain('queryKey: ["po-waiting"]');
  });
});

describe("filterTickets with the waiting set", () => {
  it("keeps only the tickets whose id is in the set; no set = no filter", () => {
    const rows = [ticket(1, { id: LIVE }), ticket(2, { id: OTHER }), ticket(3)];
    const base = {
      mineId: null,
      stage: "all",
      overdueOnly: false,
      type: "all",
      tech: TECH_ALL,
      search: "",
      today: "2026-10-05",
    };
    expect(
      filterTickets(rows, { ...base, poWaiting: new Set([LIVE]) }).map((r) => r.number),
    ).toEqual([1]);
    expect(filterTickets(rows, { ...base, poWaiting: new Set() })).toEqual([]);
    expect(filterTickets(rows, { ...base, poWaiting: null }).length).toBe(3);
    expect(filterTickets(rows, base).length).toBe(3);
  });
});

describe("listPoWaitingTicketIds: the live tickets with an order still waiting", () => {
  it("one id per ticket; an approved order or a deleted ticket never", async () => {
    const env = world("manager");
    const ids = await (listPoWaitingTicketIds as unknown as Call<string[]>)({
      context: { supabase: env.db, userId: ME },
    });
    expect(ids).toEqual([LIVE]);
  });
});

describe("the Business tile", () => {
  it("counts only orders on live tickets and links to the filtered list", async () => {
    const env = world("admin");
    const r = await (
      listOwnerBusiness as unknown as Call<{ pos: { count: number; total: number } }>
    )({ data: { today: "2026-10-08" }, context: { supabase: env.db, userId: ME } });
    expect(r.pos).toEqual({ count: 1, total: 10 });
    expect(BUSINESS_HREFS.pos).toBe("/service?po=waiting");
  });
  it("Invoiced this month is gone (the margin report's month row has it, before tax, with cost)", () => {
    const biz = read("src/components/owner-business.tsx");
    expect(biz).not.toContain('title="Invoiced this month"');
    expect(biz).toContain('title="Purchase orders waiting for approval"');
    expect(BUSINESS_HREFS).not.toHaveProperty("invoiced");
  });
});
