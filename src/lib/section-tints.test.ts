/**
 * Owner, Oct 21: "add color to the boxes for contacts, properties, tickets etc. — keep the
 * actual contact boxes with info in them white and the add contact button white but give the
 * background they sit on color." The tints (lib/section-tints.ts), where they are used, and that
 * the boxes inside stay white.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { INNER_BOX, SECTION_TINTS, sectionClass, type TintedSection } from "@/lib/section-tints";

const read = (p: string) => readFileSync(p, "utf8");
const customers = read("src/components/customers-page.tsx");
const property = read("src/components/property-page.tsx");
const ticketRows = read("src/components/crm/ticket-rows.tsx");

describe("the tints", () => {
  it("one distinct hue per kind, each with a light wash and a dark pair", () => {
    const hues = new Set<string>();
    for (const [name, cls] of Object.entries(SECTION_TINTS)) {
      const hue = /bg-([a-z]+)-50\b/.exec(cls)?.[1];
      expect(hue, name).toBeTruthy();
      hues.add(hue!);
      expect(cls, name).toMatch(/dark:bg-[a-z]+-950\/40/);
      expect(cls, name).toMatch(/border-[a-z]+-200/);
      expect(cls, name).toMatch(/dark:border-[a-z]+-900/);
      // Red is the status colour (overdue): never a section's ground.
      expect(hue, name).not.toMatch(/^(red|rose)$/);
    }
    expect(hues.size).toBe(Object.keys(SECTION_TINTS).length);
  });
  it("sectionClass keeps the shared frame and adds the tint", () => {
    expect(sectionClass("tickets")).toBe(
      `space-y-3 rounded-lg border p-4 ${SECTION_TINTS.tickets}`,
    );
  });
  it("the boxes inside stand on the card colour (white in light mode)", () => {
    expect(INNER_BOX).toBe("bg-card");
  });
});

describe("where they are used", () => {
  const sections: [string, TintedSection, string][] = [
    ["Contacts", "contacts", customers],
    ["Properties", "properties", customers],
    ["Tickets", "tickets", customers],
    ["Opportunities", "opportunities", customers],
    ["Tasks", "tasks", customers],
    ["Takeoffs", "takeoffs", customers],
    ["Bids", "bids", customers],
    ["Property details", "properties", property],
    ["Tickets", "tickets", property],
    ["Bids", "bids", property],
  ];
  it.each(sections)("the %s section stands on the %s tint", (label, key, src) => {
    expect(src).toContain(`<section className={sectionClass("${key}")} aria-label="${label}">`);
  });
  it("the same kind has the same colour on both pages", () => {
    expect(customers).toContain('sectionClass("tickets")');
    expect(property).toContain('sectionClass("tickets")');
  });
  it("the customer's own card at the top is not tinted", () => {
    expect(customers).toContain(
      '<section className="space-y-4 rounded-lg border p-4" aria-label="Customer">',
    );
  });
  it("every contact box, property box and list inside sits on the card colour", () => {
    // Contact and property boxes.
    expect(customers.match(/rounded-md border px-3 py-2 \$\{INNER_BOX\}`\}/g)).toHaveLength(2);
    // The ticket, task, takeoff, bid and opportunity lists (live and closed tickets apart).
    expect(
      customers.match(/divide-y rounded-md border \$\{INNER_BOX\}/g)!.length,
    ).toBeGreaterThanOrEqual(5);
    expect(customers).not.toContain('<div className="divide-y rounded-md border">');
    expect(property).toContain("divide-y rounded-md border ${INNER_BOX}");
    expect(ticketRows).toContain("divide-y rounded-md border ${INNER_BOX}");
  });
  it("the Add buttons are outline buttons, which already stand on the card colour", () => {
    expect(read("src/components/ui/button.tsx")).toMatch(/outline:\s*"border border-input bg-card/);
    for (const label of ["Add contact", "Add property", "New task", "Link a bid"])
      expect(customers, label).toContain(label);
  });
});
