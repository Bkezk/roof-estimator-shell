/**
 * The technician's clock (owner, Oct 15, CenterPoint-style: "the technicians clock into travel,
 * then clock into the job; while they're out, if they're going to another job they clock into
 * travel for that job, then into the job once they get there, then they can edit time later").
 * The pure rules of tech-clock.ts: every transition of the one clock, the one-minute mistap
 * rule, the quarter-hour rounding, the labels, the card's buttons, the entry's day and the
 * time editor's helpers.
 */
import { describe, expect, it } from "vitest";

import {
  MISTAP_MS,
  cardActions,
  clockTransition,
  closedLine,
  durationHours,
  elapsedLabel,
  entryDay,
  entryTimes,
  localHm,
  pressLine,
  runningLabel,
  shiftYmd,
  type Clock,
} from "@/lib/tech-clock";

const TECH = "tech-1";
const A = "job-a";
const B = "job-b";
const T0 = "2026-10-15T12:00:00.000Z";
const at = (min: number) => new Date(Date.parse(T0) + min * 60_000);
const travelA: Clock = {
  technician_id: TECH,
  service_job_id: A,
  kind: "travel",
  started_at: T0,
  helper_count: 1,
};
const laborA: Clock = { ...travelA, kind: "labor" };
const ticketA = { id: A, number: 6014, customer_name: "Bell County" };

describe("clockTransition: one clock per technician", () => {
  it("Start travel with no clock opens travel on the ticket, en route, nothing closed", () => {
    const t = clockTransition(null, "travel", A, at(0), 2, TECH);
    expect(t).toEqual({
      close: null,
      open: {
        technician_id: TECH,
        service_job_id: A,
        kind: "travel",
        started_at: T0,
        helper_count: 2,
      },
      fieldStatus: "en_route",
      changed: true,
    });
  });
  it("On site while travelling to the same ticket closes the travel and opens labor", () => {
    const t = clockTransition(travelA, "on_site", A, at(20), 1, TECH);
    expect(t.close).toEqual({
      jobId: A,
      technician_id: TECH,
      kind: "travel",
      started_at: T0,
      ended_at: at(20).toISOString(),
      helper_count: 1,
    });
    expect(t.open).toMatchObject({
      service_job_id: A,
      kind: "labor",
      started_at: at(20).toISOString(),
    });
    expect(t.fieldStatus).toBe("on_site");
    expect(t.changed).toBe(true);
  });
  it("On site without having pressed travel is allowed: labor opens, nothing closes", () => {
    const t = clockTransition(null, "on_site", A, at(0), 0, TECH);
    expect(t.close).toBeNull();
    expect(t.open?.kind).toBe("labor");
    expect(t.fieldStatus).toBe("on_site");
  });
  it("Start travel to B while on site at A closes A's labor (any ticket, both kinds)", () => {
    const t = clockTransition(laborA, "travel", B, at(90), 0, TECH);
    expect(t.close).toMatchObject({ jobId: A, kind: "labor", ended_at: at(90).toISOString() });
    expect(t.open).toMatchObject({ service_job_id: B, kind: "travel" });
    expect(t.fieldStatus).toBe("en_route");
    // Travelling to A, then straight to B: the travel to A closes too.
    const t2 = clockTransition(travelA, "travel", B, at(5), 0, TECH);
    expect(t2.close).toMatchObject({ jobId: A, kind: "travel" });
    expect(t2.open?.service_job_id).toBe(B);
  });
  it("On site at B while travelling to A still closes A's travel", () => {
    const t = clockTransition(travelA, "on_site", B, at(15), 0, TECH);
    expect(t.close).toMatchObject({ jobId: A, kind: "travel" });
    expect(t.open).toMatchObject({ service_job_id: B, kind: "labor" });
  });
  it("Leave site closes the clock on that ticket and opens nothing; field status none", () => {
    const t = clockTransition(laborA, "leave", A, at(75), 0, TECH);
    expect(t.close).toMatchObject({ jobId: A, kind: "labor" });
    expect(t.open).toBeNull();
    expect(t.fieldStatus).toBeNull();
    expect(t.changed).toBe(true);
    // Leaving while only travelling there closes the travel the same way.
    expect(clockTransition(travelA, "leave", A, at(10), 0, TECH).close?.kind).toBe("travel");
  });
  it("Complete is Leave site: the close-out finishes the ticket", () => {
    expect(clockTransition(laborA, "done", A, at(75), 0, TECH)).toEqual(
      clockTransition(laborA, "leave", A, at(75), 0, TECH),
    );
  });
  it("Leave / Complete on a ticket the clock is NOT on keeps the clock where it is", () => {
    for (const action of ["leave", "done"] as const) {
      const t = clockTransition(laborA, action, B, at(75), 0, TECH);
      expect(t).toEqual({
        close: null,
        open: laborA,
        fieldStatus: null,
        changed: false,
        note: "no clock on this ticket",
      });
    }
    expect(clockTransition(null, "leave", A, at(1), 0, TECH).changed).toBe(false);
  });
  it("Undo drops the clock on that ticket without an entry; only when it is on that ticket", () => {
    const t = clockTransition(laborA, "cancel", A, at(75), 0, TECH);
    expect(t).toEqual({ close: null, open: null, fieldStatus: null, changed: true, note: "undo" });
    const other = clockTransition(laborA, "cancel", B, at(75), 0, TECH);
    expect(other.changed).toBe(false);
    expect(other.open).toBe(laborA);
  });
  it("pressing the same button twice is harmless", () => {
    const again = clockTransition(travelA, "travel", A, at(3), 0, TECH);
    expect(again).toEqual({
      close: null,
      open: travelA,
      fieldStatus: "en_route",
      changed: false,
      note: "already",
    });
    const again2 = clockTransition(laborA, "on_site", A, at(3), 0, TECH);
    expect(again2).toEqual({
      close: null,
      open: laborA,
      fieldStatus: "on_site",
      changed: false,
      note: "already",
    });
  });
  it("a close under a minute is a mistap: the clock moves, nothing is written", () => {
    expect(MISTAP_MS).toBe(60_000);
    const t = clockTransition(travelA, "on_site", A, new Date(Date.parse(T0) + 59_000), 0, TECH);
    expect(t.close).toBeNull();
    expect(t.open?.kind).toBe("labor");
    expect(t.note).toBe("mistap");
    const leave = clockTransition(laborA, "leave", A, new Date(Date.parse(T0) + 30_000), 0, TECH);
    expect(leave).toMatchObject({ close: null, open: null, changed: true, note: "mistap" });
    // A full minute writes.
    expect(clockTransition(travelA, "on_site", A, at(1), 0, TECH).close).not.toBeNull();
  });
  it("the new clock carries the ticket's helper count; the close carries the old clock's", () => {
    const t = clockTransition({ ...laborA, helper_count: 3 }, "travel", B, at(60), 1, TECH);
    expect(t.close?.helper_count).toBe(3);
    expect(t.open?.helper_count).toBe(1);
  });
});

describe("durationHours: the quarter hour, never under a quarter (quarterHours' rule)", () => {
  it("rounds to the nearest quarter", () => {
    expect(durationHours(T0, at(20))).toBe(0.25);
    expect(durationHours(T0, at(23))).toBe(0.5);
    expect(durationHours(T0, at(75))).toBe(1.25);
    expect(durationHours(T0, at(100))).toBe(1.75);
    expect(durationHours(T0, at(8 * 60 + 7))).toBe(8);
  });
  it("never under a quarter, even for a minute", () => {
    expect(durationHours(T0, at(1))).toBe(0.25);
    expect(durationHours(T0, at(0))).toBe(0.25);
  });
});

describe("labels", () => {
  it("elapsedLabel: minutes, then hours and minutes", () => {
    expect(elapsedLabel(T0, at(0))).toBe("0 m");
    expect(elapsedLabel(T0, at(12))).toBe("12 m");
    expect(elapsedLabel(T0, at(80))).toBe("1 h 20 m");
    expect(elapsedLabel(T0, at(120))).toBe("2 h 0 m");
    expect(elapsedLabel(at(5), T0)).toBe("0 m");
  });
  it("runningLabel: On site at / Travelling to #number customer · elapsed", () => {
    expect(runningLabel(laborA, at(80), ticketA)).toBe("On site at #6014 Bell County · 1 h 20 m");
    expect(runningLabel(travelA, at(12), ticketA)).toBe("Travelling to #6014 Bell County · 12 m");
    expect(runningLabel(travelA, at(12), { number: 6014, customer_name: null })).toBe(
      "Travelling to #6014 · 12 m",
    );
  });
  it("closedLine: what was logged when a clock stopped", () => {
    expect(closedLine(laborA, at(45), ticketA)).toBe(
      "Left #6014 Bell County · 0.75 h labor logged",
    );
    expect(closedLine(travelA, at(20), ticketA)).toBe(
      "Travel to #6014 Bell County · 0.25 h logged",
    );
    expect(closedLine(laborA, new Date(Date.parse(T0) + 20_000), ticketA)).toBe(
      "Left #6014 Bell County · under a minute, nothing logged",
    );
  });
  it("pressLine: the toast after a press, naming what stopped and what started", () => {
    const beforeA = { ...laborA, number: 6012, customer_name: "Acme" };
    const ticketB = { id: B, number: 6014, customer_name: "Bell County" };
    expect(pressLine(null, "en_route", ticketB, at(0))).toBe("Travelling to #6014 Bell County");
    expect(pressLine(null, "on_site", ticketB, at(0))).toBe("On site at #6014 Bell County");
    expect(pressLine(beforeA, "en_route", ticketB, at(45))).toBe(
      "Left #6012 Acme · 0.75 h labor logged — travelling to #6014 Bell County",
    );
    expect(
      pressLine({ ...beforeA, kind: "travel", service_job_id: B }, "on_site", ticketB, at(20)),
    ).toBe("Travel to #6012 Acme · 0.25 h logged — on site at #6014 Bell County");
    expect(
      pressLine(beforeA, "leave", { ...ticketA, number: 6012, customer_name: "Acme" }, at(45)),
    ).toBe("Left #6012 Acme · 0.75 h labor logged");
    expect(pressLine(null, "leave", ticketB, at(0))).toBe(
      "No clock was running at #6014 Bell County",
    );
    expect(
      pressLine(
        { ...beforeA, kind: "travel" },
        "en_route",
        { ...ticketA, number: 6012, customer_name: "Acme" },
        at(3),
      ),
    ).toBe("Already travelling to #6012 Acme");
    expect(
      pressLine(beforeA, "on_site", { ...ticketA, number: 6012, customer_name: "Acme" }, at(3)),
    ).toBe("Already on site at #6012 Acme");
  });
});

describe("cardActions: what a ticket card offers (today-page.tsx)", () => {
  it("no clock on this ticket (none, or one on another ticket): Start travel and On site", () => {
    expect(cardActions(null, A)).toEqual(["travel", "on_site"]);
    expect(cardActions(laborA, B)).toEqual(["travel", "on_site"]);
    expect(cardActions(travelA, B)).toEqual(["travel", "on_site"]);
  });
  it("travelling here: On site; on site here: Leave site and Complete", () => {
    expect(cardActions(travelA, A)).toEqual(["on_site"]);
    expect(cardActions(laborA, A)).toEqual(["leave", "complete"]);
  });
});

describe("the entry's day", () => {
  it("shiftYmd moves a day by whole days, across months and years", () => {
    expect(shiftYmd("2026-10-15", -1)).toBe("2026-10-14");
    expect(shiftYmd("2026-10-01", -1)).toBe("2026-09-30");
    expect(shiftYmd("2027-01-01", -1)).toBe("2026-12-31");
    expect(shiftYmd("2026-10-15", 0)).toBe("2026-10-15");
    expect(shiftYmd("not a day", -1)).toBe("not a day");
  });
  it("entryDay: the phone's day at the close, moved back by the days the clock ran over midnight (Eastern)", () => {
    // Started 10 pm Eastern Oct 14 (02:00Z Oct 15), closed 1 am Eastern Oct 15: the day it started.
    expect(entryDay("2026-10-15", "2026-10-15T02:00:00Z", "2026-10-15T05:00:00Z")).toBe(
      "2026-10-14",
    );
    // Same Eastern day: the phone's day as sent.
    expect(entryDay("2026-10-15", "2026-10-15T12:00:00Z", "2026-10-15T14:00:00Z")).toBe(
      "2026-10-15",
    );
    // Never forward.
    expect(entryDay("2026-10-15", "2026-10-15T14:00:00Z", "2026-10-15T12:00:00Z")).toBe(
      "2026-10-15",
    );
  });
});

describe("the time editor's helpers", () => {
  it("localHm: the local wall-clock HH:MM of an instant", () => {
    const d = new Date(2026, 9, 15, 8, 5);
    expect(localHm(d.toISOString())).toBe("08:05");
    expect(localHm(null)).toBe("");
    expect(localHm("garbage")).toBe("");
  });
  it("entryTimes: two times on the day become the start and end; an earlier end is the next day", () => {
    const t = entryTimes("2026-10-15", "08:00", "09:40");
    expect(t).toEqual({
      started_at: new Date(2026, 9, 15, 8, 0).toISOString(),
      ended_at: new Date(2026, 9, 15, 9, 40).toISOString(),
    });
    const over = entryTimes("2026-10-15", "23:00", "00:30");
    expect(over?.ended_at).toBe(new Date(2026, 9, 16, 0, 30).toISOString());
    expect(entryTimes("2026-10-15", "08:00", "08:00")).toBeNull();
    expect(entryTimes("2026-10-15", "", "08:00")).toBeNull();
    expect(entryTimes("15/10/2026", "08:00", "09:00")).toBeNull();
    // The hours follow the times.
    expect(durationHours(t!.started_at, t!.ended_at)).toBe(1.75);
  });
});
