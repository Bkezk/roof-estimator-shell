import { describe, expect, it } from "vitest";

import {
  remainingInvoiceAfterVoid,
  invoiceFileStem,
  invoiceLabel,
  nextInvoiceNumber,
  slotLabel,
  slotOf,
  type NumberedInvoice,
} from "@/lib/invoice-numbering";

const live = (display_number: string): NumberedInvoice => ({ display_number, status: "draft" });

describe("invoice numbering: the ticket number is the invoice number", () => {
  it("gives the first invoice the bare ticket number", () => {
    expect(nextInvoiceNumber(6012, [])).toBe("6012");
  });

  it("gives the second live invoice .2 and the third .3", () => {
    expect(nextInvoiceNumber(6012, [live("6012")])).toBe("6012.2");
    expect(nextInvoiceNumber(6012, [live("6012"), live("6012.2")])).toBe("6012.3");
  });

  it("reuses .2 after the .2 invoice is deleted", () => {
    // 6012, 6012.2 and 6012.3 existed; 6012.2 was deleted (its row is gone).
    expect(nextInvoiceNumber(6012, [live("6012"), live("6012.3")])).toBe("6012.2");
  });

  it("reuses the bare number after the first invoice is deleted", () => {
    expect(nextInvoiceNumber(6012, [live("6012.2")])).toBe("6012");
  });

  it("treats a voided invoice's slot as free (the void stays on record)", () => {
    expect(
      nextInvoiceNumber(6012, [{ display_number: "6012", status: "void" }, live("6012.2")]),
    ).toBe("6012");
    expect(
      nextInvoiceNumber(6012, [live("6012"), { display_number: "6012.2", status: "void" }]),
    ).toBe("6012.2");
  });

  it("counts a live legacy invoice (integer number = ticket number) as the bare slot", () => {
    expect(nextInvoiceNumber(6012, [{ number: 6012, display_number: null, status: "final" }])).toBe(
      "6012.2",
    );
    // A voided legacy invoice (its number negated) does not.
    expect(nextInvoiceNumber(6012, [{ number: -6012, display_number: null, status: "void" }])).toBe(
      "6012",
    );
  });

  it("ignores numbers that belong to another ticket", () => {
    expect(nextInvoiceNumber(6012, [live("6013"), live("6013.2"), live("60122")])).toBe("6012");
  });

  it("labels, parses and shows numbers", () => {
    expect(slotLabel(6012, 1)).toBe("6012");
    expect(slotLabel(6012, 4)).toBe("6012.4");
    expect(() => slotLabel(6012, 0)).toThrow();
    expect(slotOf(6012, "6012")).toBe(1);
    expect(slotOf(6012, "6012.3")).toBe(3);
    expect(slotOf(6012, "6012.1")).toBeNull();
    expect(slotOf(6012, "6013.2")).toBeNull();
    expect(invoiceLabel({ display_number: "6012.2", number: null })).toBe("6012.2");
    expect(invoiceLabel({ display_number: null, number: -6001 })).toBe("6001");
    expect(invoiceLabel({ display_number: null, number: 6001 })).toBe("6001");
    expect(invoiceFileStem({ display_number: "6012.2" })).toBe("6012.2");
  });
});

describe("remainingInvoiceAfterVoid — the block falls back to the ticket's other invoice", () => {
  const inv = (id: string, status: string, created_at: string) => ({ id, status, created_at });
  it("deleting 6000.2 shows 6000 again (the earliest live invoice)", () => {
    const list = [
      inv("a", "final", "2026-10-01T10:00:00Z"),
      inv("b", "draft", "2026-10-01T11:00:00Z"),
    ];
    expect(remainingInvoiceAfterVoid(list, "b")?.id).toBe("a");
  });
  it("skips voided invoices and the one just voided; null when nothing is left", () => {
    const list = [
      inv("a", "void", "2026-10-01T10:00:00Z"),
      inv("b", "draft", "2026-10-01T11:00:00Z"),
    ];
    expect(remainingInvoiceAfterVoid(list, "b")).toBeNull();
    expect(remainingInvoiceAfterVoid([], "b")).toBeNull();
    const two = [
      inv("a", "final", "2026-10-02T10:00:00Z"),
      inv("c", "sent", "2026-10-01T09:00:00Z"),
    ];
    expect(
      remainingInvoiceAfterVoid([...two, inv("b", "draft", "2026-10-03T00:00:00Z")], "b")?.id,
    ).toBe("c");
  });
});
