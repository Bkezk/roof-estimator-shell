/**
 * The Tech Board on a phone: the week as day cards (owner, Nov 20: "on mobile on the tech board
 * can we have the calendar be bigger and remove the list of technicians so we can see the days
 * better and since once we drag a job up the technician list appears anyway?";
 * docs/qa/tech-board-phone-days-2026-11-20.md).
 *
 * Before this the days were seven small buttons and the page was a row per technician for one
 * day. The technicians came up only for a ticket held from the Unassigned tray.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  DOCK_DAYS_PX,
  DOCK_GAP_PX,
  DOCK_HEAD_PX,
  DOCK_ROW_PX,
  PHONE_BOARD_HINT,
  dayCountWords,
  dayKey,
  dockColumns,
  dockFor,
  dockHeight,
  isDayKey,
  liftDayIndex,
  parseDropKey,
  planDrop,
} from "@/lib/board-phone";
import { carried } from "@/lib/hold-drag";

const read = (p: string) => readFileSync(p, "utf8");
const flat = (s: string) => s.replace(/\s+/g, " ");
const phone = flat(read("src/components/service/board-phone.tsx"));

const WEEK = [
  "2026-11-16",
  "2026-11-17",
  "2026-11-18",
  "2026-11-19",
  "2026-11-20",
  "2026-11-21",
  "2026-11-22",
];
const TECH = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("the page is the week", () => {
  it("a card a day, with no row per technician", () => {
    expect(phone).toContain("{p.days.map((d, i) => dayCard(d, i))}");
    expect(phone).toContain("data-board-days");
    // The technician rows are gone, and so is their own fold of other people.
    expect(phone).not.toContain("data-row=");
    expect(phone).not.toContain("const row = (r: Row");
    expect(phone).not.toContain("showOthers");
  });
  it("a card lists every ticket of its day, whoever has it, with the name on the ticket", () => {
    expect(phone).toContain("const people = [...p.techRows, ...p.otherRows];");
    expect(phone).toContain(
      "people.flatMap((r) => p.cellJobs(r.id, d).map((job) => ({ job, who: r.name })));",
    );
    expect(phone).toMatch(/<PhoneChip key=\{j\.id\} job=\{j\} who=\{who\}/);
    expect(phone).toMatch(/\{props\.who && \( <span[^>]*data-chip-who/);
  });
  it("a card says its day in full and how many tickets it has", () => {
    expect(phone).toContain(
      '<span className="text-lg font-semibold leading-tight">{dayTitle(d)}</span>',
    );
    expect(dayCountWords(0)).toBe("No tickets");
    expect(dayCountWords(1)).toBe("1 ticket");
    expect(dayCountWords(4)).toBe("4 tickets");
  });
  it("a tap chooses the day, and a card is a day target for a dispatcher only", () => {
    expect(phone).toMatch(/role="tab" aria-selected=\{on\} onClick=\{\(\) => setDayIdx\(i\)\}/);
    expect(phone).toContain('data-day-card={on ? "chosen" : "day"}');
    expect(phone).toContain("data-drop={p.dispatch ? dayKey(d) : undefined}");
    // The + starts a ticket on that day, for whoever it is given to later.
    expect(phone).toContain("search={{ new: 1, date: d }}");
  });
  it("says how in a line", () => {
    expect(PHONE_BOARD_HINT).toContain("the technicians come up");
  });
});

describe("the technicians come up for any held ticket", () => {
  it("from the tray or from a day", () => {
    expect(dockFor({ technician_id: null, scheduled_date: null })).toBe(true);
    expect(dockFor({ technician_id: TECH, scheduled_date: WEEK[1]! })).toBe(true);
    expect(dockFor(null)).toBe(false);
    expect(phone).toContain(
      "const showDock = p.dispatch && p.techRows.length > 0 && dockFor(dragged);",
    );
  });
  it("a ticket let go where it lifted is still put back, so the block opening under a finger drops nothing", () => {
    expect(carried(100, 400, 100, 400)).toBe(false);
    expect(carried(100, 400, 103, 402)).toBe(false);
    expect(carried(100, 400, 100, 460)).toBe(true);
  });
  it("a ticket that is on a day of this week is held for its own day", () => {
    expect(liftDayIndex({ scheduled_date: "2026-11-18" }, WEEK)).toBe(2);
    // One from another week, or with no day: the chosen day stays.
    expect(liftDayIndex({ scheduled_date: "2026-11-25" }, WEEK)).toBe(-1);
    expect(liftDayIndex({ scheduled_date: null }, WEEK)).toBe(-1);
    expect(liftDayIndex(undefined, WEEK)).toBe(-1);
    expect(phone).toMatch(
      /const own = liftDayIndex\( p\.jobs\.find\(\(j\) => j\.id === id\), p\.days, \); if \(own >= 0\) setDayIdx\(own\);/,
    );
  });
  it("the days are in the block too, under the finger", () => {
    expect(phone).toMatch(/data-dock-days[\s\S]{0,200}data-drop=\{dayKey\(d\)\}/);
    expect(phone).toContain("data-dock-day={d}");
    // The same key as a day card, so the same rules: rest on it and the day is chosen, let go
    // on it and only the day changes.
    expect(isDayKey(dayKey(WEEK[5]!))).toBe(true);
    expect(phone).toContain("dwells: isDayKey,");
    const held = { stage: "scheduled", technician_id: TECH, scheduled_date: WEEK[0]! };
    expect(planDrop(held, parseDropKey(dayKey(WEEK[5]!)))).toEqual({
      technician_id: TECH,
      scheduled_date: WEEK[5],
    });
    // An unassigned ticket only gets the day.
    expect(
      planDrop(
        { stage: "open", technician_id: null, scheduled_date: null },
        parseDropKey(dayKey(WEEK[2]!)),
      ),
    ).toEqual({ technician_id: null, scheduled_date: WEEK[2] });
  });
  it("the block's height counts the row of days, so nobody is cut off", () => {
    expect(DOCK_HEAD_PX).toBe(44 + DOCK_DAYS_PX);
    expect(dockHeight(8, 2)).toBe(DOCK_HEAD_PX + 4 * DOCK_ROW_PX + 3 * DOCK_GAP_PX);
    // Two across while they fit the room, three when they do not.
    expect(dockColumns(8, dockHeight(8, 2))).toBe(2);
    expect(dockColumns(8, dockHeight(8, 2) - 1)).toBe(3);
  });
  it("the tray stays solid under a held ticket: only its edge lights", () => {
    expect(phone).toContain(
      'p.over === RAIL_KEY ? "bg-card ring-2 ring-inset ring-primary" : "bg-card"',
    );
  });
  it("the two week targets still show while a ticket that can move a week is held", () => {
    expect(phone).toMatch(/data-board-top[\s\S]{0,200}sticky top-\[var\(--jbk-top-gap,0px\)\]/);
    expect(phone).toContain("data-drop={PREV_WEEK_KEY}");
    expect(phone).toContain("data-drop={NEXT_WEEK_KEY}");
  });
});
