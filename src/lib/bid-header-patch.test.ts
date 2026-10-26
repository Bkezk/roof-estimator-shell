/**
 * Owner, Oct 26 (Somerset Career Center): Brian filed the bid under a folder from the Bids list
 * and linked it to its customer from the Customers page while his estimator tab had it open; the
 * tab's next save was refused ("Brian saved this at 2 pm"). With the stale rule now reading the
 * contents stamp (bid-stale-save.ts) that save goes through — and must not put the tab's old
 * folder back: the estimator sends only the header fields changed in the tab, shows the row's
 * newer values after the save, and the toast says what was kept.
 */
import { describe, expect, it } from "vitest";

import {
  type BidHeader,
  bidHeaderOfRow,
  bidHeaderPatch,
  keptElsewhere,
  savedToastText,
} from "./bid-header-patch";

const loaded: BidHeader = {
  status: "draft",
  lostReason: null,
  wonOn: "",
  dueDate: "2026-10-30",
  folder: "",
  reminderOn: "",
  reminderNote: "",
};

describe("bidHeaderPatch: what a save sends", () => {
  it("nothing changed in the tab → nothing (the folder moved elsewhere is left alone)", () => {
    expect(bidHeaderPatch(loaded, { ...loaded })).toEqual({});
    // Blank and unfiled are the same folder; so are a blank note and no note.
    expect(bidHeaderPatch(loaded, { ...loaded, folder: "  ", reminderNote: "x" })).toEqual({});
  });
  it("only the field changed in the tab", () => {
    expect(bidHeaderPatch(loaded, { ...loaded, dueDate: "2026-11-02" })).toEqual({
      dueDate: "2026-11-02",
    });
    expect(bidHeaderPatch(loaded, { ...loaded, dueDate: "" })).toEqual({ dueDate: null });
    expect(bidHeaderPatch(loaded, { ...loaded, folder: "Branscum Construction" })).toEqual({
      folder: "Branscum Construction",
    });
  });
  it("the status goes with its lost reason and won day", () => {
    expect(bidHeaderPatch(loaded, { ...loaded, status: "won", wonOn: "2026-10-26" })).toEqual({
      status: "won",
      lostReason: null,
      wonOn: "2026-10-26",
    });
    expect(bidHeaderPatch(loaded, { ...loaded, status: "won" })).toEqual({
      status: "won",
      lostReason: null,
      wonOn: null,
    });
    const lost: BidHeader = { ...loaded, status: "lost", lostReason: "price" };
    expect(bidHeaderPatch(lost, { ...lost, lostReason: "timing" })).toEqual({
      status: "lost",
      lostReason: "timing",
      wonOn: null,
    });
    const won: BidHeader = { ...loaded, status: "won", wonOn: "2026-10-20" };
    expect(bidHeaderPatch(won, { ...won, wonOn: "2026-10-21" })).toEqual({
      status: "won",
      lostReason: null,
      wonOn: "2026-10-21",
    });
  });
  it("the reminder date goes with its note", () => {
    expect(
      bidHeaderPatch(loaded, { ...loaded, reminderOn: "2026-10-28", reminderNote: " call Brian " }),
    ).toEqual({ reminderOn: "2026-10-28", reminderNote: "call Brian" });
    const set: BidHeader = { ...loaded, reminderOn: "2026-10-28", reminderNote: "call" };
    expect(bidHeaderPatch(set, { ...set, reminderNote: "" })).toEqual({
      reminderOn: "2026-10-28",
      reminderNote: null,
    });
    expect(bidHeaderPatch(set, { ...set, reminderOn: "" })).toEqual({
      reminderOn: null,
      reminderNote: null,
    });
  });
  it("a new bid sends the whole header", () => {
    expect(
      bidHeaderPatch(null, {
        ...loaded,
        status: "lost",
        lostReason: "price",
        folder: "Owens",
        reminderOn: "2026-10-28",
        reminderNote: "x",
      }),
    ).toEqual({
      status: "lost",
      lostReason: "price",
      wonOn: null,
      dueDate: "2026-10-30",
      folder: "Owens",
      reminderOn: "2026-10-28",
      reminderNote: "x",
    });
  });
});

describe("keptElsewhere and the toast", () => {
  it("Somerset: the folder set from the Bids list comes back on the row and is named", () => {
    const row = bidHeaderOfRow({
      status: "draft",
      lost_reason: null,
      won_on: null,
      due_date: "2026-10-30",
      folder: "Branscum Construction",
      reminder_on: null,
      reminder_note: null,
    });
    expect(keptElsewhere(loaded, row)).toEqual(["folder"]);
    expect(savedToastText(["folder"])).toBe(
      "Bid saved. The folder was changed elsewhere since you opened this bid; that change is kept.",
    );
  });
  it("nothing kept → the plain toast; several → listed", () => {
    expect(keptElsewhere(loaded, { ...loaded })).toEqual([]);
    expect(savedToastText([])).toBe("Bid saved");
    expect(
      keptElsewhere(loaded, { ...loaded, status: "won", wonOn: "2026-10-26", folder: "A" }),
    ).toEqual(["status", "folder"]);
    expect(savedToastText(["status", "folder"])).toContain(
      "The status and folder were changed elsewhere",
    );
    expect(savedToastText(["status", "due date", "folder"])).toContain(
      "status, due date and folder were",
    );
  });
  it("a won day the tab left blank is the server's default, not a change made elsewhere", () => {
    const won: BidHeader = { ...loaded, status: "won" };
    expect(keptElsewhere(won, { ...won, wonOn: "2026-10-26" })).toEqual([]);
    expect(keptElsewhere({ ...won, wonOn: "2026-10-20" }, { ...won, wonOn: "2026-10-26" })).toEqual(
      ["won day"],
    );
  });
  it("bidHeaderOfRow reads nulls as blanks and an unknown status as draft", () => {
    expect(
      bidHeaderOfRow({
        status: "bogus",
        lost_reason: null,
        won_on: null,
        due_date: null,
        folder: null,
        reminder_on: null,
        reminder_note: null,
      }),
    ).toEqual(loaded && { ...loaded, dueDate: "" });
  });
});
