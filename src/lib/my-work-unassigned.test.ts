/**
 * Work Overview's Unassigned group (owner, Oct 7): "sometimes opportunities are made and are
 * unassigned so can we also have an unassigned group on the work overview list that includes
 * services and opportunities. that appears for people who are anything except only technicians.
 * Also things that are not finished should stay on the lists regardless of time (currently there
 * are 3 things overdue between the opportunities and services but only 2 are showing)."
 *
 * The missing third was ticket #6003: scheduled Sep 29, no technician — the list only ever
 * carried assigned work, and an unassigned opportunity never gets a follow-up (the follow-up
 * guard needs an assignee), so neither could appear anywhere.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { isOffice } from "./access";
import {
  UNASSIGNED_OVERDUE_DAYS_DEFAULT,
  bucketOf,
  flagUnassigned,
  listGroups,
  mergeWork,
  opportunityItem,
  unassignedItems,
  unassignedOverdue,
  type OppIn,
  type TicketIn,
} from "./my-work";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const TODAY = "2026-10-07";

const ticket = (over: Partial<TicketIn>): TicketIn => ({
  id: "t6003",
  number: 6003,
  customer_name: "bell county",
  site_name: null,
  site_address: null,
  description: "",
  service_type: "repair",
  stage: "scheduled",
  scheduled_date: "2026-09-29",
  technician_id: null,
  ...over,
});
const opp = (over: Partial<OppIn>): OppIn => ({
  id: "o1",
  title: "Corbin middle",
  status: "quoted",
  expected_close: "2026-09-30",
  account_name: "Corbin ISD",
  ...over,
});

describe("Unassigned work on Work Overview", () => {
  it("an unassigned ticket and an unassigned opportunity become rows that say so", () => {
    const items = unassignedItems({ tickets: [ticket({})], opportunities: [opp({})] });
    expect(items.map((i) => i.key)).toEqual(["ticket:t6003", "opportunity:o1"]);
    expect(items[0]).toMatchObject({
      kind: "ticket",
      title: "#6003",
      where: "bell county",
      date: "2026-09-29",
      status: "Scheduled",
      unassigned: true,
      assigneeId: null,
      href: "/service?id=t6003",
    });
    expect(items[1]).toMatchObject({
      kind: "opportunity",
      title: "Corbin middle",
      where: "Corbin ISD",
      date: "2026-09-30",
      status: "Quoted",
      unassigned: true,
      href: "/opportunities?id=o1",
    });
    expect(opportunityItem(opp({ status: "contacted", expected_close: null })).status).toBe(
      "Contacted",
    );
  });

  it("sits under Unassigned whatever its date — a week overdue, today, or undated", () => {
    expect(bucketOf({ date: "2026-09-29", done: false, unassigned: true }, TODAY)).toBe(
      "unassigned",
    );
    expect(bucketOf({ date: TODAY, done: false, unassigned: true }, TODAY)).toBe("unassigned");
    expect(bucketOf({ date: null, done: false, unassigned: true }, TODAY)).toBe("unassigned");
    // Still overdue for everything that has a person.
    expect(bucketOf({ date: "2026-09-29", done: false }, TODAY)).toBe("overdue");
  });

  it("stays on the list however old: no date window anywhere, three overdue things show as three", () => {
    const items = mergeWork(
      {
        tickets: [
          ticket({ id: "t6005", number: 6005, scheduled_date: "2026-10-06", technician_id: "ro" }),
        ],
        tasks: [],
        followups: [
          {
            id: "f1",
            title: "Corbin middle",
            url: "/opportunities?id=o1",
            due_at: "2026-09-30T12:00:00Z",
            status: "open",
            kind: "opportunity",
            item_id: "o1",
            assignee_id: "brian",
          },
        ],
        unassigned: { tickets: [ticket({})], opportunities: [] },
      },
      (iso) => iso.slice(0, 10),
    );
    const groups = listGroups(items, TODAY, { unassigned: true });
    const by = Object.fromEntries(groups.map((g) => [g.bucket, g.items.map((i) => i.key)]));
    // Due first: the Sep 30 opportunity follow-up, then the Oct 6 ticket.
    expect(by["overdue"]).toEqual(["followup:f1", "ticket:t6005"]);
    expect(by["unassigned"]).toEqual(["ticket:t6003"]);
    // Two years old and still there.
    const old = mergeWork({
      tickets: [],
      tasks: [],
      followups: [],
      unassigned: { tickets: [ticket({ scheduled_date: "2024-01-05" })], opportunities: [] },
    });
    expect(listGroups(old, TODAY)[0]).toMatchObject({ bucket: "unassigned" });
    const fn = read("./my-work.functions.ts");
    expect(fn).not.toMatch(
      /\.(gte|gt|lt|lte)\(\s*"(scheduled_date|due_at|due_date|expected_close)"/,
    );
  });

  it("the group leads the list for everyone but a technician-only user, and never for one", () => {
    expect(listGroups([], TODAY, { unassigned: true }).map((g) => g.bucket)).toEqual([
      "unassigned",
      "overdue",
      "week",
      "later",
      "waiting",
      "nodate",
      "done",
    ]);
    expect(listGroups([], TODAY).map((g) => g.bucket)).not.toContain("unassigned");
    expect(listGroups([], TODAY, { unassigned: true })[0]!.items).toEqual([]);
    // Something in it shows it even when the flag is off (a manager looking at one person).
    const items = mergeWork({
      tickets: [],
      tasks: [],
      followups: [],
      unassigned: { tickets: [ticket({})], opportunities: [] },
    });
    expect(listGroups(items, TODAY)[0]!.bucket).toBe("unassigned");

    // Who gets it: isOffice — anyone who is not a plain technician.
    expect(isOffice({ role: "user", technician: true, access: ["service"] })).toBe(false);
    expect(isOffice({ role: "user", technician: false, access: ["service"] })).toBe(true);
    expect(isOffice({ role: "manager", technician: true, access: [] })).toBe(true);
    expect(isOffice({ role: "admin", technician: false, access: [] })).toBe(true);
    const fn = read("./my-work.functions.ts");
    expect(fn).toContain("const showUnassigned = isOffice(me)");
    expect(fn).toContain('.is("technician_id", null)');
    expect(fn).toContain('.is("assignee_id", null)');
    expect(fn).toContain('.in("status", [...OPEN_OPP_STATUSES])');
    const page = read("../components/my-work-page.tsx");
    expect(page).toContain("unassigned={!!q.data?.unassigned}");
  });

  it("an assigned opportunity's row wears the Opportunity badge too, not Follow-up (owner, Oct 8)", () => {
    const base = {
      id: "f1",
      title: "Corbin middle",
      url: "/opportunities?id=o1",
      due_at: "2026-09-30T12:00:00Z",
      status: "open",
      item_id: "o1",
      assignee_id: "brian",
    };
    const rows = mergeWork({
      tickets: [],
      tasks: [],
      followups: [
        { ...base, kind: "opportunity" },
        { ...base, id: "f2", kind: "ticket", title: "Ticket #6005", item_id: "t1" },
        { ...base, id: "f3", kind: "invoice", title: "Authorize ticket #6005", item_id: "t1" },
      ],
    });
    const by = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(by["followup:f1"]).toMatchObject({ kind: "opportunity", title: "Corbin middle" });
    expect(by["followup:f1"]!.followup?.status).toBe("open");
    expect(by["followup:f2"]).toMatchObject({ kind: "followup" });
    expect(by["followup:f3"]).toMatchObject({ kind: "followup", needsAuth: true });
  });

  it("a ticket is either somebody's or nobody's: an assigned ticket never doubles under Unassigned", () => {
    const t = ticket({ technician_id: "ro" });
    const items = mergeWork({
      tickets: [t],
      tasks: [],
      followups: [],
      unassigned: { tickets: [t], opportunities: [] },
    });
    expect(items.map((i) => i.key)).toEqual(["ticket:t6003"]);
    expect(items[0]!.unassigned).toBeUndefined();
  });
});

describe("the 'needs assignment' timer (owner, Oct 7: overdue just by nature of being unassigned)", () => {
  const entered = (since: string | null, date: string | null = null) => ({
    unassigned: true,
    since,
    date,
  });
  it("flags nobody's work once it has waited Setup's days for a person", () => {
    // Entered Oct 5, 1 day allowed: flagged from Oct 6 on.
    expect(unassignedOverdue(entered("2026-10-05"), "2026-10-05", 1)).toBe(false);
    expect(unassignedOverdue(entered("2026-10-05"), "2026-10-06", 1)).toBe(true);
    expect(unassignedOverdue(entered("2026-10-05"), TODAY, 1)).toBe(true);
    // 3 days allowed: not yet on Oct 7, yes on Oct 8.
    expect(unassignedOverdue(entered("2026-10-05"), TODAY, 3)).toBe(false);
    expect(unassignedOverdue(entered("2026-10-05"), "2026-10-08", 3)).toBe(true);
    // 0 days: the day it is entered.
    expect(unassignedOverdue(entered(TODAY), TODAY, 0)).toBe(true);
    // The default is one day.
    expect(UNASSIGNED_OVERDUE_DAYS_DEFAULT).toBe(1);
    expect(unassignedOverdue(entered("2026-10-06"), TODAY)).toBe(true);
    expect(unassignedOverdue(entered(TODAY), TODAY)).toBe(false);
  });
  it("past its own day counts too, and nothing flags assigned work or an item with no dates", () => {
    expect(unassignedOverdue(entered(TODAY, "2026-09-29"), TODAY, 30)).toBe(true);
    expect(unassignedOverdue(entered(null, null), TODAY, 0)).toBe(false);
    expect(
      unassignedOverdue({ unassigned: false, since: "2026-01-01", date: "2026-01-01" }, TODAY, 0),
    ).toBe(false);
  });
  it("flagUnassigned marks only the unassigned rows, from their created day", () => {
    const items = mergeWork(
      {
        tickets: [ticket({ id: "mine", technician_id: "me", scheduled_date: "2026-09-01" })],
        tasks: [],
        followups: [],
        unassigned: {
          tickets: [
            ticket({ id: "old", created_at: "2026-10-01T14:00:00Z", scheduled_date: null }),
          ],
          opportunities: [
            opp({ id: "new", created_at: `${TODAY}T09:00:00Z`, expected_close: "2026-11-01" }),
          ],
        },
      },
      (iso) => iso.slice(0, 10),
    );
    const flagged = flagUnassigned(items, TODAY, 2);
    const by = Object.fromEntries(flagged.map((i) => [i.key, i]));
    expect(by["ticket:old"]).toMatchObject({ since: "2026-10-01", flag: true });
    expect(by["opportunity:new"]).toMatchObject({ since: TODAY, flag: false });
    expect(by["ticket:mine"]!.flag).toBeUndefined();
  });
  it("the timer lives in Setup › Reminders (crm_settings.unassigned_overdue_days) and reaches the page", () => {
    const migration = read("../../supabase/migrations/20261007100000_unassigned_overdue.sql");
    expect(migration).toContain(
      "add column if not exists unassigned_overdue_days integer not null default 1",
    );
    expect(read("../integrations/supabase/types.ts")).toContain("unassigned_overdue_days: number;");
    expect(read("./followups.functions.ts")).toContain(
      "unassigned_overdue_days: z.number().int().min(0).max(365)",
    );
    const setup = read("../components/reminders-settings.tsx");
    expect(setup).toContain('key: "unassigned_overdue_days"');
    expect(setup).toContain("Needs assignment");
    expect(setup).toContain('daysFields("unassigned")');
    const fn = read("./my-work.functions.ts");
    expect(fn).toContain('.select("unassigned_overdue_days")');
    expect(fn).toMatch(/technician_id, created_at"/);
    expect(fn).toContain('"id, title, status, expected_close, account_id, created_at"');
    expect(fn).toContain("unassignedOverdueDays,");
    const page = read("../components/my-work-page.tsx");
    expect(page).toContain(
      "flagUnassigned(mergeWork(q.data), today, q.data.unassignedOverdueDays)",
    );
    expect(page).toContain(
      '{item.flag && <span className="font-medium text-destructive">Overdue</span>}',
    );
    // The front desk may save an opportunity with nobody on it.
    expect(read("./opportunity-form.ts")).toMatch(
      /export function assigneeProblem[\s\S]*?return null;/,
    );
  });
});
