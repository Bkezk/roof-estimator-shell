/**
 * Owner (Oct 2): a new purchase order on a ticket starts with the ticket number, a dot and the
 * next letter — ticket #6000's first PO is "6000.A", the next "6000.B".
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { nextPoNumber, poLetters } from "./purchase-orders";

describe("nextPoNumber", () => {
  it("first PO on a ticket: <number>.A; then B, C…", () => {
    expect(nextPoNumber(6000, [])).toBe("6000.A");
    expect(nextPoNumber(6000, ["6000.A"])).toBe("6000.B");
    expect(nextPoNumber(6000, ["6000.A", "6000.B"])).toBe("6000.C");
  });
  it("skips letters already used, whatever the case or spacing, and ignores other numbers", () => {
    expect(nextPoNumber(6000, [" 6000.a ", "6000.C", "Jbk24-0255", "6001.B"])).toBe("6000.B");
    expect(nextPoNumber("6000", ["6000.B"])).toBe("6000.A");
  });
  it("after Z comes AA", () => {
    const all = Array.from({ length: 26 }, (_, i) => `6000.${poLetters(i)}`);
    expect(nextPoNumber(6000, all)).toBe("6000.AA");
    expect(poLetters(25)).toBe("Z");
    expect(poLetters(26)).toBe("AA");
    expect(poLetters(27)).toBe("AB");
  });
  it("no ticket number → blank", () => {
    expect(nextPoNumber(null, [])).toBe("");
    expect(nextPoNumber(undefined, ["6000.A"])).toBe("");
  });
});

describe("the ticket's PO form starts a new PO with that number", () => {
  it("the list carries the ticket number and the form prefills from it", () => {
    const fn = readFileSync("src/lib/service-pos.functions.ts", "utf8");
    expect(fn).toContain('select("id, number, technician_id")');
    expect(fn).toContain("ticketNumber: job.number ?? null,");
    const ui = readFileSync("src/components/service/purchase-orders-section.tsx", "utf8");
    expect(ui).toContain("suggestedNumber={nextPoNumber(");
    expect(ui).toContain("po_number: po?.po_number ?? suggested,");
    expect(ui).toContain("useState<PoDraft>(() => draftOf(po, suggestedNumber))");
  });
});
