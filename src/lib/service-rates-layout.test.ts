/**
 * Admin › Service Rates, owner Oct 2: "there's a ton of white space". Layout only: the page is
 * capped at max-w-5xl; the twelve rates are one compact table (Rate kind | Role | four rate
 * columns, the Tech / Helper pair under one kind label, small right-aligned boxes, "$ per hour"
 * as the caption); markup / tax, terms / contact line and subject / message sit side by side
 * on md+; the CenterPoint note is one line. Every label, hint and number box stays.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(p, "utf8");
const page = read("src/routes/admin.service-rates.tsx");
const ui = read("src/components/service-rates-settings.tsx");
const flat = ui.replace(/\s+/g, " ");

describe("Service Rates page width", () => {
  it("is capped at max-w-5xl", () => {
    expect(page).toMatch(/<div className="[^"]*\bmax-w-5xl\b[^"]*">/);
  });
});

describe("the rates are a compact table", () => {
  it("has the six column headers once, at the top", () => {
    const head = flat.slice(flat.indexOf("<thead>"), flat.indexOf("</thead>"));
    expect(head).toContain("> Rate kind </th>");
    expect(head).toContain("> Role </th>");
    expect(ui.match(/<thead>/g)).toHaveLength(1);
    expect(ui).toMatch(
      /COLUMNS = \[\s*\{[^}]*label: "Travel bill" \},\s*\{[^}]*label: "Labor bill" \},\s*\{[^}]*label: "Travel cost" \},\s*\{[^}]*label: "Labor cost" \},\s*\]/,
    );
  });
  it('"$ per hour" is the caption, not a column header', () => {
    expect(ui).toMatch(/<caption[^>]*>\s*\$ per hour\s*<\/caption>/);
    expect(ui).not.toMatch(/<th[^>]*>\$ per hour<\/th>/);
  });
  it("the Tech / Helper pair sits under one kind label (rowSpan)", () => {
    expect(ui).toContain("rowSpan={ROLES.length}");
    expect(ui).toContain("{RATE_KIND_LABELS[kind]}");
  });
  it("rows are py-1 and the boxes h-8 w-24 text-right, blank when zero (NumberField)", () => {
    const body = ui.slice(ui.indexOf("<tbody>"), ui.indexOf("</tbody>"));
    expect(body).not.toContain("py-1.5");
    expect(body).toMatch(/<td className="[^"]*\bpy-1\b/);
    expect(body).toMatch(/<NumberField[^>]*className="[^"]*\bh-8 w-24 text-right\b/);
    expect(body).not.toContain("blankZero={false}");
  });
});

describe("the settings below the table", () => {
  const grid = ui.slice(ui.indexOf('<div className="grid'), ui.indexOf("<Button"));
  it("are a two-column grid on md+, no field spanning both columns", () => {
    expect(grid).toMatch(/^<div className="grid [^"]*\bmd:grid-cols-2\b/);
    expect(grid).not.toContain("col-span-2");
  });
  it("pair markup / tax, terms / contact line, subject / message, in that order", () => {
    const order = [
      "Material markup %",
      "Tax rate %",
      "Payment terms",
      "Invoice contact line",
      "Email subject",
      "Email message",
    ].map((l) => grid.indexOf(`>${l}</Label>`));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
  it("the message is a 3-row textarea; every hint is still there", () => {
    expect(grid).toMatch(/<Textarea[^>]*rows=\{3\}/);
    for (const hint of [
      "Materials bill at cost × (1 + markup): 75 % bills a $10 part at $17.50.",
      "On the taxable lines of new invoices; a tax-exempt customer gets 0.",
      "Printed on the invoice PDF.",
      '{"{number}"} is replaced with the invoice number.',
      "The default message in the Send dialog; it can be changed per send.",
    ])
      expect(grid.replace(/\s+/g, " ")).toContain(hint);
  });
});

describe("the CenterPoint note", () => {
  it("is kept, on one line", () => {
    expect(flat).toMatch(
      /<p className="[^"]*\btruncate\b[^"]*">\s*Defaults came from the CenterPoint invoices in the report; confirm the helper travel rates with the office\.\s*<\/p>/,
    );
  });
});
