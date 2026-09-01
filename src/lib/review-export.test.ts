import { describe, it, expect } from "vitest";

import { buildReviewRows, toCsv, type ReviewData } from "./review-export";

const data: ReviewData = {
  bidName: 'Acme "HQ", Phase 1',
  statusLabel: "In Progress",
  membraneMaterial: 3199.23,
  parapetMaterial: 0,
  metalsMaterial: 0,
  adhesiveMaterial: 0,
  accessoryMaterial: 210.85,
  underlaymentMaterial: 2125,
  otherMaterial: 0,
  discounts: 0,
  warrantyCost: 0,
  shipping: 800,
  laborCost: 756.25,
  subsServices: 0,
  subtotal1: 7091.33,
  markupLabel: "Gross profit %",
  markupValue: 3818.41,
  subtotal2: 10909.74,
  commissionValue: 327.29,
  perDiemCharge: 0,
  salesTaxValue: 345.95,
  grandTotal: 11582.98,
  installHours: 15.13,
  setupHours: 16,
  inspectionHours: 5,
  tearOffHours: 0,
  accessoryHours: 1,
  parapetHours: 0,
  curbHours: 0,
  underlaymentHours: 0,
  totalManDays: 4.13,
  disposalUnits: 0,
  roofSqFt: 2500,
  membraneSqFt: 2723,
};

describe("buildReviewRows", () => {
  const rows = buildReviewRows(data);
  const find = (line: string) => rows.find((r) => r[1] === line);

  it("carries the core money chain and drops zero-value optional lines", () => {
    expect(find("Bid total")![2]).toBe("11582.98");
    expect(find("Membrane material")![2]).toBe("3199.23");
    expect(find("Accessories")).toBeDefined(); // 210.85 (Purchases group)
    expect(find("Parapet material")).toBeUndefined(); // 0 → omitted
    expect(find("Per-diem")).toBeUndefined();
  });

  it("computes the legacy unit metrics from the totals", () => {
    expect(find("Price per roof sq ft")![2]).toBe((11582.98 / 2500).toFixed(2));
    expect(find("Labor per membrane sq ft")![2]).toBe((756.25 / 2723).toFixed(2));
  });

  it("guards divide-by-zero areas", () => {
    const r0 = buildReviewRows({ ...data, roofSqFt: 0, membraneSqFt: 0 });
    expect(r0.find((r) => r[1] === "Price per roof sq ft")).toBeUndefined();
    expect(r0.find((r) => r[1] === "Price per membrane sq ft")).toBeUndefined();
  });
});

describe("toCsv", () => {
  it("quotes and escapes fields with commas, quotes and newlines (CRLF rows)", () => {
    const csv = toCsv([
      ["a", "b,c", 'say "hi"'],
      ["line\nbreak", "plain", ""],
    ]);
    expect(csv).toBe('a,"b,c","say ""hi"""\r\n"line\nbreak",plain,\r\n');
  });

  it("round-trips the bid name with comma and quotes", () => {
    const csv = toCsv(buildReviewRows(data));
    expect(csv).toContain('"Acme ""HQ"", Phase 1"');
  });
});
