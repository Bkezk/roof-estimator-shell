/**
 * The "still not paid" reminder goes at 8:00, by the office's days (the audit of Nov 25, 2026,
 * fix 27; owner: "go on ... 27"). Nov 26, 2026.
 *
 * The record says a plan that is signed and not paid is told "again every two days at 8 AM on
 * a working day". The rule was "48 hours since it was last told", from 8:00 on: a plan signed
 * on a Monday at 2:15 PM was reminded on Wednesday afternoon, and one told at 8:50 PM was
 * reminded at about 9 PM two days later, when somebody opened a page. Now the days are office
 * days: last told on day D, due from 8:00 on the first working day that is at least two days
 * after D. And a plan whose bank payment is clearing is not told "no payment is recorded".
 *
 * The rule is tested here in its TypeScript form (planPayReminderDue); the database holds the
 * same rule and is the one that decides, and its text is read below. Places are made up.
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const sent = vi.fn<(...a: unknown[]) => Promise<number>>(async () => 1);
vi.mock("@/lib/notify.server", () => ({
  notify: (...a: unknown[]) => sent(...a),
  serverClient: async (sb: unknown) => sb,
  hasServiceRole: () => true,
}));

import {
  PLAN_BANK_CLEARING_DAYS,
  PLAN_CARD_WAIT_MINUTES,
  PLAN_PAY_REMIND_DAYS,
  planPayReminderDay,
  planPayReminderDue,
  planPayRemindersOpen,
} from "@/lib/roof-care-pay-notice";
import { dispatchPlanPayNotices } from "@/lib/roof-care-notify.server";
import { fakeSupabase } from "@/test/fake-supabase";

const flat = (p: string) => readFileSync(p, "utf8").replace(/\s+/g, " ");
const MIGRATION = "supabase/migrations/20261125500000_email_count_and_pay_reminder.sql";

/**
 * An instant on the office's clock in the week of Monday Dec 20, 2027 (winter: five hours
 * behind UTC). "Mon 14:15" is 2:15 PM on the Monday; the next week's days are "Mon+ 08:00".
 */
const DAYS: Record<string, string> = {
  Mon: "2027-12-20",
  Tue: "2027-12-21",
  Wed: "2027-12-22",
  Thu: "2027-12-23",
  Fri: "2027-12-24",
  Sat: "2027-12-25",
  Sun: "2027-12-26",
  "Mon+": "2027-12-27",
  "Tue+": "2027-12-28",
};
const at = (when: string): Date => {
  const [day = "", time = ""] = when.split(" ");
  return new Date(`${DAYS[day]}T${time}:00-05:00`);
};

beforeEach(() => {
  sent.mockReset();
  sent.mockResolvedValue(1);
});

describe("the two days are office days, and the reminder goes from 8:00", () => {
  // [last told, now, due]
  const cases: [string, string, boolean][] = [
    // Signed and told on a Monday afternoon: Wednesday morning, not Wednesday afternoon.
    ["Mon 14:15", "Tue 08:00", false],
    ["Mon 14:15", "Tue 16:00", false],
    ["Mon 14:15", "Wed 07:59", false],
    ["Mon 14:15", "Wed 08:00", true],
    ["Mon 14:15", "Wed 08:01", true],
    ["Mon 14:15", "Wed 14:16", true],
    // Told at night (a card plan left at the card screen): the morning two days on.
    ["Mon 20:50", "Wed 07:59", false],
    ["Mon 20:50", "Wed 08:00", true],
    // Told first thing in the morning: the same morning two days on.
    ["Mon 08:02", "Wed 08:00", true],
    // Two days that end on a weekend: Monday.
    ["Thu 10:00", "Fri 17:00", false],
    ["Thu 10:00", "Sat 09:00", false],
    ["Thu 10:00", "Sun 09:00", false],
    ["Thu 10:00", "Mon+ 07:59", false],
    ["Thu 10:00", "Mon+ 08:00", true],
    ["Fri 16:30", "Sun 16:31", false],
    ["Fri 16:30", "Mon+ 08:00", true],
    // Told on a weekend (a card plan's first notice goes at any hour).
    ["Sat 11:00", "Mon+ 08:00", true],
    ["Sun 23:30", "Mon+ 08:00", false],
    ["Sun 23:30", "Tue+ 08:00", true],
    // A pass that was missed that morning still sends it later the same day.
    ["Mon 14:15", "Thu 11:00", true],
  ];
  it.each(cases)("last told %s, at %s: due %s", (last, now, due) => {
    expect(planPayReminderDue(at(last), at(now))).toBe(due);
    // As the database hands the stamp back: a string.
    expect(planPayReminderDue(at(last).toISOString(), at(now))).toBe(due);
  });
  it("the old rule, 48 hours since, got the afternoon and the night wrong", () => {
    const hours48 = (last: Date, now: Date) =>
      planPayRemindersOpen(now) && now.getTime() - last.getTime() >= 48 * 3600 * 1000;
    // Wednesday 8:01 after a Monday 2:15 PM: the old rule waited until the afternoon.
    expect(hours48(at("Mon 14:15"), at("Wed 08:01"))).toBe(false);
    expect(planPayReminderDue(at("Mon 14:15"), at("Wed 08:01"))).toBe(true);
    // A Monday 8:50 PM: the old rule first said yes on Wednesday at 8:50 PM.
    expect(hours48(at("Mon 20:50"), at("Wed 20:49"))).toBe(false);
    expect(planPayReminderDue(at("Mon 20:50"), at("Wed 08:00"))).toBe(true);
  });
  it("the day it is due, and the clocks' change does not move it", () => {
    expect(planPayReminderDay(at("Mon 14:15"))).toBe("2027-12-22");
    expect(planPayReminderDay(at("Thu 10:00"))).toBe("2027-12-27");
    expect(planPayReminderDay(at("Fri 16:30"))).toBe("2027-12-27");
    expect(planPayReminderDay(at("Sat 11:00"))).toBe("2027-12-27");
    // Late on a Sunday evening in the office is already Monday in UTC: the office's day counts.
    expect(planPayReminderDay(at("Sun 23:30"))).toBe("2027-12-28");
    // Friday Mar 10, 2028, 3 PM (winter time); the clocks go forward on Sunday the 12th. Due
    // Monday the 13th at 8:00 summer time, which is 12:00 UTC, and not at 7:59.
    const friday = new Date("2028-03-10T20:00:00Z");
    expect(planPayReminderDay(friday)).toBe("2028-03-13");
    expect(planPayReminderDue(friday, new Date("2028-03-13T11:59:00Z"))).toBe(false);
    expect(planPayReminderDue(friday, new Date("2028-03-13T12:00:00Z"))).toBe(true);
  });
  it("a plan never told has no reminder, and the days are two", () => {
    expect(planPayReminderDue(null, at("Wed 09:00"))).toBe(false);
    expect(planPayReminderDue(undefined, at("Wed 09:00"))).toBe(false);
    expect(PLAN_PAY_REMIND_DAYS).toBe(2);
    expect(planPayReminderDue(at("Mon 14:15"), at("Thu 08:00"), 3)).toBe(true);
    expect(planPayReminderDue(at("Mon 14:15"), at("Wed 08:00"), 3)).toBe(false);
    // A setting that is not a number of days is read as the two days.
    expect(planPayReminderDay(at("Mon 14:15"), 0)).toBe("2027-12-22");
    expect(planPayReminderDay(at("Mon 14:15"), Number.NaN)).toBe("2027-12-22");
  });
});

describe("the pass", () => {
  const world = () =>
    fakeSupabase(
      { profiles: [{ id: "11111111-1111-4111-8111-111111111111", role: "admin" }] },
      { rpcs: { roof_care_pay_notice_claim: () => [], roof_care_pay_notice_release: () => null } },
    );
  const asked = async (now: Date) => {
    const env = world();
    await dispatchPlanPayNotices(env.db, { now });
    return env.rpcCalls.filter((c) => c.fn === "roof_care_pay_notice_claim").map((c) => c.args);
  };
  it("asks for reminders from 8:00 on a working day, and for the sign-ups at any hour", async () => {
    const settings = { p_plan: null, p_days: 2, p_card_wait: PLAN_CARD_WAIT_MINUTES };
    expect(await asked(at("Wed 07:59"))).toEqual([{ ...settings, p_reminders: false }]);
    expect(await asked(at("Wed 08:00"))).toEqual([{ ...settings, p_reminders: true }]);
    expect(await asked(at("Sat 10:00"))).toEqual([{ ...settings, p_reminders: false }]);
    expect(planPayRemindersOpen(at("Wed 08:00"))).toBe(true);
    expect(planPayRemindersOpen(at("Sun 12:00"))).toBe(false);
  });
});

describe("the database's side", () => {
  const sql = flat(MIGRATION);
  const body = (name: string, end: string) => {
    const from = sql.indexOf(`create or replace function public.${name}(`);
    expect(from).toBeGreaterThan(-1);
    return sql.slice(from, sql.indexOf(end, from));
  };
  const rule = body("roof_care_pay_remind_due", "$function$;");
  const claim = body("roof_care_pay_notice_claim", "$$;");

  it("the rule is the same one: a working day, from 8:00, at least the days after the day told", () => {
    expect(rule).toContain(
      "roof_care_pay_remind_due( p_last timestamptz, p_now timestamptz, p_days integer default 2 ) returns boolean",
    );
    expect(rule).toContain("and extract(isodow from (p_now at time zone 'America/New_York')) < 6");
    expect(rule).toContain("and (p_now at time zone 'America/New_York')::time >= time '08:00'");
    expect(rule).toContain(
      "and (p_now at time zone 'America/New_York')::date >= (p_last at time zone 'America/New_York')::date + greatest(coalesce(p_days, 2), 1);",
    );
    // No count of hours is left in it.
    expect(rule).not.toMatch(/interval|make_interval|hours/);
  });
  it("the claim asks the rule, and no longer counts 48 hours", () => {
    expect(claim).toContain(
      "and public.roof_care_pay_remind_due( greatest(p.pay_notified_at, coalesce(p.pay_link_sent_at, p.pay_notified_at)), now(), p_days))",
    );
    expect(claim).not.toContain("make_interval(days =>");
    // The line of Nov 24, which is what is replaced.
    expect(flat("supabase/migrations/20261124970000_roof_care_pay_notice_card.sql")).toContain(
      "<= now() - make_interval(days => greatest(coalesce(p_days, 2), 1)))",
    );
    // Still only with the morning run's word, and never with a plan named (the sign-up).
    expect(claim).toContain(
      "or (p_plan is null and coalesce(p_reminders, false) and p.pay_notified_at is not null and public.roof_care_pay_remind_due(",
    );
  });
  it("a plan whose bank payment is clearing is not told while it clears", () => {
    expect(claim).toContain(
      `and (p.bank_pending_at is null or p.bank_pending_at < now() - interval '${PLAN_BANK_CLEARING_DAYS} days')`,
    );
    expect(PLAN_BANK_CLEARING_DAYS).toBe(10);
    // The column is stream 1's (20261125100000); this file names it again so it runs alone.
    expect(sql).toContain(
      "alter table public.roof_care_plans add column if not exists bank_pending_at timestamptz;",
    );
    expect(
      sql.indexOf("add column if not exists bank_pending_at") <
        sql.indexOf("create or replace function public.roof_care_pay_notice_claim("),
    ).toBe(true);
  });
  it("what stays: the sign-up's notice, the card plan's 30 minutes, paid and ended plans", () => {
    const before = flat("supabase/migrations/20261124970000_roof_care_pay_notice_card.sql");
    for (const line of [
      "where p.status = 'awaiting_payment'",
      "and (p_plan is null or p.id = p_plan)",
      "(p.pay_notified_at is null and (p.pay_method is distinct from 'card' or (p_plan is null and p.created_at <= now() - make_interval(mins => greatest(coalesce(p_card_wait, 30), 1)))))",
      "for update of p skip locked",
      "set pay_notified_at = now()",
      "greatest(0, (now() at time zone 'America/New_York')::date - m.signed_on)::integer",
    ]) {
      expect(before).toContain(line);
      expect(claim).toContain(line);
    }
    // A plan in force with an open invoice for a roof size difference is 'active': the claim
    // reads the plan's own status and no invoice, so that invoice can never set it off.
    expect(claim).not.toContain("invoices");
    // The same four settings and the same answer: nothing is dropped, and the server's call
    // and the release are as they were.
    expect(claim).toContain(
      "roof_care_pay_notice_claim( p_plan uuid default null, p_days integer default 2, p_reminders boolean default false, p_card_wait integer default 30 )",
    );
    expect(sql).not.toContain("drop function");
    expect(sql).not.toContain("roof_care_pay_notice_release");
  });
  it("the site's server alone calls them", () => {
    for (const fn of [
      "roof_care_pay_notice_claim(uuid, integer, boolean, integer)",
      "roof_care_pay_remind_due(timestamptz, timestamptz, integer)",
    ]) {
      expect(sql).toContain(
        `revoke all on function public.${fn} from public, anon, authenticated;`,
      );
      expect(sql).toContain(`grant execute on function public.${fn} to service_role;`);
    }
    expect(claim).toContain("language plpgsql security definer set search_path = public");
  });
});
