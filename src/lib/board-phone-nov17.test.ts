/**
 * The Tech Board on a phone (owner, Nov 17): "specifcally the tech board and service tickets need
 * to be optimized for mobile, it needs to be easy to drag and move tickets onto the tech board
 * and click tickets to see their details".
 *
 * Until then a phone got the desk's week grid squeezed in (a day and a half on the screen), its
 * drag and drop was the mouse's, so a finger could not move a ticket at all, and a tap left the
 * board for the whole ticket page. The owner chose from two drawings: one day at a time, and a
 * details pop-up on a tap; the ticket page and the Tickets list stay as they are for now.
 *
 * These pin the rules (what a drop does, when a held finger is a drag and when it is a scroll,
 * the words) and that the screen is wired to them. The gestures themselves were run in a browser
 * with real touch events; that run is in docs/qa/tech-board-phone-2026-11-17.md.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  NEXT_WEEK_KEY,
  PHONE_BOARD_HINT,
  PHONE_BOARD_QUERY,
  PREV_WEEK_KEY,
  RAIL_KEY,
  cellKey,
  dayCounts,
  dayKey,
  dayNumber,
  dayShort,
  dayTitle,
  isDayKey,
  mapsUrl,
  movableOnBoard,
  moveSummary,
  parseDropKey,
  peekAddressLines,
  peekMapQuery,
  peekPhone,
  planDrop,
  startDayIndex,
} from "@/lib/board-phone";
import {
  DWELL_MS,
  EDGE_PX,
  EDGE_WAIT_MS,
  HOLD_MS,
  IDLE,
  SCROLL_MAX,
  SLOP_PX,
  edgeScroll,
  edgeScrollAfterWait,
  lift,
  move,
  press,
  release,
} from "@/lib/hold-drag";
import { assignedStage } from "@/lib/service-schedule";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const page = read("../components/service/board-page.tsx");
const phone = read("../components/service/board-phone.tsx");
const hook = read("../hooks/use-hold-drag.ts");
const peekFn = read("./board-peek.functions.ts");

const TECH_A = "11111111-1111-4111-8111-111111111111";
const TECH_B = "22222222-2222-4222-8222-222222222222";
const WEEK = [
  "2026-11-16",
  "2026-11-17",
  "2026-11-18",
  "2026-11-19",
  "2026-11-20",
  "2026-11-21",
  "2026-11-22",
];
const job = (
  over: Partial<{ stage: string; technician_id: string | null; scheduled_date: string | null }>,
) => ({
  stage: "scheduled",
  technician_id: TECH_A as string | null,
  scheduled_date: "2026-11-16" as string | null,
  ...over,
});

describe("which screens get the phone board", () => {
  it("anything narrower than a tablet, and a touch screen up to a tablet held upright", () => {
    expect(PHONE_BOARD_QUERY).toBe("(max-width: 767px), (pointer: coarse) and (max-width: 1023px)");
  });
  it("the page draws the phone board there and keeps the week grid everywhere else", () => {
    expect(page).toContain("const phone = usePhoneBoard();");
    expect(page).toMatch(/\) : phone \? \(\s*<PhoneBoard/);
    // The desk's grid and its mouse drag are still there.
    expect(page).toContain('role="grid"');
    expect(page).toContain("draggable={canDrag}");
    // And the page waits for the browser's answer rather than flashing the desk grid on a phone.
    expect(page).toContain("loading || phone === undefined");
  });
});

describe("what a drop does", () => {
  it("reads each target's key", () => {
    expect(parseDropKey(cellKey(TECH_B, "2026-11-18"))).toEqual({
      kind: "cell",
      techId: TECH_B,
      ymd: "2026-11-18",
    });
    expect(parseDropKey(RAIL_KEY)).toEqual({ kind: "rail" });
    expect(parseDropKey(dayKey("2026-11-19"))).toEqual({ kind: "day", ymd: "2026-11-19" });
    expect(parseDropKey(PREV_WEEK_KEY)).toEqual({ kind: "week", weeks: -1 });
    expect(parseDropKey(NEXT_WEEK_KEY)).toEqual({ kind: "week", weeks: 1 });
  });
  it("a finger let go over nothing, or over something that is not a target, is no target", () => {
    for (const k of [
      null,
      undefined,
      "",
      "nonsense",
      "day:tomorrow",
      `${TECH_A}|soon`,
      "|2026-11-18",
    ])
      expect(parseDropKey(k)).toBeNull();
    expect(isDayKey(dayKey("2026-11-19"))).toBe(true);
    expect(isDayKey(cellKey(TECH_A, "2026-11-19"))).toBe(false);
    expect(isDayKey(null)).toBe(false);
  });
  it("a technician's day: that technician, that day", () => {
    expect(planDrop(job({}), parseDropKey(cellKey(TECH_B, "2026-11-18")))).toEqual({
      technician_id: TECH_B,
      scheduled_date: "2026-11-18",
    });
    // Out of the tray, with nothing set yet.
    expect(
      planDrop(
        job({ stage: "open", technician_id: null, scheduled_date: null }),
        parseDropKey(cellKey(TECH_A, "2026-11-20")),
      ),
    ).toEqual({ technician_id: TECH_A, scheduled_date: "2026-11-20" });
  });
  it("the tray: no technician, the day kept", () => {
    expect(planDrop(job({}), { kind: "rail" })).toEqual({
      technician_id: null,
      scheduled_date: "2026-11-16",
    });
  });
  it("a day button: that day, the technician kept; an unassigned ticket only gets the day", () => {
    expect(planDrop(job({}), { kind: "day", ymd: "2026-11-19" })).toEqual({
      technician_id: TECH_A,
      scheduled_date: "2026-11-19",
    });
    expect(
      planDrop(job({ stage: "open", technician_id: null }), { kind: "day", ymd: "2026-11-19" }),
    ).toEqual({ technician_id: null, scheduled_date: "2026-11-19" });
  });
  it("a week earlier or later: the same technician and weekday, across a month end too", () => {
    expect(planDrop(job({}), { kind: "week", weeks: 1 })).toEqual({
      technician_id: TECH_A,
      scheduled_date: "2026-11-23",
    });
    expect(planDrop(job({ scheduled_date: "2026-11-02" }), { kind: "week", weeks: -1 })).toEqual({
      technician_id: TECH_A,
      scheduled_date: "2026-10-26",
    });
    // Only a ticket that is on the grid can move a week.
    expect(planDrop(job({ technician_id: null }), { kind: "week", weeks: 1 })).toBeNull();
    expect(planDrop(job({ scheduled_date: null }), { kind: "week", weeks: 1 })).toBeNull();
  });
  it("a drop that changes nothing writes nothing", () => {
    expect(planDrop(job({}), parseDropKey(cellKey(TECH_A, "2026-11-16")))).toBeNull();
    expect(planDrop(job({}), { kind: "day", ymd: "2026-11-16" })).toBeNull();
    expect(planDrop(job({ technician_id: null }), { kind: "rail" })).toBeNull();
    expect(planDrop(job({}), null)).toBeNull();
  });
  it("only Open and Scheduled tickets move, as on the desk and on the server", () => {
    for (const stage of ["done", "authorized", "invoiced", "closed"]) {
      expect(movableOnBoard({ stage })).toBe(false);
      expect(planDrop(job({ stage }), parseDropKey(cellKey(TECH_B, "2026-11-18")))).toBeNull();
    }
    expect(movableOnBoard({ stage: "open" })).toBe(true);
    expect(movableOnBoard({ stage: "scheduled" })).toBe(true);
  });
  it("every plan is one the server's own stage rule accepts", () => {
    // Out of the tray onto a technician's day: Scheduled. Back onto the tray: Open.
    const out = planDrop(job({ stage: "open", technician_id: null }), {
      kind: "cell",
      techId: TECH_A,
      ymd: "2026-11-18",
    })!;
    expect(assignedStage("open", out.technician_id, out.scheduled_date)).toBe("scheduled");
    const back = planDrop(job({}), { kind: "rail" })!;
    expect(assignedStage("scheduled", back.technician_id, back.scheduled_date)).toBe("open");
  });
  it("the phone's move is the board's own single write", () => {
    expect(page).toContain("const movePhone = (job: ServiceJobWithTech, plan: MovePlan) =>");
    expect(page).toContain("onMove={movePhone}");
    expect(page).toMatch(/movePhone[\s\S]*?assign\.mutate\(\{[\s\S]*?say: moveSummary\(/);
    // Nothing on the phone board writes on its own.
    expect(phone).not.toMatch(/import[^;]*assignServiceJob/);
    expect(phone).not.toContain("useMutation");
  });
});

describe("hold, then drag", () => {
  it("a finger that holds still lifts the ticket; the page then stops scrolling", () => {
    let s = press(100, 300);
    expect(s.phase).toBe("pressing");
    // A wobble inside the slop is still a hold.
    const wobble = move(s, 100 + SLOP_PX - 2, 300);
    expect(wobble).toMatchObject({ cancel: false, prevent: false });
    s = lift(wobble.state);
    expect(s.phase).toBe("dragging");
    const dragged = move(s, 120, 180);
    expect(dragged).toMatchObject({ cancel: false, prevent: true });
    expect(dragged.state).toMatchObject({ x: 120, y: 180, phase: "dragging" });
    expect(release(dragged.state)).toEqual({ drop: true, tap: false });
  });
  it("a finger that moves first is a scroll: nothing lifts, nothing is blocked", () => {
    const s = press(100, 300);
    const swipe = move(s, 100, 300 - SLOP_PX - 1);
    expect(swipe).toEqual({ state: IDLE, cancel: true, prevent: false });
    // The hold time passing afterwards lifts nothing.
    expect(lift(swipe.state).phase).toBe("idle");
    expect(release(swipe.state)).toEqual({ drop: false, tap: false });
  });
  it("a finger that lifts before the hold time is a tap", () => {
    expect(release(press(10, 10))).toEqual({ drop: false, tap: true });
  });
  it("the times and distances are a thumb's", () => {
    expect(HOLD_MS).toBeGreaterThanOrEqual(250);
    expect(HOLD_MS).toBeLessThanOrEqual(450);
    expect(SLOP_PX).toBeGreaterThanOrEqual(8);
    expect(DWELL_MS).toBeGreaterThan(HOLD_MS);
  });
  it("near the top or bottom of the list the page scrolls, faster the deeper in", () => {
    const top = 80;
    const bottom = 580;
    expect(edgeScroll(300, top, bottom)).toBe(0);
    expect(edgeScroll(top + 10, top, bottom)).toBeLessThan(0);
    expect(edgeScroll(bottom - 10, top, bottom)).toBeGreaterThan(0);
    expect(Math.abs(edgeScroll(top + 5, top, bottom))).toBeGreaterThan(
      Math.abs(edgeScroll(top + EDGE_PX - 5, top, bottom)),
    );
    expect(edgeScroll(bottom - 1, top, bottom)).toBeLessThanOrEqual(SCROLL_MAX);
    // Over the day buttons or the tray (outside the list) nothing scrolls: they are targets.
    expect(edgeScroll(top - 20, top, bottom)).toBe(0);
    expect(edgeScroll(bottom + 20, top, bottom)).toBe(0);
    // A list too short to have a middle does not scroll at all.
    expect(edgeScroll(100, 80, 80 + EDGE_PX)).toBe(0);
  });
  it("the scroll waits a moment, so a ticket carried across the band does not drag the list", () => {
    const first = edgeScrollAfterWait(90, 80, 580, null, 1000);
    expect(first).toEqual({ by: 0, since: 1000 });
    expect(edgeScrollAfterWait(90, 80, 580, first.since, 1000 + EDGE_WAIT_MS - 1).by).toBe(0);
    expect(edgeScrollAfterWait(90, 80, 580, first.since, 1000 + EDGE_WAIT_MS).by).toBeLessThan(0);
    // Leaving the band forgets the wait.
    expect(edgeScrollAfterWait(300, 80, 580, first.since, 2000)).toEqual({ by: 0, since: null });
  });
  it("the wiring a touch screen needs", () => {
    // The move and end listeners sit on the ticket itself: it may leave the page mid-drag (the
    // board switched day), and only it still hears its finger.
    expect(hook).toContain('el.addEventListener("touchmove", onMove, { passive: false });');
    expect(hook).toContain('el.addEventListener("touchend", onEnd);');
    expect(hook).toContain('el.addEventListener("touchcancel", onCancel);');
    // iPhones: a cancelling move listener must exist before the finger goes down.
    expect(hook).toContain('window.addEventListener("touchmove", noop, { passive: false });');
    // A drop is not also a tap.
    expect(hook).toMatch(/if \(drop && ev\.cancelable\) ev\.preventDefault\(\);/);
    // A cancelled touch drops nothing.
    expect(hook).toContain("const onCancel = () => finish(false);");
    // Targets are found under the finger by their key.
    expect(hook).toContain('closest("[data-drop]")');
  });
  it("the phone's tickets are not the browser's own draggables (an iPhone would fight the finger)", () => {
    expect(phone).not.toContain("draggable");
    expect(phone).toContain("[-webkit-touch-callout:none]");
    expect(phone).toContain("select-none");
    expect(phone).toContain("onContextMenu={(e) => e.preventDefault()}");
  });
});

describe("the phone board's screen", () => {
  it("every target carries its key, for a dispatcher only", () => {
    expect(phone).toContain("data-drop={p.dispatch ? key : undefined}");
    expect(phone).toContain("data-drop={p.dispatch ? dayKey(d) : undefined}");
    expect(phone).toContain("data-drop={p.dispatch ? RAIL_KEY : undefined}");
    expect(phone).toContain("data-drop={PREV_WEEK_KEY}");
    expect(phone).toContain("data-drop={NEXT_WEEK_KEY}");
    // And a ticket only lifts for someone who may move it, and only while it can move.
    expect(phone).toContain("const canDrag = props.drag && movableOnBoard(j);");
    expect(phone).toContain("{...(canDrag ? props.bind(j.id) : {})}");
  });
  it("the day buttons stay at the top and the tray at the bottom", () => {
    expect(phone).toMatch(/data-board-top[\s\S]{0,200}sticky top-\[var\(--jbk-top-gap,0px\)\]/);
    expect(phone).toMatch(/data-board-tray[\s\S]{0,300}sticky bottom-0/);
    expect(phone).toContain("env(safe-area-inset-bottom)");
  });
  it("a ticket resting on a day button switches the board to that day", () => {
    expect(phone).toContain("dwells: isDayKey,");
    expect(phone).toMatch(/onDwell: \(key\) => \{[\s\S]*?setDayIdx\(i\);/);
  });
  it("the week targets show only while a ticket that can move a week is held", () => {
    expect(phone).toContain(
      "const weekTargets = p.dispatch && !!dragged?.technician_id && !!dragged.scheduled_date;",
    );
    expect(phone).toContain("A week earlier");
    expect(phone).toContain("A week later");
  });
  it("a thumb's targets are 44 real pixels, and typing boxes do not make an iPhone zoom", () => {
    for (const cls of ["h-[44px] w-[44px]", "min-h-[60px]", "min-h-[52px]", "min-h-[44px]"])
      expect(phone).toContain(cls);
    expect(phone).toContain('const PEEK_BUTTON = "h-[46px] text-[15px]";');
    expect(phone.match(/text-\[16px\]/g)?.length).toBeGreaterThanOrEqual(3);
    expect(page).toContain('phone ? "h-[44px] px-3"');
  });
  it("says how in a line", () => {
    expect(PHONE_BOARD_HINT).toBe(
      "Hold a ticket, then drag it onto a technician. Tap a ticket for its details.",
    );
    expect(page).toContain("PHONE_BOARD_HINT");
  });
});

describe("the day strip", () => {
  const t = (over: object) => ({
    technician_id: TECH_A as string | null,
    stage: "scheduled",
    scheduled_date: "2026-11-17" as string | null,
    completed_at: null as string | null,
    ...over,
  });
  it("counts the tickets on each day, where the board files them", () => {
    const counts = dayCounts(
      [
        t({}),
        t({ technician_id: TECH_B }),
        t({ scheduled_date: "2026-11-20" }),
        // Unassigned: in the tray, on no day.
        t({ technician_id: null }),
        // Another week.
        t({ scheduled_date: "2026-11-30" }),
        // Finished: on the day it was completed, not the day it was due.
        t({ stage: "done", scheduled_date: "2026-11-22", completed_at: "2026-11-18T15:00:00" }),
      ],
      WEEK,
    );
    expect(counts).toEqual([0, 2, 1, 0, 1, 0, 0]);
  });
  it("opens on today in today's week, on Monday in another, and on the day last looked at", () => {
    expect(startDayIndex(WEEK, "2026-11-17")).toBe(1);
    expect(startDayIndex(WEEK, "2026-12-01")).toBe(0);
    expect(startDayIndex(WEEK, "2026-11-17", "2026-11-20")).toBe(4);
    // A remembered day from another week is ignored.
    expect(startDayIndex(WEEK, "2026-11-17", "2026-10-01")).toBe(1);
    expect(startDayIndex(WEEK, "2026-11-17", null)).toBe(1);
  });
  it("names a day without a time zone", () => {
    expect(dayTitle("2026-11-17")).toBe("Tuesday, Nov 17");
    expect(dayShort("2026-11-17")).toBe("Tue, Nov 17");
    expect(dayShort("2027-01-03")).toBe("Sun, Jan 3");
    expect(dayNumber("2026-11-07")).toBe(7);
  });
});

describe("the words after a move", () => {
  it("says who and when", () => {
    expect(
      moveSummary(6071, "Garry Peters", { technician_id: TECH_A, scheduled_date: "2026-11-17" }),
    ).toBe("Ticket #6071: Garry Peters, Tue, Nov 17.");
    expect(moveSummary(6071, null, { technician_id: null, scheduled_date: "2026-11-17" })).toBe(
      "Ticket #6071 is unassigned, still set for Tue, Nov 17.",
    );
    expect(moveSummary(6071, null, { technician_id: null, scheduled_date: null })).toBe(
      "Ticket #6071 is unassigned.",
    );
    expect(moveSummary(6071, null, { technician_id: TECH_A, scheduled_date: null })).toBe(
      "Ticket #6071: a technician, no day yet.",
    );
  });
  it("is said only once the move is saved", () => {
    expect(page).toMatch(
      /onSuccess: \(row, a\) => \{[\s\S]*?if \(a\.say\) toast\.success\(a\.say\);/,
    );
  });
});

describe("the details pop-up", () => {
  const place = {
    customer_name: "Acme Stores",
    site_name: "Acme North",
    site_address: "12 Main St",
    site_city: "Corbin",
    site_state: "KY",
  };
  it("gives the address as lines, without saying the city twice", () => {
    expect(peekAddressLines(place)).toEqual(["12 Main St", "Corbin, KY"]);
    expect(peekAddressLines({ ...place, site_address: "12 Main St, Corbin, KY 40701" })).toEqual([
      "12 Main St, Corbin, KY 40701",
    ]);
    expect(peekAddressLines({ ...place, site_address: null })).toEqual(["Corbin, KY"]);
    expect(
      peekAddressLines({ ...place, site_address: " ", site_city: null, site_state: null }),
    ).toEqual([]);
  });
  it("Directions goes to the address, else to the property by name, else it is not offered", () => {
    expect(peekMapQuery(place)).toBe("12 Main St, Corbin, KY");
    expect(peekMapQuery({ ...place, site_address: null, site_city: null, site_state: null })).toBe(
      "Acme North, Acme Stores",
    );
    expect(
      peekMapQuery({
        customer_name: "",
        site_name: null,
        site_address: null,
        site_city: null,
        site_state: null,
      }),
    ).toBeNull();
    expect(mapsUrl("12 Main St, Corbin, KY")).toBe(
      "https://maps.google.com/?q=12%20Main%20St%2C%20Corbin%2C%20KY",
    );
  });
  it("Call dials the property contact, else the customer; with neither it is not offered", () => {
    expect(peekPhone({ contact_phone: "606-555-0100", account_phone: "606-555-0199" })).toBe(
      "606-555-0100",
    );
    expect(peekPhone({ contact_phone: " ", account_phone: "606-555-0199" })).toBe("606-555-0199");
    expect(peekPhone({ contact_phone: null, account_phone: null })).toBeNull();
  });
  it("a tap opens it over the board; the board's address does not change", () => {
    expect(phone).toContain("onClick={() => props.onOpen(j.id)}");
    expect(phone).toContain('<SheetContent\n        side="bottom"');
    // The ticket itself is a button now, not a link that leaves the board.
    expect(phone).toMatch(/<button\s+type="button"\s+data-chip=\{j\.id\}/);
  });
  it("has the four things to do, each only when it can be done", () => {
    // Open ticket returns to this week's board on Back.
    expect(phone).toContain('search={{ id: j.id, from: "board", week: props.week }}');
    expect(phone).toContain("const canMove = props.dispatch && movableOnBoard(j);");
    expect(phone).toMatch(/\{canMove && \(\s*<Button[\s\S]*?data-peek="move-button"/);
    expect(phone).toMatch(/\{phone && \(\s*<Button[\s\S]*?href=\{`tel:\$\{phone\}`\}/);
    expect(phone).toMatch(/\{mapQuery && \(\s*<Button[\s\S]*?href=\{mapsUrl\(mapQuery\)\}/);
  });
  it("Move saves only a real change with a day, through the same write as a drag", () => {
    expect(phone).toContain("disabled={!changed || !date}");
    expect(phone).toContain(
      "props.onMove(j, { technician_id: tech || null, scheduled_date: date || null });",
    );
  });
  it("reads the special instructions and who to call with the viewer's own sign-in", () => {
    expect(peekFn).toContain(".middleware([requireSupabaseAuth])");
    expect(peekFn).toContain('canAccess(p, "service") || canAccess(p, "customers")');
    expect(peekFn).toContain('.select("notes, contact_id, account_id")');
    expect(peekFn).toContain("context.supabase");
    // No money, and no service-role client.
    expect(peekFn).not.toMatch(/rate|price|cost|amount|total/i);
    expect(peekFn).not.toMatch(/service_role|supabaseAdmin|admin\./);
    expect(phone).toContain('<span className="font-semibold">Special instructions: </span>');
  });
  it("a failed read says so in plain words and still leaves Open ticket", () => {
    expect(phone).toContain("Could not load the special instructions and contact (");
    expect(phone).toContain("Open\n            the ticket to see them.");
  });
});
