/**
 * Owner, Nov 20: "im still not thrilled with the tech board on mobile it seems difficult to
 * reassign or move tickets when theyre already on the board, i really need that to be a user
 * friendly as possible."
 *
 * What a phone made of it before: hold the ticket for a third of a second, wait for a block of
 * technicians that covers two thirds of the screen, and carry it there under a finger that hides
 * the target; or tap it, press Move, open a drop-down list, pick, and Save. Now a tap opens the
 * ticket with the days and the technicians as buttons, already open, the ticket's own marked:
 * tap where it goes, then the one button in the bar at the bottom, which says what it will do.
 * A dragged ticket says the same words above the finger.
 *
 *   - moveWords: what a move will do, for the button and the dragged ticket;
 *   - weekDays / weekWords: the week the day buttons show, and the arrows to the next;
 *   - ghostCentre: the dragged ticket's words stay on the screen;
 *   - the screen: the choices are open at once, the bar never scrolls away, the same single
 *     write, nothing for a person who may not move tickets or a ticket that is Done.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  DRAG_NO_CHANGE,
  PHONE_BOARD_HINT,
  moveSummary,
  moveWords,
  moveWordsLine,
  parseDropKey,
  planDrop,
  weekDays,
  weekWords,
} from "@/lib/board-phone";
import { HOLD_MS, SLOP_PX, ghostCentre } from "@/lib/hold-drag";

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(here, rel), "utf8");
const flat = (s: string) => s.replace(/\s+/g, " ");
const phone = read("../components/service/board-phone.tsx");
const hook = read("../hooks/use-hold-drag.ts");
const page = read("../components/service/board-page.tsx");

const GARRY = "11111111-1111-4111-8111-111111111111";
const TYLER = "22222222-2222-4222-8222-222222222222";
const onGarry = { stage: "scheduled", technician_id: GARRY, scheduled_date: "2026-11-20" };
const inTray = { stage: "open", technician_id: null, scheduled_date: "2026-11-20" };

describe("what a move will do, in words", () => {
  it("another technician, the same day", () => {
    const w = moveWords(
      onGarry,
      { technician_id: TYLER, scheduled_date: "2026-11-20" },
      "Tyler Mitchell",
      "Garry Peters",
    );
    expect(w).toEqual({ main: "Give to Tyler Mitchell", sub: "Same day: Fri, Nov 20" });
    expect(moveWordsLine(w!)).toBe("Give to Tyler Mitchell. Same day: Fri, Nov 20.");
  });
  it("another day, the same technician", () => {
    expect(
      moveWords(
        onGarry,
        { technician_id: GARRY, scheduled_date: "2026-11-24" },
        "Garry Peters",
        "Garry Peters",
      ),
    ).toEqual({ main: "Move to Tue, Nov 24", sub: "Stays with Garry Peters" });
  });
  it("both at once", () => {
    expect(
      moveWords(
        onGarry,
        { technician_id: TYLER, scheduled_date: "2026-11-18" },
        "Tyler Mitchell",
        "Garry Peters",
      ),
    ).toEqual({ main: "Give to Tyler Mitchell", sub: "Moves to Wed, Nov 18" });
  });
  it("taken off its technician: it says it is unassigned and what day it keeps", () => {
    expect(
      moveWords(
        onGarry,
        { technician_id: null, scheduled_date: "2026-11-20" },
        null,
        "Garry Peters",
      ),
    ).toEqual({ main: "Take it off Garry Peters", sub: "Unassigned, still Fri, Nov 20" });
    expect(
      moveWords(
        onGarry,
        { technician_id: null, scheduled_date: "2026-11-23" },
        null,
        "Garry Peters",
      ),
    ).toEqual({ main: "Take it off Garry Peters", sub: "Unassigned, moves to Mon, Nov 23" });
  });
  it("from the tray: given to someone, or only given a day", () => {
    expect(
      moveWords(
        inTray,
        { technician_id: TYLER, scheduled_date: "2026-11-20" },
        "Tyler Mitchell",
        null,
      ),
    ).toEqual({ main: "Give to Tyler Mitchell", sub: "Same day: Fri, Nov 20" });
    expect(
      moveWords(inTray, { technician_id: null, scheduled_date: "2026-11-19" }, null, null),
    ).toEqual({ main: "Move to Thu, Nov 19", sub: "Nobody assigned yet" });
    // A ticket with no day yet says the day it gets, not that it "moves".
    expect(
      moveWords(
        { stage: "open", technician_id: null, scheduled_date: null },
        { technician_id: TYLER, scheduled_date: "2026-11-19" },
        "Tyler Mitchell",
        null,
      ),
    ).toEqual({ main: "Give to Tyler Mitchell", sub: "On Thu, Nov 19" });
  });
  it("nothing changed: no words, so there is nothing to save", () => {
    expect(
      moveWords(
        onGarry,
        { technician_id: GARRY, scheduled_date: "2026-11-20" },
        "Garry Peters",
        "Garry Peters",
      ),
    ).toBeNull();
  });
  it("a name that is not known is still a sentence", () => {
    expect(
      moveWords(onGarry, { technician_id: TYLER, scheduled_date: "2026-11-20" }, null, null)!.main,
    ).toBe("Give to this technician");
    expect(
      moveWords(onGarry, { technician_id: null, scheduled_date: "2026-11-20" }, null, null)!.main,
    ).toBe("Take it off its technician");
  });
  it("the words match what the same drop would write", () => {
    // A drag onto a technician's day and the pop-up's button describe one and the same write.
    const plan = planDrop(onGarry, parseDropKey(`${TYLER}|2026-11-18`))!;
    expect(plan).toEqual({ technician_id: TYLER, scheduled_date: "2026-11-18" });
    expect(moveWords(onGarry, plan, "Tyler Mitchell", "Garry Peters")!.sub).toBe(
      "Moves to Wed, Nov 18",
    );
    // What is said once it is saved is unchanged.
    expect(moveSummary(6071, "Tyler Mitchell", plan)).toBe(
      "Ticket #6071: Tyler Mitchell, Wed, Nov 18.",
    );
  });
});

describe("the week the day buttons show", () => {
  it("is Monday to Sunday around any day", () => {
    const week = [
      "2026-11-16",
      "2026-11-17",
      "2026-11-18",
      "2026-11-19",
      "2026-11-20",
      "2026-11-21",
      "2026-11-22",
    ];
    expect(weekDays("2026-11-20")).toEqual(week);
    expect(weekDays("2026-11-16")).toEqual(week);
    expect(weekDays("2026-11-22")).toEqual(week);
    // Across a month and a year.
    expect(weekDays("2026-12-31")[0]).toBe("2026-12-28");
    expect(weekDays("2026-12-31")[6]).toBe("2027-01-03");
  });
  it("is said in words", () => {
    expect(weekWords(weekDays("2026-11-20"))).toBe("Nov 16 to 22");
    expect(weekWords(weekDays("2026-12-02"))).toBe("Nov 30 to Dec 6");
    expect(weekWords([])).toBe("");
  });
});

describe("the pop-up: move or reassign is open at once", () => {
  const f = flat(phone);
  it("no Move button to press first, and no drop-down list", () => {
    expect(phone).not.toContain('data-peek="move-button"');
    expect(phone).not.toContain("setMoving");
    expect(phone).not.toMatch(/<select/);
    expect(f).toContain('{canMove && ( <div className="space-y-2 border-y py-2" data-peek="move">');
  });
  it("comes before the address, the description and the instructions", () => {
    const at = (s: string) => phone.indexOf(s);
    expect(at('data-peek="move"')).toBeGreaterThan(-1);
    for (const later of [
      'data-peek="place"',
      'data-peek="description"',
      'data-peek="instructions"',
    ])
      expect(at('data-peek="move"')).toBeLessThan(at(later));
  });
  it("every technician is a button, and Nobody; the one that has it is marked", () => {
    expect(f).toContain('{[...techOptions, { id: "", name: "Nobody" }].map((t) => {');
    expect(f).toContain('data-peek-tech={t.id || "none"}');
    expect(f).toContain(
      'data-now={own ? "1" : undefined} aria-pressed={tech === t.id} onClick={() => setTech(t.id)}',
    );
    // A former assignee who is no longer a technician is still listed, as before.
    expect(f).toContain(
      'techOptions.push({ id: j.technician_id, name: j.technician_name ?? "Former assignee" });',
    );
    // Under the name: who has it now, else how busy that day is (the board's week only).
    expect(f).toContain(
      "if (date && props.days.includes(date)) return dockNote(props.countOn(id, date), hasIt);",
    );
    expect(f).toContain("countOn={(id, d) => p.cellJobs(id, d).length}");
  });
  it("the week's days are buttons, the ticket's own marked, with a week either way and the date box", () => {
    expect(f).toContain("const [shown, setShown] = useState<string[]>(props.days);");
    expect(f).toContain("const own = d === j.scheduled_date;");
    expect(f).toContain('aria-label={`${dayShort(d)}${own ? ", its day now" : ""}`}');
    expect(f).toContain("onClick={() => setShown(weekDays(shiftDays(shown[0]!, -7)))}");
    expect(f).toContain("onClick={() => setShown(weekDays(shiftDays(shown[0]!, 7)))}");
    expect(f).toContain('aria-label="The week before"');
    expect(f).toContain('aria-label="The week after"');
    // A date typed in the box brings its own week to the buttons.
    expect(f).toContain("if (d && !shown.includes(d)) setShown(weekDays(d));");
    expect(f).toContain('id="peek-date" type="date"');
  });
  it("a thumb's sizes: 46 and 48 pixel buttons, a 16 pixel date box", () => {
    expect(f).toContain("flex min-h-[48px] flex-col items-center justify-center rounded-md border");
    expect(f).toContain(
      "flex min-h-[46px] min-w-0 items-center gap-2 rounded-md border px-2 text-left",
    );
    expect(f).toContain('className="h-[46px] w-[46px] shrink-0 p-0"');
    expect(f).toContain('className="h-[46px] min-w-0 flex-1 text-[16px]"');
    expect(f).toContain("h-auto min-h-[56px] min-w-0 flex-1 flex-col");
  });
});

describe("the bar at the bottom of the pop-up", () => {
  const f = flat(phone);
  it("is outside the part that scrolls, so it is always on the screen", () => {
    expect(f).toContain('className="flex max-h-[88dvh] flex-col gap-0 rounded-t-xl p-0');
    expect(f).toContain(
      'data-peek="body" className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-3 pb-3 pt-3"',
    );
    expect(f).toContain('data-peek="bar" className="shrink-0 border-t bg-card px-3 pt-2');
    expect(phone.indexOf('data-peek="bar"')).toBeGreaterThan(
      phone.indexOf('data-peek="instructions"'),
    );
  });
  it("with a change picked it is the one button that saves, saying what it will do", () => {
    expect(f).toContain("{canMove && changed ? (");
    expect(f).toContain('aria-label={words ? moveWordsLine(words) : "Pick a day to save"}');
    expect(f).toContain('{!date ? "Pick a day to save" : (words?.main ?? "Save")}');
    expect(f).toContain("{words.sub}");
    // Only a real change with a day, through the same single write as a drag.
    expect(f).toContain("disabled={!changed || !date}");
    expect(f).toContain(
      "props.onMove(j, { technician_id: tech || null, scheduled_date: date || null }); props.onClose();",
    );
    expect(flat(page)).toContain("say: moveSummary(job.number, name, plan),");
  });
  it("Put back undoes the picking without saving anything", () => {
    expect(f).toContain(
      'const putBack = () => { setTech(j.technician_id ?? ""); setDate(j.scheduled_date ?? ""); setShown(props.days); };',
    );
    expect(f).toContain(
      'data-peek="put-back" aria-label="Put back: change nothing" onClick={putBack}',
    );
  });
  it("with nothing picked it is Open ticket, Call and Directions, as before", () => {
    expect(f).toContain('<div className="flex gap-2" data-peek="actions">');
    expect(f).toContain('search={{ id: j.id, from: "board", week: props.week }}');
    expect(f).toContain('href={`tel:${phone}`} data-peek="call"');
    expect(f).toContain("href={mapsUrl(mapQuery)}");
  });
});

describe("who gets the choices", () => {
  const f = flat(phone);
  it("only a person who may move tickets, and only a ticket that may move", () => {
    expect(f).toContain("const canMove = props.dispatch && movableOnBoard(j);");
    // Everything that moves is inside canMove: the choices and the button that saves.
    expect(phone.match(/setTech\(t\.id\)/g)?.length).toBe(1);
    expect(phone.indexOf("{canMove && (")).toBeLessThan(phone.indexOf("setTech(t.id)"));
    expect(phone.indexOf("setTech(t.id)")).toBeLessThan(
      phone.indexOf("{props.dispatch && !canMove && ("),
    );
  });
  it("a ticket that is Done or later says it stays", () => {
    expect(f).toContain(
      '{props.dispatch && !canMove && ( <p className="rounded-md border bg-muted/50 px-3 py-2 text-sm" data-peek="stays"> A ticket that is Done or later stays where it is on the board. </p> )}',
    );
    expect(
      planDrop(
        { stage: "done", technician_id: GARRY, scheduled_date: "2026-11-20" },
        parseDropKey(`${TYLER}|2026-11-20`),
      ),
    ).toBeNull();
  });
});

describe("hold and drag: the lifted ticket says what letting go will do", () => {
  const f = flat(phone);
  it("the same words as the button, worked from the target under the finger", () => {
    expect(f).toContain(
      "const dropPlan = dragged ? planDrop(dragged, parseDropKey(p.over)) : null;",
    );
    expect(f).toContain("{dropWords ? dropWords.sub : DRAG_NO_CHANGE}");
    expect(f).toContain(
      '? dropWords.main : dragged ? `#${dragged.number} ${dragged.customer_name}` : ""}',
    );
    expect(DRAG_NO_CHANGE).toBe("Let go to put it back");
  });
  it("its words stay on the screen at either edge", () => {
    // A 160 px picture on a 390 px screen: centred on the finger in the middle…
    expect(ghostCentre(200, 160, 390)).toBe(200);
    // …and held 6 px inside the edge at the sides.
    expect(ghostCentre(5, 160, 390)).toBe(86);
    expect(ghostCentre(388, 160, 390)).toBe(304);
    // Wider than the screen: the middle.
    expect(ghostCentre(10, 400, 390)).toBe(195);
    expect(flat(hook)).toContain(
      "const width = g.firstElementChild?.getBoundingClientRect().width ?? 0; const x = ghostCentre(state.x, width, window.innerWidth);",
    );
  });
  it("the hold itself is as it was: a moving finger still scrolls", () => {
    expect(HOLD_MS).toBe(320);
    expect(SLOP_PX).toBe(10);
  });
});

describe("the hint says the easy way first", () => {
  it("tap, tap, button; then the hold and drag", () => {
    expect(PHONE_BOARD_HINT).toBe(
      "Tap a ticket, tap the technician or the day it goes to, then the button at the bottom. Or hold a ticket and drag it there.",
    );
    expect(PHONE_BOARD_HINT.indexOf("Tap a ticket")).toBeLessThan(
      PHONE_BOARD_HINT.indexOf("hold a ticket"),
    );
    expect(flat(phone)).toContain(
      'canDrag ? "Tap to move it or see its details, hold to drag it." : "Tap for details."',
    );
  });
});
