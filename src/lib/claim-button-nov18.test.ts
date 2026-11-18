/**
 * Work Overview's Claim button (owner, Nov 18): "go ahead and get rid of the claim button since
 * the dropdown establishes the same thing".
 *
 * An Unassigned row showed "Assign to…" and Claim side by side. Picking yourself in the dropdown
 * puts you on the work exactly as Claim did, so Claim is gone from every row that has the
 * dropdown. One case has no dropdown: a task or an opportunity nobody is on, for an office
 * person ticked Technician who is not a manager (only an admin or a manager assigns those).
 * Claim is still their one way to take it, so it stays there.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { canClaim, shapeForKind } from "@/lib/access";
import type { WorkItem } from "@/lib/my-work";
import {
  PANE_HINT_ASSIGN,
  PANE_HINT_CLAIM,
  PANE_HINT_TAKE,
  assignKind,
  claimShows,
  paneHint,
} from "@/lib/my-work-actions";

const read = (p: string) => readFileSync(p, "utf8");
const page = read("src/components/my-work-page.tsx");
const hook = read("src/components/my-work-actions.tsx");

const ME = "11111111-1111-4111-8111-111111111111";
// The owner's own login: an admin ticked Technician. A manager ticked Technician likewise.
const adminTicked = { id: ME, ...shapeForKind("owner", true) };
const managerTicked = { id: ME, ...shapeForKind("manager", true) };
const admin = { id: ME, ...shapeForKind("owner", false) };
const officeTicked = { id: ME, ...shapeForKind("office", true) };
const officePlain = { id: ME, ...shapeForKind("office", false) };
const techOnly = { id: ME, ...shapeForKind("technician", true) };

const item = (over: Partial<WorkItem>): WorkItem => ({
  key: "ticket:t1",
  kind: "ticket",
  title: "#101 Leak",
  where: null,
  date: "2026-11-24",
  status: "Scheduled",
  done: false,
  href: "/service?id=t1",
  assigneeId: null,
  assigneeName: null,
  unassigned: true,
  followup: null,
  ...over,
});
const ticket = item({});
const inspection = item({ key: "ticket:t2", kind: "inspection" });
const task = item({ key: "task:k1", kind: "task", title: "Call the owner" });
const opp = item({ key: "opportunity:o1", kind: "opportunity", title: "Reroof gym" });

describe("Claim shows only where the row has no Assign to…", () => {
  it("never on a ticket: everyone who could claim one has the dropdown", () => {
    for (const v of [adminTicked, managerTicked, officeTicked]) {
      expect(canClaim(v)).toBe(true);
      for (const row of [ticket, inspection]) {
        expect(assignKind(row, v)).toBe("ticket");
        expect(claimShows(row, v)).toBe(false);
      }
    }
  });
  it("never for an admin or a manager: they have the dropdown on every kind", () => {
    for (const v of [adminTicked, managerTicked])
      for (const row of [ticket, task, opp]) expect(claimShows(row, v)).toBe(false);
  });
  it("still on a task or an opportunity for a ticked office person: no dropdown there", () => {
    for (const row of [task, opp]) {
      expect(assignKind(row, officeTicked)).toBeNull();
      expect(claimShows(row, officeTicked)).toBe(true);
    }
  });
  it("nobody who could not claim before can claim now", () => {
    for (const v of [admin, officePlain, techOnly, null])
      for (const row of [ticket, task, opp]) expect(claimShows(row, v)).toBe(false);
  });
  it("only on nobody's work", () => {
    expect(claimShows(item({ ...task, unassigned: false, assigneeId: ME }), officeTicked)).toBe(
      false,
    );
  });
  it("no row has both, and no claimable row is left with neither", () => {
    for (const v of [adminTicked, managerTicked, officeTicked])
      for (const row of [ticket, inspection, task, opp]) {
        const dropdown = assignKind(row, v) !== null;
        expect(claimShows(row, v)).toBe(!dropdown);
      }
  });
});

describe("the page", () => {
  it("the row asks the rule, and still draws the dropdown first", () => {
    expect(hook).toContain("claimShows: (item) => claimShows(item, profile),");
    expect(page).toContain(
      "const showClaim = !!claim && (actions ? actions.claimShows(item) : !!item.unassigned);",
    );
    expect(page).not.toContain("const showClaim = !!item.unassigned && !!claim;");
    expect(page).toContain("{assignNode}\n            {showClaim && (");
  });
  it("a drop on a calendar day still takes it for yourself", () => {
    expect(page).toMatch(/if \(claim\) claim\(it, d\);/);
    expect(page).toContain("const claim: ClaimWork | null = canClaim(profile)");
  });
  it("the Calendar pane's line no longer offers Claim where there is none", () => {
    expect(PANE_HINT_TAKE).toBe(
      "Drag one onto a day to take it and put it there, or use Assign to.",
    );
    expect(paneHint(adminTicked)).toBe(PANE_HINT_TAKE);
    expect(paneHint(managerTicked)).toBe(PANE_HINT_TAKE);
    expect(paneHint(officeTicked)).toBe(PANE_HINT_CLAIM);
    expect(PANE_HINT_CLAIM).toContain("a task or an opportunity has Claim");
    expect(paneHint(admin)).toBe(PANE_HINT_ASSIGN);
    expect(paneHint(officePlain)).toBe(PANE_HINT_ASSIGN);
  });
});
