/**
 * The PDF's Property block (owner, Oct 9, from the Invoice-6010 preview: "why does the invoice
 * say property on it if theres no property listed?"). McKnight & Associates has no property on
 * file, so the invoice's property snapshot is { name: "", address: "" } and the PDF printed a
 * "Property" heading over nothing. Now the heading prints only when there is a line under it,
 * and the editor says so on screen.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { propertyLines } from "@/lib/invoice-pdf-rows";

const read = (p: string) => readFileSync(p, "utf8");

describe("propertyLines — what prints under the Property heading", () => {
  it("nothing for a ticket without a property (empty snapshot, blanks, null)", () => {
    expect(propertyLines({ name: "", address: "" })).toEqual([]);
    expect(propertyLines({ name: "  ", address: " " })).toEqual([]);
    expect(propertyLines({})).toEqual([]);
    expect(propertyLines(null)).toEqual([]);
    expect(propertyLines(undefined)).toEqual([]);
  });

  it("name then address when the ticket has a property; either alone is fine", () => {
    expect(propertyLines({ name: "Pineville Preschool", address: "1 Main St, London KY" })).toEqual(
      ["Pineville Preschool", "1 Main St, London KY"],
    );
    expect(propertyLines({ name: "Pineville Preschool", address: "" })).toEqual([
      "Pineville Preschool",
    ]);
    expect(propertyLines({ address: "1 Main St" })).toEqual(["1 Main St"]);
  });
});

describe("the PDF and the editor use it", () => {
  it("renderInvoicePdf prints the Property heading only when there are lines", () => {
    const src = read("src/lib/invoices.server.ts");
    expect(src).toMatch(/const propLines = propertyLines\(property\);/);
    expect(src).toMatch(/if \(propLines\.length > 0\) \{\s*doc\.text\("Property"/);
    // The old unconditional heading is gone.
    expect(src).not.toMatch(
      /\n\s*doc\.text\("Property", M \+ 270, 9, true\);\n\s*doc\.y -= 12;\n\s*doc\.paragraph\(\[property/,
    );
  });

  it("the editor says there is no property instead of a bare dash", () => {
    const src = read("src/components/service/invoice-editor.tsx");
    expect(src).toMatch(/propertyLines\(p\)\.length === 0/);
    expect(src).toContain("No property on file");
    expect(src).not.toMatch(/\{p\["name"\] \|\| "—"\}/);
  });
});
