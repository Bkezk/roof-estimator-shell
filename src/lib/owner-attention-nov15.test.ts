/**
 * The Owner page's Needs attention list (owner, Nov 15: "one issue we run into on the roofing
 * business is things not getting started or followed up on" … "keep the owner on top of
 * things"). The owner approved the three groups and their rows ("Those are right"), left
 * tickets waiting on an invoice out ("Yes noise") and wanted nothing sent ("No morning brief
 * please"). The rules are pinned here row by row; the wiring (the page, the admin check, the two
 * limits in Setup) is pinned against the source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { settingsSchema } from "@/lib/followups.functions";
import {
  ATTENTION_DEFAULTS,
  ATTENTION_GROUPS,
  INSPECTION_WINDOW_DAYS,
  attentionLimits,
  attentionList,
  attentionPeople,
  attentionSummary,
  bidsWaiting,
  groupRows,
  inspectionProblems,
  redFrom,
  rowsFor,
  toneOf,
  type AttBid,
  type AttTicket,
  type AttentionIn,
} from "@/lib/owner-attention";

const TODAY = "2026-11-16"; // a Monday
const NOW = "2026-11-16T15:00:00Z";
const BRIAN = "11111111-1111-4111-8111-111111111111";
const GARRY = "22222222-2222-4222-8222-222222222222";
const BRIANNA = "33333333-3333-4333-8333-333333333333";

const base = (over: Partial<AttentionIn> = {}): AttentionIn => ({
  today: TODAY,
  now: NOW,
  limits: { ...ATTENTION_DEFAULTS },
  tickets: [],
  untouched: [],
  opps: [],
  bids: [],
  invoices: [],
  followups: [],
  repairFrom: [],
  bidFrom: [],
  names: { [BRIAN]: "Brian Folden", [GARRY]: "Garry Peters", [BRIANNA]: "Brian Stone" },
  ...over,
});
const ticket = (over: Partial<AttTicket> = {}): AttTicket => ({
  id: "t1",
  number: 6071,
  customer_name: "Acme Tire",
  service_type: "repair",
  stage: "open",
  stage_changed_at: "2026-11-10T14:00:00Z",
  updated_at: "2026-11-10T14:00:00Z",
  created_at: "2026-11-10T14:00:00Z",
  scheduled_date: "2026-11-13",
  technician_id: null,
  ...over,
});
const bid = (over: Partial<AttBid> = {}): AttBid => ({
  id: "b1",
  name: "Career Center",
  status: "submitted",
  due_date: "2026-10-30",
  submitted_at: "2026-11-04T16:00:00Z",
  status_changed_at: "2026-11-04T16:00:00Z",
  updated_at: "2026-11-04T16:00:00Z",
  reminder_on: null,
  grand_total: 235274,
  created_by: BRIAN,
  ...over,
});
const inspection = (issues: number, grade: string | null = "C") => ({
  v: 1,
  grade,
  items: [
    ...Array.from({ length: issues }, (_, n) => ({
      id: `i${n}`,
      label: `Row ${n}`,
      status: "issue",
    })),
    { id: "ok", label: "Drains", status: "ok" },
    { id: "na", label: "Ponding", status: "na" },
  ],
});
const only = (i: AttentionIn) => {
  const { rows } = attentionList(i);
  expect(rows).toHaveLength(1);
  return rows[0]!;
};

describe("the limits", () => {
  it("default to 7, 3 and 1 when the row or a column is missing", () => {
    expect(attentionLimits(null)).toEqual({ bidDays: 7, authorizeDays: 3, unassignedDays: 1 });
    expect(attentionLimits({ unassigned_overdue_days: 2 })).toEqual({
      bidDays: 7,
      authorizeDays: 3,
      unassignedDays: 2,
    });
  });
  it("take the saved numbers, 0 included, and fall back on anything else", () => {
    expect(
      attentionLimits({
        attention_bid_days: 0,
        attention_authorize_days: 10,
        unassigned_overdue_days: 0,
      }),
    ).toEqual({ bidDays: 0, authorizeDays: 10, unassignedDays: 0 });
    expect(attentionLimits({ attention_bid_days: -1, attention_authorize_days: 2.5 })).toEqual(
      ATTENTION_DEFAULTS,
    );
    expect(attentionLimits({ attention_bid_days: "7", attention_authorize_days: 366 })).toEqual(
      ATTENTION_DEFAULTS,
    );
  });
  it("amber past the limit, red at twice the limit, never red before 2 days", () => {
    expect(redFrom(7)).toBe(14);
    expect(redFrom(0)).toBe(2);
    expect(toneOf(13, 7)).toBe("amber");
    expect(toneOf(14, 7)).toBe("red");
    expect(toneOf(1, 0)).toBe("amber");
  });
});

describe("Not started", () => {
  it("a ticket past its date with nobody on it", () => {
    const r = only(base({ tickets: [ticket()] }));
    expect(r).toMatchObject({
      group: "not_started",
      kind: "ticket_nobody",
      tag: "Repair",
      title: "#6071 Acme Tire",
      why: "Nobody is on it. Its date was Fri, Nov 13.",
      who: "Nobody",
      whoKey: "nobody",
      age: 3,
      ageText: "3 days late",
      tone: "red",
      href: "/service?id=t1",
    });
  });
  it("not while its date is today or ahead, and not once someone is on it or it is Done", () => {
    for (const t of [
      ticket({ scheduled_date: TODAY }),
      ticket({ scheduled_date: "2026-12-16" }),
      ticket({ technician_id: BRIAN }),
      ticket({ stage: "done" }),
      ticket({ stage: "authorized" }),
    ])
      expect(
        attentionList(base({ tickets: [t], limits: { ...ATTENTION_DEFAULTS, authorizeDays: 99 } }))
          .rows,
      ).toEqual([]);
  });
  it("a ticket with nobody and no date, once Setup's needs-assignment limit has passed", () => {
    const undated = ticket({ scheduled_date: null, created_at: "2026-11-15T15:00:00Z" });
    const r = only(base({ tickets: [undated] }));
    expect(r.why).toBe("Nobody is on it and it has no date. Entered Sun, Nov 15.");
    expect(r.ageText).toBe("1 day");
    expect(
      attentionList(
        base({ tickets: [undated], limits: { ...ATTENTION_DEFAULTS, unassignedDays: 2 } }),
      ).rows,
    ).toEqual([]);
  });
  it("a ticket its technician has not started, from the untouched list", () => {
    const t = ticket({
      technician_id: BRIAN,
      scheduled_date: "2026-11-11",
      service_type: "inspection",
    });
    const r = only(
      base({
        tickets: [t],
        untouched: [
          {
            kind: "ticket",
            item_id: "t1",
            title: "#6071 Acme Tire",
            assignee_id: BRIAN,
            assignee_name: "Brian Folden",
            assigned_at: "2026-11-10T14:00:00Z",
            limit_days: 2,
          },
        ],
      }),
    );
    expect(r).toMatchObject({
      kind: "ticket_untouched",
      tag: "Inspection",
      why: "Not started. Its date was Wed, Nov 11.",
      who: "Brian Folden",
      whoKey: BRIAN,
      ageText: "5 days late",
      tone: "red",
    });
  });
  it("an opportunity with no contact logged, only past its limit", () => {
    const u = {
      kind: "opportunity",
      item_id: "o1",
      title: "Acme Tire",
      assignee_id: GARRY,
      assignee_name: "Garry Peters",
      assigned_at: "2026-11-11T14:00:00Z",
      limit_days: 3,
    };
    const r = only(base({ untouched: [u] }));
    expect(r).toMatchObject({
      kind: "opp_untouched",
      tag: "Opportunity",
      title: "Acme Tire",
      why: "No call, text or email logged since it was assigned.",
      who: "Garry Peters",
      age: 5,
      ageText: "5 days",
      tone: "amber",
      href: "/opportunities?id=o1",
    });
    expect(
      attentionList(base({ untouched: [{ ...u, assigned_at: "2026-11-14T14:00:00Z" }] })).rows,
    ).toEqual([]);
  });
  it("an open opportunity nobody is on, past the needs-assignment limit", () => {
    const o = {
      id: "o2",
      title: "New school roof",
      status: "open",
      assignee_id: null,
      created_at: "2026-11-12T14:00:00Z",
      expected_close: null,
    };
    const r = only(base({ opps: [o] }));
    expect(r).toMatchObject({
      kind: "opp_nobody",
      who: "Nobody",
      why: "Nobody is on it. Entered Thu, Nov 12.",
      ageText: "4 days",
    });
    expect(attentionList(base({ opps: [{ ...o, assignee_id: BRIAN }] })).rows).toEqual([]);
    expect(attentionList(base({ opps: [{ ...o, status: "won" }] })).rows).toEqual([]);
    expect(
      attentionList(base({ opps: [{ ...o, created_at: "2026-11-16T13:00:00Z" }] })).rows,
    ).toEqual([]);
  });
  it("a draft bid past its due date, with its dollars and whoever started it", () => {
    const r = only(
      base({ bids: [bid({ status: "draft", due_date: "2026-11-09", grand_total: 8909 })] }),
    );
    expect(r).toMatchObject({
      group: "not_started",
      kind: "bid_draft_late",
      tag: "Draft bid",
      why: "Still a draft. It was due Mon, Nov 9.",
      who: "Brian Folden",
      ageText: "7 days late",
      amount: 8909,
      href: "/estimate?bid=b1",
    });
    // No due date (a bid from before the rule), or due today: nothing.
    expect(attentionList(base({ bids: [bid({ status: "draft", due_date: null })] })).rows).toEqual(
      [],
    );
    expect(attentionList(base({ bids: [bid({ status: "draft", due_date: TODAY })] })).rows).toEqual(
      [],
    );
  });
});

describe("Not followed up", () => {
  it("a submitted bid with no follow-up date, once the limit has passed", () => {
    const r = only(base({ bids: [bid()] }));
    expect(r).toMatchObject({
      group: "not_followed_up",
      kind: "bid_sent",
      tag: "Bid sent",
      title: "Career Center",
      why: "No follow-up date. Sent Wed, Nov 4.",
      who: "Brian Folden",
      age: 12,
      ageText: "12 days",
      tone: "amber",
      amount: 235274,
    });
    expect(only(base({ bids: [bid({ submitted_at: "2026-10-13T16:00:00Z" })] })).tone).toBe("red");
    // Sent 6 days ago: not yet.
    expect(
      attentionList(base({ bids: [bid({ submitted_at: "2026-11-10T16:00:00Z" })] })).rows,
    ).toEqual([]);
  });
  it("a follow-up date today or ahead keeps it off; a passed one puts it on at once", () => {
    for (const day of [TODAY, "2026-11-20"])
      expect(attentionList(base({ bids: [bid({ reminder_on: day })] })).rows).toEqual([]);
    const passed = only(
      base({ bids: [bid({ submitted_at: "2026-11-13T16:00:00Z", reminder_on: "2026-11-15" })] }),
    );
    expect(passed.why).toBe("Its follow-up date was Sun, Nov 15. No new date is set.");
    expect(passed.tone).toBe("amber");
    expect(passed.ageText).toBe("3 days");
    expect(only(base({ bids: [bid({ reminder_on: "2026-10-26" })] })).tone).toBe("red");
  });
  it("a won or lost bid is never listed, and an old status reads as the status it folds into", () => {
    for (const status of ["won", "lost", "accepted", "denied"])
      expect(attentionList(base({ bids: [bid({ status })] })).rows).toEqual([]);
    // "final" is a draft in the four-status model: not a sent bid.
    expect(attentionList(base({ bids: [bid({ status: "final", due_date: null })] })).rows).toEqual(
      [],
    );
  });
  it("an inspection that found problems and was closed with no next step, for 30 days", () => {
    const t = ticket({
      id: "t9",
      number: 6040,
      service_type: "inspection",
      stage: "authorized",
      technician_id: GARRY,
      inspection: inspection(4),
      inspection_outcome: "none",
      inspection_outcome_at: "2026-11-09T15:00:00Z",
      inspection_outcome_by: GARRY,
    });
    const r = only(base({ tickets: [t] }));
    expect(r).toMatchObject({
      group: "not_followed_up",
      kind: "inspection_no_next",
      tag: "Inspection",
      title: "#6040 Acme Tire",
      why: "Graded C with 4 problems found. Closed with no repair ticket or bid.",
      who: "Garry Peters",
      ageText: "7 days",
      tone: "amber",
    });
    expect(INSPECTION_WINDOW_DAYS).toBe(30);
    expect(
      attentionList(base({ tickets: [{ ...t, inspection_outcome_at: "2026-10-15T15:00:00Z" }] }))
        .rows,
    ).toEqual([]);
    // A repair ticket or a bid made from it: the next step exists.
    expect(attentionList(base({ tickets: [t], repairFrom: ["t9"] })).rows).toEqual([]);
    expect(attentionList(base({ tickets: [t], bidFrom: ["t9"] })).rows).toEqual([]);
    expect(
      attentionList(base({ tickets: [{ ...t, inspection_outcome: "repair_ticket" }] })).rows,
    ).toEqual([]);
    // Nothing flagged: nothing to follow up.
    expect(attentionList(base({ tickets: [{ ...t, inspection: inspection(0) }] })).rows).toEqual(
      [],
    );
  });
  it("an inspection with problems and no choice made yet stays until one is made", () => {
    const t = ticket({
      service_type: "inspection",
      stage: "closed",
      technician_id: GARRY,
      inspection: inspection(1, null),
      inspection_outcome: null,
      stage_changed_at: "2026-09-01T15:00:00Z",
    });
    const r = only(base({ tickets: [t] }));
    expect(r.why).toBe("1 problem found. Nobody has chosen what happens next.");
    expect(r.who).toBe("Office");
    expect(r.tone).toBe("red");
  });
  it("counts only the flagged rows of the checklist", () => {
    expect(inspectionProblems(inspection(3))).toBe(3);
    expect(inspectionProblems(null)).toBe(0);
    expect(inspectionProblems({ items: "nope" })).toBe(0);
  });
});

describe("Waiting on the office", () => {
  it("a Done ticket not authorized after the limit, under the authorizer's name when one is set", () => {
    const t = ticket({
      stage: "done",
      technician_id: BRIAN,
      stage_changed_at: "2026-11-11T15:00:00Z",
    });
    const r = only(base({ tickets: [t] }));
    expect(r).toMatchObject({
      group: "office",
      kind: "to_authorize",
      why: "Done. Waiting to be authorized.",
      who: "Office",
      whoKey: "office",
      ageText: "5 days",
      tone: "amber",
    });
    const named = only(
      base({
        tickets: [t],
        followups: [
          {
            kind: "invoice",
            item_id: "t1",
            status: "open",
            snoozed_until: null,
            assignee_id: GARRY,
          },
        ],
      }),
    );
    expect(named.who).toBe("Garry Peters");
    // Done 2 days ago: not yet.
    expect(
      attentionList(base({ tickets: [{ ...t, stage_changed_at: "2026-11-14T15:00:00Z" }] })).rows,
    ).toEqual([]);
  });
  it("never a ticket that is Authorized and waiting on an invoice (owner: noise)", () => {
    const t = ticket({
      stage: "authorized",
      technician_id: BRIAN,
      stage_changed_at: "2026-10-14T15:00:00Z",
    });
    expect(attentionList(base({ tickets: [t] })).rows).toEqual([]);
  });
  it("an invoice unpaid past its due date, for what is still owed", () => {
    const v = {
      id: "v1",
      number: 1042,
      display_number: "1042-A",
      status: "final",
      total: 1500,
      paid_amount: 500,
      due_date: "2026-11-06",
      bill_to: { name: "Acme Tire" },
    };
    const r = only(base({ invoices: [v] }));
    expect(r).toMatchObject({
      group: "office",
      kind: "invoice_unpaid",
      tag: "Invoice",
      title: "#1042-A Acme Tire",
      why: "Unpaid. It was due Fri, Nov 6.",
      who: "Office",
      ageText: "10 days late",
      amount: 1000,
      href: "/service/invoices?id=v1",
    });
    for (const over of [
      { paid_amount: 1500 },
      { due_date: TODAY },
      { due_date: null },
      { status: "draft" },
      { status: "paid" },
    ])
      expect(attentionList(base({ invoices: [{ ...v, ...over }] })).rows).toEqual([]);
  });
});

describe("a manager's hold", () => {
  const hold = (kind: string, item_id: string, until: string) => ({
    kind,
    item_id,
    status: "open",
    snoozed_until: until,
  });
  it("takes an untouched ticket, an untouched opportunity and a Done ticket off, and is counted", () => {
    const i = base({
      tickets: [
        ticket({ technician_id: BRIAN, scheduled_date: "2026-11-11" }),
        ticket({ id: "t2", stage: "done", stage_changed_at: "2026-11-09T15:00:00Z" }),
      ],
      untouched: [
        {
          kind: "ticket",
          item_id: "t1",
          title: "x",
          assignee_id: BRIAN,
          assignee_name: "Brian Folden",
          assigned_at: "2026-11-10T14:00:00Z",
          limit_days: 2,
        },
        {
          kind: "opportunity",
          item_id: "o1",
          title: "y",
          assignee_id: GARRY,
          assignee_name: "Garry Peters",
          assigned_at: "2026-11-01T14:00:00Z",
          limit_days: 3,
        },
      ],
    });
    expect(attentionList(i).rows).toHaveLength(3);
    const held = attentionList({
      ...i,
      followups: [
        hold("ticket", "t1", "2026-11-20T13:00:00Z"),
        hold("opportunity", "o1", "2026-11-20T13:00:00Z"),
        hold("invoice", "t2", "2026-11-20T13:00:00Z"),
      ],
    });
    expect(held.rows).toEqual([]);
    expect(held.held).toBe(3);
    // A hold that has ended holds nothing.
    const ended = attentionList({
      ...i,
      followups: [hold("ticket", "t1", "2026-11-15T13:00:00Z")],
    });
    expect(ended.rows).toHaveLength(3);
    expect(ended.held).toBe(0);
  });
});

describe("the list as a whole", () => {
  const full = base({
    tickets: [
      ticket(),
      ticket({ id: "t2", number: 6069, stage: "done", stage_changed_at: "2026-11-10T15:00:00Z" }),
    ],
    bids: [
      bid(),
      bid({
        id: "b2",
        name: "Bank",
        submitted_at: "2026-10-22T16:00:00Z",
        grand_total: 69008,
        created_by: GARRY,
      }),
      bid({
        id: "b3",
        name: "Late draft",
        status: "draft",
        due_date: "2026-11-09",
        grand_total: 100,
      }),
    ],
  });
  it("groups in the owner's order, the longest wait first inside a group", () => {
    const { rows } = attentionList(full);
    expect(rows.map((r) => r.key)).toEqual([
      "bid_draft_late:b3",
      "ticket_nobody:t1",
      "bid_sent:b2",
      "bid_sent:b1",
      "to_authorize:t2",
    ]);
    expect(ATTENTION_GROUPS.map((g) => g.label)).toEqual([
      "Not started",
      "Not followed up",
      "Waiting on the office",
    ]);
    expect(groupRows(rows, "not_followed_up")).toHaveLength(2);
  });
  it("sums it up in one line, with the dollars in bids nobody has a follow-up date on", () => {
    const { rows } = attentionList(full);
    expect(bidsWaiting(rows)).toBe(304282);
    expect(attentionSummary(rows)).toBe(
      "2 not started · 2 not followed up · 1 waiting on the office · $304,282 in bids with no follow-up",
    );
    expect(attentionSummary([])).toBe("Nothing needs attention.");
    expect(attentionSummary(groupRows(rows, "office"))).toBe("1 waiting on the office");
  });
  it("offers each person, the busiest first, then Office and Nobody", () => {
    const { rows } = attentionList(full);
    expect(attentionPeople(rows)).toEqual([
      { key: BRIAN, label: "Brian", count: 2 },
      { key: GARRY, label: "Garry", count: 1 },
      { key: "office", label: "Office", count: 1 },
      { key: "nobody", label: "Nobody", count: 1 },
    ]);
    expect(rowsFor(rows, BRIAN).map((r) => r.key)).toEqual(["bid_draft_late:b3", "bid_sent:b1"]);
    expect(rowsFor(rows, null)).toHaveLength(5);
  });
  it("uses the full name when two people share a first name", () => {
    const { rows } = attentionList(base({ bids: [bid(), bid({ id: "b2", created_by: BRIANNA })] }));
    expect(attentionPeople(rows).map((p) => p.label)).toEqual(["Brian Folden", "Brian Stone"]);
  });
  it("says so when the untouched list could not be read, and still lists the rest", () => {
    const l = attentionList({ ...full, untouched: null });
    expect(l.untouchedRead).toBe(false);
    expect(l.rows).toHaveLength(5);
    expect(attentionList(full).untouchedRead).toBe(true);
  });
});

describe("the wiring", () => {
  const flat = (p: string) => readFileSync(p, "utf8").replace(/\s+/g, " ");
  const page = flat("src/components/owner-page.tsx");
  const fn = flat("src/lib/owner-attention.functions.ts");
  const rules = flat("src/lib/owner-attention.ts");
  const box = flat("src/components/owner-attention.tsx");
  const setup = flat("src/components/reminders-settings.tsx");

  it("the list opens the People tab, above the table of people", () => {
    expect(page).toContain('import { OwnerAttention } from "@/components/owner-attention";');
    expect(page.indexOf("<OwnerAttention />")).toBeGreaterThan(page.indexOf('tab === "people" ?'));
    expect(page.indexOf("<OwnerAttention />")).toBeLessThan(page.indexOf("<OwnerView />"));
  });
  it("the Owner page keeps to the screen's width on a phone (the people table scrolls in its box)", () => {
    expect(page).toContain('<div className="mx-auto w-full min-w-0 max-w-none space-y-5">');
  });
  it("only an admin is answered, on the role read from their own profile row", () => {
    expect(fn).toContain(".middleware([requireSupabaseAuth])");
    expect(fn).toContain('.eq("id", context.userId)');
    expect(fn).toContain(
      'if (!me || !visibleToOwner(me)) throw new Error("Forbidden: admin only");',
    );
    expect(fn.indexOf("visibleToOwner(me)")).toBeLessThan(fn.indexOf('.from("service_jobs")'));
    expect(fn).not.toContain("supabaseAdmin");
  });
  it("reads only: it writes nothing and sends nothing (no morning brief)", () => {
    for (const src of [fn, rules, box]) {
      expect(src).not.toMatch(/\.(insert|update|upsert|delete)\(/);
      expect(src).not.toMatch(/from "@\/lib\/[^"]*(notify|push)[^"]*"|sendPush|resend/i);
    }
  });
  it("a row is a link to the item and nothing on it dismisses it", () => {
    expect(box).toContain("href={row.href}");
    expect(box).not.toMatch(/dismiss|snooze/i);
    expect(box).toContain("A row leaves by itself when the work is done.");
  });
  it("Setup › Reminders has the two limits, saved as whole days from 0 to 365", () => {
    expect(setup).toContain('title="Owner’s Needs attention list"');
    expect(setup).toContain('{field("attention_bid_days")}');
    expect(setup).toContain('{field("attention_authorize_days")}');
    const saved = {
      opportunity_close_days: 30,
      opportunity_first_days: 3,
      opportunity_every_days: 7,
      ticket_first_days: 1,
      ticket_every_days: 3,
      ticket_before_every_days: 3,
      ticket_due_notice_days: 1,
      ticket_untouched_days: 2,
      opportunity_untouched_days: 3,
      unassigned_overdue_days: 1,
      bid_due_notice_days: 1,
      bid_overdue_every_days: null,
      attention_bid_days: 7,
      attention_authorize_days: 3,
      escalate_to_admins: true,
      escalate_user_ids: [],
    };
    expect(settingsSchema.safeParse(saved).success).toBe(true);
    expect(settingsSchema.safeParse({ ...saved, attention_bid_days: 0 }).success).toBe(true);
    for (const over of [
      { attention_bid_days: -1 },
      { attention_bid_days: 366 },
      { attention_authorize_days: 1.5 },
      { attention_authorize_days: null },
    ])
      expect(settingsSchema.safeParse({ ...saved, ...over }).success).toBe(false);
    const { attention_bid_days: _gone, ...without } = saved;
    expect(settingsSchema.safeParse(without).success).toBe(false);
  });
  it("the database holds the two limits with the same defaults and range", () => {
    const sql = flat("supabase/migrations/20261115120000_owner_attention_limits.sql");
    expect(sql).toContain(
      "add column if not exists attention_bid_days integer not null default 7;",
    );
    expect(sql).toContain(
      "add column if not exists attention_authorize_days integer not null default 3;",
    );
    expect(sql).toContain("check (attention_bid_days between 0 and 365);");
    expect(sql).toContain("check (attention_authorize_days between 0 and 365);");
    const types = flat("src/integrations/supabase/types.ts");
    expect(types).toContain("attention_authorize_days: number attention_bid_days: number");
  });
});
