/**
 * The calendar's ticket chips (owner, Nov 25, 2026: "why does ticket 6058 just show the number but
 * others show the customers and sometimes they show other things?", then "go on the calendar
 * question solution").
 *
 * A ticket's chip was its number and its description. A ticket with an empty description showed
 * only its number; the others showed whatever was typed, which is sometimes a customer's name
 * and sometimes not. Now every ticket's chip leads with the customer and ends with its number.
 * Every name here is made up.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { calendarChip, ticketItem, type TicketIn } from "@/lib/my-work";

const ticket = (over: Partial<TicketIn> = {}): TicketIn =>
  ({
    id: "t1",
    number: 7058,
    customer_name: "Harbor Supply",
    site_name: "North plant",
    site_address: "12 Dock St",
    description: "",
    service_type: "repair",
    stage: "scheduled",
    scheduled_date: "2026-11-27",
    technician_id: "u1",
    ...over,
  }) as TicketIn;

describe("a ticket's chip on the calendar", () => {
  it("a ticket with no description leads with its customer, not just its number", () => {
    const chip = calendarChip(ticketItem(ticket()));
    expect(chip.lead).toBe("Harbor Supply");
    expect(chip.tail).toBe("#7058");
  });

  it("a ticket with a description reads the same way: customer, then number", () => {
    const chip = calendarChip(ticketItem(ticket({ description: "Leak over the office" })));
    expect(chip.lead).toBe("Harbor Supply");
    expect(chip.tail).toBe("#7058");
  });

  it("the hover text keeps everything: customer, number and description", () => {
    expect(calendarChip(ticketItem(ticket({ description: "Leak over the office" }))).hover).toBe(
      "Harbor Supply · #7058 Leak over the office",
    );
    expect(calendarChip(ticketItem(ticket())).hover).toBe("Harbor Supply · #7058");
  });

  it("an inspection is a ticket too", () => {
    const chip = calendarChip(ticketItem(ticket({ service_type: "inspection" })));
    expect(chip).toMatchObject({ lead: "Harbor Supply", tail: "#7058" });
  });

  it("a ticket with no customer on it reads as before, never a blank chip", () => {
    const chip = calendarChip(ticketItem(ticket({ customer_name: "  ", description: "Gutter" })));
    expect(chip).toEqual({ lead: "#7058 Gutter", tail: null, hover: "#7058 Gutter" });
  });

  it("an opportunity, a bid and a task keep their own title", () => {
    for (const title of ["Leak at the dock", "Dock re-roof", "Order the lift"])
      expect(calendarChip({ title })).toEqual({ lead: title, tail: null, hover: title });
  });

  it("the list row is not changed: its title is still the number and the description", () => {
    expect(ticketItem(ticket({ description: "Leak over the office" })).title).toBe(
      "#7058 Leak over the office",
    );
  });
});

describe("the calendar draws the chip from the rule", () => {
  const page = readFileSync("src/components/my-work-page.tsx", "utf8");
  it("the customer gets the room; the number shows only when the day is wide enough", () => {
    expect(page).toContain("const chip = calendarChip(i);");
    // The pair wraps: the number drops to a second line, which is not shown, unless 4.5rem is
    // left for the customer beside it.
    expect(page).toContain(
      '<span className="flex h-4 min-w-0 flex-1 flex-wrap gap-x-1 overflow-hidden">',
    );
    expect(page).toMatch(/className="min-w-0 flex-\[1_1_4\.5rem\] truncate"\s+data-chip="lead"/);
    expect(page).toContain('<span className="shrink-0 tabular-nums" data-chip="number">');
    // No size container on the chip: it made the whole calendar shrink on a wide screen.
    expect(page).not.toContain("@container flex min-w-0 items-center gap-1");
    expect(page).not.toContain('<span className="min-w-0 flex-1 truncate">{i.title}</span>');
  });
  it("the hover text is the chip's, with whose it is in the Everyone view", () => {
    expect(page).toContain('showWho ? `${chip.hover} — ${i.assigneeName ?? ""}` : chip.hover');
  });
});
