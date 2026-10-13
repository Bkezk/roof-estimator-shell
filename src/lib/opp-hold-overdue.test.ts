/**
 * A snoozed opportunity is not overdue until the hold's day (owner, Oct 13: "I put Corbin middle
 * on snooze with a date but I'm not sure it worked? it still says overdue"). The snooze had
 * saved (the follow-up held until Oct 22) and Work Overview filed it under Waiting, but the
 * Opportunities list row, the open opportunity's header, its follow-up line and the Customers
 * strip's Overdue opportunities count all judged by the expected close alone. Each fails on the
 * old code.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { isFollowupOverdue } from "@/lib/followup-rules";
import { heldOppIds, isOppHeld, isOverdueOpp, oppOverdueDays } from "@/lib/work-counts";

const TODAY = "2026-10-13";
const read = (p: string) => readFileSync(p, "utf8");

describe("isOverdueOpp / oppOverdueDays honour a hold", () => {
  const corbin = { status: "quoted", expected_close: "2026-09-30" };
  it("past its expected close and not held: overdue 13 days", () => {
    expect(isOverdueOpp(corbin, TODAY)).toBe(true);
    expect(isOverdueOpp(corbin, TODAY, false)).toBe(true);
    expect(oppOverdueDays(corbin, TODAY)).toBe(13);
  });
  it("held: not overdue, no day count", () => {
    expect(isOverdueOpp(corbin, TODAY, true)).toBe(false);
    expect(oppOverdueDays(corbin, TODAY, true)).toBeNull();
  });
});

describe("isOppHeld (the row's hold_until)", () => {
  it("a hold on a later day holds; on its own day or earlier it is back; none is none", () => {
    expect(isOppHeld({ hold_until: "2026-10-22T12:00:00+00:00" }, TODAY)).toBe(true);
    expect(isOppHeld({ hold_until: "2026-10-14T12:00:00+00:00" }, TODAY)).toBe(true);
    expect(isOppHeld({ hold_until: "2026-10-13T12:00:00+00:00" }, TODAY)).toBe(false);
    expect(isOppHeld({ hold_until: "2026-10-01T12:00:00+00:00" }, TODAY)).toBe(false);
    expect(isOppHeld({ hold_until: null }, TODAY)).toBe(false);
    expect(isOppHeld({}, TODAY)).toBe(false);
  });
});

describe("heldOppIds (the Customers strip)", () => {
  it("only open opportunity follow-ups held on a later day; tickets are heldTicketIds' business", () => {
    const rows = [
      {
        kind: "opportunity",
        item_id: "corbin",
        status: "open",
        snoozed_until: "2026-10-22T12:00:00Z",
      },
      {
        kind: "opportunity",
        item_id: "back",
        status: "open",
        snoozed_until: "2026-10-13T12:00:00Z",
      },
      {
        kind: "opportunity",
        item_id: "closed",
        status: "closed",
        snoozed_until: "2026-10-22T12:00:00Z",
      },
      { kind: "ticket", item_id: "t1", status: "open", snoozed_until: "2026-10-22T12:00:00Z" },
    ];
    expect([...heldOppIds(rows, TODAY)]).toEqual(["corbin"]);
  });
});

describe("isFollowupOverdue honours the hold", () => {
  const due = "2026-09-30T12:00:00+00:00";
  it("due Sep 30, held until Oct 22: not overdue on Oct 13", () => {
    expect(
      isFollowupOverdue(
        { due_at: due, status: "open", snoozed_until: "2026-10-22T12:00:00+00:00" },
        TODAY,
      ),
    ).toBe(false);
  });
  it("a hold that has passed, or none: overdue as before", () => {
    expect(
      isFollowupOverdue(
        { due_at: due, status: "open", snoozed_until: "2026-10-05T12:00:00+00:00" },
        TODAY,
      ),
    ).toBe(true);
    expect(isFollowupOverdue({ due_at: due, status: "open", snoozed_until: null }, TODAY)).toBe(
      true,
    );
    expect(isFollowupOverdue({ due_at: due, status: "open" }, TODAY)).toBe(true);
  });
});

describe("the screens carry the hold", () => {
  const fns = read("src/lib/opportunities.functions.ts");
  const page = read("src/components/opportunities-page.tsx");
  const counts = read("src/lib/work-counts.functions.ts");
  const badge = read("src/components/overdue-badge.tsx");
  const shared = read("src/components/followups-shared.ts");
  it("every opportunity row carries hold_until from its open follow-up", () => {
    expect(fns).toContain("hold_until: string | null;");
    expect(fns).toContain('.eq("kind", "opportunity")');
    expect(fns).toContain('.not("snoozed_until", "is", null)');
    expect(fns).toContain("hold_until: holds.get(r.id) ?? null,");
  });
  it("the list row, the Overdue filter and the header pass the hold; an On hold tag replaces the red one", () => {
    expect(page).toContain("days={oppOverdueDays({ ...o, status }, today, isOppHeld(o, today))}");
    expect(page).toContain("<HoldBadge holdUntil={o.hold_until} today={today} />");
    expect(page).toContain(
      "isOverdueOpp({ ...o, status: asStatus(o.status) }, today, isOppHeld(o, today))",
    );
    expect(page).toContain("isOppHeld(opp, localYmd(new Date())),");
    expect(page).toContain("<HoldBadge holdUntil={opp.hold_until} today={localYmd(new Date())} />");
    expect(page).toContain("on hold until ${whenDay(f.snoozed_until)}");
    expect(badge).toContain("export function HoldBadge(");
    expect(badge).toContain("On hold until {day}");
  });
  it("the Customers strip leaves held opportunities out of Overdue opportunities", () => {
    expect(counts).toContain('.in("kind", ["ticket", "opportunity"])');
    expect(counts).toContain("const oppsOnHold = heldOppIds(heldRows, today);");
    expect(counts).toContain(
      "overdueOpps: (overdueO.data ?? []).filter((o) => !oppsOnHold.has(o.id)).length,",
    );
    expect(counts).not.toContain("overdueOpps: overdueO.count ?? 0");
  });
  it("a snooze re-reads the opportunity rows and the strip", () => {
    expect(shared).toContain('void qc.invalidateQueries({ queryKey: ["opportunities"] });');
    expect(shared).toContain('void qc.invalidateQueries({ queryKey: ["opportunity"] });');
    expect(shared).toContain('void qc.invalidateQueries({ queryKey: ["work-counts"] });');
  });
});
