/**
 * Invoices on a trade bid, the rules (owner, Nov 17: "Go with option 1, T-1001 format").
 * Every number is worked by hand from the painting job of trade-bid-nov16.test.ts, whose price
 * is $3,067.12.
 */
import { describe, expect, it } from "vitest";

import {
  isTradeInvoiceNumber,
  nextBidInvoiceNumber,
  tradeJobLabel,
  unbilledAmount,
} from "@/lib/bid-invoices";

describe("the job number and the invoice numbers", () => {
  it("a job number reads T-1001", () => {
    expect(tradeJobLabel(1001)).toBe("T-1001");
    expect(tradeJobLabel(1042)).toBe("T-1042");
  });
  it("the first invoice is the bare job number, the next live ones .2 and .3", () => {
    expect(nextBidInvoiceNumber(1001, [])).toBe("T-1001");
    expect(nextBidInvoiceNumber(1001, [{ display_number: "T-1001", status: "draft" }])).toBe(
      "T-1001.2",
    );
    expect(
      nextBidInvoiceNumber(1001, [
        { display_number: "T-1001", status: "paid" },
        { display_number: "T-1001.2", status: "final" },
      ]),
    ).toBe("T-1001.3");
  });
  it("a voided invoice frees its slot, the lowest free one is taken", () => {
    expect(nextBidInvoiceNumber(1001, [{ display_number: "T-1001", status: "void" }])).toBe(
      "T-1001",
    );
    expect(
      nextBidInvoiceNumber(1001, [
        { display_number: "T-1001", status: "paid" },
        { display_number: "T-1001.2", status: "void" },
        { display_number: "T-1001.3", status: "draft" },
      ]),
    ).toBe("T-1001.2");
  });
  it("another job's numbers, a ticket's number and a legacy integer hold no slot", () => {
    expect(
      nextBidInvoiceNumber(1001, [
        { display_number: "T-1002", status: "final" },
        { display_number: "1001", status: "final" },
        { display_number: null, number: 1001, status: "final" },
      ]),
    ).toBe("T-1001");
  });
  it("knows a trade job's invoice number from a ticket's", () => {
    expect(isTradeInvoiceNumber("T-1001")).toBe(true);
    expect(isTradeInvoiceNumber("T-1001.2")).toBe(true);
    expect(isTradeInvoiceNumber(" T-1001 ")).toBe(true);
    expect(isTradeInvoiceNumber("6012")).toBe(false);
    expect(isTradeInvoiceNumber("6012.2")).toBe(false);
    expect(isTradeInvoiceNumber("T-")).toBe(false);
    expect(isTradeInvoiceNumber(null)).toBe(false);
  });
});

describe("what is left to bill", () => {
  it("nothing invoiced: the whole price", () => {
    expect(unbilledAmount(3067.12, [])).toBe(3067.12);
  });
  it("a $1,000 deposit leaves $2,067.12, whatever its status short of void", () => {
    for (const status of ["draft", "final", "paid"])
      expect(unbilledAmount(3067.12, [{ status, subtotal: 1000 }])).toBe(2067.12);
  });
  it("a voided invoice bills nothing", () => {
    expect(unbilledAmount(3067.12, [{ status: "void", subtotal: 1000 }])).toBe(3067.12);
  });
  it("a deposit and a final bill it all: nothing left, never below zero", () => {
    // 1,000 + 2,067.12 = 3,067.12
    expect(
      unbilledAmount(3067.12, [
        { status: "paid", subtotal: 1000 },
        { status: "final", subtotal: 2067.12 },
      ]),
    ).toBe(0);
    expect(unbilledAmount(3067.12, [{ status: "final", subtotal: 3500 }])).toBe(0);
  });
  it("cents do not drift: 0.1 + 0.2 billed of 0.3 leaves 0", () => {
    expect(
      unbilledAmount(0.3, [
        { status: "final", subtotal: 0.1 },
        { status: "final", subtotal: 0.2 },
      ]),
    ).toBe(0);
  });
});
