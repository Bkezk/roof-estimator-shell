import { describe, expect, it } from "vitest";

import { timeLines, type RateTable } from "@/lib/invoice-labor";

// The Standard rates the invoices migration seeds (20260927160000_invoices.sql).
const RATES: RateTable = {
  "tech:labor": { bill: 85, cost: 85 },
  "tech:travel": { bill: 55, cost: 85 },
  "helper:labor": { bill: 55, cost: 55 },
  "helper:travel": { bill: 45, cost: 55 },
};
const LEAD = "11111111-1111-4111-8111-111111111111";
const AMY = "22222222-2222-4222-8222-222222222222";
const BOB = "33333333-3333-4333-8333-333333333333";
const NAMES = new Map([
  [LEAD, "Dale Lead"],
  [AMY, "Amy Tech"],
  [BOB, "Bob Tech"],
]);
const TIMES = [
  { id: 7, kind: "travel", hours: 1, helper_count: 2, technician_id: LEAD, on_date: "2026-09-29" },
  {
    id: 8,
    kind: "labor",
    hours: "2.5",
    helper_count: 2,
    technician_id: LEAD,
    on_date: "2026-09-29",
  },
  { id: 9, kind: "labor", hours: 0, helper_count: 2, technician_id: LEAD, on_date: "2026-09-29" },
];

describe("invoice labor lines: an old-style ticket (helper_count, no crew rows)", () => {
  it("bills exactly as before the crew existed: the tech plus one Helper line per helper", () => {
    const lines = timeLines({
      times: TIMES,
      rates: RATES,
      crew: [],
      techName: NAMES,
      // A profile rate must not touch an old-style ticket.
      profileRates: new Map([[LEAD, 120]]),
    });
    // The lines buildLinesFromJob produced before (invoices.server.ts at f1bb35a), verbatim.
    const line = (
      sort: number,
      kind: "travel" | "labor",
      description: string,
      qty: number,
      rate: number,
      cost: number,
      source: string,
    ) => ({
      sort,
      kind,
      description,
      qty,
      unit: "hour",
      rate,
      total: Math.round(qty * rate * 100) / 100,
      cost_rate: cost,
      cost_total: Math.round(qty * cost * 100) / 100,
      on_date: "2026-09-29",
      source,
      taxable: false,
    });
    expect(lines).toEqual([
      line(0, "travel", "Dale Lead — Travel", 1, 55, 85, "time:7"),
      line(1, "travel", "Helper — Travel", 1, 45, 55, "time:7:helper1"),
      line(2, "travel", "Helper — Travel", 1, 45, 55, "time:7:helper2"),
      line(3, "labor", "Dale Lead — Labor", 2.5, 85, 85, "time:8"),
      line(4, "labor", "Helper — Labor", 2.5, 55, 55, "time:8:helper1"),
      line(5, "labor", "Helper — Labor", 2.5, 55, 55, "time:8:helper2"),
    ]);
    expect(lines.reduce((n, l) => n + l.total, 0)).toBe(55 + 45 + 45 + 212.5 + 137.5 + 137.5);
  });

  it("names an unknown technician 'Technician'", () => {
    const [l] = timeLines({
      times: [{ ...TIMES[1]!, helper_count: 0, technician_id: null }],
      rates: RATES,
      crew: [],
      techName: NAMES,
      profileRates: new Map(),
    });
    expect(l?.description).toBe("Technician — Labor");
  });
});

describe("invoice labor lines: a named crew", () => {
  const crew = [
    { technician_id: LEAD, sort: 0, bill_rate: null },
    { technician_id: AMY, sort: 1, bill_rate: 70 },
    { technician_id: BOB, sort: 2, bill_rate: null },
  ];

  it("bills labor per member at its own $, else its profile rate, else the rate table", () => {
    const lines = timeLines({
      times: [TIMES[1]!],
      rates: RATES,
      crew,
      techName: NAMES,
      profileRates: new Map([[LEAD, 95]]),
    });
    expect(lines.map((l) => [l.description, l.rate, l.total, l.cost_rate, l.source])).toEqual([
      ["Dale Lead — Labor", 95, 237.5, 85, "time:8"], // profile rate; cost = tech
      ["Amy Tech — Labor", 70, 175, 55, `time:8:tech:${AMY}`], // the ticket's $; cost = helper
      ["Bob Tech — Labor", 55, 137.5, 55, `time:8:tech:${BOB}`], // rate table's helper rate
    ]);
  });

  it("ignores helper_count and keeps the rate table for travel", () => {
    const lines = timeLines({
      times: [TIMES[0]!],
      rates: RATES,
      crew,
      techName: NAMES,
      profileRates: new Map([[LEAD, 95]]),
    });
    expect(lines.map((l) => [l.description, l.rate, l.cost_rate])).toEqual([
      ["Dale Lead — Travel", 55, 85],
      ["Amy Tech — Travel", 45, 55],
      ["Bob Tech — Travel", 45, 55],
    ]);
  });

  it("bills a lead who works alone once", () => {
    const lines = timeLines({
      times: [TIMES[1]!],
      rates: RATES,
      crew: [{ technician_id: LEAD, sort: 0, bill_rate: 100 }],
      techName: NAMES,
      profileRates: new Map(),
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]?.total).toBe(250);
  });
});
