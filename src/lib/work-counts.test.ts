import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { OPEN_TICKET_STAGES as CUSTOMER_OPEN_STAGES } from "@/lib/crm-account";
import { OPP_CLOSING, OPP_STATUSES } from "@/lib/opportunities.functions";
import { SERVICE_STAGES, TECH_STAGES } from "@/lib/service.functions";
import { LOAD_STAGES } from "@/lib/service-schedule";
import {
  isOpenOppStatus,
  isOpenTicketStage,
  isOverdue,
  isOverdueOpp,
  isOverdueTicket,
  OPEN_OPP_STATUSES,
  OPEN_TICKET_STAGES,
  OPP_ALL_OPEN,
  SERVICE_OPEN_WORK,
  tileHref,
  WORK_TILES,
} from "./work-counts";

const TODAY = "2026-10-01";

describe("isOverdue", () => {
  it("is overdue only strictly before today", () => {
    expect(isOverdue("2026-09-30", TODAY)).toBe(true);
    expect(isOverdue("2025-12-31", TODAY)).toBe(true);
    expect(isOverdue(TODAY, TODAY)).toBe(false); // equal day = not overdue
    expect(isOverdue("2026-10-02", TODAY)).toBe(false);
  });
  it("is never overdue without a date (or with a malformed one)", () => {
    expect(isOverdue(null, TODAY)).toBe(false);
    expect(isOverdue(undefined, TODAY)).toBe(false);
    expect(isOverdue("", TODAY)).toBe(false);
    expect(isOverdue("Sep 30", TODAY)).toBe(false);
  });
});

describe("open sets", () => {
  it("tickets in progress are open / scheduled / done / authorized — everything not yet invoiced or closed (owner, Oct 12, item 6)", () => {
    expect([...OPEN_TICKET_STAGES]).toEqual(["open", "scheduled", "done", "authorized"]);
    // The same set keeps a customer from being deleted (crm-account.ts); the technician's own
    // stages and the Board's load (open / scheduled / done) are a smaller set on purpose.
    expect([...OPEN_TICKET_STAGES]).toEqual([...CUSTOMER_OPEN_STAGES]);
    expect([...TECH_STAGES]).toEqual([...LOAD_STAGES]);
    expect([...OPEN_TICKET_STAGES].slice(0, 3)).toEqual([...TECH_STAGES]);
    for (const s of SERVICE_STAGES)
      expect(isOpenTicketStage(s)).toBe(s !== "invoiced" && s !== "closed");
  });
  it("open opportunities are every status that is not closing", () => {
    expect([...OPEN_OPP_STATUSES]).toEqual(OPP_STATUSES.filter((s) => !OPP_CLOSING.includes(s)));
    expect([...OPEN_OPP_STATUSES]).toEqual(["open", "contacted", "quoted"]);
    for (const s of ["won", "lost", "no_response"]) expect(isOpenOppStatus(s)).toBe(false);
  });
  it("overdue rows are Open / Scheduled rows whose date has passed — never a Done ticket (owner, Oct 12)", () => {
    expect(isOverdueTicket({ stage: "open", scheduled_date: "2026-09-29" }, TODAY)).toBe(true);
    expect(isOverdueTicket({ stage: "scheduled", scheduled_date: "2026-09-29" }, TODAY)).toBe(true);
    // Done is finished work waiting to be authorized and invoiced: "waiting", not overdue.
    expect(isOverdueTicket({ stage: "done", scheduled_date: "2026-09-29" }, TODAY)).toBe(false);
    expect(isOverdueTicket({ stage: "authorized", scheduled_date: "2026-09-29" }, TODAY)).toBe(
      false,
    );
    expect(isOverdueTicket({ stage: "invoiced", scheduled_date: "2026-09-29" }, TODAY)).toBe(false);
    expect(isOverdueTicket({ stage: "open", scheduled_date: TODAY }, TODAY)).toBe(false);
    expect(isOverdueOpp({ status: "quoted", expected_close: "2026-09-01" }, TODAY)).toBe(true);
    expect(isOverdueOpp({ status: "won", expected_close: "2026-09-01" }, TODAY)).toBe(false);
    expect(isOverdueOpp({ status: "open", expected_close: null }, TODAY)).toBe(false);
  });
});

describe("tileHref", () => {
  it("links each tile to its list with the filter preset", () => {
    expect(tileHref("openTickets")).toEqual({ to: "/service", search: { stage: "openwork" } });
    expect(tileHref("overdueTickets")).toEqual({
      to: "/service",
      search: { stage: "openwork", overdue: 1 },
    });
    expect(tileHref("openOpps")).toEqual({ to: "/opportunities", search: { status: "allopen" } });
    expect(tileHref("overdueOpps")).toEqual({
      to: "/opportunities",
      search: { status: "allopen", overdue: 1 },
    });
    expect(SERVICE_OPEN_WORK).toBe("openwork");
    expect(OPP_ALL_OPEN).toBe("allopen");
  });
  it("the strip has exactly the four tiles, overdue ones flagged", () => {
    expect(WORK_TILES.map((t) => [t.kind, t.label, t.overdue])).toEqual([
      ["openTickets", "Tickets in progress", false],
      ["overdueTickets", "Overdue tickets", true],
      ["openOpps", "Open opportunities", false],
      ["overdueOpps", "Overdue opportunities", true],
    ]);
  });
});

// The Customers page counts strip left on Oct 14 (owner): the tiles above are the lib only.
