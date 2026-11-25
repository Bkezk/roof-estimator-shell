/**
 * A step nobody finishes must not keep its opportunity quiet for good (the audit of Nov 25,
 * finding 22; owner: "go on ... 21, 22, 23, 24", and his fear: "i also dont want to miss
 * things"). The rule is job-steps.ts; job-steps.server.ts reads the rows and sends the notice.
 *
 * Before: a late step was said on ONE calendar day (the first working day after its date), so
 * a run that missed that morning lost it for good; a step with no date was never late; nobody
 * was told when the opportunity's person held the step themselves; the bid of somebody who has
 * left still held its opportunity; and a copy of a bid made for another customer held the
 * first customer's opportunity.
 *
 * Nov 25, 2026 is a Wednesday. Every name, title and number here is made up.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sent = vi.hoisted(
  () => [] as { to: string[]; title: string; body: string; url: string; kind: string }[],
);
const notifyFails = vi.hoisted(() => ({ on: false }));
vi.mock("@/lib/notify.server", () => ({
  serverClient: async (sb: unknown) => sb,
  notify: async (to: string[], n: { kind: string; title: string; body: string; url: string }) => {
    if (notifyFails.on) throw new Error("the mail is down");
    sent.push({ to, ...n });
    return to.length;
  },
}));

import {
  LATE_AGAIN_WORKING_DAYS,
  STEP_NO_DATE,
  UNDATED_STEP_WORKING_DAYS,
  bidIsOfTicketsJob,
  bidIsOpenStep,
  lateTellDue,
  openStepsByOpportunity,
  stepDueDay,
  stepIsLate,
  stepLateNotice,
  waitingWords,
  type StepBid,
  type StepTicket,
} from "@/lib/job-steps";
import { openStepsFor, openStepsStrict, tellLateSteps } from "@/lib/job-steps.server";
import type { Client } from "@/lib/notify.server";
import { fakeSupabase } from "@/test/fake-supabase";

const OPP = "0pp00000-0000-4000-8000-000000000001";
const OPP2 = "0pp00000-0000-4000-8000-000000000002";
const GARRY = "user-garry";
const RO = "user-ro";
const GONE = "user-who-left";
const ACME = "acct-acme";
const OTHER = "acct-other";

const ticket = (over: Partial<StepTicket> = {}): StepTicket => ({
  id: "t1",
  number: 7090,
  service_type: "inspection",
  stage: "scheduled",
  scheduled_date: "2026-12-03",
  technician_id: GARRY,
  from_opportunity_id: OPP,
  from_job_id: null,
  deleted_at: null,
  account_id: ACME,
  created_at: "2026-11-20T15:00:00Z",
  ...over,
});
const bid = (over: Partial<StepBid> = {}): StepBid => ({
  id: "b1",
  name: "Dock re-roof",
  status: "draft",
  due_date: "2026-12-03",
  created_by: RO,
  opportunity_id: OPP,
  from_job_id: null,
  deleted_at: null,
  account_id: ACME,
  created_at: "2026-11-11T15:00:00Z",
  ...over,
});
const late = (due: string | null, today: string) => [{ due }].filter((s) => stepIsLate(s, today));

describe("(a) late is said the next working day, and again every third while it is late", () => {
  it("a bid due Thursday Dec 3 is said on Friday Dec 4", () => {
    expect(lateTellDue(late("2026-12-03", "2026-12-04"), null, "2026-12-04")).toBe(true);
  });

  it("the Friday run was missed: Monday's run says it (it was lost for good before)", () => {
    expect(lateTellDue(late("2026-12-03", "2026-12-07"), null, "2026-12-07")).toBe(true);
    // And any later working day it has still not been said.
    expect(lateTellDue(late("2026-12-03", "2026-12-16"), null, "2026-12-16")).toBe(true);
  });

  it("told on Friday Dec 4: not Monday or Tuesday, again on Wednesday Dec 9, the third working day", () => {
    expect(LATE_AGAIN_WORKING_DAYS).toBe(3);
    const told = "2026-12-04";
    expect(lateTellDue(late("2026-12-03", "2026-12-07"), told, "2026-12-07")).toBe(false);
    expect(lateTellDue(late("2026-12-03", "2026-12-08"), told, "2026-12-08")).toBe(false);
    expect(lateTellDue(late("2026-12-03", "2026-12-09"), told, "2026-12-09")).toBe(true);
  });

  it("a repeat that came due while the run was down is said on the next run", () => {
    expect(lateTellDue(late("2026-12-03", "2026-12-11"), "2026-12-04", "2026-12-11")).toBe(true);
  });

  it("never on a Saturday or a Sunday, and never while nothing is late", () => {
    expect(lateTellDue(late("2026-12-03", "2026-12-05"), null, "2026-12-05")).toBe(false);
    expect(lateTellDue(late("2026-12-03", "2026-12-06"), null, "2026-12-06")).toBe(false);
    expect(lateTellDue([], "2026-11-01", "2026-12-04")).toBe(false);
    expect(lateTellDue(late("2026-12-04", "2026-12-04"), null, "2026-12-04")).toBe(false);
  });

  it("a second step that runs late after the last notice is said the next working day, not three days on", () => {
    // Told on Friday Dec 4 of the inspection. The bid was due that Friday and is late on Monday.
    const both = [{ due: "2026-12-03" }, { due: "2026-12-04" }];
    expect(lateTellDue(both, "2026-12-04", "2026-12-07")).toBe(true);
  });

  it("a step moved to a new day that is missed again is said again", () => {
    expect(lateTellDue(late("2026-12-10", "2026-12-11"), "2026-12-09", "2026-12-11")).toBe(true);
  });
});

describe("(c) a step with no date does not hold an opportunity for ever", () => {
  it("it counts as due ten working days after it was made", () => {
    expect(UNDATED_STEP_WORKING_DAYS).toBe(10);
    // Made Wednesday Nov 11: the tenth working day after is Wednesday Nov 25.
    expect(stepDueDay(null, "2026-11-11")).toBe("2026-11-25");
    expect(stepDueDay("2026-12-03", "2026-11-11")).toBe("2026-12-03");
    expect(stepDueDay(null, null)).toBeNull();
  });

  it("a draft bid with no due date is late the day after, like any other", () => {
    const [step] = openStepsByOpportunity({ tickets: [], bids: [bid({ due_date: null })] }).get(
      OPP,
    )!;
    expect(step).toMatchObject({ date: null, due: "2026-11-25", made: "2026-11-11" });
    expect(stepIsLate(step!, "2026-11-25")).toBe(false);
    expect(stepIsLate(step!, "2026-11-26")).toBe(true);
    expect(lateTellDue([step!], null, "2026-11-26")).toBe(true);
  });

  it("the day it was made is the office's day, not the UTC one", () => {
    // 2:30 AM UTC on Nov 12 is still Nov 11 in the office.
    const [step] = openStepsByOpportunity({
      tickets: [ticket({ scheduled_date: null, created_at: "2026-11-12T02:30:00Z" })],
      bids: [],
    }).get(OPP)!;
    expect(step?.made).toBe("2026-11-11");
  });

  it("the waiting words say so where a date would be", () => {
    expect(STEP_NO_DATE).toBe("no date set");
    const one = openStepsByOpportunity({ tickets: [], bids: [bid({ due_date: null })] }).get(OPP)!;
    expect(waitingWords(one, { [RO]: "Ro Santos" })).toBe(
      "Waiting on bid Dock re-roof, no date set, Ro Santos",
    );
    const two = openStepsByOpportunity({
      tickets: [ticket()],
      bids: [bid({ due_date: null })],
    }).get(OPP)!;
    expect(waitingWords(two)).toBe(
      "Waiting on inspection #7090, Dec 3 and bid Dock re-roof, no date set",
    );
  });
});

describe("(d) a bid counts as held only while its estimator still has a login", () => {
  it("the bid of somebody who has left holds nothing back", () => {
    const here = new Set([RO, GARRY]);
    expect(bidIsOpenStep(bid(), here)).toBe(true);
    expect(bidIsOpenStep(bid({ created_by: GONE }), here)).toBe(false);
    expect(
      openStepsByOpportunity({ tickets: [], bids: [bid({ created_by: GONE })], people: here }).size,
    ).toBe(0);
  });
  it("when who is still here is not known, every estimator counts, as before", () => {
    expect(bidIsOpenStep(bid({ created_by: GONE }))).toBe(true);
    expect(bidIsOpenStep(bid({ created_by: GONE }), null)).toBe(true);
  });
});

describe("(e) a copy of a bid for another customer is not part of the first customer's job", () => {
  const inspection = ticket({ stage: "done" });
  it("a bid made from the inspection for the same customer holds the opportunity", () => {
    const m = openStepsByOpportunity({
      tickets: [inspection],
      bids: [bid({ opportunity_id: null, from_job_id: "t1" })],
    });
    expect(m.get(OPP)?.map((s) => s.label)).toEqual(["bid Dock re-roof"]);
  });
  it("a bid with no customer yet does too", () => {
    expect(bidIsOfTicketsJob({ account_id: null }, inspection)).toBe(true);
    const m = openStepsByOpportunity({
      tickets: [inspection],
      bids: [bid({ opportunity_id: null, from_job_id: "t1", account_id: null })],
    });
    expect(m.get(OPP)).toHaveLength(1);
  });
  it("the copy made for another customer does not", () => {
    expect(bidIsOfTicketsJob({ account_id: OTHER }, inspection)).toBe(false);
    const m = openStepsByOpportunity({
      tickets: [inspection],
      bids: [bid({ id: "b2", opportunity_id: null, from_job_id: "t1", account_id: OTHER })],
    });
    expect(m.size).toBe(0);
  });
  it("a bid tied to the opportunity itself counts as before, whatever its customer", () => {
    const m = openStepsByOpportunity({
      tickets: [],
      bids: [bid({ account_id: OTHER })],
    });
    expect(m.get(OPP)).toHaveLength(1);
  });
});

describe("(f) the notice names every late step", () => {
  it("two late steps: both in the title, each with its own day and person", () => {
    expect(
      stepLateNotice({
        steps: [
          { label: "inspection #7090", was: "Thursday 12/3/2026", made: null, who: "Garry Peters" },
          { label: "bid Dock re-roof", was: "Friday 12/4/2026", made: null, who: "you" },
        ],
        opportunity: "Leak at the dock",
      }),
    ).toEqual({
      title: "Inspection #7090 and bid Dock re-roof are late: Leak at the dock",
      body: "Inspection #7090 was set for Thursday 12/3/2026 with Garry Peters. Bid Dock re-roof was set for Friday 12/4/2026 with you. Your opportunity is waiting on them.",
    });
  });
  it("a step with no date says so, and when it was made", () => {
    expect(
      stepLateNotice({
        steps: [
          { label: "bid Dock re-roof", was: null, made: "Wednesday 11/11/2026", who: "Ro Santos" },
        ],
        opportunity: "Leak at the dock",
      }).body,
    ).toBe(
      "It has no date set and was made on Wednesday 11/11/2026, and Ro Santos has it. Your opportunity is waiting on it.",
    );
  });
  it("an opportunity nobody is on says that to the people who are told", () => {
    expect(
      stepLateNotice({
        steps: [{ label: "repair #7091", was: "Thursday 12/3/2026", made: null, who: null }],
        opportunity: "Leak at the dock",
        nobody: true,
      }).body,
    ).toBe(
      "It was set for Thursday 12/3/2026. The opportunity is waiting on it, and nobody is on the opportunity.",
    );
  });
});

// ── The morning run, on a small made-up database ─────────────────────────────────────────────────

type Row = Record<string, unknown>;
const opp = (over: Row = {}): Row => ({
  id: OPP,
  title: "Leak at the dock",
  status: "contacted",
  assignee_id: RO,
  deleted_at: null,
  ...over,
});
const world = (tables: Record<string, object[]>) =>
  fakeSupabase({
    crm_opportunities: [opp()],
    service_jobs: [],
    bids: [],
    step_late_marks: [],
    profiles: [{ id: RO }, { id: GARRY }],
    ...(tables as Record<string, Row[]>),
  });
const at = (ymd: string) => new Date(`${ymd}T15:00:00Z`);
const names = (id: string | null) =>
  id === GARRY ? "Garry Peters" : id === RO ? "Ro Santos" : null;

/**
 * The real table lets one row be made for an opportunity. `stale` hands a pass the marks as
 * they stood before another pass claimed: two passes that read at the same moment.
 */
function marksAsTheDatabase(db: Client, tables: Record<string, Row[]>, stale?: Row[]): Client {
  const real = db as unknown as { from: (t: string) => Record<string, unknown> };
  return {
    ...(db as object),
    from: (t: string) => {
      const b = real.from(t);
      if (t !== "step_late_marks") return b;
      return {
        ...b,
        select: (...a: unknown[]) =>
          stale
            ? { in: async () => ({ data: stale, error: null }) }
            : (b["select"] as (...x: unknown[]) => unknown)(...a),
        insert: async (row: Row) =>
          (tables["step_late_marks"] ?? []).some(
            (m) => m["opportunity_id"] === row["opportunity_id"],
          )
            ? { data: null, error: { code: "23505", message: "duplicate key" } }
            : (b["insert"] as (x: Row) => unknown)(row),
      };
    },
  } as unknown as Client;
}

describe("the morning run tells the late steps", () => {
  let quiet: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    sent.length = 0;
    notifyFails.on = false;
    quiet = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    quiet.mockRestore();
    vi.unstubAllEnvs();
  });

  it("(b) the opportunity's person started the bid themselves, the common case: they are told", async () => {
    const env = world({ bids: [bid()] });
    const out = await tellLateSteps(env.db, at("2026-12-04"), names);
    expect(out).toEqual({ told: 1, failed: 0 });
    expect(sent).toEqual([
      {
        to: [RO],
        kind: "followup",
        title: "Bid Dock re-roof is late: Leak at the dock",
        body: "It was set for Thursday 12/3/2026 with you. Your opportunity is waiting on it.",
        url: `/opportunities?id=${OPP}`,
      },
    ]);
  });

  it("a draft bid with no due date, made eleven working days ago: told, and it says no date is set", async () => {
    const env = world({ bids: [bid({ due_date: null })] });
    const out = await tellLateSteps(env.db, at("2026-11-26"), names);
    expect(out.told).toBe(1);
    expect(sent[0]?.body).toBe(
      "It has no date set and was made on Wednesday 11/11/2026, and you have it. Your opportunity is waiting on it.",
    );
  });

  it("the same bid ten working days after it was made is not late yet", async () => {
    const env = world({ bids: [bid({ due_date: null })] });
    expect((await tellLateSteps(env.db, at("2026-11-25"), names)).told).toBe(0);
  });

  it("the run missed Friday: Monday's run still tells it (it never did before)", async () => {
    const env = world({ service_jobs: [ticket()] });
    expect((await tellLateSteps(env.db, at("2026-12-07"), names)).told).toBe(1);
    expect(sent[0]?.title).toBe("Inspection #7090 is late: Leak at the dock");
  });

  it("told once a day at most, then again on the third working day, and the mark says when", async () => {
    const env = world({ service_jobs: [ticket()] });
    expect((await tellLateSteps(env.db, at("2026-12-04"), names)).told).toBe(1);
    expect(env.tables["step_late_marks"]).toHaveLength(1);
    // A second pass the same morning, Monday and Tuesday: nothing.
    for (const day of ["2026-12-04", "2026-12-07", "2026-12-08"])
      expect((await tellLateSteps(env.db, at(day), names)).told).toBe(0);
    expect(sent).toHaveLength(1);
    // Wednesday, the third working day: again, and the mark moves.
    expect((await tellLateSteps(env.db, at("2026-12-09"), names)).told).toBe(1);
    expect(sent).toHaveLength(2);
    expect(env.tables["step_late_marks"]).toEqual([
      expect.objectContaining({ opportunity_id: OPP, told_at: at("2026-12-09").toISOString() }),
    ]);
  });

  it("two late steps are both named in the one notice", async () => {
    const env = world({
      service_jobs: [ticket()],
      bids: [bid({ due_date: "2026-12-02", created_by: GARRY })],
    });
    expect((await tellLateSteps(env.db, at("2026-12-04"), names)).told).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.title).toBe("Inspection #7090 and bid Dock re-roof are late: Leak at the dock");
    expect(sent[0]?.body).toBe(
      "Inspection #7090 was set for Thursday 12/3/2026 with Garry Peters. Bid Dock re-roof was set for Wednesday 12/2/2026 with Garry Peters. Your opportunity is waiting on them.",
    );
  });

  it("two passes at once, nobody told yet: the second is refused the mark and sends nothing", async () => {
    const env = world({ service_jobs: [ticket()] });
    const first = marksAsTheDatabase(env.db, env.tables);
    // The second pass read the marks before the first one wrote: it saw none.
    const second = marksAsTheDatabase(env.db, env.tables, []);
    expect((await tellLateSteps(first, at("2026-12-04"), names)).told).toBe(1);
    expect(await tellLateSteps(second, at("2026-12-04"), names)).toEqual({ told: 0, failed: 0 });
    expect(sent).toHaveLength(1);
  });

  it("two passes at once on a repeat: only the one whose claim still matches sends", async () => {
    const before = [{ opportunity_id: OPP, told_at: at("2026-12-04").toISOString() }];
    const env = world({ service_jobs: [ticket()], step_late_marks: [{ ...before[0]! }] });
    const second = marksAsTheDatabase(env.db, env.tables, before);
    expect((await tellLateSteps(env.db, at("2026-12-09"), names)).told).toBe(1);
    expect(await tellLateSteps(second, at("2026-12-09"), names)).toEqual({ told: 0, failed: 0 });
    expect(sent).toHaveLength(1);
  });

  it("a notice that fails to send puts the claim back, and the next pass sends it", async () => {
    const env = world({ service_jobs: [ticket()] });
    notifyFails.on = true;
    expect(await tellLateSteps(env.db, at("2026-12-04"), names)).toEqual({ told: 0, failed: 1 });
    expect(env.tables["step_late_marks"]).toEqual([]);
    notifyFails.on = false;
    expect((await tellLateSteps(env.db, at("2026-12-04"), names)).told).toBe(1);
  });

  it("a failed repeat goes back to the day it was last told", async () => {
    const was = at("2026-12-04").toISOString();
    const env = world({
      service_jobs: [ticket()],
      step_late_marks: [{ opportunity_id: OPP, told_at: was }],
    });
    notifyFails.on = true;
    expect((await tellLateSteps(env.db, at("2026-12-09"), names)).failed).toBe(1);
    expect(env.tables["step_late_marks"]?.[0]?.["told_at"]).toBe(was);
  });

  it("an opportunity nobody is on tells the people on the Nobody is on it line", async () => {
    const env = world({
      crm_opportunities: [opp({ assignee_id: null })],
      service_jobs: [ticket()],
    });
    expect((await tellLateSteps(env.db, at("2026-12-04"), names, ["boss-1"])).told).toBe(1);
    expect(sent[0]).toMatchObject({
      to: ["boss-1"],
      body: "It was set for Thursday 12/3/2026 with Garry Peters. The opportunity is waiting on it, and nobody is on the opportunity.",
    });
    // With nobody on that line there is nobody to tell, and nothing is claimed.
    const none = world({
      crm_opportunities: [opp({ assignee_id: null })],
      service_jobs: [ticket()],
    });
    expect((await tellLateSteps(none.db, at("2026-12-04"), names)).told).toBe(0);
    expect(none.tables["step_late_marks"]).toEqual([]);
  });

  it("a won, lost or deleted opportunity, and a step that is not late, tell nobody", async () => {
    for (const patch of [{ status: "won" }, { status: "lost" }, { deleted_at: "x" }]) {
      const env = world({ crm_opportunities: [opp(patch)], service_jobs: [ticket()] });
      expect((await tellLateSteps(env.db, at("2026-12-04"), names)).told).toBe(0);
    }
    const env = world({ service_jobs: [ticket({ scheduled_date: "2026-12-04" })] });
    expect((await tellLateSteps(env.db, at("2026-12-04"), names)).told).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it("when the marks cannot be read nothing is sent: never told twice on a guess", async () => {
    const env = world({ service_jobs: [ticket()] });
    const broken = {
      ...(env.db as object),
      from: (t: string) =>
        t === "step_late_marks"
          ? { select: () => ({ in: async () => ({ data: null, error: { message: "no table" } }) }) }
          : (env.db as unknown as { from: (t: string) => unknown }).from(t),
    } as unknown as Client;
    await expect(tellLateSteps(broken, at("2026-12-04"), names)).rejects.toThrow(/no table/);
    expect(sent).toHaveLength(0);
  });

  it("more open opportunities than one page holds are all read", async () => {
    const many = Array.from({ length: 501 }, (_, i) =>
      opp({ id: `opp-${String(i).padStart(4, "0")}`, title: `Job ${i}` }),
    );
    const last = many[many.length - 1]!["id"] as string;
    const env = world({
      crm_opportunities: many,
      service_jobs: [ticket({ from_opportunity_id: last })],
    });
    expect((await tellLateSteps(env.db, at("2026-12-04"), names)).told).toBe(1);
    expect(sent[0]?.url).toBe(`/opportunities?id=${last}`);
  });
});

describe("the reads behind it", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("(d) with the server's key, the bid of somebody with no login does not hold its opportunity", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-placeholder-not-a-key");
    const env = world({
      crm_opportunities: [opp(), opp({ id: OPP2 })],
      bids: [bid({ created_by: GONE }), bid({ id: "b2", opportunity_id: OPP2 })],
    });
    const m = await openStepsFor(env.db, [OPP, OPP2]);
    expect(m.has(OPP)).toBe(false);
    expect(m.get(OPP2)?.map((s) => s.id)).toEqual(["b2"]);
  });

  it("without the key the every-user list stands in; unreadable, every estimator counts", async () => {
    const env = world({ bids: [bid({ created_by: GONE })] });
    // The fake's every-user list is the people seeded: the one who left is not among them.
    expect((await openStepsFor(env.db, [OPP])).has(OPP)).toBe(false);
    const noList = fakeSupabase(
      { ...env.tables },
      {
        rpc: (fn) =>
          fn === "crm_user_options" ? { data: null, error: { message: "no" } } : undefined,
      },
    );
    expect((await openStepsFor(noList.db, [OPP])).has(OPP)).toBe(true);
  });

  it("(e) the copy for another customer is read, and does not hold the first one's opportunity", async () => {
    const env = world({
      service_jobs: [ticket({ stage: "done" })],
      bids: [bid({ id: "copy", opportunity_id: null, from_job_id: "t1", account_id: OTHER })],
    });
    expect((await openStepsFor(env.db, [OPP])).size).toBe(0);
    env.tables["bids"]![0]!["account_id"] = ACME;
    expect((await openStepsFor(env.db, [OPP])).get(OPP)).toHaveLength(1);
  });

  it("a read that fails part way is an error to the strict read and nothing to the screens", async () => {
    const env = world({ service_jobs: [ticket()] });
    const broken = {
      ...(env.db as object),
      from: (t: string) =>
        t === "bids"
          ? {
              select: () => ({
                in: () => ({
                  order: () => ({
                    limit: async () => ({ data: null, error: { message: "bids are down" } }),
                  }),
                }),
              }),
            }
          : (env.db as unknown as { from: (t: string) => unknown }).from(t),
    } as unknown as Client;
    await expect(openStepsStrict(broken, [OPP])).rejects.toThrow(/bids are down/);
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    // Before, the tickets that were read still counted and the bids silently did not.
    expect((await openStepsFor(broken, [OPP])).size).toBe(0);
    quiet.mockRestore();
  });

  it("a read that fills a page is read on to its end", async () => {
    // 501 tickets under one opportunity, the open one last: one page would not reach it.
    const done = Array.from({ length: 500 }, (_, i) =>
      ticket({ id: `t-${String(i).padStart(4, "0")}`, number: 8000 + i, stage: "done" }),
    );
    const env = world({
      service_jobs: [...done, ticket({ id: "t-9999", number: 8999 })],
    });
    expect((await openStepsFor(env.db, [OPP])).get(OPP)?.map((s) => s.label)).toEqual([
      "inspection #8999",
    ]);
  });
});
