/**
 * "Purchase orders waiting for approval" is gone (owner, Oct 28: "PO's should count to internal
 * cost regardless as they happened whether approved or not, and drop the switch entirely as it
 * won't be used"; "that view isn't even on work overview anymore"). Until then (Oct 21) the
 * Business tab had a tile linking to the Tickets list filtered by ?po=waiting, the list had a
 * "PO waiting" chip, and listPoWaitingTicketIds served the ids. This pins that every piece has
 * left: the tile and its link, the search param, the chip and its query, the filter, the server
 * function — and that an old ?po=waiting link still opens the plain list.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { BUSINESS_HREFS } from "@/lib/owner-business";
import * as serviceFns from "@/lib/service.functions";
import { parseServiceSearch } from "@/lib/service-search";
import { filterTickets, TECH_ALL, type ListTicket } from "@/lib/ticket-list-filter";

const read = (p: string) => readFileSync(p, "utf8");
const LIVE = "11111111-1111-4111-8111-111111111111";
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

describe("?po=waiting is no longer a Tickets list filter", () => {
  it("an old link is ignored: the list opens plain, the other filters still parse", () => {
    expect(parseServiceSearch({ po: "waiting" })).toEqual({});
    expect(parseServiceSearch({ stage: "openwork", po: "waiting" })).toEqual({
      stage: "openwork",
    });
    expect(parseServiceSearch({ id: LIVE, po: "waiting" })).toEqual({ id: LIVE });
    const search = read("src/lib/service-search.ts");
    expect(search).not.toContain('s["po"]');
    expect(search).not.toContain('po?: "waiting"');
  });
  it("the route hands no `po` to the page; the list has no PO waiting chip or query", () => {
    expect(read("src/routes/service.tsx")).not.toContain("po={search.po}");
    const page = read("src/components/service-page.tsx");
    expect(page).not.toContain("poWaiting");
    expect(page).not.toContain("PO waiting");
    expect(page).not.toContain('"po-waiting"');
    expect(page).not.toContain("listPoWaitingTicketIds");
    expect(page).not.toContain("waiting for approval");
  });
});

describe("filterTickets has no waiting set", () => {
  it("the filters are Mine, stage, Overdue, Type, Technician and the search box", () => {
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
    expect(filterTickets(rows, base).length).toBe(3);
    // A stray `poWaiting` key (an old caller) changes nothing: the filter no longer exists.
    expect(filterTickets(rows, { ...base, poWaiting: new Set([LIVE]) } as typeof base).length).toBe(
      3,
    );
    const filter = read("src/lib/ticket-list-filter.ts");
    expect(filter).not.toContain("poWaiting");
    expect(filter).not.toContain("waiting for approval");
  });
});

describe("listPoWaitingTicketIds is gone", () => {
  it("service.functions.ts no longer exports it, nor reads `approved`", () => {
    expect(serviceFns).not.toHaveProperty("listPoWaitingTicketIds");
    expect(serviceFns).not.toHaveProperty("PO_WAITING_LIMIT");
    const fns = read("src/lib/service.functions.ts");
    expect(fns).not.toContain("listPoWaitingTicketIds");
    expect(fns).not.toContain('.eq("approved"');
  });
});

describe("the Business tile is gone", () => {
  it("no tile, no link, no purchase-order query on the Owner page", () => {
    expect(BUSINESS_HREFS).not.toHaveProperty("pos");
    expect(Object.values(BUSINESS_HREFS)).not.toContain("/service?po=waiting");
    const biz = read("src/components/owner-business.tsx");
    expect(biz).not.toContain('title="Purchase orders waiting for approval"');
    expect(biz).not.toContain("BUSINESS_HREFS.pos");
    expect(biz).not.toContain("d.pos");
    const lib = read("src/lib/owner-business.ts");
    expect(lib).not.toContain("po=waiting");
    expect(lib).not.toContain("BizPo");
    expect(lib).not.toContain("approved");
    const server = read("src/lib/owner-business.functions.ts");
    expect(server).not.toContain("service_job_purchase_orders");
    expect(server).not.toContain("approved");
  });
  it("Invoiced this month stays gone too (owner, Oct 21: the margin report has the month)", () => {
    const biz = read("src/components/owner-business.tsx");
    expect(biz).not.toContain('title="Invoiced this month"');
    expect(BUSINESS_HREFS).not.toHaveProperty("invoiced");
  });
});
