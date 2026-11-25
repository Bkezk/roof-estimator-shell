/**
 * One job, one row (owner, Nov 25, 2026: "2. go i like this setup"). The rule is job-steps.ts;
 * job-steps.server.ts reads the rows and sends the two notices.
 *
 * His words: "if there is an opportunity then an inspection ticket gets generated from that then
 * the opportunity becomes overdue even though someone is going to do the inspection thats a bit
 * confusing", and "id also like for only 1 thing to appear on the work overview at a time … but
 * i also dont want to miss things and a weird situation where theres an inspection/repair at the
 * same location i dont want to miss that".
 *
 * Nov 25, 2026 is a Wednesday. Every name and title here is made up.
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  alsoOpenHere,
  bidIsOpenStep,
  followUpAfterStep,
  followUpBy,
  LINK_ALREADY,
  LINK_NO_CUSTOMER,
  LINK_NOT_OPEN,
  LINK_OTHER_CUSTOMER,
  lateTellDue,
  linkedWords,
  linkProblem,
  linkRows,
  openStepsByOpportunity,
  stepDoneNotice,
  stepIsLate,
  stepLateNotice,
  ticketIsOpenStep,
  waitingWords,
  type LinkTicketIn,
  type StepBid,
  type StepTicket,
} from "@/lib/job-steps";
import { oppCounts, detailGroups } from "@/lib/owner-view";

const src = (p: string) => readFileSync(p, "utf8");

const OPP = "0pp00000-0000-4000-8000-000000000001";
const OPP2 = "0pp00000-0000-4000-8000-000000000002";
const GARRY = "user-garry";
const RO = "user-ro";

const ticket = (over: Partial<StepTicket> = {}): StepTicket => ({
  id: "t1",
  number: 7090,
  service_type: "inspection",
  stage: "scheduled",
  scheduled_date: "2026-12-04",
  technician_id: GARRY,
  from_opportunity_id: OPP,
  from_job_id: null,
  deleted_at: null,
  ...over,
});
const bid = (over: Partial<StepBid> = {}): StepBid => ({
  id: "b1",
  name: "Dock re-roof",
  status: "draft",
  due_date: "2026-12-10",
  created_by: RO,
  opportunity_id: OPP,
  from_job_id: null,
  deleted_at: null,
  ...over,
});

describe("what an opportunity waits on", () => {
  it("a scheduled inspection with a technician is an open step", () => {
    const m = openStepsByOpportunity({ tickets: [ticket()], bids: [] });
    expect(m.get(OPP)).toEqual([
      {
        kind: "ticket",
        id: "t1",
        label: "inspection #7090",
        date: "2026-12-04",
        personId: GARRY,
        // Nov 26, 2026 (the audit's 22): a step also says the day it counts as due (its own
        // day here) and the day it was made, when that is known.
        due: "2026-12-04",
        made: null,
      },
    ]);
  });

  it("a ticket nobody is on holds nothing back: the opportunity stays in sight", () => {
    expect(ticketIsOpenStep(ticket({ technician_id: null }))).toBe(false);
    expect(
      openStepsByOpportunity({ tickets: [ticket({ technician_id: null })], bids: [] }).size,
    ).toBe(0);
  });

  it("a done, authorized, invoiced, closed or deleted ticket holds nothing back", () => {
    for (const stage of ["done", "authorized", "invoiced", "closed"])
      expect(ticketIsOpenStep(ticket({ stage }))).toBe(false);
    expect(ticketIsOpenStep(ticket({ deleted_at: "2026-11-25T10:00:00Z" }))).toBe(false);
  });

  it("an open ticket with no date still holds it back while somebody has it", () => {
    const t = ticket({ stage: "open", scheduled_date: null });
    expect(openStepsByOpportunity({ tickets: [t], bids: [] }).get(OPP)?.[0]?.date).toBeNull();
  });

  it("a repair made from the opportunity's inspection is part of the same job", () => {
    const inspection = ticket({ stage: "done" });
    const repair = ticket({
      id: "t2",
      number: 7091,
      service_type: "repair",
      from_opportunity_id: null,
      from_job_id: "t1",
      scheduled_date: "2026-12-09",
    });
    const m = openStepsByOpportunity({ tickets: [inspection, repair], bids: [] });
    expect(m.get(OPP)?.map((s) => s.label)).toEqual(["repair #7091"]);
  });

  it("a draft bid is an open step; a submitted, won, lost or deleted bid is not", () => {
    expect(bidIsOpenStep(bid())).toBe(true);
    for (const status of ["submitted", "won", "lost"])
      expect(bidIsOpenStep(bid({ status }))).toBe(false);
    expect(bidIsOpenStep(bid({ deleted_at: "2026-11-25T10:00:00Z" }))).toBe(false);
    expect(bidIsOpenStep(bid({ created_by: null }))).toBe(false);
  });

  it("a bid made from the inspection belongs to the inspection's opportunity", () => {
    const m = openStepsByOpportunity({
      tickets: [ticket({ stage: "done" })],
      bids: [bid({ opportunity_id: null, from_job_id: "t1" })],
    });
    expect(m.get(OPP)?.map((s) => s.label)).toEqual(["bid Dock re-roof"]);
  });

  it("a repair and a bid from one inspection both hold it back: tickets first", () => {
    const m = openStepsByOpportunity({
      tickets: [
        ticket({ stage: "done" }),
        ticket({ id: "t2", number: 7091, service_type: "repair", from_job_id: "t1" }),
      ],
      bids: [bid()],
    });
    expect(m.get(OPP)?.map((s) => s.label)).toEqual(["repair #7091", "bid Dock re-roof"]);
  });

  it("a ticket that belongs to no opportunity holds none back", () => {
    const m = openStepsByOpportunity({
      tickets: [ticket({ from_opportunity_id: null })],
      bids: [],
    });
    expect(m.size).toBe(0);
  });

  it("each opportunity waits only on its own steps", () => {
    const m = openStepsByOpportunity({
      tickets: [ticket(), ticket({ id: "t9", number: 7099, from_opportunity_id: OPP2 })],
      bids: [],
    });
    expect(m.get(OPP)?.map((s) => s.id)).toEqual(["t1"]);
    expect(m.get(OPP2)?.map((s) => s.id)).toEqual(["t9"]);
  });
});

describe("the words", () => {
  const steps = openStepsByOpportunity({ tickets: [ticket()], bids: [] }).get(OPP)!;

  it("one step is said in full: what, its day, who has it", () => {
    expect(waitingWords(steps, { [GARRY]: "Garry Peters" })).toBe(
      "Waiting on inspection #7090, Dec 4, Garry Peters",
    );
  });

  // Nov 26, 2026 (the audit's 22): a missing date was left out. It is now said, "no date
  // set": the step with no date is the one that can sit unseen.
  it("an unknown name is left out, never guessed, and a missing date is said", () => {
    expect(waitingWords(steps)).toBe("Waiting on inspection #7090, Dec 4");
    const noDay = openStepsByOpportunity({
      tickets: [ticket({ stage: "open", scheduled_date: null })],
      bids: [],
    }).get(OPP)!;
    expect(waitingWords(noDay, { [GARRY]: "Garry Peters" })).toBe(
      "Waiting on inspection #7090, no date set, Garry Peters",
    );
  });

  it("two steps are both named", () => {
    const two = openStepsByOpportunity({
      tickets: [ticket({ id: "t2", number: 7091, service_type: "repair" })],
      bids: [bid()],
    }).get(OPP)!;
    expect(waitingWords(two)).toBe("Waiting on repair #7091, Dec 4 and bid Dock re-roof, Dec 10");
  });

  it("nothing waited on says nothing", () => {
    expect(waitingWords([])).toBe("");
  });
});

describe("the step is finished: two working days to follow up", () => {
  it("done on a Wednesday is due the Friday", () => {
    expect(followUpBy("2026-11-25")).toBe("2026-11-27");
  });
  it("done on a Friday is due the Tuesday: the weekend is not counted", () => {
    expect(followUpBy("2026-11-27")).toBe("2026-12-01");
  });
  it("an expected close already further out is left alone", () => {
    expect(followUpAfterStep("2026-11-25", "2026-12-20")).toBe("2026-12-20");
  });
  it("a passed or empty expected close moves out to the two working days", () => {
    expect(followUpAfterStep("2026-11-25", "2026-11-12")).toBe("2026-11-27");
    expect(followUpAfterStep("2026-11-25", null)).toBe("2026-11-27");
  });
  it("the notice names the step, the opportunity and the day", () => {
    expect(
      stepDoneNotice({
        label: "inspection #7090",
        outcome: "done",
        opportunity: "Leak at the dock",
        by: "Friday 11/27/2026",
      }),
    ).toEqual({
      title: "Inspection #7090 is done: follow up on Leak at the dock",
      body: "Your opportunity was waiting on it. Follow up by Friday 11/27/2026.",
    });
  });
});

// Nov 26, 2026 (the audit's 22): the rule here was "the first working day after its date, and
// only that day" (stepLateOn), and "a step with no date is never late". That is the fault that
// was fixed: a missed morning lost the notice for good and nothing was said twice. The same
// days are asked of the new rule (job-steps-late-nov26.test.ts has the rest).
describe("a step runs late: said the next working day, then every third", () => {
  const late = (due: string | null, today: string) => [{ due }].filter((x) => stepIsLate(x, today));
  it("the first working day after its date, and not on its own day or before", () => {
    expect(lateTellDue(late("2026-11-24", "2026-11-25"), null, "2026-11-25")).toBe(true);
    expect(lateTellDue(late("2026-11-25", "2026-11-25"), null, "2026-11-25")).toBe(false);
    expect(lateTellDue(late("2026-11-26", "2026-11-25"), null, "2026-11-25")).toBe(false);
  });
  it("a morning that was missed is caught up on the next one", () => {
    expect(lateTellDue(late("2026-11-24", "2026-11-26"), null, "2026-11-26")).toBe(true);
  });
  it("a Friday step is said on the Monday, never at the weekend", () => {
    expect(lateTellDue(late("2026-11-27", "2026-11-28"), null, "2026-11-28")).toBe(false);
    expect(lateTellDue(late("2026-11-27", "2026-11-29"), null, "2026-11-29")).toBe(false);
    expect(lateTellDue(late("2026-11-27", "2026-11-30"), null, "2026-11-30")).toBe(true);
  });
  it("a step with no day known at all is never late", () => {
    expect(stepIsLate({ due: null }, "2026-11-25")).toBe(false);
  });
  it("the notice says what was late, for when and with whom", () => {
    expect(
      stepLateNotice({
        steps: [
          {
            label: "inspection #7090",
            was: "Tuesday 11/24/2026",
            made: null,
            who: "Garry Peters",
          },
        ],
        opportunity: "Leak at the dock",
      }),
    ).toEqual({
      title: "Inspection #7090 is late: Leak at the dock",
      body: "It was set for Tuesday 11/24/2026 with Garry Peters. Your opportunity is waiting on it.",
    });
  });
});

describe("two jobs at one property are never merged", () => {
  const place = (over: Record<string, unknown>) => ({
    id: "t1",
    number: 7090,
    service_type: "inspection",
    stage: "scheduled",
    site_id: "site-a",
    from_opportunity_id: null as string | null,
    from_job_id: null as string | null,
    ...over,
  });

  it("two unrelated open tickets at one property each say the other is open", () => {
    const m = alsoOpenHere([
      place({ from_opportunity_id: OPP }),
      place({ id: "t2", number: 7070, service_type: "repair" }),
    ]);
    expect(m.get("t1")).toBe("Also open at this property: repair #7070");
    expect(m.get("t2")).toBe("Also open at this property: inspection #7090");
  });

  it("tickets of the same job say nothing of each other", () => {
    const m = alsoOpenHere([
      place({ from_opportunity_id: OPP }),
      place({ id: "t2", number: 7091, service_type: "repair", from_job_id: "t1" }),
    ]);
    expect(m.size).toBe(0);
  });

  it("a ticket at another property, a finished one and one with no property are not named", () => {
    const m = alsoOpenHere([
      place({}),
      place({ id: "t2", number: 7070, site_id: "site-b" }),
      place({ id: "t3", number: 7071, stage: "done" }),
      place({ id: "t4", number: 7072, site_id: null }),
    ]);
    expect(m.size).toBe(0);
  });

  it("three unrelated tickets name the other two, by number", () => {
    const m = alsoOpenHere([
      place({}),
      place({ id: "t2", number: 7070, service_type: "repair" }),
      place({ id: "t3", number: 7065, service_type: "other" }),
    ]);
    expect(m.get("t1")).toBe("Also open at this property: ticket #7065, repair #7070");
  });
});

describe("the Owner view counts a waiting opportunity as open, never overdue", () => {
  const opp = {
    id: OPP,
    assignee_id: RO,
    status: "contacted",
    expected_close: "2026-11-12",
    est_value: null,
  };
  it("past its expected close and waiting on nothing: one overdue", () => {
    expect(oppCounts([opp], "2026-11-25")[RO]?.overdue).toBe(1);
  });
  it("the same opportunity while it waits on its inspection: none overdue, still open", () => {
    const c = oppCounts([opp], "2026-11-25", [], new Set([OPP]))[RO];
    expect(c?.overdue).toBe(0);
    expect(c?.open).toBe(1);
  });
  it("the person's own list leaves the waiting opportunity out of Overdue", () => {
    const row = { ...opp, title: "Leak at the dock", customer: null };
    expect(detailGroups(RO, [], [row], "2026-11-25").overdue).toHaveLength(1);
    expect(detailGroups(RO, [], [row], "2026-11-25", [], new Set([OPP])).overdue).toHaveLength(0);
  });
});

describe("link an existing ticket", () => {
  const opp = { id: OPP, account_id: "acct-1" };
  const t = (over: Partial<LinkTicketIn> = {}): LinkTicketIn => ({
    id: "t1",
    number: 7071,
    service_type: "inspection",
    stage: "scheduled",
    scheduled_date: "2026-12-04",
    account_id: "acct-1",
    from_opportunity_id: null,
    from_job_id: null,
    deleted_at: null,
    site_name: "North plant",
    ...over,
  });

  it("an open ticket of the same customer that belongs to no opportunity can be linked", () => {
    expect(linkProblem(opp, t())).toBeNull();
  });
  it("another customer's ticket is refused", () => {
    expect(linkProblem(opp, t({ account_id: "acct-2" }))).toBe(LINK_OTHER_CUSTOMER);
    expect(linkProblem(opp, t({ account_id: null }))).toBe(LINK_OTHER_CUSTOMER);
  });
  it("an opportunity with no customer is told to pick one", () => {
    expect(linkProblem({ id: OPP, account_id: null }, t())).toBe(LINK_NO_CUSTOMER);
  });
  it("a ticket of another opportunity, or made from one of its tickets, is refused", () => {
    expect(linkProblem(opp, t({ from_opportunity_id: OPP2 }))).toBe(LINK_ALREADY);
    expect(linkProblem(opp, t({ from_job_id: "tx" }), OPP2)).toBe(LINK_ALREADY);
  });
  it("a finished or deleted ticket is refused", () => {
    expect(linkProblem(opp, t({ stage: "done" }))).toBe(LINK_NOT_OPEN);
    expect(linkProblem(opp, t({ deleted_at: "2026-11-25T10:00:00Z" }))).toBe(LINK_NOT_OPEN);
  });

  it("the window lists the linked tickets first, then the ones that can be linked", () => {
    const rows = linkRows(opp, [
      t({ id: "a", number: 7080 }),
      t({ id: "b", number: 7060, from_opportunity_id: OPP, stage: "done" }),
      t({ id: "c", number: 7075, from_opportunity_id: OPP2 }),
      t({ id: "d", number: 7076, stage: "done" }),
      t({ id: "e", number: 7077, service_type: "repair", from_job_id: "b", scheduled_date: null }),
    ]);
    expect(rows).toEqual([
      {
        id: "b",
        number: 7060,
        label: "Inspection #7060",
        day: "Dec 4",
        place: "North plant",
        linked: true,
        // Nov 26, 2026 (the audit's 21): a row says when linking it would mark the
        // opportunity Won. An inspection does not.
        ask: null,
      },
      {
        id: "a",
        number: 7080,
        label: "Inspection #7080",
        day: "Dec 4",
        place: "North plant",
        linked: false,
        ask: null,
      },
    ]);
  });

  it("the words after a press say when the opportunity moved", () => {
    expect(linkedWords("Inspection #7071")).toBe("Inspection #7071 is linked to this opportunity.");
    expect(linkedWords("Inspection #7071", { to: "Contacted" })).toBe(
      "Inspection #7071 is linked to this opportunity. The opportunity is now Contacted.",
    );
  });
});

// ── The server side, on a small made-up database ────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = { [k: string]: any } & {
  stage?: string;
  expected_close?: string | null;
  scheduled_date?: string | null;
  technician_id?: string | null;
};
const db: {
  crm_opportunities: Row[];
  service_jobs: Row[];
  bids: Row[];
  crm_contact_log: Row[];
  // Nov 26, 2026: when the last late-step notice went (20261125400000).
  step_late_marks: Row[];
} = { crm_opportunities: [], service_jobs: [], bids: [], crm_contact_log: [], step_late_marks: [] };
const tables = db as unknown as Record<string, Row[]>;
const sent: { to: string[]; title: string; body: string; url: string; kind: string }[] = [];
const synced: Row[] = [];

/** A tiny stand-in for the database client: filters, one row, update, insert. */
function fakeClient() {
  const from = (table: string) => {
    const filters: ((r: Row) => boolean)[] = [];
    let patch: Row | null = null;
    const rows = () => (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
    const run = () => {
      const hit = rows();
      if (patch) for (const r of hit) Object.assign(r, patch);
      return { data: hit, error: null };
    };
    const q = {
      select: () => q,
      eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
      in: (c: string, v: unknown[]) => (filters.push((r) => v.includes(r[c])), q),
      is: (c: string, v: unknown) => (filters.push((r) => (r[c] ?? null) === v), q),
      not: (c: string, _op: string, v: unknown) => (filters.push((r) => (r[c] ?? null) !== v), q),
      limit: () => q,
      order: () => q,
      // Nov 26, 2026: a full page is read on by id.
      gt: (c: string, v: string) => (filters.push((r) => String(r[c]) > v), q),
      update: (p: Row) => ((patch = p), q),
      insert: (r: Row) => {
        (tables[table] ??= []).push(r);
        return Promise.resolve({ error: null });
      },
      maybeSingle: () => Promise.resolve({ data: run().data[0] ?? null, error: null }),
      then: (ok: (v: { data: Row[]; error: null }) => unknown) => Promise.resolve(run()).then(ok),
    };
    return q;
  };
  return { from } as never;
}

vi.mock("@/lib/notify.server", () => ({
  serverClient: async (sb: unknown) => sb,
  notify: async (to: string[], n: { kind: string; title: string; body: string; url: string }) => {
    sent.push({ to, ...n });
    return to.length;
  },
}));
vi.mock("@/lib/followups.server", () => ({
  syncFollowup: async (input: Row) => {
    synced.push(input);
    return "ok";
  },
}));

const seed = () => {
  db.crm_opportunities = [
    {
      id: OPP,
      title: "Leak at the dock",
      status: "contacted",
      assignee_id: RO,
      account_id: "acct-1",
      expected_close: "2026-11-12",
      deleted_at: null,
    },
  ];
  db.service_jobs = [{ ...ticket() }];
  db.bids = [];
  db.crm_contact_log = [];
  db.step_late_marks = [];
  sent.length = 0;
  synced.length = 0;
};

describe("job-steps.server", () => {
  beforeEach(seed);
  const WED = new Date("2026-11-25T15:00:00Z");

  it("openStepsFor reads the inspection, the repair made from it and the bid", async () => {
    const { openStepsFor } = await import("@/lib/job-steps.server");
    db.service_jobs.push({
      ...ticket({
        id: "t2",
        number: 7091,
        service_type: "repair",
        from_opportunity_id: null,
        from_job_id: "t1",
      }),
    });
    db.bids.push({ ...bid({ opportunity_id: null, from_job_id: "t1" }) });
    const m = await openStepsFor(fakeClient(), [OPP]);
    expect(m.get(OPP)?.map((s) => s.label)).toEqual([
      "inspection #7090",
      "repair #7091",
      "bid Dock re-roof",
    ]);
  });

  it("openStepsFor answers nothing for an opportunity with no step, and for no ids", async () => {
    const { openStepsFor } = await import("@/lib/job-steps.server");
    expect((await openStepsFor(fakeClient(), [OPP2])).size).toBe(0);
    expect((await openStepsFor(fakeClient(), [])).size).toBe(0);
  });

  it("a read that fails answers nothing: every opportunity shows as it always did", async () => {
    const { openStepsFor } = await import("@/lib/job-steps.server");
    const broken = {
      from: () => {
        throw new Error("down");
      },
    } as never;
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await openStepsFor(broken, [OPP])).size).toBe(0);
    quiet.mockRestore();
  });

  it("the inspection is done and nothing else is open: the person is told, with two working days", async () => {
    const { afterStepDone } = await import("@/lib/job-steps.server");
    db.service_jobs[0]!.stage = "done";
    const out = await afterStepDone(
      fakeClient(),
      { kind: "ticket", label: "inspection #7090", from_opportunity_id: OPP, from_job_id: null },
      { id: GARRY, name: "Garry Peters" },
      WED,
    );
    expect(out).toBe("told");
    expect(db.crm_opportunities[0]!.expected_close).toBe("2026-11-27");
    expect(synced).toHaveLength(1);
    expect(synced[0]).toMatchObject({
      kind: "opportunity",
      itemId: OPP,
      dueDate: "2026-11-27",
      quiet: true,
    });
    expect(sent).toEqual([
      {
        to: [RO],
        kind: "followup",
        title: "Inspection #7090 is done: follow up on Leak at the dock",
        body: "Your opportunity was waiting on it. Follow up by Friday 11/27/2026.",
        url: `/opportunities?id=${OPP}`,
      },
    ]);
    expect(db.crm_contact_log).toEqual([
      expect.objectContaining({
        kind: "opportunity",
        item_id: OPP,
        method: "note",
        note: "Inspection #7090 is done. Follow up by Friday 11/27/2026.",
      }),
    ]);
  });

  it("an expected close further out is not pulled in, and its timer is left alone", async () => {
    const { afterStepDone } = await import("@/lib/job-steps.server");
    db.service_jobs[0]!.stage = "done";
    db.crm_opportunities[0]!.expected_close = "2026-12-20";
    await afterStepDone(
      fakeClient(),
      { kind: "ticket", label: "inspection #7090", from_opportunity_id: OPP, from_job_id: null },
      { id: GARRY, name: "Garry Peters" },
      WED,
    );
    expect(db.crm_opportunities[0]!.expected_close).toBe("2026-12-20");
    expect(synced).toHaveLength(0);
    expect(sent[0]?.body).toBe(
      "Your opportunity was waiting on it. Follow up by Sunday 12/20/2026.",
    );
  });

  it("another step of the job is still open: nobody is told yet", async () => {
    const { afterStepDone } = await import("@/lib/job-steps.server");
    db.service_jobs[0]!.stage = "done";
    db.bids.push({ ...bid() });
    const out = await afterStepDone(
      fakeClient(),
      { kind: "ticket", label: "inspection #7090", from_opportunity_id: OPP, from_job_id: null },
      { id: GARRY, name: "Garry Peters" },
      WED,
    );
    expect(out).toBe("still_waiting");
    expect(sent).toHaveLength(0);
    expect(db.crm_opportunities[0]!.expected_close).toBe("2026-11-12");
  });

  it("a won, lost or deleted opportunity, one with nobody on it, and a ticket of no opportunity tell nobody", async () => {
    const { afterStepDone } = await import("@/lib/job-steps.server");
    db.service_jobs[0]!.stage = "done";
    const step = {
      kind: "ticket" as const,
      label: "inspection #7090",
      from_opportunity_id: OPP,
      from_job_id: null,
    };
    const who = { id: GARRY, name: "Garry Peters" };
    for (const patch of [
      { status: "won" },
      { status: "lost" },
      { deleted_at: "x" },
      { assignee_id: null },
    ]) {
      seed();
      Object.assign(db.crm_opportunities[0]!, patch);
      expect(await afterStepDone(fakeClient(), step, who, WED)).toBe("none");
    }
    seed();
    expect(
      await afterStepDone(fakeClient(), { ...step, from_opportunity_id: null }, who, WED),
    ).toBe("none");
    expect(sent).toHaveLength(0);
  });

  it("a repair made from the inspection finds the opportunity through the inspection", async () => {
    const { afterStepDone } = await import("@/lib/job-steps.server");
    db.service_jobs[0]!.stage = "done";
    const out = await afterStepDone(
      fakeClient(),
      { kind: "ticket", label: "repair #7091", from_opportunity_id: null, from_job_id: "t1" },
      { id: GARRY, name: "Garry Peters" },
      WED,
    );
    expect(out).toBe("told");
    expect(sent[0]?.title).toBe("Repair #7091 is done: follow up on Leak at the dock");
  });

  it("a submitted bid says submitted", async () => {
    const { afterStepDone } = await import("@/lib/job-steps.server");
    db.service_jobs = [];
    const out = await afterStepDone(
      fakeClient(),
      { kind: "bid", label: "bid Dock re-roof", from_opportunity_id: OPP, from_job_id: null },
      { id: RO, name: "Ro" },
      WED,
    );
    expect(out).toBe("told");
    expect(sent[0]?.title).toBe("Bid Dock re-roof is submitted: follow up on Leak at the dock");
  });

  // Nov 26, 2026 (the audit's 22 and 24): the late notice no longer asks "already told
  // today" of the other notices. It has a claim of its own (step_late_marks), it is said again
  // every third working day, and the person is told even when they have the step themselves.
  it("the morning after a missed inspection, the opportunity's person is told once", async () => {
    const { tellLateSteps } = await import("@/lib/job-steps.server");
    db.service_jobs[0]!.scheduled_date = "2026-11-24";
    const names = (id: string | null) => (id === GARRY ? "Garry Peters" : null);
    expect(await tellLateSteps(fakeClient(), WED, names)).toEqual({ told: 1, failed: 0 });
    expect(sent).toEqual([
      {
        to: [RO],
        kind: "followup",
        title: "Inspection #7090 is late: Leak at the dock",
        body: "It was set for Tuesday 11/24/2026 with Garry Peters. Your opportunity is waiting on it.",
        url: `/opportunities?id=${OPP}`,
      },
    ]);
    // A second pass the same morning finds the claim and sends nothing.
    expect(await tellLateSteps(fakeClient(), WED, names)).toEqual({ told: 0, failed: 0 });
    expect(sent).toHaveLength(1);
  });

  it("two days late and never told: told now. The same person on both: told too", async () => {
    const { tellLateSteps } = await import("@/lib/job-steps.server");
    const names = () => null;
    db.service_jobs[0]!.scheduled_date = "2026-11-23";
    expect((await tellLateSteps(fakeClient(), WED, names)).told).toBe(1);
    seed();
    db.service_jobs[0]!.scheduled_date = "2026-11-24";
    db.service_jobs[0]!.technician_id = RO;
    expect((await tellLateSteps(fakeClient(), WED, names)).told).toBe(1);
    expect(sent[0]?.body).toBe(
      "It was set for Tuesday 11/24/2026 with you. Your opportunity is waiting on it.",
    );
  });
});

describe("every screen and the reminder run ask the one rule", () => {
  it("Work Overview leaves a waiting opportunity out and gives its ticket the two notes", () => {
    const s = src("src/lib/my-work.functions.ts");
    // Nov 26, 2026 (the audit's 24): the opportunities nobody is on are asked in the same call.
    expect(s).toContain(
      "const waiting = await openStepsFor(sb, [...oppIds, ...(unOpps.data ?? []).map((o) => o.id)]);",
    );
    expect(s).toContain('.filter((f) => !(f.kind === "opportunity" && waiting.has(f.item_id)))');
    expect(s).toContain("job_note: title ? `Opportunity: ${title}` : null,");
    expect(s).toContain("also_here: alsoHere.get(t.id) ?? null,");
    expect(src("src/components/my-work-page.tsx")).toContain("data-job-note");
  });

  it("the Overdue opportunities tile does not count it", () => {
    expect(src("src/lib/work-counts.functions.ts")).toMatch(
      /!oppsOnHold\.has\(o\.id\) && !waiting\.has\(o\.id\)/,
    );
  });

  // Nov 26, 2026 (the audit's 23): a waiting one was skipped inside the loop and counted in
  // `skipped`; it is now left out when the due follow-ups are read, counted in `waiting`, and
  // takes no place among the 200. The late notice has its own claim, not notToldToday.
  it("the reminder run leaves it unclaimed, and tells the late step with the morning pass", () => {
    const s = src("src/lib/notify.server.ts");
    expect(s).toMatch(
      /if \(f\.kind === "opportunity" && waiting\.has\(f\.item_id\)\) out\.waiting\+\+;\s+else if \(due\.length < DUE_PAGE\) due\.push\(f\);/,
    );
    expect(s).toContain("await tellLateSteps(");
    expect(s).not.toContain("(ids, url) => notToldToday(admin, ids, url, now),");
    expect(s).toContain(
      'const past = overLimit.filter((u) => !(u.kind === "opportunity" && waiting.has(u.item_id)));',
    );
  });

  it("the Owner view and Needs attention leave it out", () => {
    const v = src("src/lib/owner-view.functions.ts");
    expect(v).toContain("const oppsBy = oppCounts(oppRows, today, followupRows, waitingOpps);");
    expect(v.match(/f\.kind === "opportunity" && waitingOpps\.has\(f\.item_id\)/g)).toHaveLength(2);
    expect(src("src/lib/owner-attention.functions.ts")).toContain(
      'untouched.filter((u) => !(u.kind === "opportunity" && waitingOpps.has(u.item_id)))',
    );
  });

  it("the Opportunities page says what it waits on and does not call it overdue", () => {
    const p = src("src/components/opportunities-page.tsx");
    expect(p).toContain("isOppHeld(o, today) || !!o.waiting_on");
    expect(p).toContain("data-opp-waiting");
    expect(src("src/lib/opportunities.functions.ts")).toContain("waiting_on:");
  });

  it("a ticket marked Done and a bid that leaves Draft hand the opportunity back", () => {
    const t = src("src/lib/ticket-events.server.ts");
    // Nov 26, 2026 (the audit's 24): every way out of Open / Scheduled, and a delete, too.
    expect(t).toMatch(
      /if \(becameDone \|\| leftOpen \|\| deletedOpen\) \{\s+const \{ afterStepDone \}/,
    );
    const b = src("src/lib/bids.functions.ts");
    expect(b.match(/await bidLeftDraft\(/g)).toHaveLength(2);
    expect(b).toContain('if (asBidStatus(prevStatus) !== "draft") return;');
  });

  it("the link is offered only to the people who create tickets, on the server too", () => {
    const f = src("src/lib/job-link.functions.ts");
    expect(f).toContain("if (!dispatchesTickets(prof ?? null)) throw new Error(LINK_NOT_ALLOWED);");
    expect(f).toContain('.is("from_opportunity_id", null)');
    expect(f).toContain("const problem = linkProblem(opp, t, parentOpp);");
    const p = src("src/components/opportunities-page.tsx");
    expect(p).toMatch(
      /opp && !deleted && !!opp\.account_id && dispatchesTickets\(profile\) && \(\s+<LinkTicket/,
    );
    // No line at all while there is nothing to link and nothing linked.
    expect(src("src/components/link-ticket.tsx")).toContain("if (!list.length) return null;");
  });
});
