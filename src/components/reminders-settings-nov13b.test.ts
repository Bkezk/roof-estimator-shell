/**
 * Admin › Reminders and the lists after the ticket reminders changed (owner, Nov 13: "that can
 * also be edited in settings" … "ensure the wording and editing is similar to our previous
 * notifications editing and wordings" … "give it the new meaning for untouched tickets").
 *
 * The two new numbers sit with the ticket numbers, as boxes that are blank when off like the
 * bids' past-due one; the save refuses a bad number in the page's usual words; the ticket lines
 * say working days; and "untouched", for a ticket, says its new meaning wherever it is shown.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { isPastLimit } from "@/lib/contact-log.functions";
import { WORKING_DAYS_NOTE } from "@/lib/alert-rules";
import { settingsSchema } from "@/lib/followups.functions";
import { KIND_CATEGORIES, NOTICE_CATEGORY_HELP, noticeCategory } from "@/lib/notice-categories";
import { KIND_LABELS, kindLabel } from "@/lib/notifications.functions";
import { TICKET_BEFORE_EVERY_DAYS_MAX, TICKET_DUE_NOTICE_DAYS_MAX } from "@/lib/ticket-reminders";

const page = readFileSync("src/components/reminders-settings.tsx", "utf8");
const flat = page.replace(/\s+/g, " ");
const log = readFileSync("src/components/crm/contact-log.tsx", "utf8").replace(/\s+/g, " ");
const logFns = readFileSync("src/lib/contact-log.functions.ts", "utf8").replace(/\s+/g, " ");
const service = readFileSync("src/components/service-page.tsx", "utf8").replace(/\s+/g, " ");

const saved = {
  opportunity_close_days: 30,
  opportunity_every_days: 7,
  // Nov 18: the standard lines (alert-rules.ts). The old first-reminder number and the single
  // "Also tell" list left the save.
  opportunity_before_every_days: 7 as number | null,
  opportunity_due_notice_days: null as number | null,
  opportunity_unassigned_days: 1,
  opportunity_unassigned_every_days: 3 as number | null,
  ticket_review_every_days: 3,
  ticket_unassigned_every_days: 3 as number | null,
  alert_who: {} as Record<string, string[]>,
  ticket_first_days: 1,
  ticket_every_days: 3,
  ticket_before_every_days: 3 as number | null,
  ticket_due_notice_days: 1 as number | null,
  ticket_untouched_days: 2,
  opportunity_untouched_days: 3,
  unassigned_overdue_days: 1,
  bid_due_notice_days: 1,
  bid_overdue_every_days: null,
  // Nov 15: the Owner page's Needs attention limits ride in the same save.
  attention_bid_days: 7,
  attention_authorize_days: 3,
};

describe("the save: two more numbers, blank means off", () => {
  it("takes the defaults, other whole numbers in range, and blank", () => {
    expect(settingsSchema.safeParse(saved).success).toBe(true);
    expect(
      settingsSchema.safeParse({
        ...saved,
        ticket_before_every_days: null,
        ticket_due_notice_days: null,
      }).success,
    ).toBe(true);
    expect(
      settingsSchema.safeParse({
        ...saved,
        ticket_before_every_days: TICKET_BEFORE_EVERY_DAYS_MAX,
        ticket_due_notice_days: TICKET_DUE_NOTICE_DAYS_MAX,
      }).success,
    ).toBe(true);
    expect(TICKET_BEFORE_EVERY_DAYS_MAX).toBe(365);
    expect(TICKET_DUE_NOTICE_DAYS_MAX).toBe(30);
  });
  it.each([
    ["0 before the date (blank is how it is switched off)", { ticket_before_every_days: 0 }],
    ["a negative number", { ticket_before_every_days: -3 }],
    ["half a day", { ticket_before_every_days: 2.5 }],
    ["more than a year", { ticket_before_every_days: 366 }],
    ["a notice 0 days before (the date has its own reminder)", { ticket_due_notice_days: 0 }],
    ["a notice more than 30 working days before", { ticket_due_notice_days: 31 }],
    ["text", { ticket_due_notice_days: "1" }],
  ])("refuses %s", (_what, over) => {
    expect(settingsSchema.safeParse({ ...saved, ...over }).success).toBe(false);
  });
  it("needs both keys: an older page cannot wipe them by leaving them out", () => {
    const { ticket_before_every_days: _a, ...withoutOne } = saved;
    expect(settingsSchema.safeParse(withoutOne).success).toBe(false);
  });
});

describe("Admin › Reminders: the two boxes sit with the ticket numbers", () => {
  it("each is a days-or-blank box like the bids' past-due one, with its range", () => {
    // Nov 18: each box is named by its card and line.
    expect(flat).toContain(
      'key: "ticket_before_every_days", label: "Tickets, Coming up: every N working days before the date (blank = off)", min: 1, max: TICKET_BEFORE_EVERY_DAYS_MAX, never: true, },',
    );
    expect(flat).toContain(
      'key: "ticket_due_notice_days", label: "Tickets, Coming up: a notice N working days before the date (blank = off)", min: 1, max: TICKET_DUE_NOTICE_DAYS_MAX, never: true, },',
    );
    // The same box, the same refusal and the same save as every other number on the page.
    expect(flat).toContain("if (f.never) return ( <DaysOrNever");
    expect(flat).toContain("onChange={(e) => props.onChange(blankOrNumber(e.target.value))}");
    expect(flat).toContain(
      '`Check the numbers: ${invalid.map((f) => `“${f.label}” must be a whole number from ${f.min} to ${f.max ?? 365}`).join("; ")}`',
    );
    expect(flat).toContain('toast.success("Reminder settings saved")');
  });
  it("a box starts blank when the setting is off, and shows the saved number otherwise", () => {
    // Before anything has loaded nothing stands in the two boxes.
    expect(flat).toContain("ticket_before_every_days: null, ticket_due_notice_days: null,");
    // Nov 18: the opportunity's two, and the two "then every" boxes, start blank the same way.
    expect(flat).toContain(
      "opportunity_before_every_days: null, opportunity_due_notice_days: null,",
    );
    expect(flat).toContain("ticket_unassigned_every_days: null,");
    expect(flat).toContain("opportunity_unassigned_every_days: null,");
    // Null stays null (blank); only a row from before the migration reads as the defaults.
    expect(flat).toContain(
      "ticket_before_every_days: s.ticket_before_every_days === undefined ? 3 : s.ticket_before_every_days,",
    );
    expect(flat).toContain(
      "ticket_due_notice_days: s.ticket_due_notice_days === undefined ? 1 : s.ticket_due_notice_days,",
    );
    expect(flat).toContain('value={props.value ?? ""}');
  });
  it("the ticket lines say when each reminder goes, in working days", () => {
    // Nov 18: the same lines on every card (alert-rules.ts). "Before the date", "Notice" and "On
    // the date" are one "Coming up" line; "After that" is "Past due". Working days are said
    // once, in the note above the cards, because every kind of work counts them now.
    expect(flat).toContain(
      '<Line label={LINE_LABELS.coming_up} who={picker("ticket", "coming_up")}> Every {field("ticket_before_every_days")} days before the date, and a notice{" "} {field("ticket_due_notice_days")} days before it. Also on the morning of the date. </Line>',
    );
    expect(flat).toContain(
      '<Line label={LINE_LABELS.past_due} who={picker("ticket", "past_due")}> Every {field("ticket_every_days")} days after the date, until it is Done. </Line>',
    );
    expect(WORKING_DAYS_NOTE).toBe(
      "Days are working days. Saturdays and Sundays are not counted, and no alert is sent on one, except a reminder on the item's own date.",
    );
    expect(flat).toContain('<span className="font-medium">{WORKING_DAYS_NOTE}</span>');
    // The order on the page: the note, then the ticket card's lines, then the other cards.
    const at = (s: string) => flat.indexOf(s);
    const order = [
      'data-note="working-days"',
      'type="ticket"',
      'picker("ticket", "coming_up")',
      'picker("ticket", "past_due")',
      'picker("ticket", "not_started")',
      'picker("ticket", "nobody")',
      'picker("ticket", "review")',
      'picker("ticket", "steps")',
      'type="opportunity"',
      'type="bid"',
    ].map(at);
    expect(order.every((n) => n > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // Opportunities and bids are worded the same way (they counted calendar days before).
    expect(flat).toContain(
      'Every {field("opportunity_every_days")} days after it, until it is won, lost or marked No response.',
    );
    expect(flat).toContain('A notice {field("bid_due_notice_days")} days before the due date');
  });
  it("untouched says the new meaning for a ticket", () => {
    // Nov 18: "Untouched work" is each card's "Not started" line; the meaning is unchanged.
    expect(flat).toContain(
      'key: "ticket_untouched_days", label: "Tickets, Not started: N working days after its date", min: 0, },',
    );
    expect(flat).toContain(
      '{field("ticket_untouched_days")} days after its date with nobody started on it, then at the Past due pace.',
    );
    expect(flat).toContain(
      '{field("opportunity_untouched_days")} days after it is assigned with no contact logged, then at the Past due pace.',
    );
    expect(page).not.toContain("days with no contact logged; an");
  });
  it("the boxes are narrow and their lines wrap, so a phone does not scroll sideways", () => {
    // Every number box is a fixed 4rem inside a line that wraps.
    expect(page.match(/<span className="inline-block w-16">/g)?.length).toBe(2);
    expect(flat).toContain('<span className="flex flex-wrap items-center gap-x-2 gap-y-1.5">');
    // Nov 18: a line's name, sentence and who-dropdown stack on a phone and sit in a row only
    // on a wide screen; the dropdown fills its column and its text is cut, never pushed wide.
    expect(flat).toContain(
      'className="grid gap-x-4 gap-y-1.5 py-2.5 text-sm lg:grid-cols-[8.5rem_1fr_17rem]"',
    );
    expect(flat).toContain(
      'className="h-[40px] w-full justify-between gap-2 px-2 font-normal lg:h-9"',
    );
  });
});

describe("the lists and tags", () => {
  it("a ticket row is always past the limit (the database only returns those); an opportunity is graded by days assigned", () => {
    const now = new Date("2026-11-13T15:00:00Z");
    const assignedToday = { assigned_at: "2026-11-13T14:00:00Z", limit_days: 2 };
    expect(isPastLimit({ ...assignedToday, kind: "ticket" }, now)).toBe(true);
    expect(isPastLimit({ ...assignedToday, kind: "opportunity" }, now)).toBe(false);
    expect(
      isPastLimit({ kind: "opportunity", assigned_at: "2026-11-10T14:00:00Z", limit_days: 2 }, now),
    ).toBe(true);
    // A row without a kind (older callers) is graded as before.
    expect(isPastLimit(assignedToday, now)).toBe(false);
  });
  it("each ticket row carries its date and the working days it is late", () => {
    expect(logFns).toContain(
      'const ticketIds = rows.filter((r) => r.kind === "ticket").map((r) => r.item_id);',
    );
    expect(logFns).toContain(
      "r.late_days = ticketLate(j.scheduled_date, j.assigned_at ?? r.assigned_at, today).days;",
    );
    expect(logFns).toContain("const today = officeDay(new Date());");
  });
  it("the tag on a ticket reads working days past its date; the strip says both meanings", () => {
    expect(log).toContain(
      '`Due ${dayText(ticket.dueDay)} and nobody has started it, ${n} working day${n === 1 ? "" : "s"} later (${limit})`',
    );
    expect(log).toContain('Untouched{n === null ? "" : ` ${n}d`}');
    expect(log).toContain(
      "An opportunity: assigned longer than the limit with no contact logged. A ticket: its date has passed and nobody has started it. Open it and log the call, text, email or visit, start it, or move its date.",
    );
    expect(log).toContain(
      'ticket={ r.kind === "ticket" ? { dueDay: r.due_day, lateDays: r.late_days } : undefined }',
    );
    expect(service).toContain(
      "ticket={{ dueDay: untouched.due_day, lateDays: untouched.late_days }}",
    );
    // The opportunity's tag is as it was.
    expect(log).toContain(
      'title={`Assigned ${d} day${d === 1 ? "" : "s"} ago with no contact logged and not started (limit ${limitDays}d)`}',
    );
  });
});

describe("the bell and the per-person switches", () => {
  it("every ticket reminder, the notice included, is a Reminder under Service notices — no new kind", () => {
    expect(kindLabel("followup")).toBe("Reminder");
    expect(KIND_LABELS["ticket_due"]).toBeUndefined();
    expect(KIND_CATEGORIES["ticket_due"]).toBeUndefined();
    // Placed by its link, as every follow-up is: a ticket's opens Service.
    expect(noticeCategory("followup", "/service?id=abc")).toBe("service");
    expect(noticeCategory("untouched", "/service?id=abc")).toBe("service");
    expect(noticeCategory("followup", "/opportunities?id=abc")).toBe("opportunities");
    // Nov 17: the admins' and managers' ticket steps joined the line (ticket-watch.ts).
    expect(NOTICE_CATEGORY_HELP.service).toBe(
      "Ticket assignments, reminders, date moves, done and ready-to-invoice notices. Admins and managers: every step of every ticket.",
    );
  });
});
