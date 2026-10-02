/**
 * A red "Overdue" tag on overdue service tickets and opportunities (owner, Oct 2): on each list
 * row and beside the "Opened …" line of the open item, by the same rule as the lists' Overdue
 * filter and the Customers page counts (lib/work-counts.ts).
 */
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { OverdueBadge } from "@/components/overdue-badge";
import { isOverdueOpp, isOverdueTicket, oppOverdueDays, ticketOverdueDays } from "./work-counts";

const TODAY = "2026-10-02";
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

describe("ticketOverdueDays", () => {
  it("counts whole days past the ticket's day for an open ticket", () => {
    expect(ticketOverdueDays({ stage: "open", scheduled_date: "2026-10-01" }, TODAY)).toBe(1);
    expect(ticketOverdueDays({ stage: "scheduled", scheduled_date: "2026-09-25" }, TODAY)).toBe(7);
    // Across a month and a DST change: still calendar days.
    expect(ticketOverdueDays({ stage: "done", scheduled_date: "2026-08-31" }, "2026-11-02")).toBe(
      63,
    );
  });

  it("is null for today, the future, no date, or a closed stage", () => {
    expect(ticketOverdueDays({ stage: "open", scheduled_date: TODAY }, TODAY)).toBeNull();
    expect(ticketOverdueDays({ stage: "open", scheduled_date: "2026-10-03" }, TODAY)).toBeNull();
    expect(ticketOverdueDays({ stage: "open", scheduled_date: null }, TODAY)).toBeNull();
    for (const stage of ["invoiced", "closed"])
      expect(ticketOverdueDays({ stage, scheduled_date: "2026-09-01" }, TODAY)).toBeNull();
  });

  it("agrees with the Overdue filter on every case", () => {
    const stages = ["open", "scheduled", "done", "invoiced", "closed"];
    const dates = [null, "2026-09-01", "2026-10-01", TODAY, "2026-10-03"];
    for (const stage of stages)
      for (const scheduled_date of dates) {
        const j = { stage, scheduled_date };
        expect(ticketOverdueDays(j, TODAY) !== null).toBe(isOverdueTicket(j, TODAY));
      }
  });
});

describe("oppOverdueDays", () => {
  it("counts days past the expected close while open, contacted or quoted", () => {
    for (const status of ["open", "contacted", "quoted"])
      expect(oppOverdueDays({ status, expected_close: "2026-09-30" }, TODAY)).toBe(2);
  });

  it("is null once won, lost or no response, and for today / later / no date", () => {
    for (const status of ["won", "lost", "no_response"])
      expect(oppOverdueDays({ status, expected_close: "2026-09-01" }, TODAY)).toBeNull();
    expect(oppOverdueDays({ status: "open", expected_close: TODAY }, TODAY)).toBeNull();
    expect(oppOverdueDays({ status: "open", expected_close: "2026-12-01" }, TODAY)).toBeNull();
    expect(oppOverdueDays({ status: "open", expected_close: null }, TODAY)).toBeNull();
  });

  it("agrees with the Overdue filter on every case", () => {
    const statuses = ["open", "contacted", "quoted", "won", "lost", "no_response"];
    const dates = [null, "2026-09-01", "2026-10-01", TODAY, "2026-10-03"];
    for (const status of statuses)
      for (const expected_close of dates) {
        const o = { status, expected_close };
        expect(oppOverdueDays(o, TODAY) !== null).toBe(isOverdueOpp(o, TODAY));
      }
  });
});

describe("OverdueBadge", () => {
  it("renders a red (destructive) 'Overdue Nd' tag with the due day in its tooltip", () => {
    const html = renderToStaticMarkup(createElement(OverdueBadge, { days: 3, what: "Was due" }));
    expect(html).toContain("Overdue 3d");
    expect(html).toContain("bg-destructive");
    expect(html).toContain('title="Was due 3 days ago"');
    expect(html).toContain('data-tag="overdue"');
    const one = renderToStaticMarkup(createElement(OverdueBadge, { days: 1, what: "Was due" }));
    expect(one).toContain('title="Was due 1 day ago"');
  });

  it("renders nothing when not overdue", () => {
    expect(renderToStaticMarkup(createElement(OverdueBadge, { days: null, what: "x" }))).toBe("");
  });
});

describe("where the tag shows", () => {
  const service = read("components/service-page.tsx");
  const opps = read("components/opportunities-page.tsx");
  const count = (src: string, s: string) => src.split(s).length - 1;

  it("each ticket row and the open ticket's header, by the list's own day", () => {
    expect(service).toContain(
      '<OverdueBadge days={ticketOverdueDays({ ...j, stage }, today)} what="Was due" />',
    );
    expect(service).toMatch(/<TicketListRow[\s\S]*?today=\{today\}/);
    expect(count(service, "ticketOverdueDays(")).toBe(2);
    expect(service).toMatch(/data-line="opened"[\s\S]{0,80}\{opened\}\s*<OverdueBadge/);
  });

  it("each opportunity row and the open opportunity's header, by the list's own day", () => {
    expect(opps).toContain(
      '<OverdueBadge days={oppOverdueDays({ ...o, status }, today)} what="Expected to close" />',
    );
    expect(opps).toMatch(/<OppListRow[\s\S]*?today=\{today\}/);
    expect(count(opps, "oppOverdueDays(")).toBe(2);
    expect(opps).toMatch(/data-line="opened"[\s\S]{0,80}\{opened\}\s*<OverdueBadge/);
  });
});
