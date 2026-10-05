import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

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
  it("open tickets are open / scheduled / done (the stages My Work and the board load use)", () => {
    expect([...OPEN_TICKET_STAGES]).toEqual(["open", "scheduled", "done"]);
    expect([...OPEN_TICKET_STAGES]).toEqual([...TECH_STAGES]);
    expect([...OPEN_TICKET_STAGES]).toEqual([...LOAD_STAGES]);
    for (const s of SERVICE_STAGES)
      expect(isOpenTicketStage(s)).toBe(s !== "authorized" && s !== "invoiced" && s !== "closed");
  });
  it("open opportunities are every status that is not closing", () => {
    expect([...OPEN_OPP_STATUSES]).toEqual(OPP_STATUSES.filter((s) => !OPP_CLOSING.includes(s)));
    expect([...OPEN_OPP_STATUSES]).toEqual(["open", "contacted", "quoted"]);
    for (const s of ["won", "lost", "no_response"]) expect(isOpenOppStatus(s)).toBe(false);
  });
  it("overdue rows are open rows whose date has passed", () => {
    expect(isOverdueTicket({ stage: "scheduled", scheduled_date: "2026-09-29" }, TODAY)).toBe(true);
    expect(isOverdueTicket({ stage: "done", scheduled_date: "2026-09-29" }, TODAY)).toBe(true);
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
      ["openTickets", "Open tickets", false],
      ["overdueTickets", "Overdue tickets", true],
      ["openOpps", "Open opportunities", false],
      ["overdueOpps", "Overdue opportunities", true],
    ]);
  });
});

describe("Customers page counts strip (source scan)", () => {
  const page = readFileSync("src/components/customers-page.tsx", "utf8");
  const strip = readFileSync("src/components/work-counts-strip.tsx", "utf8");
  it("the Customers page renders the strip under its header", () => {
    expect(page).toMatch(/import \{ WorkCountsStrip \} from "@\/components\/work-counts-strip";/);
    const header = page.indexOf("New customer");
    const at = page.indexOf("<WorkCountsStrip />");
    expect(header).toBeGreaterThan(0);
    expect(at).toBeGreaterThan(header);
    // Above the list / account panes.
    expect(at).toBeLessThan(page.indexOf("<AccountList"));
  });
  it("the strip renders one link per tile, to tileHref, from getWorkCounts", () => {
    expect(strip).toMatch(/WORK_TILES\.map\(/);
    expect(strip).toMatch(/<Link[\s\S]*?\{\.\.\.tileHref\(t\.kind\)\}/);
    expect(strip).toMatch(/useServerFn\(getWorkCounts\)/);
    expect(strip).toMatch(/refetchInterval: 60_000/);
    expect(strip).toMatch(/refetchOnWindowFocus: true/);
  });
});
