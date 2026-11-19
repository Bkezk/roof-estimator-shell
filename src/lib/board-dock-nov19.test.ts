/**
 * The technician dock on the phone Tech Board (owner, Nov 19: "assigning service to the tech via
 * the tech board on mobile isnt great think of ways to improve it to drag and drop assigning
 * better").
 *
 * What was wrong: about three technicians fit on a phone between the day buttons and the tray.
 * A ticket bound for anyone further down had to be held at the edge of the list until the page
 * crept to them. Now, while a ticket is held, every technician is a target in a block on the
 * tray's top edge, an inch or two from the finger. Each test here fails on the board before.
 *
 *  rules   lib/board-phone.ts (dockRoom, dockHeight, dockColumns, dockScroll, dockTitle, dockNote)
 *  screen  components/service/board-phone.tsx
 *  write   components/service/board-page.tsx movePhone: the board's own single write, unchanged
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { SLOP_PX, carried } from "./hold-drag";
import {
  DOCK_GAP_PX,
  DOCK_HEAD_PX,
  DOCK_ROW_PX,
  cellKey,
  dockColumns,
  dockFor,
  dockHeight,
  dockNote,
  dockRoom,
  dockScroll,
  dockTitle,
  parseDropKey,
  planDrop,
} from "./board-phone";

const flat = (s: string) => s.replace(/\s+/g, " ");
const phone = flat(readFileSync("src/components/service/board-phone.tsx", "utf8"));
const page = flat(readFileSync("src/components/service/board-page.tsx", "utf8"));
const hook = flat(readFileSync("src/hooks/use-hold-drag.ts", "utf8"));

const TECH = "d6ae5586-a27e-4146-89cd-d8f5242e7828";
const OTHER = "42f66d51-de7e-4a22-a2c3-4fac91d40f54";
const DAY = "2026-11-19";

describe("a dock target is a technician's day, like any row", () => {
  const drop = (job: Parameters<typeof planDrop>[0]) =>
    planDrop(job, parseDropKey(cellKey(TECH, DAY)));
  it("an unassigned ticket with no day gets that technician and the day on the board", () => {
    expect(drop({ stage: "open", technician_id: null, scheduled_date: null })).toEqual({
      technician_id: TECH,
      scheduled_date: DAY,
    });
  });
  it("a ticket that has a technician but no day goes to this one, that day", () => {
    expect(drop({ stage: "open", technician_id: OTHER, scheduled_date: null })).toEqual({
      technician_id: TECH,
      scheduled_date: DAY,
    });
  });
  it("a key is a key: a ticket another technician has would go to this one, the same single write", () => {
    expect(drop({ stage: "scheduled", technician_id: OTHER, scheduled_date: DAY })).toEqual({
      technician_id: TECH,
      scheduled_date: DAY,
    });
  });
  it("on the technician who has it that day, nothing changes and nothing is written", () => {
    expect(drop({ stage: "scheduled", technician_id: TECH, scheduled_date: DAY })).toBeNull();
  });
  it("a ticket that is Done or later does not move from the dock either", () => {
    expect(drop({ stage: "done", technician_id: OTHER, scheduled_date: DAY })).toBeNull();
  });
  it("the dock's own key is empty: a finger let go between two technicians drops on nothing", () => {
    expect(parseDropKey("")).toBeNull();
    expect(planDrop({ stage: "open", technician_id: null, scheduled_date: null }, null)).toBeNull();
    // The hook reads an empty key as no target, and the dock stops the search for one at itself,
    // so the tray under it (which unassigns) is never the answer.
    expect(hook).toContain('closest("[data-drop]")');
    expect(hook).toContain('hit?.getAttribute("data-drop") || null');
    expect(phone).toMatch(/data-board-dock data-drop=""/);
  });
});

describe("which ticket gets the dock", () => {
  it("one lifted from the Unassigned tray: no technician, or no day yet", () => {
    expect(dockFor({ technician_id: null, scheduled_date: null })).toBe(true);
    expect(dockFor({ technician_id: null, scheduled_date: DAY })).toBe(true);
    expect(dockFor({ technician_id: OTHER, scheduled_date: null })).toBe(true);
  });
  it("not one lifted from a technician's row: the dock would open under the finger", () => {
    // Let go without moving, and it would land on whoever's name came up there.
    expect(dockFor({ technician_id: OTHER, scheduled_date: DAY })).toBe(false);
    expect(dockFor(null)).toBe(false);
    expect(dockFor(undefined)).toBe(false);
  });
});

describe("every technician fits on the screen", () => {
  it("the room is from the day buttons down to the tray", () => {
    expect(dockRoom(713, 338)).toBe(375);
    expect(dockRoom(300, 420)).toBe(0);
  });
  it("the height: a line of words, then rows a thumb can hit", () => {
    expect(DOCK_ROW_PX).toBeGreaterThanOrEqual(44);
    expect(dockHeight(8, 2)).toBe(DOCK_HEAD_PX + 4 * DOCK_ROW_PX + 3 * DOCK_GAP_PX);
    expect(dockHeight(8, 3)).toBe(DOCK_HEAD_PX + 3 * DOCK_ROW_PX + 2 * DOCK_GAP_PX);
    expect(dockHeight(1, 2)).toBe(DOCK_HEAD_PX + DOCK_ROW_PX);
    expect(dockHeight(0, 2)).toBe(DOCK_HEAD_PX);
  });
  it("two across while that fits, so a name reads whole; three when it does not", () => {
    expect(dockColumns(8, 375)).toBe(2);
    expect(dockColumns(8, dockHeight(8, 2))).toBe(2);
    expect(dockColumns(8, dockHeight(8, 2) - 1)).toBe(3);
    expect(dockColumns(20, 375)).toBe(3);
  });
  it("on a short phone the page scrolls its own heading away to make the room, and no further", () => {
    // Needs 254, has 149: 105 more. The day buttons can rise 200, the page can scroll 900.
    expect(dockScroll(254, 149, 200, 900)).toBe(105);
    // Only as far as the day buttons can rise, and as the page can scroll.
    expect(dockScroll(254, 149, 60, 900)).toBe(60);
    expect(dockScroll(254, 149, 200, 40)).toBe(40);
    // Enough room already: the page stays where it is.
    expect(dockScroll(254, 375, 200, 900)).toBe(0);
    expect(dockScroll(254, 149, 0, 900)).toBe(0);
    expect(dockScroll(254, 149, -12, 900)).toBe(0);
  });
});

describe("the words", () => {
  it("says what to do and for which day", () => {
    expect(dockTitle("2026-11-19")).toBe("Drop on a technician · Thu, Nov 19");
  });
  it("under each name: who has it now, else how loaded that technician's day is", () => {
    expect(dockNote(2, true)).toBe("has it now");
    expect(dockNote(0, false)).toBe("free");
    expect(dockNote(1, false)).toBe("1 ticket");
    expect(dockNote(3, false)).toBe("3 tickets");
  });
});

describe("the screen", () => {
  it("the dock shows only while a dispatcher holds a ticket, and hangs on the tray's top edge", () => {
    expect(phone).toContain(
      "const showDock = p.dispatch && p.techRows.length > 0 && dockFor(dragged);",
    );
    expect(phone).toContain("{showDock && dockSpace !== null && (");
    // Inside the tray, above its first line: no measuring of where it goes.
    const tray = phone.slice(phone.indexOf("data-board-tray"));
    expect(tray.indexOf("data-board-dock")).toBeGreaterThan(0);
    expect(tray.indexOf("data-board-dock")).toBeLessThan(tray.indexOf("data-tray-count"));
    expect(phone).toMatch(/className="absolute inset-x-0 bottom-full mb-0 /);
  });
  it("each target carries the technician's key for the day on the board, and lights under the finger", () => {
    const dock = phone.slice(phone.indexOf("data-board-dock"), phone.indexOf("data-tray-count"));
    expect(dock).toContain("const key = cellKey(r.id, day);");
    expect(dock).toContain("data-drop={key}");
    expect(dock).toContain("p.over === key ? overClass");
    expect(dock).toContain("h-[48px]");
    expect(dock).toContain("dockNote(p.cellJobs(r.id, day).length, hasIt)");
    // Two or three across, by the room.
    expect(dock).toContain(
      'dockColumns(p.techRows.length, dockSpace) === 3 ? "grid-cols-3" : "grid-cols-2"',
    );
  });
  it("the page does not creep under a finger on the dock", () => {
    expect(phone).toContain(
      "bottomEdge: () => (dock.current ?? tray.current)?.getBoundingClientRect().top ?? window.innerHeight,",
    );
  });
  it("the room is measured before the screen is drawn, after making it on a short phone", () => {
    expect(phone).toContain("useLayoutEffect(() => {");
    expect(phone).toContain(
      "const by = dockScroll(dockHeight(p.techRows.length, 2), room, slack, left);",
    );
    expect(phone).toMatch(/if \(by > 0\) \{ window\.scrollBy\(0, by\); room = measure\(\); \}/);
  });
  it("a drop on the dock takes the same road as every other drop: one plan, the board's own write", () => {
    expect(phone).toContain("const plan = job ? planDrop(job, parseDropKey(key)) : null;");
    expect(phone).toContain("if (job && plan) p.onMove(job, plan);");
    expect(phone).not.toMatch(/import[^;]*assignServiceJob/);
    expect(phone).not.toContain("useMutation");
    // The board's write: the same server function the desk grid calls, with its rules and notices.
    expect(page).toContain("onMove={movePhone}");
    expect(
      /const movePhone = [\s\S]{0,400}?assign\.mutate\(\{ job, technician_id: plan\.technician_id,/.test(
        page,
      ),
    ).toBe(true);
    expect(page).toContain(
      "assignFn({ data: { id: a.job.id, technician_id: a.technician_id, scheduled_date: a.scheduled_date }, })",
    );
    expect(page).toContain("const assignFn = useServerFn(assignServiceJob);");
  });
  it("everything that worked before is still there: the rows, the day buttons, the tray, the details pop-up", () => {
    expect(phone).toContain("data-drop={p.dispatch ? key : undefined}");
    expect(phone).toContain("data-drop={p.dispatch ? dayKey(d) : undefined}");
    expect(phone).toContain("data-drop={p.dispatch ? RAIL_KEY : undefined}");
    expect(phone).toContain('data-peek="move-button"');
  });
});

describe("a ticket let go where it lifted is put back", () => {
  it("the finger has to carry it past the slop for the drop to count", () => {
    expect(carried(100, 600, 100, 600)).toBe(false);
    expect(carried(100, 600, 104, 606)).toBe(false);
    expect(carried(100, 600, 100, 600 - SLOP_PX)).toBe(false);
    expect(carried(100, 600, 100, 600 - SLOP_PX - 1)).toBe(true);
    expect(carried(100, 600, 180, 420)).toBe(true);
  });
  it("the hook asks before it drops: the open tray folds and the dock opens under a still finger", () => {
    // Before: lifting a ticket out of the open tray and letting go without moving dropped it on
    // whichever technician's row the folding tray uncovered under the finger.
    expect(hook).toContain("liftAt = { x: state.x, y: state.y };");
    expect(hook).toContain(
      "finish(drop && !!liftAt && carried(liftAt.x, liftAt.y, state.x, state.y));",
    );
    // Still not a tap: the details pop-up does not open on a put-back.
    expect(hook).toContain("if (drop && ev.cancelable) ev.preventDefault();");
  });
});
