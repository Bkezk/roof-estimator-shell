/**
 * Owner, Nov 13: "yes plz move those to 8 am" — the task notices ("due today", "overdue") and
 * the three bid notices ("Bid due", "Bid past due", "Bid reminder") wait for 8:00 on the
 * office's clock, as a ticket's reminders do. Before: a task's went at 7:00, and a bid's had no
 * hour at all (the first pass after midnight Eastern).
 */
import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { marker: "admin" } }));

import { dispatchBidDueNotices } from "@/lib/bids-notify.server";
import type { Client } from "@/lib/notify.server";
import { dueTaskNotices, MORNING_HOUR, zonedTime, type NoticeFields } from "@/lib/tasks";
import { morningReached, REMINDER_MORNING, reminderMorning } from "@/lib/working-days";

const et = (ymd: string, hm: string) => zonedTime(ymd, hm, "America/New_York");

describe("one morning for every reminder", () => {
  it("the task hour and the ticket hour are the same: 8", () => {
    expect(MORNING_HOUR).toBe(8);
    expect(REMINDER_MORNING).toBe(`${String(MORNING_HOUR).padStart(2, "0")}:00`);
  });

  it("morningReached: false until 8:00 Eastern, winter and summer", () => {
    // Winter: 8:00 Eastern is 13:00 UTC.
    expect(morningReached(new Date("2026-11-13T05:00:00Z"))).toBe(false); // midnight
    expect(morningReached(new Date("2026-11-13T12:00:00Z"))).toBe(false); // 7:00
    expect(morningReached(new Date("2026-11-13T12:59:59Z"))).toBe(false);
    expect(morningReached(new Date("2026-11-13T13:00:00Z"))).toBe(true);
    expect(morningReached(new Date("2026-11-14T04:59:00Z"))).toBe(true); // 11:59 PM
    // Summer: 8:00 Eastern is 12:00 UTC.
    expect(morningReached(new Date("2026-07-15T11:59:59Z"))).toBe(false);
    expect(morningReached(new Date("2026-07-15T12:00:00Z"))).toBe(true);
    // Late evening in UTC is still the same office day.
    expect(morningReached(new Date("2026-07-16T03:00:00Z"))).toBe(true); // 11 PM on the 15th
    expect(morningReached(new Date("2026-07-16T04:30:00Z"))).toBe(false); // 12:30 AM on the 16th
    expect(reminderMorning("2026-11-13").toISOString()).toBe("2026-11-13T13:00:00.000Z");
  });
});

describe("task notices wait for 8:00", () => {
  const task = (over: Partial<NoticeFields> = {}): NoticeFields =>
    ({
      status: "open",
      all_day: true,
      due_at: et("2026-11-16", "08:00").toISOString(),
      due_date: "2026-11-16",
      created_at: et("2026-11-10", "10:00").toISOString(),
      notified_created_at: et("2026-11-10", "10:00").toISOString(),
      notified_morning_at: null,
      notified_overdue_at: null,
      ...over,
    }) as NoticeFields;
  const kinds = (t: NoticeFields, now: Date) => dueTaskNotices(t, now).map((n) => n.kind);

  it('"due today" is not sent at 7:00 or 7:59; it is at 8:00', () => {
    expect(kinds(task(), et("2026-11-16", "07:00"))).toEqual([]);
    expect(kinds(task(), et("2026-11-16", "07:59"))).toEqual([]);
    expect(kinds(task(), et("2026-11-16", "08:00"))).toEqual(["morning"]);
  });

  it('"overdue" is not sent at 7:00 the next day; it is at 8:00', () => {
    const sent = task({ notified_morning_at: et("2026-11-16", "08:00").toISOString() });
    expect(kinds(sent, et("2026-11-17", "07:00"))).toEqual([]);
    expect(kinds(sent, et("2026-11-17", "07:59"))).toEqual([]);
    expect(kinds(sent, et("2026-11-17", "08:00"))).toEqual(["overdue"]);
  });

  it('"New task" still goes on the first pass, at any hour', () => {
    expect(kinds(task({ notified_created_at: null }), et("2026-11-10", "05:00"))).toEqual([
      "created",
    ]);
  });
});

describe("bid notices wait for 8:00", () => {
  /** A client that fails the test if the pass reads anything. */
  const untouched = () => {
    const calls: string[] = [];
    const client = {
      from: (table: string) => {
        calls.push(table);
        throw new Error(`read ${table} before the morning`);
      },
      rpc: (fn: string) => {
        calls.push(fn);
        throw new Error(`called ${fn} before the morning`);
      },
    } as unknown as Client;
    return { client, calls };
  };

  it("a pass at 7:00 Eastern in winter (the 12:00 UTC scheduled run) reads and sends nothing", async () => {
    const { client, calls } = untouched();
    const out = await dispatchBidDueNotices(client, new Date("2026-11-13T12:00:00Z"));
    expect(calls).toEqual([]);
    expect(out).toMatchObject({
      bids_checked: 0,
      bids_notified: 0,
      bids_errors: 0,
      pass_errors: [],
    });
  });

  it("a pass just after midnight Eastern (an office user opening the site) does nothing either", async () => {
    const { client, calls } = untouched();
    const out = await dispatchBidDueNotices(client, new Date("2026-07-15T04:05:00Z"));
    expect(calls).toEqual([]);
    expect(out.bids_checked).toBe(0);
  });

  it("at 8:00 Eastern the pass runs (it reads its settings)", async () => {
    const { client, calls } = untouched();
    await dispatchBidDueNotices(client, new Date("2026-11-13T13:00:00Z")).catch(() => undefined);
    expect(calls.length).toBeGreaterThan(0);
  });
});

describe("Admin › Reminders says so", () => {
  const page = readFileSync("src/components/reminders-settings.tsx", "utf8");
  it("the Tickets and the Bids sections each carry a Time of day line", () => {
    expect(page).toContain(
      '<Line label="Time of day">Ticket reminders go out at 8 AM Eastern.</Line>',
    );
    expect(page).toContain(
      '<Line label="Time of day">Bid reminders go out at 8 AM Eastern.</Line>',
    );
  });
});
