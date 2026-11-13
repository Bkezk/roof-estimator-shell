/**
 * The morning is 8:00 in the office, all year (owner, Nov 13: "lets do 8AM est instead of 7 am
 * plz"). A follow-up's due instant and a ticket's reminder were written at 12:00 UTC of their
 * day — 8 AM Eastern in summer, 7 AM in winter. They are now 8:00 on the office's clock:
 * reminderMorning (src/lib/working-days.ts) and the database's reminder_morning()
 * (20261113130000_reminder_morning_8am.sql), held here to one table of days.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { backFromHoldNotice } from "@/lib/followup-holds";
import { startNotice } from "@/lib/followups.server";
import { TASK_TZ, localHm } from "@/lib/tasks";
import {
  TICKET_REMINDER_DEFAULTS,
  dayMorning,
  ticketFirstRemindAt,
  ticketNextRemindAt,
  ticketReminderNotice,
  ticketReminderPhase,
  ticketStartTail,
  ticketUntouchedNotice,
} from "@/lib/ticket-reminders";
import {
  REMINDER_MORNING,
  addWorkingDays,
  officeDay,
  plusDays,
  reminderMorning,
} from "@/lib/working-days";

const ON = TICKET_REMINDER_DEFAULTS;
const read = (p: string) => readFileSync(p, "utf8");
const flat = (s: string) => s.replace(/\s+/g, " ");

/**
 * `sql` is what reminder_morning(day) answered on PostgreSQL 16 for that day (the migration
 * file run as written; docs/qa/ticket-reminders-working-days-2026-11-13.md says where).
 */
const MORNINGS: readonly { day: string; what: string; sql: string }[] = [
  { day: "2026-11-13", what: "a winter day", sql: "2026-11-13T13:00:00Z" },
  { day: "2026-07-15", what: "a summer day", sql: "2026-07-15T12:00:00Z" },
  { day: "2026-10-31", what: "the day before the clocks go back", sql: "2026-10-31T12:00:00Z" },
  { day: "2026-11-01", what: "the day the clocks go back", sql: "2026-11-01T13:00:00Z" },
  { day: "2026-11-02", what: "the day after", sql: "2026-11-02T13:00:00Z" },
  { day: "2027-03-13", what: "the day before the clocks go forward", sql: "2027-03-13T13:00:00Z" },
  { day: "2027-03-14", what: "the day the clocks go forward", sql: "2027-03-14T12:00:00Z" },
  { day: "2027-03-15", what: "the day after", sql: "2027-03-15T12:00:00Z" },
  { day: "2026-03-07", what: "the day before this spring's change", sql: "2026-03-07T13:00:00Z" },
  { day: "2026-03-08", what: "this spring's change", sql: "2026-03-08T12:00:00Z" },
  { day: "2026-12-31", what: "New Year's Eve", sql: "2026-12-31T13:00:00Z" },
  { day: "2028-02-29", what: "a leap day", sql: "2028-02-29T13:00:00Z" },
];

describe("8:00 in the office is one instant per day, the same in the app and the database", () => {
  it.each(MORNINGS)("$day ($what) is $sql", ({ day, sql }) => {
    expect(reminderMorning(day).toISOString()).toBe(sql.replace("Z", ".000Z"));
    expect(dayMorning(day)).toBe(sql.replace("Z", ".000Z"));
  });
  it("13:00 UTC in winter, 12:00 UTC in summer", () => {
    expect(reminderMorning("2026-11-13").toISOString()).toBe("2026-11-13T13:00:00.000Z");
    expect(reminderMorning("2026-07-15").toISOString()).toBe("2026-07-15T12:00:00.000Z");
    expect(REMINDER_MORNING).toBe("08:00");
  });
  it("reads 8:00 on the office's clock every day for two years, and is that same day", () => {
    for (let day = "2026-01-01"; day <= "2027-12-31"; day = plusDays(day, 1)) {
      const at = reminderMorning(day);
      expect(localHm(at, TASK_TZ)).toBe("08:00");
      expect(officeDay(at)).toBe(day);
      // The same calendar day in UTC too, so nothing that slices the date out of the instant
      // moves a day.
      expect(at.toISOString().slice(0, 10)).toBe(day);
    }
  });
  it("a follow-up written at the old 12:00 UTC still reads as its own day", () => {
    for (const day of ["2026-11-15", "2026-07-15", "2026-11-01", "2027-03-14"])
      expect(officeDay(`${day}T12:00:00Z`)).toBe(day);
  });
});

describe("a ticket's reminders are set to 8:00 in the office", () => {
  const due = reminderMorning("2026-12-14"); // a Monday
  it("the first reminder and every next one, in winter", () => {
    const assigned = new Date("2026-11-13T15:00:00Z");
    expect(ticketFirstRemindAt(due, assigned, ON, 3).toISOString()).toBe(
      "2026-11-18T13:00:00.000Z",
    );
    expect(ticketNextRemindAt(due.toISOString(), "2026-11-18", ON, 3)).toBe(
      "2026-11-23T13:00:00.000Z",
    );
    // The notice day (Friday), then the date itself — the due instant, 8:00 that Monday.
    expect(ticketNextRemindAt(due.toISOString(), "2026-12-09", ON, 3)).toBe(
      "2026-12-11T13:00:00.000Z",
    );
    expect(ticketNextRemindAt(due.toISOString(), "2026-12-11", ON, 3)).toBe(
      "2026-12-14T13:00:00.000Z",
    );
    // After the date: three working days on, 8:00.
    expect(ticketNextRemindAt(due.toISOString(), "2026-12-14", ON, 3)).toBe(
      "2026-12-17T13:00:00.000Z",
    );
  });
  it("in summer the same rule lands on 12:00 UTC, which is 8:00 there", () => {
    const july = reminderMorning("2027-07-20");
    expect(ticketNextRemindAt(july.toISOString(), "2027-07-09", ON, 3)).toBe(
      "2027-07-14T12:00:00.000Z",
    );
  });
  it("across the change of clocks each reminder is still 8:00 on the wall", () => {
    // Assigned Wed Oct 28, 2026 for Thu Nov 5; the clocks go back on Sunday Nov 1.
    const d = reminderMorning("2026-11-05").toISOString();
    const first = ticketNextRemindAt(d, "2026-10-28", ON, 3);
    expect(first).toBe("2026-11-02T13:00:00.000Z");
    expect(localHm(new Date(first), TASK_TZ)).toBe("08:00");
    // The Friday before the change is still summer time: 12:00 UTC.
    expect(ticketNextRemindAt(d, "2026-10-27", ON, 3)).toBe("2026-10-30T12:00:00.000Z");
  });
  it("a winter reminder is not yet due on the 7:00 and 7:30 passes, and is on the 8:00 one", () => {
    const next = Date.parse(ticketNextRemindAt(due.toISOString(), "2026-11-13", ON, 3));
    expect(next).toBeGreaterThan(Date.parse("2026-11-18T12:00:00Z")); // 7:00 AM Eastern
    expect(next).toBeGreaterThan(Date.parse("2026-11-18T12:30:00Z")); // 7:30 AM
    expect(next).toBeLessThanOrEqual(Date.parse("2026-11-18T13:00:00Z")); // 8:00 AM
  });
  it("a timer still carrying a 12:00 UTC due instant gets its next reminders at 8:00", () => {
    // Until the migration moves it, and for a closed-then-read row: the day is the same.
    const old = "2026-12-14T12:00:00+00:00";
    expect(ticketNextRemindAt(old, "2026-11-13", ON, 3)).toBe("2026-11-18T13:00:00.000Z");
    expect(ticketReminderPhase({ due_at: old }, "2026-12-14", ON)).toBe("due");
    expect(addWorkingDays("2026-12-14", 3)).toBe("2026-12-17");
  });
});

describe("the words do not print a clock time", () => {
  it('every ticket notice still says the day, and "that morning" where it did', () => {
    const f = {
      title: "Ticket #6090 Acme — leak at the dock",
      due_at: reminderMorning("2026-12-14").toISOString(),
      created_at: "2026-11-13T15:00:00Z",
      last_reminded_at: null,
      every_days: 3,
      reminders_sent: 1,
    };
    const all = [
      ...["2026-11-18", "2026-12-11", "2026-12-14", "2026-12-17"].map((d) => {
        const n = ticketReminderNotice(f, reminderMorning(d), ON);
        return `${n.title} ${n.body}`;
      }),
      ticketStartTail(new Date(f.due_at), reminderMorning("2026-11-18"), 3, new Date(f.created_at)),
      ticketStartTail(new Date(f.due_at), new Date(f.due_at), 3, new Date(f.created_at)),
      ticketUntouchedNotice(
        { title: "#6090 Acme", assignee_name: "Sam Tech", limit_days: 2 },
        "2026-11-06",
        null,
        "2026-11-11",
      ).body,
    ];
    for (const text of all) expect(text).not.toMatch(/\b\d{1,2}(:\d{2})?\s?(am|pm)\b|\d:\d{2}/i);
    expect(all[1]).toContain("the next one is that morning.");
    expect(all[5]).toBe("Due Monday 12/14/2026; the reminder comes that morning.");
  });
});

describe("the migration 20261113130000_reminder_morning_8am.sql", () => {
  const sql = read("supabase/migrations/20261113130000_reminder_morning_8am.sql");
  const was = read("supabase/migrations/20261113120000_ticket_reminders_working_days.sql");
  const body = flat(sql.replace(/--[^\n]*/g, ""));
  const fn = (text: string, name: string) => {
    const from = text.indexOf(`create or replace function public.${name}(`);
    return text.slice(from, text.indexOf("$$;", from) + 3);
  };
  it("one helper: 8:00 in the office's zone, stable (a zone rule is not immutable)", () => {
    expect(body).toContain(
      `create or replace function public.reminder_morning(p_day date) returns timestamptz language sql stable set search_path = public as $$ select (p_day + time '${REMINDER_MORNING}') at time zone '${TASK_TZ}'; $$;`,
    );
    expect(body).not.toMatch(/reminder_morning\(p_day date\)[^$]*immutable/);
    expect(body).toContain(
      "revoke all on function public.reminder_morning(date) from public, anon, authenticated;",
    );
    expect(body).not.toMatch(/grant [^;]* to anon/);
  });
  it("the two functions that wrote 12:00 UTC call it, and nothing else in them changed", () => {
    const lines = (t: string) => t.split("\n");
    const changed = (name: string) => {
      const a = lines(fn(was, name));
      const b = lines(fn(sql, name));
      return {
        out: a.filter((l) => !b.includes(l)),
        in: b.filter((l) => !a.includes(l)),
        same: a.length === b.length,
      };
    };
    expect(changed("ticket_next_remind_at")).toEqual({
      out: ["              else (x.d + time '12:00') at time zone 'UTC' end"],
      in: ["              else public.reminder_morning(x.d) end"],
      same: true,
    });
    expect(changed("followup_sync_upsert")).toEqual({
      out: ["    when p_due_date is not null then (p_due_date + time '12:00') at time zone 'UTC'"],
      in: ["    when p_due_date is not null then public.reminder_morning(p_due_date)"],
      same: true,
    });
    // The "date moved" check is the same comparison, now against the 8:00 instant.
    expect(fn(sql, "followup_sync_upsert")).toContain(
      "if p_due_date is not null and f.due_at is distinct from v_due then",
    );
  });
  it("the open follow-ups: exactly-12:00-UTC instants move to that day's morning; one due now stays due", () => {
    expect(body).toContain(
      "case when t.due_at = ((t.due_at at time zone 'UTC')::date + time '12:00') at time zone 'UTC' then public.reminder_morning((t.due_at at time zone 'UTC')::date) else t.due_at end as new_due",
    );
    expect(body).toContain(
      "case when t.next_remind_at > now() and t.next_remind_at = ((t.next_remind_at at time zone 'UTC')::date + time '12:00') at time zone 'UTC' then public.reminder_morning((t.next_remind_at at time zone 'UTC')::date) else t.next_remind_at end as new_next",
    );
    expect(body).toContain("where t.status = 'open'");
    // Only a row whose instant would change is written (a second run changes nothing).
    expect(body).toContain(
      "and (f.due_at is distinct from c.new_due or f.next_remind_at is distinct from c.new_next);",
    );
    // Written under the flag the follow-up guard accepts; the claim trigger is not involved
    // (the reminder count does not change).
    expect(body).toContain("perform set_config('jbk.followup_sync', 'on', true);");
    expect(body.slice(body.indexOf("do $$"))).not.toContain("reminders_sent");
  });
  it("the applied migration was not edited", () => {
    expect(was).toContain("else (x.d + time '12:00') at time zone 'UTC' end");
    expect(was).not.toContain("reminder_morning");
  });
});

describe("the app's own writes, the page and the schedule", () => {
  it("the sync's direct write (before the database function exists) uses the same morning", () => {
    const src = read("src/lib/followups.server.ts");
    expect(src).not.toContain("T12:00:00Z");
    expect(src).not.toContain("dateAtNoonUtc");
    expect(flat(src)).toContain("reminderMorning(a.dueDate)");
    const rules = read("src/lib/ticket-reminders.ts");
    expect(rules).not.toContain("T12:00:00");
    expect(rules).toContain(
      "export const dayMorning = (ymd: string): string => reminderMorning(ymd).toISOString();",
    );
  });
  it("Admin › Reminders says when ticket reminders go out, with the ticket lines", () => {
    const page = flat(read("src/components/reminders-settings.tsx"));
    expect(page).toContain(
      '<Line label="Time of day">Ticket reminders go out at 8 AM Eastern.</Line>',
    );
    const at = (s: string) => page.indexOf(s);
    expect(at('title="Tickets"')).toBeLessThan(at('<Line label="Time of day">'));
    expect(at('<Line label="Time of day">')).toBeLessThan(at('title="Bids"'));
    // "That morning" stays as it was.
    expect(page).toContain(
      '<Line label="On the date">That morning, also on a Saturday or Sunday.</Line>',
    );
  });
  it("the schedule is unchanged and its comment is true in both seasons", () => {
    const y = read(".github/workflows/reminders.yml");
    expect(y).toContain('- cron: "*/30 12-23 * * *"');
    expect(y).not.toContain("8am–7pm Eastern");
    const note = flat(y.replace(/\n\s*#/g, " "));
    expect(note).toContain(
      "Every 30 minutes from 12:00 to 23:30 UTC: 8:00 AM to 7:30 PM Eastern in summer, 7:00 AM to 6:30 PM Eastern in winter.",
    );
    expect(note).toContain(
      "the first run after that is the 12:00 UTC one in summer and the 13:00 UTC one in winter",
    );
    // The arithmetic behind the comment: 12:00 UTC is 8:00 in July and 7:00 in January.
    expect(localHm(new Date("2026-07-15T12:00:00Z"), TASK_TZ)).toBe("08:00");
    expect(localHm(new Date("2026-01-15T12:00:00Z"), TASK_TZ)).toBe("07:00");
    expect(localHm(new Date("2026-01-15T13:00:00Z"), TASK_TZ)).toBe("08:00");
    expect(localHm(new Date("2026-07-15T23:30:00Z"), TASK_TZ)).toBe("19:30");
    expect(localHm(new Date("2026-01-15T23:30:00Z"), TASK_TZ)).toBe("18:30");
  });
});

describe('a ticket notice says "Ticket" once (owner, Nov 13: "update the wording so it doesnt double say ticket")', () => {
  const TITLE = "Ticket #6090 Acme Supply — leak at the dock";
  const due = reminderMorning("2026-12-14");
  const base = {
    title: TITLE,
    actorName: "Roe",
    due,
    every: 3,
    now: new Date("2026-11-13T15:00:00Z"),
  };
  it("assigned and reopened: the lead-in no longer repeats the word", () => {
    expect(startNotice({ ...base, kind: "ticket", reopened: false }).title).toBe(
      "Assigned to you: Ticket #6090 Acme Supply — leak at the dock",
    );
    expect(startNotice({ ...base, kind: "ticket", reopened: true }).title).toBe(
      "Reopened: Ticket #6090 Acme Supply — leak at the dock",
    );
    // The old strings are gone.
    for (const reopened of [false, true]) {
      const t = startNotice({ ...base, kind: "ticket", reopened }).title;
      expect(t).not.toMatch(/^Ticket (assigned to you|reopened):/);
    }
    // The bodies are as they were.
    expect(startNotice({ ...base, kind: "ticket", reopened: true }).body).toMatch(
      /^Roe reopened this\. Due Monday 12\/14\/2026;/,
    );
  });
  it('untouched: "Untouched: Ticket #6090 …" (the list\'s own title starts at the number)', () => {
    const n = ticketUntouchedNotice(
      { title: "#6090 Acme Supply — leak at the dock", assignee_name: "Sam Tech", limit_days: 2 },
      "2026-11-06",
      null,
      "2026-11-11",
    );
    expect(n.title).toBe("Untouched: Ticket #6090 Acme Supply — leak at the dock");
    expect(n.title).not.toContain("Untouched ticket");
  });
  it("every title a ticket's person can get says the word exactly once; the count stays", () => {
    const f = {
      title: TITLE,
      due_at: due.toISOString(),
      created_at: "2026-11-13T15:00:00Z",
      last_reminded_at: null,
      every_days: 3,
      reminders_sent: 6,
    };
    const reminders = ["2026-11-18", "2026-12-11", "2026-12-14", "2026-12-17"].map((d) =>
      ticketReminderNotice(f, reminderMorning(d), ON),
    );
    const titles = [
      startNotice({ ...base, kind: "ticket", reopened: false }).title,
      startNotice({ ...base, kind: "ticket", reopened: true }).title,
      ...reminders.map((n) => n.title),
      backFromHoldNotice({
        title: TITLE,
        snoozed_until: "2026-11-19T13:00:00Z",
        hold_reason: "Waiting on the customer",
      }).title,
      ticketUntouchedNotice(
        { title: TITLE.replace("Ticket ", ""), assignee_name: "Sam Tech", limit_days: 2 },
        "2026-11-06",
        null,
        "2026-11-11",
      ).title,
    ];
    expect(titles).toEqual([
      `Assigned to you: ${TITLE}`,
      `Reopened: ${TITLE}`,
      `Follow up: ${TITLE}`,
      `Due Monday: ${TITLE}`,
      `Follow up: ${TITLE}`,
      `Follow up: ${TITLE}`,
      `Back from hold: ${TITLE}`,
      `Untouched: ${TITLE}`,
    ]);
    for (const t of titles) expect(t.match(/ticket/gi)).toHaveLength(1);
    // "i almost want a bit of nagging so thats fine on the reminder count": it stays in each.
    expect(reminders.map((n) => /Reminder 7[;.]/.test(n.body))).toEqual([true, true, true, true]);
  });
  it("opportunities and the review timer keep their own words", () => {
    const opp = { ...base, title: "Dock roof", kind: "opportunity" as const };
    expect(startNotice({ ...opp, reopened: false }).title).toBe(
      "Opportunity assigned to you: Dock roof",
    );
    expect(startNotice({ ...opp, reopened: true }).title).toBe("Opportunity reopened: Dock roof");
    expect(
      startNotice({
        ...base,
        kind: "invoice",
        title: "Authorize Ticket #6090 Acme",
        reopened: false,
      }).title,
    ).toBe("Authorize Ticket #6090 Acme — ready for your review");
  });
});
