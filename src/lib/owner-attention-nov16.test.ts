/**
 * The Owner page's Needs attention list: the twelve rule gaps of the Nov 16 audit. The owner
 * approved every fix; the numbers (11 to 22) are the owner's. Each fix is pinned here by a test
 * that failed on the Nov 15 code. The rules are lib/owner-attention.ts; the read is
 * owner-attention.functions.ts, run here against the in-memory stand-in
 * (src/test/fake-supabase.ts).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));

import { ID_CHUNK } from "@/lib/chunk-ids";
import { ON_RECEIPT_LATE_DAYS } from "@/lib/invoice-list";
import {
  ATTENTION_DEFAULTS,
  WHO_NOBODY,
  attentionList,
  attentionPeople,
  attentionSummary,
  groupNote,
  type AttBid,
  type AttInvoice,
  type AttTicket,
  type AttUntouched,
  type AttentionIn,
  type AttentionList,
} from "@/lib/owner-attention";
import { listOwnerAttention } from "@/lib/owner-attention.functions";
import { plusDays } from "@/lib/working-days";
import { fakeSupabase } from "@/test/fake-supabase";

const TODAY = "2026-11-16"; // a Monday
const NOW = "2026-11-16T15:00:00Z";
const DANA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const LEE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

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
  names: { [DANA]: "Dana Reed", [LEE]: "Lee Marsh" },
  ...over,
});
const ticket = (over: Partial<AttTicket> = {}): AttTicket => ({
  id: "t1",
  number: 7001,
  customer_name: "Pine Hall",
  service_type: "repair",
  stage: "open",
  stage_changed_at: "2026-11-10T14:00:00Z",
  updated_at: "2026-11-10T14:00:00Z",
  created_at: "2026-11-10T14:00:00Z",
  scheduled_date: "2026-11-13",
  technician_id: DANA,
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
  ],
});
/** A finished inspection with problems, Authorized, nothing chosen yet. */
const inspected = (over: Partial<AttTicket> = {}): AttTicket =>
  ticket({
    service_type: "inspection",
    stage: "authorized",
    inspection: inspection(2),
    inspection_outcome: null,
    ...over,
  });
const bid = (over: Partial<AttBid> = {}): AttBid => ({
  id: "b1",
  name: "Maple School",
  status: "submitted",
  due_date: null,
  submitted_at: "2026-11-04T16:00:00Z",
  status_changed_at: "2026-11-04T16:00:00Z",
  updated_at: "2026-11-04T16:00:00Z",
  reminder_on: null,
  grand_total: 12000,
  created_by: DANA,
  ...over,
});
const invoice = (over: Partial<AttInvoice> = {}): AttInvoice => ({
  id: "v1",
  number: 2001,
  display_number: null,
  status: "final",
  total: 900,
  paid_amount: 0,
  due_date: null,
  invoice_date: "2026-10-01",
  bill_to: { name: "Pine Hall" },
  ...over,
});
const untouchedTicket = (over: Partial<AttUntouched> = {}): AttUntouched => ({
  kind: "ticket",
  item_id: "t1",
  title: "#7001 Pine Hall",
  assignee_id: DANA,
  assignee_name: "Dana Reed",
  assigned_at: "2026-11-02T14:00:00Z",
  limit_days: 2,
  ...over,
});
const rowsOf = (i: AttentionIn) => attentionList(i).rows;
const only = (i: AttentionIn) => {
  const rows = rowsOf(i);
  expect(rows).toHaveLength(1);
  return rows[0]!;
};

describe("Nov 16 audit fix 11: an unpaid invoice with no due date", () => {
  it("is listed once it is late by the Invoices page's own rule, aged from the day it became late", () => {
    const r = only(
      base({ invoices: [invoice({ invoice_date: plusDays(TODAY, -(ON_RECEIPT_LATE_DAYS + 7)) })] }),
    );
    expect(r).toMatchObject({
      group: "office",
      kind: "invoice_unpaid",
      title: "#2001 Pine Hall",
      why: "Unpaid. No due date. Invoiced Sat, Oct 10, over 30 days ago.",
      who: "Office",
      age: 7,
      ageText: "7 days late",
      tone: "amber",
      amount: 900,
    });
  });
  it("not on its last day in time, and from the day after", () => {
    const on = (back: number) =>
      rowsOf(base({ invoices: [invoice({ invoice_date: plusDays(TODAY, -back) })] }));
    expect(on(ON_RECEIPT_LATE_DAYS)).toEqual([]);
    expect(on(ON_RECEIPT_LATE_DAYS + 1)[0]!.ageText).toBe("1 day late");
    // Paid in full, or with no invoice date either: nothing.
    expect(rowsOf(base({ invoices: [invoice({ paid_amount: 900 })] }))).toEqual([]);
    expect(rowsOf(base({ invoices: [invoice({ invoice_date: null })] }))).toEqual([]);
  });
  it("an invoice with a due date still goes by that date", () => {
    const r = only(base({ invoices: [invoice({ due_date: "2026-11-06" })] }));
    expect(r.why).toBe("Unpaid. It was due Fri, Nov 6.");
    expect(r.ageText).toBe("10 days late");
  });
});

describe("Nov 16 audit fix 12: an inspection nobody has chosen a next step for", () => {
  it("is aged from the day it was finished, so authorizing it does not restart the wait", () => {
    const r = only(
      base({
        tickets: [
          inspected({
            completed_at: "2026-10-01T15:00:00Z",
            stage_changed_at: "2026-11-15T15:00:00Z",
          }),
        ],
      }),
    );
    expect(r.kind).toBe("inspection_no_next");
    expect(r.why).toBe("Graded C with 2 problems found. Nobody has chosen what happens next.");
    expect(r.age).toBe(46);
    expect(r.ageText).toBe("46 days");
    expect(r.tone).toBe("red");
  });
  it("falls back to the stage stamp, then the last update", () => {
    expect(
      only(base({ tickets: [inspected({ stage_changed_at: "2026-11-12T15:00:00Z" })] })).age,
    ).toBe(4);
    expect(
      only(
        base({
          tickets: [inspected({ stage_changed_at: null, updated_at: "2026-11-13T15:00:00Z" })],
        }),
      ).age,
    ).toBe(3);
  });
});

describe("Nov 16 audit fix 13: an inspection whose repair ticket or bid was deleted", () => {
  const done = { completed_at: "2026-11-05T15:00:00Z" };
  it("comes back when no live repair ticket or bid from it is left", () => {
    const repair = only(
      base({ tickets: [inspected({ ...done, inspection_outcome: "repair_ticket" })] }),
    );
    expect(repair).toMatchObject({
      kind: "inspection_no_next",
      group: "not_followed_up",
      why: "Graded C with 2 problems found. Its repair ticket was deleted. Nobody has chosen what happens next.",
      who: "Office",
      ageText: "11 days",
    });
    const gone = only(base({ tickets: [inspected({ ...done, inspection_outcome: "bid" })] }));
    expect(gone.why).toBe(
      "Graded C with 2 problems found. Its bid was deleted. Nobody has chosen what happens next.",
    );
  });
  it("stays off while a live repair ticket or bid from it exists", () => {
    const t = inspected({ ...done, inspection_outcome: "repair_ticket" });
    expect(rowsOf(base({ tickets: [t], repairFrom: ["t1"] }))).toEqual([]);
    expect(rowsOf(base({ tickets: [t], bidFrom: ["t1"] }))).toEqual([]);
    // Nothing flagged: there was nothing to follow up in the first place.
    expect(rowsOf(base({ tickets: [{ ...t, inspection: inspection(0) }] }))).toEqual([]);
  });
});

describe("Nov 16 audit fix 14: a ticket its technician has not started", () => {
  const list = (scheduled_date: string, limit_days = 2) =>
    only(
      base({
        tickets: [ticket({ scheduled_date })],
        untouched: [untouchedTicket({ limit_days })],
      }),
    );
  it("is amber on the day it first shows: the color counts working days, as the limit does", () => {
    // Thursday to Monday is 2 working days: the limit of 2 is just reached.
    const r = list("2026-11-12");
    expect(r).toMatchObject({
      kind: "ticket_untouched",
      why: "Not started. Its date was Thu, Nov 12.",
      age: 2,
      ageText: "2 working days late",
      tone: "amber",
    });
  });
  it("is red at twice the limit in working days, and the words count the same days", () => {
    // Wednesday to Monday: 3 working days. Tuesday to Monday: 4.
    expect(list("2026-11-11")).toMatchObject({ age: 3, tone: "amber" });
    expect(list("2026-11-10")).toMatchObject({
      age: 4,
      ageText: "4 working days late",
      tone: "red",
    });
    expect(list("2026-11-13", 1)).toMatchObject({ ageText: "1 working day late", tone: "amber" });
  });
});

describe("Nov 16 audit fix 15: a bid sent a second time", () => {
  it("is aged from the latest time it became submitted, not the first", () => {
    const first = "2026-10-01T16:00:00Z";
    // Sent again 4 days ago: not yet on the list.
    expect(
      rowsOf(
        base({ bids: [bid({ submitted_at: first, status_changed_at: "2026-11-12T16:00:00Z" })] }),
      ),
    ).toEqual([]);
    const r = only(
      base({ bids: [bid({ submitted_at: first, status_changed_at: "2026-11-05T16:00:00Z" })] }),
    );
    expect(r).toMatchObject({
      kind: "bid_sent",
      why: "No follow-up date. Sent Thu, Nov 5.",
      age: 11,
      ageText: "11 days",
      tone: "amber",
    });
  });
  it("one stamp alone still dates it", () => {
    expect(
      only(base({ bids: [bid({ status_changed_at: null, submitted_at: "2026-11-02T16:00:00Z" })] }))
        .age,
    ).toBe(14);
    expect(
      only(base({ bids: [bid({ submitted_at: null, status_changed_at: "2026-11-03T16:00:00Z" })] }))
        .age,
    ).toBe(13);
  });
});

describe("Nov 16 audit fix 16: a follow-up date from before the bid was sent", () => {
  const sentToday = { submitted_at: NOW, status_changed_at: NOW };
  it("does not put a bid sent today on the list", () => {
    expect(rowsOf(base({ bids: [bid({ ...sentToday, reminder_on: "2026-11-09" })] }))).toEqual([]);
  });
  it("counts as no follow-up date: the bid shows after the limit, and says so", () => {
    const r = only(base({ bids: [bid({ reminder_on: "2026-10-30" })] }));
    expect(r.why).toBe("No follow-up date. Sent Wed, Nov 4.");
    expect(r.tone).toBe("amber");
  });
  it("a follow-up date on or after the day it was sent still counts", () => {
    const r = only(
      base({
        bids: [
          bid({
            submitted_at: "2026-11-13T16:00:00Z",
            status_changed_at: "2026-11-13T16:00:00Z",
            reminder_on: "2026-11-13",
          }),
        ],
      }),
    );
    expect(r.why).toBe("Its follow-up date was Fri, Nov 13. No new date is set.");
  });
});

describe("Nov 16 audit fix 17: one row for a Done inspection, and never 0 days", () => {
  it("a Done inspection with problems gets only the row that waits to be authorized", () => {
    const t = inspected({ stage: "done", stage_changed_at: "2026-11-11T15:00:00Z" });
    expect(rowsOf(base({ tickets: [t] })).map((r) => r.key)).toEqual(["to_authorize:t1"]);
    // Inside the limit it has no row at all yet.
    expect(rowsOf(base({ tickets: [{ ...t, stage_changed_at: "2026-11-15T15:00:00Z" }] }))).toEqual(
      [],
    );
    // "No action needed" chosen while it is still Done: the same.
    expect(
      rowsOf(
        base({
          tickets: [
            { ...t, inspection_outcome: "none", inspection_outcome_at: "2026-11-12T15:00:00Z" },
          ],
        }),
      ).map((r) => r.key),
    ).toEqual(["to_authorize:t1"]);
  });
  it("the next-step row starts once the ticket is Authorized", () => {
    const t = inspected({ stage: "authorized", stage_changed_at: "2026-11-11T15:00:00Z" });
    expect(rowsOf(base({ tickets: [t] })).map((r) => r.key)).toEqual(["inspection_no_next:t1"]);
  });
  it("a wait that began today reads Today, in the row and in the group's header", () => {
    const limits = { bidDays: 0, authorizeDays: 0, unassignedDays: 0 };
    const { rows } = attentionList(
      base({
        limits,
        tickets: [
          ticket({ id: "t2", stage: "done", stage_changed_at: NOW }),
          ticket({ id: "t3", technician_id: null, scheduled_date: null, created_at: NOW }),
          inspected({ id: "t4", stage_changed_at: NOW }),
        ],
        bids: [bid({ submitted_at: NOW, status_changed_at: NOW })],
        opps: [
          {
            id: "o1",
            title: "New roof",
            status: "open",
            assignee_id: null,
            created_at: NOW,
            expected_close: null,
          },
        ],
        untouched: [
          {
            kind: "opportunity",
            item_id: "o2",
            title: "Leak call",
            assignee_id: LEE,
            assignee_name: "Lee Marsh",
            assigned_at: NOW,
            limit_days: 0,
          },
        ],
      }),
    );
    expect(rows.map((r) => r.kind).sort()).toEqual([
      "bid_sent",
      "inspection_no_next",
      "opp_nobody",
      "opp_untouched",
      "ticket_nobody",
      "to_authorize",
    ]);
    for (const r of rows) {
      expect(r.age).toBe(0);
      expect(r.ageText).toBe("Today");
      expect(r.tone).toBe("amber");
    }
    expect(groupNote(rows.filter((r) => r.group === "office"))).toBe("all today");
    expect(attentionSummary(rows)).toBe(
      "3 not started · 2 not followed up · 1 waiting on the office · $12,000 in bids with no follow-up",
    );
  });
  it("no row says 0 days, late or not", () => {
    // A ticket dated Friday, seen on the Saturday with a limit of 0 working days.
    const r = only(
      base({
        today: "2026-11-14",
        tickets: [ticket({ scheduled_date: "2026-11-13" })],
        untouched: [untouchedTicket({ limit_days: 0 })],
      }),
    );
    expect(r.ageText).toBe("Today");
  });
});

describe("Nov 16 audit fix 18: an inspection graded F with nothing flagged", () => {
  it("is listed on its grade alone", () => {
    const r = only(
      base({
        tickets: [
          inspected({ inspection: inspection(0, "F"), completed_at: "2026-11-06T15:00:00Z" }),
        ],
      }),
    );
    expect(r).toMatchObject({
      kind: "inspection_no_next",
      why: "Graded F. Nobody has chosen what happens next.",
      who: "Office",
      ageText: "10 days",
    });
    // Owner, later on Nov 16: "No action needed" takes the row off at once.
    expect(
      rowsOf(
        base({
          tickets: [
            inspected({
              inspection: inspection(0, "F"),
              inspection_outcome: "none",
              inspection_outcome_at: "2026-11-09T15:00:00Z",
              inspection_outcome_by: LEE,
            }),
          ],
        }),
      ),
    ).toEqual([]);
  });
  it("only the failing grade counts by itself; with problems the words are as before", () => {
    for (const grade of ["A", "B", "C", "D", null])
      expect(rowsOf(base({ tickets: [inspected({ inspection: inspection(0, grade) })] }))).toEqual(
        [],
      );
    expect(only(base({ tickets: [inspected({ inspection: inspection(2, "F") })] })).why).toBe(
      "Graded F with 2 problems found. Nobody has chosen what happens next.",
    );
  });
});

describe("Nov 16 audit fix 19: a bid with no maker", () => {
  const bids = [
    bid({ created_by: null }),
    bid({ id: "b2", name: "Oak Plaza", created_by: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" }),
    bid({
      id: "b3",
      name: "Late draft",
      status: "draft",
      due_date: "2026-11-09",
      created_by: null,
    }),
    bid({ id: "b4", name: "Elm Court" }),
  ];
  it('is filed under "No estimator", never under Nobody', () => {
    const rows = rowsOf(base({ bids }));
    expect(rows.map((r) => [r.key, r.who, r.whoKey])).toEqual([
      ["bid_draft_late:b3", "No estimator", "no_estimator"],
      ["bid_sent:b4", "Dana Reed", DANA],
      ["bid_sent:b1", "No estimator", "no_estimator"],
      ["bid_sent:b2", "No estimator", "no_estimator"],
    ]);
    expect(rows.some((r) => r.whoKey === WHO_NOBODY)).toBe(false);
  });
  it("has its own filter chip, after the people and Office and before Nobody", () => {
    const rows = rowsOf(
      base({
        bids,
        tickets: [
          ticket({ technician_id: null }),
          ticket({ id: "t2", stage: "done", stage_changed_at: "2026-11-10T15:00:00Z" }),
        ],
      }),
    );
    expect(attentionPeople(rows)).toEqual([
      { key: DANA, label: "Dana", count: 1 },
      { key: "office", label: "Office", count: 1 },
      { key: "no_estimator", label: "No estimator", count: 3 },
      { key: "nobody", label: "Nobody", count: 1 },
    ]);
  });
  it("the screen paints only Nobody red", () => {
    const box = readFileSync("src/components/owner-attention.tsx", "utf8").replace(/\s+/g, " ");
    expect(box).toContain('row.whoKey === WHO_NOBODY ? "font-semibold text-destructive" : ""');
  });
});

describe("Nov 16 audit fix 20: a submitted bid whose follow-up date has passed", () => {
  const past = (reminder_on: string) =>
    only(
      base({
        bids: [
          bid({
            submitted_at: "2026-10-20T16:00:00Z",
            status_changed_at: "2026-10-20T16:00:00Z",
            reminder_on,
          }),
        ],
      }),
    );
  it("is amber from the first day past it and red at twice the limit", () => {
    expect(past("2026-11-15").tone).toBe("amber");
    // 7 days past with a limit of 7: one times the limit is still amber.
    expect(past("2026-11-09").tone).toBe("amber");
    expect(past("2026-11-03").tone).toBe("amber"); // 13 days
    expect(past("2026-11-02").tone).toBe("red"); // 14 days
    expect(past("2026-11-02").why).toBe("Its follow-up date was Mon, Nov 2. No new date is set.");
  });
});

describe("Nov 16 audit fix 22: a Done ticket waiting to be authorized", () => {
  it("is aged from the day the work was finished, before the stage stamp", () => {
    const t = ticket({
      stage: "done",
      completed_at: "2026-11-06T15:00:00Z",
      stage_changed_at: "2026-11-15T15:00:00Z",
    });
    const r = only(base({ tickets: [t] }));
    expect(r).toMatchObject({ kind: "to_authorize", age: 10, ageText: "10 days", tone: "red" });
    // No finish stamp: the stage stamp, then the last update, as before.
    expect(
      only(
        base({ tickets: [{ ...t, completed_at: null, stage_changed_at: "2026-11-12T15:00:00Z" }] }),
      ).age,
    ).toBe(4);
    expect(
      only(
        base({
          tickets: [
            {
              ...t,
              completed_at: null,
              stage_changed_at: null,
              updated_at: "2026-11-13T15:00:00Z",
            },
          ],
        }),
      ).age,
    ).toBe(3);
  });
});

describe("Nov 16 audit fix 21: the read is not cut at 1,000 rows, and long id lists are chunked", () => {
  type Row = Record<string, unknown>;
  const ADMIN = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const pad = (n: number) => String(n).padStart(4, "0");
  const tables = (over: Record<string, Row[]> = {}): Record<string, Row[]> => ({
    profiles: [{ id: ADMIN, role: "admin", access: [], full_name: "Ana Admin", email: "ana@x" }],
    service_jobs: [],
    crm_opportunities: [],
    bids: [],
    invoices: [],
    crm_followups: [],
    crm_settings: [{ id: 1 }],
    ...over,
  });
  /** The fake as the caller's client, capped at 1,000 rows a request as the server is. */
  const client = (t: Record<string, Row[]>) =>
    fakeSupabase(t, { maxRows: 1000, rpcs: { crm_untouched: () => [] } });
  const run = async (db: unknown, userId = ADMIN): Promise<AttentionList> => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(NOW));
    try {
      return await (
        listOwnerAttention as unknown as (a: {
          data: Row;
          context: unknown;
        }) => Promise<AttentionList>
      )({ data: { today: TODAY }, context: { supabase: db, userId } });
    } finally {
      vi.useRealTimers();
    }
  };
  const jobRow = (over: Row = {}): Row => ({
    id: "j0000",
    number: 7000,
    customer_name: "Pine Hall",
    service_type: "inspection",
    stage: "authorized",
    stage_changed_at: "2026-11-02T15:00:00Z",
    updated_at: "2026-11-02T15:00:00Z",
    created_at: "2026-10-20T15:00:00Z",
    completed_at: "2026-11-02T15:00:00Z",
    scheduled_date: "2026-11-02",
    technician_id: LEE,
    inspection: inspection(1),
    inspection_outcome: null,
    inspection_outcome_at: null,
    inspection_outcome_by: null,
    from_job_id: null,
    deleted_at: null,
    ...over,
  });

  it("1,200 submitted bids are all listed", async () => {
    const bids = Array.from({ length: 1200 }, (_, n) => ({
      ...bid({ id: `b${pad(n)}`, name: `Bid ${pad(n)}` }),
      deleted_at: null,
    }));
    const l = await run(client(tables({ bids })).db);
    expect(l.rows.filter((r) => r.kind === "bid_sent")).toHaveLength(1200);
  });
  it("the inspections' repair tickets and bids are looked up 100 ids at a time", async () => {
    const inspections = Array.from({ length: 150 }, (_, n) =>
      jobRow({ id: `j${pad(n)}`, number: 7000 + n }),
    );
    const env = client(
      tables({
        service_jobs: [
          ...inspections,
          // A live repair ticket from the last inspection, and a deleted one from the first.
          jobRow({ id: "r1", service_type: "repair", inspection: null, from_job_id: "j0149" }),
          jobRow({
            id: "r2",
            service_type: "repair",
            inspection: null,
            from_job_id: "j0000",
            deleted_at: "2026-11-10T15:00:00Z",
          }),
        ],
        bids: [{ ...bid({ id: "b1", status: "won" }), from_job_id: "j0120", deleted_at: null }],
      }),
    );
    type Builder = { in: (c: string, vs: unknown[]) => Builder };
    const real = env.db as unknown as { from: (t: string) => Builder; rpc: unknown };
    const sizes: number[] = [];
    const spied = {
      ...real,
      from: (t: string) => {
        const b = real.from(t);
        const inner = b.in;
        b.in = (c, vs) => {
          if (c === "from_job_id") sizes.push(vs.length);
          return inner(c, vs);
        };
        return b;
      },
    };
    const l = await run(spied);
    expect(sizes.length).toBeGreaterThan(2);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(ID_CHUNK);
    const listed = l.rows.filter((r) => r.kind === "inspection_no_next").map((r) => r.key);
    // 150 inspections, less the one with a live repair ticket and the one with a live bid.
    expect(listed).toHaveLength(148);
    expect(listed).not.toContain("inspection_no_next:j0149");
    expect(listed).not.toContain("inspection_no_next:j0120");
    expect(listed).toContain("inspection_no_next:j0000");
    expect(env.writes).toEqual([]);
  });
  it("reads the columns the new rules need: the finish stamp and the invoice date", async () => {
    const l = await run(
      client(
        tables({
          service_jobs: [
            jobRow({
              id: "j1",
              service_type: "repair",
              inspection: null,
              stage: "done",
              completed_at: "2026-11-06T15:00:00Z",
              stage_changed_at: "2026-11-15T15:00:00Z",
            }),
          ],
          invoices: [{ ...invoice({ invoice_date: "2026-10-10" }) }],
        }),
      ).db,
    );
    expect(l.rows.map((r) => [r.key, r.ageText])).toEqual([
      ["to_authorize:j1", "10 days"],
      ["invoice_unpaid:v1", "7 days late"],
    ]);
  });
  it("only an admin is answered, and every read pages by id under the caller's client", async () => {
    const user = { id: LEE, role: "user", access: [], full_name: "Lee Marsh", email: "lee@x" };
    const t = tables();
    t["profiles"]!.push(user);
    await expect(run(client(t).db, LEE)).rejects.toThrow("Forbidden: admin only");
    const fn = readFileSync("src/lib/owner-attention.functions.ts", "utf8").replace(/\s+/g, " ");
    expect(fn).not.toMatch(/\.limit\((?!PAGE\))/);
    // Nov 21: ten now, with the requests from the public pages (publicRequestsWaiting).
    expect(fn.match(/\.order\("id"\) ?\.limit\(PAGE\)/g)).toHaveLength(10);
    expect(fn.match(/readAll\(/g)!.length).toBeGreaterThanOrEqual(9);
    expect(fn).toContain("const sb = context.supabase;");
    expect(fn).not.toMatch(/supabaseAdmin|serverClient|service_role/);
  });
});
