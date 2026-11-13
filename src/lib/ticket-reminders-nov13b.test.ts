/**
 * Ticket reminders before the date, on working days (owner, Nov 13):
 *   "add the day before notice for tickets, also i think they would want some cadence of
 *    reminders as well, if a ticket is set to do a month out and is assigned then it starts
 *    reminding that person every 3 days or so and that can also be edited in settings."
 *   "give it the new meaning for untouched tickets. also dont count weekend days"
 *   "yes skip weekends on the after date reminders too"
 *
 * The rule (lib/ticket-reminders.ts), its words, the untouched rule's new meaning, and the
 * database's half (20261113120000_ticket_reminders_working_days.sql), which is held to the same
 * table of cases (src/test/working-day-cases.ts: what the database's function answered).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { startNotice } from "@/lib/followups.server";
import {
  TICKET_REMINDER_DEFAULTS,
  dayText,
  ticketEscalationDue,
  ticketFirstRemindAt,
  ticketIsUntouched,
  ticketLate,
  ticketNextRemindAt,
  ticketNextRemindDay,
  ticketNoticeDay,
  ticketReminderNotice,
  ticketReminderPhase,
  ticketReminderSettings,
  ticketReminderWaits,
  ticketStartTail,
  ticketUntouchedNotice,
} from "@/lib/ticket-reminders";
import { isWeekend } from "@/lib/working-days";
import { RULE_CASES } from "@/test/working-day-cases";

const ON = TICKET_REMINDER_DEFAULTS; // every 3 working days, the notice 1 working day before
const OFF = { ticket_before_every_days: null, ticket_due_notice_days: null };
const noon = (ymd: string) => `${ymd}T12:00:00.000Z`;
/** The reminder days from `from`, each answer the next `from`. */
function walk(
  due: string,
  from: string,
  before: number | null,
  notice: number | null,
  after: number,
  steps: number,
): string[] {
  const out: string[] = [];
  let day = from;
  for (let i = 0; i < steps; i++) {
    day = ticketNextRemindDay(due, day, before, notice, after);
    out.push(day);
  }
  return out;
}

describe("the owner's example: assigned a month out, reminded every 3 working days", () => {
  it("on the calendar it was written for (Thu Nov 13 → Sat Dec 13, 2025)", () => {
    expect(walk("2025-12-13", "2025-11-13", 3, 1, 3, 10)).toEqual([
      "2025-11-18", // Tue
      "2025-11-21", // Fri
      "2025-11-26", // Wed
      "2025-12-01", // Mon
      "2025-12-04", // Thu
      "2025-12-09", // Tue
      "2025-12-12", // Fri: the notice (a cadence step would land here too: one reminder)
      "2025-12-13", // Sat: the date itself
      "2025-12-17", // Wed: 3 working days after
      "2025-12-22", // Mon
    ]);
  });
  it("the same dates this year (Fri Nov 13 → Sun Dec 13, 2026)", () => {
    expect(walk("2026-12-13", "2026-11-13", 3, 1, 3, 10)).toEqual([
      "2026-11-18", // Wed
      "2026-11-23", // Mon
      "2026-11-26", // Thu
      "2026-12-01", // Tue
      "2026-12-04", // Fri
      "2026-12-09", // Wed
      "2026-12-11", // Fri: the notice for Sunday
      "2026-12-13", // Sun: the date itself
      "2026-12-16", // Wed
      "2026-12-21", // Mon
    ]);
  });
});

describe("the schedule, case by case", () => {
  it("assigned the day before: the date, then every 3 working days — no notice", () => {
    // Monday for Tuesday: Monday is the notice day, and a ticket assigned on it gets none.
    expect(walk("2026-11-17", "2026-11-16", 3, 1, 3, 3)).toEqual([
      "2026-11-17",
      "2026-11-20",
      "2026-11-25",
    ]);
  });
  it("assigned on a Friday for Monday: no notice, Monday morning", () => {
    expect(walk("2026-11-16", "2026-11-13", 3, 1, 3, 2)).toEqual(["2026-11-16", "2026-11-19"]);
  });
  it("assigned on a Thursday for Monday: the notice goes out on Friday", () => {
    expect(walk("2026-11-16", "2026-11-12", 3, 1, 3, 3)).toEqual([
      "2026-11-13",
      "2026-11-16",
      "2026-11-19",
    ]);
    expect(ticketNoticeDay("2026-11-16", 1)).toBe("2026-11-13");
  });
  it("a date on a Saturday: the notice on Friday, the reminder on the Saturday, then working days", () => {
    const days = walk("2026-11-21", "2026-11-16", 3, 1, 3, 5);
    expect(days).toEqual(["2026-11-19", "2026-11-20", "2026-11-21", "2026-11-25", "2026-11-30"]);
    // Only the date itself may be a weekend day.
    expect(days.filter(isWeekend)).toEqual(["2026-11-21"]);
  });
  it("a date on a Sunday: the notice on Friday, the reminder on the Sunday", () => {
    expect(walk("2026-11-22", "2026-11-16", 3, 1, 3, 3)).toEqual([
      "2026-11-19",
      "2026-11-20",
      "2026-11-22",
    ]);
  });
  it("a date moved later: the cadence starts again from the day it was moved", () => {
    // Was due Mon Nov 16; on Fri Nov 13 it is moved to Wed Dec 2.
    expect(walk("2026-12-02", "2026-11-13", 3, 1, 3, 3)).toEqual([
      "2026-11-18",
      "2026-11-23",
      "2026-11-26",
    ]);
  });
  it("a date moved earlier: the notice if its day is still ahead, else the date", () => {
    // Was due Dec 13; on Mon Nov 16 it is moved up to Wed Nov 18: the notice Tuesday.
    expect(walk("2026-11-18", "2026-11-16", 3, 1, 3, 2)).toEqual(["2026-11-17", "2026-11-18"]);
    // Moved up to tomorrow: no notice, the date.
    expect(walk("2026-11-17", "2026-11-16", 3, 1, 3, 1)).toEqual(["2026-11-17"]);
  });
  it("reassigned: the new technician's timer counts from the day they got it", () => {
    // Assigned Nov 13 for Dec 13, handed over on Wed Dec 2: Mon Dec 7, Thu Dec 10, the notice
    // Fri Dec 11, the date.
    expect(walk("2026-12-13", "2026-12-02", 3, 1, 3, 4)).toEqual([
      "2026-12-07",
      "2026-12-10",
      "2026-12-11",
      "2026-12-13",
    ]);
  });
  it("snoozed: after the hold ends the rule counts from the day that reminder went", () => {
    // Held until Mon Nov 30 for a Dec 13 date: "Back from hold" that day, then on as usual.
    expect(walk("2026-12-13", "2026-11-30", 3, 1, 3, 4)).toEqual([
      "2026-12-03",
      "2026-12-08",
      "2026-12-11",
      "2026-12-13",
    ]);
  });
  it("cadence off: the notice and the date only", () => {
    expect(walk("2026-12-13", "2026-11-13", null, 1, 3, 3)).toEqual([
      "2026-12-11",
      "2026-12-13",
      "2026-12-16",
    ]);
  });
  it("notice off: the cadence up to the date, no extra notice", () => {
    expect(walk("2026-12-13", "2026-11-13", 3, null, 3, 8).slice(5)).toEqual([
      "2026-12-09",
      "2026-12-13",
      "2026-12-16",
    ]);
  });
  it("both off: as it was before — on the date, then every N days — but the repeat skips weekends", () => {
    expect(walk("2026-12-13", "2026-11-13", null, null, 3, 4)).toEqual([
      "2026-12-13",
      "2026-12-16",
      "2026-12-21",
      "2026-12-24",
    ]);
    // The first reminder of a timer started today is the date's own morning, as it always was.
    const due = new Date(noon("2026-12-13"));
    const now = new Date("2026-11-13T15:00:00Z");
    expect(ticketFirstRemindAt(due, now, OFF, 3).toISOString()).toBe(noon("2026-12-13"));
  });
  it("after the date never lands on a Saturday or a Sunday", () => {
    for (const from of ["2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15", "2026-11-16"])
      for (const after of [1, 2, 3, 5, 7])
        for (const d of walk("2026-11-10", from, 3, 1, after, 6)) expect(isWeekend(d)).toBe(false);
  });
  it("0 or less is off for the two before-the-date numbers, and at least 1 after", () => {
    expect(walk("2026-11-30", "2026-11-13", 0, 0, 0, 3)).toEqual([
      "2026-11-30",
      "2026-12-01",
      "2026-12-02",
    ]);
  });
});

describe("the database walks the same days (one table, two implementations)", () => {
  it.each(RULE_CASES)("$what", ({ due, from, before, notice, after, sql }) => {
    expect(walk(due, from, before, notice, after, sql.length)).toEqual([...sql]);
  });
});

describe("the first reminder of a timer, and its instant", () => {
  const now = new Date("2026-11-13T15:00:00Z"); // Friday, 10 am in the office
  it("a month out: the first cadence step, 12:00 UTC that morning", () => {
    expect(ticketFirstRemindAt(new Date(noon("2026-12-13")), now, ON, 3).toISOString()).toBe(
      noon("2026-11-18"),
    );
  });
  it("a date that is today or already past: on the date, or now — as before", () => {
    const today = new Date(noon("2026-11-13"));
    expect(ticketFirstRemindAt(today, now, ON, 3).getTime()).toBe(now.getTime());
    const morning = new Date("2026-11-13T09:00:00Z"); // 4 am in the office
    expect(ticketFirstRemindAt(today, morning, ON, 3).toISOString()).toBe(noon("2026-11-13"));
    const past = new Date(noon("2026-11-10"));
    expect(ticketFirstRemindAt(past, now, ON, 3).getTime()).toBe(now.getTime());
  });
  it("landing on the date keeps the due instant itself; any other day is its 12:00 UTC", () => {
    const odd = "2026-11-17T18:30:00.000Z"; // an unscheduled ticket's due_at has no fixed hour
    expect(ticketNextRemindAt(odd, "2026-11-16", ON, 3)).toBe(odd);
    expect(ticketNextRemindAt(noon("2026-12-13"), "2026-11-13", ON, 3)).toBe(noon("2026-11-18"));
    // After the date: 3 working days on from the day it went, whatever the hour.
    expect(ticketNextRemindAt(noon("2026-12-13"), "2026-12-13", ON, 3)).toBe(noon("2026-12-16"));
  });
  it("a reminder that comes due on a weekend waits for Monday, unless it is the ticket's date", () => {
    expect(ticketReminderWaits(noon("2026-11-10"), "2026-11-14")).toBe(true); // Saturday, overdue
    expect(ticketReminderWaits(noon("2026-11-14"), "2026-11-14")).toBe(false); // its own date
    expect(ticketReminderWaits(noon("2026-11-15"), "2026-11-15")).toBe(false);
    expect(ticketReminderWaits(noon("2026-11-10"), "2026-11-16")).toBe(false); // Monday
  });
});

describe("the settings as the pass reads them", () => {
  it("defaults 3 and 1; null is off; a row without the columns reads as the defaults", () => {
    expect(TICKET_REMINDER_DEFAULTS).toEqual({
      ticket_before_every_days: 3,
      ticket_due_notice_days: 1,
    });
    expect(ticketReminderSettings(undefined)).toEqual(ON);
    expect(ticketReminderSettings(null)).toEqual(ON);
    expect(ticketReminderSettings({})).toEqual(ON);
    expect(
      ticketReminderSettings({ ticket_before_every_days: null, ticket_due_notice_days: null }),
    ).toEqual(OFF);
    expect(
      ticketReminderSettings({ ticket_before_every_days: 5, ticket_due_notice_days: 2 }),
    ).toEqual({ ticket_before_every_days: 5, ticket_due_notice_days: 2 });
    // Out of range reads as off rather than as a made-up number.
    expect(
      ticketReminderSettings({ ticket_before_every_days: 0, ticket_due_notice_days: 31 }),
    ).toEqual(OFF);
  });
});

describe("which reminder it is, and its words", () => {
  const f = (over: Record<string, unknown> = {}) => ({
    title: "Ticket #6090 Acme — leak at the dock",
    due_at: noon("2026-12-13"),
    created_at: "2026-11-13T15:00:00Z",
    last_reminded_at: null as string | null,
    every_days: 3,
    reminders_sent: 0,
    ...over,
  });
  const at = (ymd: string) => new Date(`${ymd}T13:00:00Z`); // 8 am in the office

  it("before the date: a sibling of the reminder, naming the weekday and counting working days", () => {
    const n = ticketReminderNotice(f({ reminders_sent: 1 }), at("2026-11-23"), ON);
    expect(n).toEqual({
      phase: "before",
      title: "Follow up: Ticket #6090 Acme — leak at the dock",
      body: "due Sunday 12/13/2026. Reminder 2; it repeats every 3 working days until the date.",
    });
    // One working day: no plural.
    expect(
      ticketReminderNotice(f(), at("2026-11-23"), { ...ON, ticket_before_every_days: 1 }).body,
    ).toBe("due Sunday 12/13/2026. Reminder 1; it repeats every 1 working day until the date.");
    // The cadence off (a reminder before the date all the same, after a hold): no repeat line.
    expect(
      ticketReminderNotice(f(), at("2026-11-23"), { ...ON, ticket_before_every_days: null }).body,
    ).toBe("due Sunday 12/13/2026. Reminder 1.");
  });
  it("the notice: its own title, saying the weekday of the date (Friday says Monday)", () => {
    const monday = f({ due_at: noon("2026-11-16"), created_at: "2026-11-10T15:00:00Z" });
    expect(ticketReminderNotice({ ...monday, reminders_sent: 1 }, at("2026-11-13"), ON)).toEqual({
      phase: "notice",
      title: "Due Monday: Ticket #6090 Acme — leak at the dock",
      body: "due Monday 11/16/2026. Reminder 2; the next one is that morning.",
    });
    // The Sunday ticket's goes out on Friday too.
    expect(ticketReminderNotice(f({ reminders_sent: 6 }), at("2026-12-11"), ON).title).toBe(
      "Due Sunday: Ticket #6090 Acme — leak at the dock",
    );
  });
  it("on the date: due today, also on a Saturday or Sunday", () => {
    expect(ticketReminderNotice(f({ reminders_sent: 7 }), at("2026-12-13"), ON)).toEqual({
      phase: "due",
      title: "Follow up: Ticket #6090 Acme — leak at the dock",
      body: "due today. Reminder 8; after today it repeats every 3 working days until the item is finished or closed.",
    });
  });
  it("after the date: working days overdue, repeating on working days", () => {
    // Sunday Dec 13 → Wednesday Dec 16: Monday, Tuesday, Wednesday.
    expect(ticketReminderNotice(f({ reminders_sent: 8 }), at("2026-12-16"), ON)).toEqual({
      phase: "after",
      title: "Follow up: Ticket #6090 Acme — leak at the dock",
      body: "3 working days overdue. Reminder 9; it repeats every 3 working days until the item is finished or closed.",
    });
    expect(
      ticketReminderNotice(f({ due_at: noon("2026-12-14"), every_days: 1 }), at("2026-12-15"), ON)
        .body,
    ).toBe(
      "1 working day overdue. Reminder 1; it repeats every 1 working day until the item is finished or closed.",
    );
  });
  it("no title carries the name of the site", () => {
    for (const day of ["2026-11-23", "2026-12-11", "2026-12-13", "2026-12-16"]) {
      const n = ticketReminderNotice(f(), at(day), ON);
      expect(`${n.title} ${n.body}`).not.toMatch(/JBK|Portal|Bid-O-Matic/i);
    }
  });

  it("the notice is the first reminder on or after the notice day, once", () => {
    const monday = { due_at: noon("2026-11-16"), created_at: "2026-11-10T15:00:00Z" };
    // Thursday: still the cadence.
    expect(ticketReminderPhase(monday, "2026-11-12", ON)).toBe("before");
    expect(ticketReminderPhase(monday, "2026-11-13", ON)).toBe("notice");
    // Already had one on the notice day (two working days' notice, a daily cadence): the
    // cadence again.
    const two = { ticket_before_every_days: 1, ticket_due_notice_days: 2 };
    const wed = { due_at: noon("2026-11-18"), created_at: "2026-11-10T15:00:00Z" };
    expect(ticketReminderPhase(wed, "2026-11-16", two)).toBe("notice");
    expect(
      ticketReminderPhase({ ...wed, last_reminded_at: "2026-11-16T13:00:00Z" }, "2026-11-17", two),
    ).toBe("before");
    // The notice switched off: never.
    expect(ticketReminderPhase(monday, "2026-11-13", { ...ON, ticket_due_notice_days: null })).toBe(
      "before",
    );
  });
  it("a ticket assigned on or after its notice day gets no notice", () => {
    // Assigned Friday for Monday; a hold then ends Friday afternoon: an ordinary reminder.
    const friday = { due_at: noon("2026-11-16"), created_at: "2026-11-13T15:00:00Z" };
    expect(ticketReminderPhase(friday, "2026-11-13", ON)).toBe("before");
    expect(ticketReminderPhase(friday, "2026-11-16", ON)).toBe("due");
    expect(ticketReminderPhase(friday, "2026-11-17", ON)).toBe("after");
  });
  it("the day as every ticket notice writes it", () => {
    expect(dayText("2026-12-13")).toBe("Sunday 12/13/2026");
    expect(dayText("2025-12-13")).toBe("Saturday 12/13/2025");
    expect(dayText("2026-01-05")).toBe("Monday 1/5/2026");
  });
});

describe("the assignment notice names the first reminder", () => {
  const now = new Date("2026-11-13T15:00:00Z");
  const due = new Date(noon("2026-12-13"));
  it("a date ahead with a reminder before it", () => {
    expect(ticketStartTail(due, new Date(noon("2026-11-18")), 3, now)).toBe(
      "Due Sunday 12/13/2026; first reminder Wednesday 11/18/2026.",
    );
    expect(
      startNotice({
        kind: "ticket",
        title: "#6090 Acme",
        reopened: false,
        actorName: "Roe",
        due,
        every: 3,
        firstReminder: new Date(noon("2026-11-18")),
        now,
      }),
    ).toEqual({
      title: "Ticket assigned to you: #6090 Acme",
      body: "Roe assigned this to you. Due Sunday 12/13/2026; first reminder Wednesday 11/18/2026.",
    });
  });
  it("a date ahead with nothing before it (both numbers blank)", () => {
    expect(ticketStartTail(due, due, 3, now)).toBe(
      "Due Sunday 12/13/2026; the reminder comes that morning.",
    );
  });
  it("today, past, or the first reminder unknown: the repeat, in working days", () => {
    const today = new Date(noon("2026-11-13"));
    expect(ticketStartTail(today, now, 3, now)).toBe(
      "Due Friday 11/13/2026; reminders every 3 working days until it is closed.",
    );
    expect(ticketStartTail(due, null, 1, now)).toBe(
      "Due Sunday 12/13/2026; reminders every 1 working day until it is closed.",
    );
  });
  it("opportunities and the review timer read as they did", () => {
    const base = { title: "Dock roof", reopened: false, actorName: "Roe", due, every: 7 };
    expect(startNotice({ ...base, kind: "opportunity" }).body).toBe(
      `Roe assigned this to you. Due ${due.toLocaleDateString("en-US")}; reminders every 7 days until it is closed.`,
    );
    expect(startNotice({ ...base, kind: "invoice", every: 1 }).body).toBe(
      `Roe assigned this to you. Due ${due.toLocaleDateString("en-US")}; reminders every 1 day until it is closed.`,
    );
  });
});

describe("untouched, for a ticket: its date has passed and nobody has started it", () => {
  const job = (over: Record<string, unknown> = {}) => ({
    deleted_at: null,
    technician_id: "tech-1",
    stage: "scheduled",
    field_status: null,
    scheduled_date: "2026-11-06", // a Friday
    assigned_at: "2026-10-20T15:00:00Z",
    contacted_at: null,
    has_time: false,
    ...over,
  });
  it("counts working days from the date: limit 2 → Tuesday for a Friday ticket", () => {
    expect(ticketIsUntouched(job(), "2026-11-06", 2)).toBe(false); // its own day
    expect(ticketIsUntouched(job(), "2026-11-07", 2)).toBe(false); // Saturday: 0 working days
    expect(ticketIsUntouched(job(), "2026-11-09", 2)).toBe(false); // Monday: 1
    expect(ticketIsUntouched(job(), "2026-11-10", 2)).toBe(true); // Tuesday: 2
    // Limit 0: as soon as the date has passed.
    expect(ticketIsUntouched(job(), "2026-11-07", 0)).toBe(true);
    expect(ticketIsUntouched(job(), "2026-11-06", 0)).toBe(false);
  });
  it("a date still ahead is never untouched, however long ago it was assigned", () => {
    expect(ticketIsUntouched(job({ scheduled_date: "2026-12-13" }), "2026-11-13", 0)).toBe(false);
  });
  it("started means: a field status, a stage past Scheduled, or time clocked on it", () => {
    const day = "2026-11-13";
    expect(ticketIsUntouched(job(), day, 2)).toBe(true);
    expect(ticketIsUntouched(job({ stage: "open" }), day, 2)).toBe(true);
    expect(ticketIsUntouched(job({ field_status: "en_route" }), day, 2)).toBe(false);
    expect(ticketIsUntouched(job({ field_status: "on_site" }), day, 2)).toBe(false);
    expect(ticketIsUntouched(job({ stage: "done" }), day, 2)).toBe(false);
    expect(ticketIsUntouched(job({ stage: "authorized" }), day, 2)).toBe(false);
    expect(ticketIsUntouched(job({ has_time: true }), day, 2)).toBe(false);
  });
  it("still assigned, not deleted, and dated", () => {
    const day = "2026-11-13";
    expect(ticketIsUntouched(job({ technician_id: null }), day, 2)).toBe(false);
    expect(ticketIsUntouched(job({ deleted_at: "2026-11-08T00:00:00Z" }), day, 2)).toBe(false);
    expect(ticketIsUntouched(job({ scheduled_date: null }), day, 2)).toBe(false);
  });
  it("a contact logged on or after the date takes it off; one from before the date does not", () => {
    const day = "2026-11-13";
    expect(ticketIsUntouched(job({ contacted_at: "2026-11-02T15:00:00Z" }), day, 2)).toBe(true);
    expect(ticketIsUntouched(job({ contacted_at: "2026-11-06T15:00:00Z" }), day, 2)).toBe(false);
    expect(ticketIsUntouched(job({ contacted_at: "2026-11-09T15:00:00Z" }), day, 2)).toBe(false);
  });
  it("handed over after its date: the new technician gets the whole limit", () => {
    const late = job({ assigned_at: "2026-11-11T15:00:00Z" }); // Wednesday
    expect(ticketLate("2026-11-06", late.assigned_at, "2026-11-12")).toEqual({
      days: 1,
      sinceAssigned: true,
      from: "2026-11-11",
    });
    expect(ticketIsUntouched(late, "2026-11-12", 2)).toBe(false);
    expect(ticketIsUntouched(late, "2026-11-13", 2)).toBe(true);
  });
  it("the escalation's words: siblings of the Sep 28 ones, with the date and working days", () => {
    const u = { title: "#6090 Acme — leak", assignee_name: "Sam Tech", limit_days: 2 };
    expect(ticketUntouchedNotice(u, "2026-11-06", "2026-10-20T15:00:00Z", "2026-11-11")).toEqual({
      title: "Untouched ticket: #6090 Acme — leak",
      body: "Assigned to Sam Tech; due Friday 11/6/2026 and not started, 3 working days later. Limit is 2 working days.",
    });
    expect(
      ticketUntouchedNotice(
        { ...u, assignee_name: null, limit_days: 1 },
        "2026-11-06",
        "2026-11-11T15:00:00Z",
        "2026-11-12",
      ).body,
    ).toBe(
      "Assigned to someone 1 working day ago; due Friday 11/6/2026 and not started. Limit is 1 working day.",
    );
  });
  it("the escalation repeats in working days and never on a weekend", () => {
    expect(ticketEscalationDue(null, "2026-11-10", 3)).toBe(true); // the first: at once
    expect(ticketEscalationDue(null, "2026-11-14", 3)).toBe(false); // not on a Saturday
    const tue = "2026-11-10T15:00:00Z";
    expect(ticketEscalationDue(tue, "2026-11-12", 3)).toBe(false); // 2 working days
    expect(ticketEscalationDue(tue, "2026-11-13", 3)).toBe(true); // Friday: 3
    const thu = "2026-11-12T15:00:00Z";
    expect(ticketEscalationDue(thu, "2026-11-15", 3)).toBe(false); // Sunday, the 3rd calendar day
    expect(ticketEscalationDue(thu, "2026-11-16", 3)).toBe(false); // Monday: 2 working days
    expect(ticketEscalationDue(thu, "2026-11-17", 3)).toBe(true); // Tuesday: 3
  });
});

describe("the migration 20261113120000_ticket_reminders_working_days.sql", () => {
  const sql = readFileSync(
    "supabase/migrations/20261113120000_ticket_reminders_working_days.sql",
    "utf8",
  );
  const flat = sql.replace(/\s+/g, " ");
  it("adds the two settings with their defaults, blank allowed, idempotently", () => {
    expect(flat).toContain("add column if not exists ticket_before_every_days integer default 3,");
    expect(flat).toContain("add column if not exists ticket_due_notice_days integer default 1;");
    expect(flat).toContain(
      "check (ticket_before_every_days is null or ticket_before_every_days between 1 and 365)",
    );
    expect(flat).toContain(
      "check (ticket_due_notice_days is null or ticket_due_notice_days between 1 and 30)",
    );
  });
  it("every claim of a ticket's reminder sets the next one by the rule, whoever claimed it", () => {
    expect(flat).toContain(
      "if new.kind = 'ticket' and new.status = 'open' and new.reminders_sent = old.reminders_sent + 1 then",
    );
    expect(flat).toContain(
      "new.next_remind_at := public.ticket_next_remind_at( new.due_at, public.office_day(coalesce(new.last_reminded_at, now())), v_before, v_notice, new.every_days);",
    );
    // After the guard, before the updated_at stamp: triggers fire in name order.
    expect(flat).toContain(
      "create trigger crm_followups_ticket_next before update on public.crm_followups for each row execute function public.crm_followups_ticket_next();",
    );
    expect(
      [
        "crm_followups_manager_only",
        "crm_followups_updated_at",
        "crm_followups_ticket_next",
      ].sort(),
    ).toEqual([
      "crm_followups_manager_only",
      "crm_followups_ticket_next",
      "crm_followups_updated_at",
    ]);
  });
  it("a ticket's first reminder, and a date moved to a day still ahead, follow the rule", () => {
    expect(flat).toContain("v_ahead := p_kind = 'ticket' and public.office_day(v_due) > v_today;");
    expect(flat).toContain(
      "when v_ahead then public.ticket_next_remind_at( v_due, v_today, v_s.ticket_before_every_days, v_s.ticket_due_notice_days, v_every)",
    );
    expect(flat).toContain(
      "when v_date_moved and (reminders_sent = 0 or v_snooze_cleared or v_ahead) then v_first_remind",
    );
    // Opportunities and the review timer keep their lines.
    expect(flat).toContain(
      "when p_kind = 'opportunity' then least(now() + make_interval(days => v_first), v_due)",
    );
    expect(flat).toContain("else greatest(v_due, now())");
    expect(flat).toContain("'first_remind_at', v_first_remind");
  });
  it("crm_untouched(): the ticket half has the new meaning; the opportunity half is unchanged, character for character", () => {
    const was = readFileSync("supabase/migrations/20260928120000_untouched.sql", "utf8");
    const fn = (text: string) => {
      const from = text.indexOf("create or replace function public.crm_untouched()");
      return text.slice(from, text.indexOf("$$;", from) + 3);
    };
    const before = fn(was);
    const after = fn(sql);
    const oppHalf = (text: string) => text.slice(text.indexOf("  union all"));
    expect(oppHalf(after)).toBe(oppHalf(before));
    expect(oppHalf(after)).toContain("and o.status = 'open' and o.contacted_at is null");
    // Everything above the ticket's own conditions is unchanged too: the columns, the limits,
    // who may see it.
    const head = (text: string) => text.slice(0, text.indexOf("and j.technician_id is not null"));
    expect(head(after)).toBe(head(before));
    // The diff, whole: two lines out, seven in.
    const lines = (text: string) => text.split("\n");
    expect(lines(before).filter((l) => !lines(after).includes(l))).toEqual([
      "     and j.stage = 'open' and j.scheduled_date is null and j.field_status is null",
      "     and j.contacted_at is null",
    ]);
    expect(lines(after).filter((l) => !lines(before).includes(l))).toEqual([
      "     and j.stage in ('open', 'scheduled') and j.field_status is null",
      "     and j.scheduled_date < public.office_day(now())",
      "     and not exists (select 1 from public.service_time_entries e where e.service_job_id = j.id)",
      "     and (j.contacted_at is null or public.office_day(j.contacted_at) < j.scheduled_date)",
      "     and public.working_days_between(",
      "           greatest(j.scheduled_date, public.office_day(j.assigned_at)),",
      "           public.office_day(now())) >= s.t",
    ]);
  });
  it("nothing new is open to a signed-out visitor, and the helpers to nobody outside the database", () => {
    for (const fn of [
      "office_day(timestamptz)",
      "add_working_days(date, integer)",
      "working_days_before(date, integer)",
      "working_days_between(date, date)",
    ])
      expect(flat).toContain(
        `revoke all on function public.${fn} from public, anon, authenticated;`,
      );
    expect(flat).toContain(
      "revoke all on function public.ticket_next_remind_day(date, date, integer, integer, integer) from public, anon, authenticated;",
    );
    expect(flat).toContain("revoke all on function public.crm_untouched() from public, anon;");
    expect(flat).toContain(
      "grant execute on function public.crm_untouched() to authenticated, service_role;",
    );
    expect(flat).not.toMatch(/grant [^;]* to anon/);
  });
  it("the open timers: only one still waiting on its date with no reminder sent, never a burst", () => {
    expect(flat).toContain("and t.reminders_sent = 0");
    expect(flat).toContain("and (t.snoozed_until is null or t.snoozed_until <= now())");
    expect(flat).toContain("and public.office_day(t.due_at) > v_today");
    expect(flat).toContain("and t.next_remind_at >= t.due_at");
    expect(flat).toContain(
      "case when r.by_rule > now() then r.by_rule else least(t.due_at, v_morning) end",
    );
  });
});
