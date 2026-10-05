/**
 * The Tickets list's Technician filter (service study M7, owner Oct 5) and the filters it sits
 * beside, moved out of ServiceList into lib/ticket-list-filter.ts.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  filterTickets,
  techChoices,
  TECH_ALL,
  TECH_UNASSIGNED,
  type ListTicket,
  type TicketListFilters,
} from "@/lib/ticket-list-filter";

const TODAY = "2026-10-05";
const t = (n: number, over: Partial<ListTicket> = {}): ListTicket => ({
  number: n,
  stage: "scheduled",
  service_type: "leak",
  scheduled_date: TODAY,
  technician_id: null,
  technician_name: null,
  customer_name: "Bell County BOE",
  site_name: "Yellow Creek",
  site_address: "4840 W Cumberland Ave",
  description: "Leak over the gym",
  po_number: null,
  job_number: null,
  centerpoint_ticket: null,
  centerpoint_invoice: null,
  ...over,
});
const ALL: TicketListFilters = {
  mineId: null,
  stage: "all",
  overdueOnly: false,
  type: "all",
  tech: TECH_ALL,
  search: "",
  today: TODAY,
};
const trace = { technician_id: "u-trace", technician_name: "Trace Floyd" };
const donnie = { technician_id: "u-donnie", technician_name: "Donnie Carpenter" };
const jobs = [t(6001, trace), t(6002, donnie), t(6003), t(6004, { ...trace, stage: "done" })];
const nums = (f: Partial<TicketListFilters>) =>
  filterTickets(jobs, { ...ALL, ...f }).map((j) => j.number);

describe("Technician filter", () => {
  it("everyone by default", () => expect(nums({})).toEqual([6001, 6002, 6003, 6004]));
  it("one technician's tickets, every stage", () =>
    expect(nums({ tech: "u-trace" })).toEqual([6001, 6004]));
  it("Unassigned: tickets with nobody on them", () =>
    expect(nums({ tech: TECH_UNASSIGNED })).toEqual([6003]));
  it("combines with the stage chip and the search", () => {
    expect(nums({ tech: "u-trace", stage: "done" })).toEqual([6004]);
    expect(nums({ tech: "u-donnie", search: "gym" })).toEqual([6002]);
  });
  it("the choices are the people on the list, A–Z, once each", () =>
    expect(techChoices(jobs)).toEqual([
      { id: "u-donnie", name: "Donnie Carpenter" },
      { id: "u-trace", name: "Trace Floyd" },
    ]));
});

describe("the filters that were already there keep working", () => {
  it("Mine, Open work, Overdue, Type, search over job # and technician name", () => {
    expect(nums({ mineId: "u-donnie" })).toEqual([6002]);
    expect(nums({ stage: "openwork" })).toEqual([6001, 6002, 6003, 6004]);
    expect(
      filterTickets([t(1, { scheduled_date: "2026-10-01" }), t(2)], {
        ...ALL,
        overdueOnly: true,
      }).map((j) => j.number),
    ).toEqual([1]);
    expect(nums({ type: "scope" })).toEqual([]);
    expect(
      filterTickets([t(7, { job_number: "26R YCES 2" })], { ...ALL, search: "yces" }),
    ).toHaveLength(1);
    expect(nums({ search: "floyd" })).toEqual([6001, 6004]);
    expect(nums({ search: "#6003" })).toEqual([6003]);
  });
});

describe("the Tickets screen uses it", () => {
  const src = readFileSync("src/components/service-page.tsx", "utf8");
  it("filters through filterTickets and shows a Technician select to the office", () => {
    expect(src).toContain("filterTickets(");
    expect(src).toContain("techChoices(");
    expect(src).toMatch(/Technician\s*\n\s*<Select value=\{techFilter\}/);
    expect(src).toContain("All technicians");
    expect(src).toContain("TECH_UNASSIGNED");
  });
});
