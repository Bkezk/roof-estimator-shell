/**
 * One meaning of "overdue ticket" (owner, Oct 12, item 11): its scheduled day has passed and it
 * is Open or Scheduled. Done is finished work waiting to be authorized and invoiced — never
 * overdue. Applied in work-counts.ts (the tiles, the red tag, the Tickets list's filter), the
 * Owner view's Past due (owner-business.ts) and Work Overview's groups (my-work.ts).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { bucketOf, ticketItem } from "@/lib/my-work";
import { businessNumbers } from "@/lib/owner-business";
import { filterTickets, TECH_ALL } from "@/lib/ticket-list-filter";
import {
  OPEN_TICKET_STAGES,
  OVERDUE_TICKET_STAGES,
  isOverdueTicket,
  isOverdueTicketStage,
  ticketOverdueDays,
} from "@/lib/work-counts";

const read = (p: string) => readFileSync(p, "utf8");
const TODAY = "2026-10-12";
const PAST = "2026-10-01";

describe("the rule", () => {
  it("Open / Scheduled past their day; Done, Authorized, Invoiced, Closed never", () => {
    expect([...OVERDUE_TICKET_STAGES]).toEqual(["open", "scheduled"]);
    expect([...OPEN_TICKET_STAGES]).toEqual(["open", "scheduled", "done"]); // open work still counts Done
    for (const stage of ["open", "scheduled"]) {
      expect(isOverdueTicketStage(stage)).toBe(true);
      expect(isOverdueTicket({ stage, scheduled_date: PAST }, TODAY)).toBe(true);
      expect(ticketOverdueDays({ stage, scheduled_date: PAST }, TODAY)).toBe(11);
      expect(isOverdueTicket({ stage, scheduled_date: TODAY }, TODAY)).toBe(false);
    }
    for (const stage of ["done", "authorized", "invoiced", "closed"]) {
      expect(isOverdueTicketStage(stage)).toBe(false);
      expect(isOverdueTicket({ stage, scheduled_date: PAST }, TODAY)).toBe(false);
      expect(ticketOverdueDays({ stage, scheduled_date: PAST }, TODAY)).toBeNull();
    }
  });
});

describe("where it applies", () => {
  it("the Tickets list's Overdue filter leaves a Done ticket out", () => {
    const base = {
      number: 1,
      service_type: "leak",
      technician_id: null,
      technician_name: null,
      customer_name: "Acme",
      site_name: null,
      site_address: null,
      description: null,
      po_number: null,
      job_number: null,
      centerpoint_ticket: null,
      centerpoint_invoice: null,
    };
    const jobs = [
      { ...base, number: 1, stage: "scheduled", scheduled_date: PAST },
      { ...base, number: 2, stage: "done", scheduled_date: PAST },
    ];
    const out = filterTickets(jobs, {
      mineId: null,
      stage: "all",
      overdueOnly: true,
      type: "all",
      tech: TECH_ALL,
      search: "",
      today: TODAY,
    });
    expect(out.map((j) => j.number)).toEqual([1]);
    // The server's counts read the same stages for the overdue tile.
    const counts = read("src/lib/work-counts.functions.ts");
    expect(counts).toContain('tickets(OVERDUE_TICKET_STAGES).lt("scheduled_date", today)');
  });
  it("the Owner view's Past due is the same rule (a Done ticket past its day is not stale)", () => {
    const n = businessNumbers({
      today: TODAY,
      now: `${TODAY}T15:00:00Z`,
      tickets: [
        { stage: "scheduled", stage_changed_at: null, scheduled_date: PAST },
        { stage: "open", stage_changed_at: null, scheduled_date: PAST },
        { stage: "done", stage_changed_at: `${PAST}T12:00:00Z`, scheduled_date: PAST },
        { stage: "scheduled", stage_changed_at: null, scheduled_date: TODAY },
      ],
      invoices: [],
      pos: [],
      opps: [],
      snoozed: 0,
      untouched: null,
    });
    expect(n.stale.pastDue).toBe(2);
    expect(read("src/lib/owner-business.ts")).toContain(
      "i.tickets.filter((t) => isOverdueTicket(t, i.today))",
    );
  });
  it("Work Overview files a Done ticket under Done, never Overdue, whatever its day", () => {
    const done = ticketItem({
      id: "t",
      number: 1,
      customer_name: "Acme",
      site_name: null,
      site_address: null,
      description: "",
      service_type: "leak",
      stage: "done",
      scheduled_date: PAST,
      technician_id: "tech",
    });
    expect(bucketOf(done, TODAY)).toBe("done");
    expect(bucketOf({ ...done, done: false }, TODAY)).toBe("overdue");
  });
  it("the red tag and the list badge read the one rule; the tile's label does not say otherwise", () => {
    const service = read("src/components/service-page.tsx");
    expect(service).toContain(
      '<OverdueBadge days={ticketOverdueDays({ ...j, stage }, today)} what="Was due" />',
    );
    expect(read("src/components/overdue-badge.tsx")).toContain("ticketOverdueDays");
    expect(read("src/lib/work-counts.ts")).toContain('label: "Overdue tickets", overdue: true');
    expect(read("src/lib/ticket-list-filter.ts")).toContain(
      "if (f.overdueOnly && !isOverdueTicket(j, f.today)) return false;",
    );
  });
});
