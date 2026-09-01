/**
 * Estimate Review export — the legacy Review tab's "Export To Excel", modernized as a CSV the
 * spreadsheet apps open directly. Pure row/CSV builders (tested); the estimator wires the numbers
 * in from the same computed result the Bid-total panel shows, so the export can't disagree with
 * the live estimate.
 */

export interface ReviewData {
  bidName: string;
  statusLabel: string;
  // purchases ($)
  membraneMaterial: number;
  parapetMaterial: number;
  metalsMaterial: number;
  adhesiveMaterial: number;
  accessoryMaterial: number;
  underlaymentMaterial: number;
  otherMaterial: number;
  discounts: number; // ≤ 0 when any discount applies
  warrantyCost: number;
  shipping: number;
  laborCost: number;
  subsServices: number;
  subtotal1: number;
  markupLabel: string;
  markupValue: number;
  subtotal2: number;
  commissionValue: number;
  perDiemCharge: number;
  salesTaxValue: number;
  grandTotal: number;
  // labor hours
  installHours: number;
  setupHours: number;
  inspectionHours: number;
  tearOffHours: number;
  accessoryHours: number;
  parapetHours: number;
  curbHours: number;
  underlaymentHours: number;
  totalManDays: number;
  disposalUnits: number;
  // areas (sq ft)
  roofSqFt: number;
  membraneSqFt: number;
}

const n2 = (v: number) => v.toFixed(2);

/** Build the Review rows: [group, line, value]. Zero-value optional lines are omitted. */
export function buildReviewRows(d: ReviewData): string[][] {
  const rows: string[][] = [["Group", "Line", "Value"]];
  const push = (group: string, line: string, value: string) => rows.push([group, line, value]);
  const opt = (group: string, line: string, v: number) => {
    if (v !== 0) push(group, line, n2(v));
  };

  push("Bid", "Name", d.bidName);
  push("Bid", "Status", d.statusLabel);

  const P = "Purchases";
  push(P, "Membrane material", n2(d.membraneMaterial));
  opt(P, "Parapet material", d.parapetMaterial);
  opt(P, "Metals material", d.metalsMaterial);
  opt(P, "Adhesive material", d.adhesiveMaterial);
  opt(P, "Accessories", d.accessoryMaterial);
  opt(P, "Insulation & underlayment", d.underlaymentMaterial);
  opt(P, "Other material (non-DL)", d.otherMaterial);
  opt(P, "Discounts", d.discounts);
  opt(P, "Warranty", d.warrantyCost);
  opt(P, "Shipping", d.shipping);
  push(P, "Labor", n2(d.laborCost));
  opt(P, "Subs & services", d.subsServices);
  push(P, "Subtotal 1", n2(d.subtotal1));
  push(P, `Markup (${d.markupLabel})`, n2(d.markupValue));
  push(P, "Subtotal 2", n2(d.subtotal2));
  push(P, "Commission", n2(d.commissionValue));
  opt(P, "Per-diem", d.perDiemCharge);
  push(P, "Sales tax", n2(d.salesTaxValue));
  push(P, "Bid total", n2(d.grandTotal));

  const L = "Labor hours";
  push(L, "Install", n2(d.installHours));
  push(L, "Setup", n2(d.setupHours));
  push(L, "Inspection", n2(d.inspectionHours));
  opt(L, "Tear-off", d.tearOffHours);
  opt(L, "Accessories", d.accessoryHours);
  opt(L, "Parapets", d.parapetHours);
  opt(L, "Curbs", d.curbHours);
  opt(L, "Underlayment", d.underlaymentHours);
  push(L, "Total man-days", n2(d.totalManDays));
  opt(L, "Disposal units", d.disposalUnits);

  const U = "Unit metrics";
  push(U, "Roof area (sq ft)", n2(d.roofSqFt));
  push(U, "Total membrane (sq ft)", n2(d.membraneSqFt));
  if (d.roofSqFt > 0) {
    push(U, "Price per roof sq ft", n2(d.grandTotal / d.roofSqFt));
    push(U, "Labor per roof sq ft", n2(d.laborCost / d.roofSqFt));
  }
  if (d.membraneSqFt > 0) {
    push(U, "Price per membrane sq ft", n2(d.grandTotal / d.membraneSqFt));
    push(U, "Labor per membrane sq ft", n2(d.laborCost / d.membraneSqFt));
  }
  return rows;
}

/** RFC-4180-style CSV: quote fields containing commas, quotes or newlines; CRLF line ends. */
export function toCsv(rows: string[][]): string {
  const field = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return rows.map((r) => r.map(field).join(",")).join("\r\n") + "\r\n";
}
