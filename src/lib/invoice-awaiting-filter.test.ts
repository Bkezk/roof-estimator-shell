/**
 * The Awaiting invoice group follows the search box and the date range (Nov 9 audit, finding 2:
 * searching "ZZ Audit" or narrowing to one day still showed "AWAITING INVOICE 3 tickets" above
 * the one matching invoice).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { awaitingMatches } from "./invoice-list";

const j = {
  number: 6059,
  customer_name: "ZZ Audit Inv Claude",
  site_name: "Bingo Hall",
  site_address: "204 N Hills Rd, Corbin",
  po_number: "ZZPO-1",
  job_number: "ZZJ-1",
};

describe("awaitingMatches", () => {
  it("the search words: number, customer, property (name and address), PO #, Job #; any order, any case", () => {
    for (const q of ["6059", "zz audit", "bingo", "hills rd", "zzpo-1", "zzj-1", "claude 6059", ""])
      expect(awaitingMatches(j, q, "2026-11-09", "", ""), q).toBe(true);
    for (const q of ["6058", "other customer", "zzpo-2"])
      expect(awaitingMatches(j, q, "2026-11-09", "", ""), q).toBe(false);
    expect(awaitingMatches({ number: 7 }, "7", "2026-11-09", "", "")).toBe(true);
  });
  it("the dates: the authorized day, inclusive both ends; a blank bound is open; no day = out", () => {
    expect(awaitingMatches(j, "", "2026-11-09", "2026-11-09", "2026-11-09")).toBe(true);
    expect(awaitingMatches(j, "", "2026-11-09", "2026-11-01", "")).toBe(true);
    expect(awaitingMatches(j, "", "2026-11-09", "", "2026-11-08")).toBe(false);
    expect(awaitingMatches(j, "", "2026-11-09", "2026-11-10", "")).toBe(false);
    expect(awaitingMatches(j, "", null, "2026-11-01", "")).toBe(false);
    expect(awaitingMatches(j, "", null, "", "")).toBe(true);
  });
});

describe("the page", () => {
  const page = readFileSync("src/components/service/invoices-page.tsx", "utf8");
  it("narrows the Awaiting rows by the search and the dates, by the authorized day; the header reads 'N of M tickets'", () => {
    expect(page).toContain("const narrowed = !!q.trim() || !!from || !!to;");
    expect(page).toContain(
      "return awaitingMatches(j, q, since ? toYmd(new Date(since)) : null, from, to);",
    );
    expect(page).toContain(
      "{narrowed ? `${waiting.length} of ${waitingCount}` : waitingCount} ticket",
    );
    expect(page).toContain('const awaitingShown = status === "all" && waiting.length > 0;');
    expect(page).toContain("{awaitingOpen && waiting.map(renderTicketRow)}");
  });
});
