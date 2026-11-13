/**
 * Owner, Nov 13 — "I like all the steps": the opportunity is carried through to the repair ticket
 * and the bid, and a ticket moves its opportunity.
 *
 *   an inspection (or warranty visit) from an opportunity   Open → Contacted
 *   a repair ticket from it, or from its inspection         → Won
 *   "No action needed" on its inspection                    the office is asked: Lost, No
 *                                                           response, or leave it open
 *
 * Never backwards, never out of Won / Lost / No response, never on a deleted opportunity; logged
 * like a hand-made change ("from ticket #N"), the reminders as that status has them, and said out
 * loud. It works whoever creates the ticket: the database function does the write.
 *
 *  1. The rule (lib/ticket-moves.ts) and the words.
 *  2. moveOpportunityFromTicket: the database's answer, the follow-up, what goes back.
 *  3. The ticket paths: saveServiceJob's create, createRepairFromInspection.
 *  4. "No action needed": the question and its three answers.
 *  5. A bid from an inspection drives the opportunity (linkBidToInspection).
 *  6. The migration and the types.
 *  7. The log line on the status strip; the toast.
 */
import { existsSync, readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { readGeneratedTypes } from "@/test/generated-types";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));
vi.mock("@/lib/notify.server", () => ({
  serverClient: async (fallback: unknown) => fallback,
  notify: vi.fn(async () => 0),
  hasServiceRole: () => true,
}));
vi.mock("@/lib/followups.server", () => ({ syncFollowup: vi.fn(async () => "closed") }));
vi.mock("@/lib/ticket-events.server", () => ({
  afterTicketStage: vi.fn(async () => {}),
  afterTicketDispatch: vi.fn(async () => {}),
}));
vi.mock("@/lib/service-crew.server", () => ({
  syncCrewLead: vi.fn(async () => {}),
  writeCrew: vi.fn(async () => 0),
  readCrew: vi.fn(async () => []),
}));

import { syncFollowup } from "@/lib/followups.server";
import { moveOpportunityFromTicket, movedByTicket } from "@/lib/opportunities.functions";
import { saveServiceJob } from "@/lib/service.functions";
import {
  answerInspectionOpportunity,
  createRepairFromInspection,
  getTicketInspection,
  linkBidToInspection,
  type TicketInspection,
} from "@/lib/service-inspection.functions";
import { oppStatusStrip, statusNotes } from "@/lib/stage-dates";
import {
  NO_ACTION_ANSWER_LABELS,
  NO_ACTION_ANSWERS,
  noActionAnswerNote,
  noActionQuestion,
  opportunityMoveText,
  oppStatusFromTicket,
  oppStillOpen,
} from "@/lib/ticket-moves";
import { fakeSupabase } from "@/test/fake-supabase";

type Row = Record<string, unknown>;
const read = (p: string) => readFileSync(p, "utf8");

// ── 1. The rule ───────────────────────────────────────────────────────────────────────────

describe("1. the rule", () => {
  it("an inspection moves Open to Contacted and nothing else", () => {
    expect(oppStatusFromTicket("inspection", "open")).toBe("contacted");
    for (const s of ["contacted", "quoted", "won", "lost", "no_response"])
      expect(oppStatusFromTicket("inspection", s)).toBeNull();
  });
  it("a repair ticket wins it from any open status, and never out of a closed one", () => {
    for (const type of ["repair", "other"]) {
      for (const s of ["open", "contacted", "quoted"])
        expect(oppStatusFromTicket(type, s)).toBe("won");
      for (const s of ["won", "lost", "no_response"])
        expect(oppStatusFromTicket(type, s)).toBeNull();
    }
  });
  it("a warranty visit is a visit, not a sale: Open to Contacted only", () => {
    expect(oppStatusFromTicket("warranty", "open")).toBe("contacted");
    expect(oppStatusFromTicket("warranty", "quoted")).toBeNull();
  });
  it("the office's answer after No action needed: Lost, No response, or nothing", () => {
    expect([...NO_ACTION_ANSWERS]).toEqual(["lost", "no_response", "open"]);
    expect(oppStatusFromTicket("inspection", "contacted", "lost")).toBe("lost");
    expect(oppStatusFromTicket("inspection", "quoted", "no_response")).toBe("no_response");
    expect(oppStatusFromTicket("inspection", "contacted", "open")).toBeNull();
    // Closed is closed; and only an inspection is answered for.
    expect(oppStatusFromTicket("inspection", "won", "lost")).toBeNull();
    expect(oppStatusFromTicket("repair", "open", "lost")).toBeNull();
    expect(oppStillOpen("quoted")).toBe(true);
    expect(oppStillOpen("no_response")).toBe(false);
    expect(oppStillOpen(null)).toBe(false);
  });
  it("the words", () => {
    expect(opportunityMoveText({ title: "Leak at the dock", to: "won" })).toBe(
      "Opportunity “Leak at the dock” is now Won",
    );
    expect(opportunityMoveText({ title: " ", to: "no_response" })).toBe(
      "Opportunity “Untitled” is now No response",
    );
    expect(NO_ACTION_ANSWER_LABELS).toEqual({
      lost: "Mark it Lost",
      no_response: "Mark it No response",
      open: "Leave it open",
    });
    expect(noActionQuestion("Leak at the dock")).toBe(
      "This inspection came from the opportunity “Leak at the dock”, which is still open. Nothing is being done, so what should happen to it?",
    );
    expect(noActionAnswerNote("lost", "Leak")).toBe(
      "Opportunity “Leak” marked Lost: no action needed",
    );
    expect(noActionAnswerNote("no_response", "Leak")).toBe(
      "Opportunity “Leak” marked No response: no action needed",
    );
    expect(noActionAnswerNote("open", "Leak")).toBe(
      'Opportunity “Leak” left open after "No action needed"',
    );
  });
});

// ── The fake database: the function's rule, as the migration writes it ─────────────────────

const MGR = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OFFICE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"; // Service only: no Customers access
const TECH = "abababab-abab-4bab-8bab-abababababab";
const ACC = "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1";
const SITE = "51515151-5151-4515-8515-515151515151";
const OPP = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const INS = "11111111-1111-4111-8111-111111111111";
const BID = "33333333-3333-4333-8333-333333333333";

let env: ReturnType<typeof fakeSupabase>;
let moveFails: string | null = null;
function setup(over: { opp?: Row; inspection?: Row; bids?: Row[]; events?: Row[] } = {}) {
  moveFails = null;
  vi.mocked(syncFollowup).mockClear();
  env = fakeSupabase(
    {
      profiles: [
        {
          id: MGR,
          role: "manager",
          access: [],
          technician: false,
          full_name: "Mo Manager",
          email: "mo@x",
        },
        {
          id: OFFICE,
          role: "user",
          access: ["service"],
          technician: false,
          full_name: "Olive Office",
          email: "o@x",
        },
        {
          id: TECH,
          role: "user",
          access: ["service"],
          technician: true,
          full_name: "Tyler Reed",
          email: "t@x",
        },
      ],
      crm_accounts: [
        { id: ACC, name: "Bell County Schools", phone: "606-555-0100", deleted_at: null },
      ],
      crm_sites: [{ id: SITE, account_id: ACC, name: "Gym", deleted_at: null }],
      crm_opportunities: [
        {
          id: OPP,
          title: "Leak at the dock",
          account_id: ACC,
          site_id: SITE,
          bid_id: null,
          assignee_id: MGR,
          status: "open",
          expected_close: "2026-12-01",
          deleted_at: null,
          ...over.opp,
        },
      ],
      service_jobs: [
        {
          id: INS,
          number: 6041,
          service_type: "inspection",
          stage: "done",
          account_id: ACC,
          site_id: SITE,
          customer_name: "Bell County Schools",
          technician_id: TECH,
          deleted_at: null,
          from_opportunity_id: OPP,
          from_job_id: null,
          inspection: {
            v: 1,
            items: [],
            notes: "",
            recommend_repairs: true,
            saved_at: "2026-11-12T10:00:00Z",
            saved_by: "Tyler Reed",
          },
          inspection_outcome: null,
          inspection_outcome_at: null,
          inspection_outcome_by: null,
          recommend_new_roof: false,
          closing_notes: "Two open seams",
          ...over.inspection,
        },
      ],
      service_job_events: over.events ?? [
        {
          id: 1,
          service_job_id: INS,
          kind: "stage",
          stage: "done",
          by_name: "Tyler Reed",
          at: "2026-11-12T10:05:00Z",
          meta: null,
        },
      ],
      inspection_checklist_items: [],
      bids: over.bids ?? [],
      crm_followups: [],
    },
    {
      rpcs: {
        // move_opportunity_from_ticket (20261113100000), on the fake's tables.
        move_opportunity_from_ticket: (args, tables) => {
          if (moveFails) throw new Error(moveFails);
          const job = tables["service_jobs"]!.find((j) => j["id"] === args["p_job"]);
          const opp =
            job && !job["deleted_at"]
              ? tables["crm_opportunities"]!.find((o) => o["id"] === job["from_opportunity_id"])
              : undefined;
          if (!job || !opp || opp["deleted_at"])
            return { action: "none", reason: "no opportunity" };
          const to = oppStatusFromTicket(
            String(job["service_type"]),
            String(opp["status"]),
            (args["p_to"] as "lost" | "no_response" | undefined) ?? null,
          );
          if (!to)
            return {
              action: "unchanged",
              opportunity_id: opp["id"],
              title: opp["title"],
              status: opp["status"],
            };
          const from = opp["status"];
          opp["status"] = to;
          return {
            action: "updated",
            opportunity_id: opp["id"],
            title: opp["title"],
            from,
            to,
            ticket: job["number"],
            account_id: opp["account_id"],
            assignee_id: opp["assignee_id"],
            expected_close: opp["expected_close"],
          };
        },
        // ticket_opportunity (20261113100000): the title and status of a ticket's live opportunity.
        ticket_opportunity: (args, tables) => {
          const job = tables["service_jobs"]!.find((j) => j["id"] === args["p_job"]);
          const opp =
            job && !job["deleted_at"]
              ? tables["crm_opportunities"]!.find((o) => o["id"] === job["from_opportunity_id"])
              : undefined;
          return opp && !opp["deleted_at"]
            ? { id: opp["id"], title: opp["title"], status: opp["status"] }
            : null;
        },
        sync_opportunity_from_bid: () => ({ action: "unchanged" }),
      },
    },
  );
}
const call = <T = void>(fn: unknown, data: Row, userId = MGR) =>
  (fn as (a: { data: Row; context: unknown }) => Promise<T>)({
    data,
    context: { supabase: env.db, userId },
  });
const ctx = (userId = MGR) => ({ supabase: env.db, userId }) as never;
const oppStatus = () => env.tables["crm_opportunities"]![0]!["status"];
const moveCalls = () => env.rpcCalls.filter((c) => c.fn === "move_opportunity_from_ticket");

beforeEach(() => setup());

// ── 2. moveOpportunityFromTicket ──────────────────────────────────────────────────────────

describe("2. moveOpportunityFromTicket", () => {
  it("asks the database (the ticket only), brings the follow-up in line, and answers the move", async () => {
    const move = await moveOpportunityFromTicket(ctx(OFFICE), INS);
    expect(move).toEqual({
      opportunity_id: OPP,
      title: "Leak at the dock",
      from: "open",
      to: "contacted",
      ticket: 6041,
    });
    // No p_to unless the office answered: the function's default stands.
    expect(moveCalls()).toEqual([{ fn: "move_opportunity_from_ticket", args: { p_job: INS } }]);
    // The follow-up, exactly as for a status set by hand: Contacted keeps the reminders.
    expect(syncFollowup).toHaveBeenCalledTimes(1);
    expect(vi.mocked(syncFollowup).mock.calls[0]![0]).toMatchObject({
      kind: "opportunity",
      itemId: OPP,
      closing: false,
      actorId: OFFICE,
      actorName: "Olive Office",
    });
    // The app writes no status itself: the function did.
    expect(env.writes.filter((w) => w.table === "crm_opportunities")).toEqual([]);
  });
  it("Won, Lost and No response stop the reminders (closing), with the status as the reason", async () => {
    env.tables["service_jobs"]![0]!["service_type"] = "repair";
    await moveOpportunityFromTicket(ctx(), INS);
    expect(vi.mocked(syncFollowup).mock.calls[0]![0]).toMatchObject({
      closing: true,
      closeReason: "status won",
    });
  });
  it("nothing moved: null, and the follow-up is left alone", async () => {
    setup({ opp: { status: "quoted" } });
    expect(await moveOpportunityFromTicket(ctx(), INS)).toBeNull();
    expect(syncFollowup).not.toHaveBeenCalled();
    setup({ opp: { deleted_at: "2026-11-01T00:00:00Z" } });
    expect(await moveOpportunityFromTicket(ctx(), INS)).toBeNull();
  });
  it("the office's answer rides as p_to", async () => {
    setup({ inspection: { inspection_outcome: "none" } });
    const move = await moveOpportunityFromTicket(ctx(OFFICE), INS, "no_response");
    expect(moveCalls()[0]!.args).toEqual({ p_job: INS, p_to: "no_response" });
    expect(move).toMatchObject({ from: "open", to: "no_response" });
  });
  it("before the migration is applied the ticket path carries on; any other failure is thrown", async () => {
    const before = fakeSupabase(
      { profiles: [] },
      {
        rpc: () => ({
          data: null,
          error: {
            code: "PGRST202",
            message: "Could not find the function public.move_opportunity_from_ticket",
          },
        }),
      },
    );
    expect(
      await moveOpportunityFromTicket({ supabase: before.db, userId: MGR } as never, INS),
    ).toBeNull();
    moveFails = "Forbidden";
    await expect(moveOpportunityFromTicket(ctx(TECH), INS)).rejects.toThrow("Forbidden");
    // The ticket paths hand a failure back instead of throwing (the ticket is already saved).
    expect(await movedByTicket(ctx(TECH), INS)).toEqual({ opportunity_move_error: "Forbidden" });
    moveFails = null;
    expect(await movedByTicket(ctx(), INS)).toMatchObject({
      opportunity_move: { to: "contacted" },
    });
    setup({ opp: { status: "won" } });
    expect(await movedByTicket(ctx(), INS)).toEqual({});
  });
  it("nothing is read with the server's rights: the function's answer carries what the follow-up needs", async () => {
    // The caller may not be able to read the opportunity at all (the office without Customers
    // access), and the preview has no service key: an opportunities table that answers nothing
    // must change nothing.
    env.tables["service_jobs"]![0]!["service_type"] = "repair";
    const opps = env.tables["crm_opportunities"]!;
    const move = await moveOpportunityFromTicket(
      {
        supabase: {
          ...(env.db as unknown as Record<string, unknown>),
          from: (t: string) => {
            if (t === "crm_opportunities")
              throw new Error("the opportunity is not the caller's to read");
            return (env.db as unknown as { from: (t: string) => unknown }).from(t);
          },
        },
        userId: OFFICE,
      } as never,
      INS,
    );
    expect(move).toMatchObject({ opportunity_id: OPP, to: "won" });
    expect(opps[0]!["status"]).toBe("won");
    expect(vi.mocked(syncFollowup).mock.calls[0]![0]).toMatchObject({
      kind: "opportunity",
      itemId: OPP,
      accountId: ACC,
      assigneeId: MGR,
      title: "Leak at the dock",
      dueDate: "2026-12-01",
      closing: true,
      closeReason: "status won",
    });
    const fn = read("src/lib/opportunities.functions.ts");
    const body = fn.slice(
      fn.indexOf("export async function moveOpportunityFromTicket("),
      fn.indexOf("export async function movedByTicket("),
    );
    expect(body).toContain('ctx.supabase.rpc("move_opportunity_from_ticket", {');
    expect(body).not.toContain("serverClient");
    expect(body).not.toContain('.from("crm_opportunities")');
    // The question's read goes through the database too.
    const insp = read("src/lib/service-inspection.functions.ts");
    const q = insp.slice(
      insp.indexOf("async function readOpportunityQuestion("),
      insp.indexOf("const asOutcome ="),
    );
    expect(q).toContain('ctx.supabase.rpc("ticket_opportunity", { p_job: job.id }),');
    expect(q).not.toContain("serverClient");
    expect(q).not.toContain("crm_opportunities");
  });
});

// ── 3. The ticket paths ───────────────────────────────────────────────────────────────────

describe("3. a new ticket moves its opportunity", () => {
  const newTicket = (service_type: string, extra: Row = {}) => ({
    account_id: ACC,
    site_id: SITE,
    description: "Look at the dock roof",
    service_type,
    scheduled_date: "2026-11-20",
    ...extra,
  });
  it("an inspection started from an opportunity, by the office without Customers access: Contacted", async () => {
    const row = await call<Row>(
      saveServiceJob,
      newTicket("inspection", { from_opportunity_id: OPP }),
      OFFICE,
    );
    expect(row["from_opportunity_id"]).toBe(OPP);
    expect(row["opportunity_move"]).toMatchObject({
      opportunity_id: OPP,
      title: "Leak at the dock",
      from: "open",
      to: "contacted",
    });
    expect(oppStatus()).toBe("contacted");
    expect(moveCalls()).toHaveLength(1);
    expect(moveCalls()[0]!.args["p_job"]).toBe(row["id"]);
  });
  it("a repair ticket started straight from an opportunity: Won, the reminders stopped", async () => {
    const row = await call<Row>(saveServiceJob, newTicket("repair", { from_opportunity_id: OPP }));
    expect(row["opportunity_move"]).toMatchObject({ from: "open", to: "won" });
    expect(oppStatus()).toBe("won");
    const opp = vi
      .mocked(syncFollowup)
      .mock.calls.map((c) => c[0])
      .find((a) => a.kind === "opportunity");
    expect(opp).toMatchObject({ itemId: OPP, closing: true });
  });
  it("a ticket with no opportunity asks nothing; an update never moves one", async () => {
    const row = await call<Row>(saveServiceJob, newTicket("repair"));
    expect(row).not.toHaveProperty("opportunity_move");
    expect(moveCalls()).toEqual([]);
    await call(saveServiceJob, { id: INS, account_id: ACC, site_id: SITE, description: "x" });
    expect(moveCalls()).toEqual([]);
    expect(oppStatus()).toBe("open");
  });
  it("the opportunity could not be moved: the ticket is saved all the same, and the reason goes back", async () => {
    moveFails = "deadlock detected";
    const row = await call<Row>(saveServiceJob, newTicket("repair", { from_opportunity_id: OPP }));
    expect(row["number"] ?? row["id"]).toBeTruthy();
    expect(row["opportunity_move_error"]).toBe("deadlock detected");
    expect(row).not.toHaveProperty("opportunity_move");
    expect(env.tables["service_jobs"]).toHaveLength(2);
  });
  it("a repair ticket made from the inspection wins the inspection's opportunity", async () => {
    // The database copies the opportunity onto the new ticket (service_jobs_carry_opportunity);
    // the fake has no triggers, so the function's fake reads it off the inspection here.
    const carry = env.db as unknown as { rpc: (f: string, a: Row) => Promise<unknown> };
    const realRpc = carry.rpc;
    carry.rpc = (f, a) => {
      if (f === "move_opportunity_from_ticket") {
        const made = env.tables["service_jobs"]!.find((j) => j["id"] === a["p_job"]);
        if (made && made["from_job_id"] === INS) made["from_opportunity_id"] = OPP;
      }
      return realRpc(f, a);
    };
    env.tables["crm_opportunities"]![0]!["status"] = "contacted";
    const made = await call<Row>(createRepairFromInspection, {
      id: INS,
      service_type: "repair",
      scheduled_date: "2026-11-25",
    });
    expect(made).toMatchObject({
      existing: false,
      opportunity_move: { opportunity_id: OPP, from: "contacted", to: "won" },
    });
    expect(moveCalls().map((c) => c.args["p_job"])).toEqual([made["id"]]);
    // The app sends only the inspection link; the opportunity is the database's to carry.
    const ins = env.writes.find((w) => w.table === "service_jobs" && w.op === "insert");
    expect(ins?.payload).toMatchObject({ from_job_id: INS });
    expect(ins?.payload).not.toHaveProperty("from_opportunity_id");
    // A second press returns the first ticket and moves nothing again.
    const again = await call<Row>(createRepairFromInspection, {
      id: INS,
      service_type: "repair",
      scheduled_date: "2026-11-25",
    });
    expect(again).toMatchObject({ existing: true });
    expect(again).not.toHaveProperty("opportunity_move");
    expect(moveCalls()).toHaveLength(1);
  });
  it("the pages say it out loud after each", () => {
    const page = read("src/components/service-page.tsx");
    expect(page).toMatch(
      /toast\.success\(`Ticket #\$\{row\.number\} created`\);[\s\S]{0,700}sayOpportunityMove\(row, \{/,
    );
    const section = read("src/components/service/inspection-section.tsx");
    expect(section).toMatch(
      /sayOpportunityMove\(row, \{[\s\S]{0,300}saved: `Repair ticket #\$\{row\.number\} was created`,/,
    );
    const say = read("src/lib/opportunity-move-toast.ts");
    expect(say).toContain("toast.success(opportunityMoveText(move), {");
    expect(say).toContain('action: { label: "Open", onClick: () => open(move.opportunity_id) }');
    expect(say).toContain("toast.error(");
    expect(say).toContain("but its opportunity's status did not change");
  });
});

// ── 4. "No action needed" ─────────────────────────────────────────────────────────────────

describe('4. "No action needed": the office is asked', () => {
  const none = { inspection_outcome: "none", inspection_outcome_at: "2026-11-01T09:00:00.000Z" };
  const getInspection = (userId = OFFICE) =>
    call<TicketInspection>(getTicketInspection, { id: INS }, userId);

  it("the panel gets the opportunity to ask about — only after No action needed, only for the office", async () => {
    expect((await getInspection()).opportunity).toBeUndefined();
    setup({ inspection: none });
    expect((await getInspection()).opportunity).toEqual({
      id: OPP,
      title: "Leak at the dock",
      status: "open",
      answer: null,
    });
    // A technician reads the inspection, not the question.
    expect((await getInspection(TECH)).opportunity).toBeUndefined();
    // No opportunity behind the inspection, or a deleted one: nothing to ask.
    setup({ inspection: { ...none, from_opportunity_id: null } });
    expect((await getInspection()).opportunity).toBeUndefined();
    setup({ inspection: none, opp: { deleted_at: "2026-11-01T00:00:00Z" } });
    expect((await getInspection()).opportunity).toBeUndefined();
  });
  it("who closed the inspection out rides along, for the recommendation line", async () => {
    expect((await getInspection()).closed_out_by).toBe("Tyler Reed");
    setup({ events: [] });
    expect((await getInspection()).closed_out_by).toBeNull();
    // A move to Done nobody made (the log's "system") names nobody.
    setup({
      events: [
        {
          id: 1,
          service_job_id: INS,
          kind: "stage",
          stage: "done",
          by_name: "system",
          at: "2026-11-12T10:05:00Z",
          meta: null,
        },
      ],
    });
    expect((await getInspection()).closed_out_by).toBeNull();
  });
  it.each([
    ["lost", "lost", "Opportunity “Leak at the dock” marked Lost: no action needed"],
    [
      "no_response",
      "no_response",
      "Opportunity “Leak at the dock” marked No response: no action needed",
    ],
  ] as const)(
    "Mark it %s: closed through the database, noted on the ticket",
    async (answer, status, note) => {
      setup({ inspection: none });
      const r = await call<Row>(answerInspectionOpportunity, { id: INS, answer }, OFFICE);
      expect(r).toMatchObject({ answer, status, move: { from: "open", to: status, ticket: 6041 } });
      expect(moveCalls()[0]!.args).toEqual({ p_job: INS, p_to: answer });
      expect(oppStatus()).toBe(status);
      expect(vi.mocked(syncFollowup).mock.calls[0]![0]).toMatchObject({ closing: true });
      const ev = env.writes.find((w) => w.table === "service_job_events" && w.op === "insert");
      expect(ev?.payload).toMatchObject({
        service_job_id: INS,
        kind: "note",
        note,
        by_name: "Olive Office",
        meta: { opportunity_answer: answer, opportunity_id: OPP },
      });
      // Answered: the panel stops asking.
      expect((await getInspection()).opportunity).toMatchObject({ status, answer });
    },
  );
  it("Leave it open: nothing is closed, the answer is kept", async () => {
    setup({ inspection: none });
    const r = await call<Row>(answerInspectionOpportunity, { id: INS, answer: "open" }, OFFICE);
    expect(r).toEqual({ answer: "open", move: null, status: "open" });
    expect(moveCalls()).toEqual([]);
    expect(oppStatus()).toBe("open");
    expect(syncFollowup).not.toHaveBeenCalled();
    expect((await getInspection()).opportunity).toMatchObject({ status: "open", answer: "open" });
  });
  it("pressing No action needed again later asks again (an older answer does not count)", async () => {
    setup({
      inspection: none,
      events: [
        {
          id: 2,
          service_job_id: INS,
          kind: "note",
          note: "x",
          at: "2026-10-30T08:00:00.000Z",
          meta: { opportunity_answer: "open" },
        },
      ],
    });
    expect((await getInspection()).opportunity).toMatchObject({ answer: null });
  });
  it("nothing is closed without the answer: recording the outcome moves nothing", () => {
    const fn = read("src/lib/service-inspection.functions.ts");
    const outcome = fn.slice(
      fn.indexOf("export const setInspectionOutcome"),
      fn.indexOf("export const answerInspectionOpportunity"),
    );
    expect(outcome).not.toContain("moveOpportunityFromTicket");
    expect(outcome).not.toContain("crm_opportunities");
  });
  it("refused: a technician, an inspection not marked No action needed, a ticket with no opportunity", async () => {
    setup({ inspection: none });
    await expect(
      call(answerInspectionOpportunity, { id: INS, answer: "lost" }, TECH),
    ).rejects.toThrow("Only the office or a manager decides what happens to the opportunity");
    setup({ inspection: { inspection_outcome: "bid" } });
    await expect(call(answerInspectionOpportunity, { id: INS, answer: "lost" })).rejects.toThrow(
      'This is asked only after "No action needed"',
    );
    setup({ inspection: { ...none, from_opportunity_id: null } });
    await expect(call(answerInspectionOpportunity, { id: INS, answer: "lost" })).rejects.toThrow(
      "This inspection did not come from an opportunity",
    );
    // Only the three answers exist.
    expect(() => call(answerInspectionOpportunity, { id: INS, answer: "won" })).toThrow();
    expect(moveCalls()).toEqual([]);
    expect(oppStatus()).toBe("open");
  });
  it("closed by someone else in the meantime: left as it is, nothing noted", async () => {
    setup({ inspection: none, opp: { status: "won" } });
    const r = await call<Row>(answerInspectionOpportunity, { id: INS, answer: "lost" });
    expect(r).toEqual({ answer: "lost", move: null, status: "won" });
    expect(moveCalls()).toEqual([]);
    expect(env.writes.filter((w) => w.table === "service_job_events")).toEqual([]);
  });
  it("the question is asked where the button was, in plain words, with the three answers", () => {
    const section = read("src/components/service/inspection-section.tsx");
    const box = section.slice(
      section.indexOf("function OpportunityAfterNoAction("),
      section.indexOf("export function InspectionNextStep("),
    );
    expect(box).toContain('data-question="opportunity-after-no-action"');
    expect(box).toContain("{noActionQuestion(opportunity.title)}");
    expect(box).toContain("{NO_ACTION_ANSWERS.map((a) => (");
    expect(box).toContain("{NO_ACTION_ANSWER_LABELS[a]}");
    expect(box).toContain("onClick={() => answer.mutate(a)}");
    expect(box).toContain('data-line="opportunity-answer"');
    // In the After the inspection panel, and up in the banner until it is answered.
    expect(section).toContain(
      "<OpportunityAfterNoAction jobId={job.id} opportunity={data.opportunity ?? null} />",
    );
    const banner = section.slice(section.indexOf("export function InspectionNextStep("));
    expect(banner).toContain('data-banner="inspection-opportunity"');
    expect(banner).toContain("opportunityAsked(q.data.opportunity)");
    // An opportunity's own Lost asks for no reason, so there is none to ask for here.
    expect(read("src/lib/opportunities.functions.ts")).not.toMatch(/lost_reason/);
  });
});

// ── 5. A bid from an inspection ───────────────────────────────────────────────────────────

describe("5. a bid started from an inspection drives the inspection's opportunity", () => {
  it("the link is written; the bid's opportunity (the database's to carry) is synced and handed back", async () => {
    // As the database leaves the row once from_job_id is written (bids_carry_opportunity).
    setup({
      bids: [
        {
          id: BID,
          name: "Dock re-roof",
          status: "submitted",
          from_job_id: null,
          opportunity_id: OPP,
          deleted_at: null,
        },
      ],
    });
    const r = await call<Row>(linkBidToInspection, { inspectionId: INS, bidId: BID }, OFFICE);
    expect(r).toEqual({ linked: true, opportunity_id: OPP });
    expect(env.rpcCalls.filter((c) => c.fn === "sync_opportunity_from_bid")).toEqual([
      { fn: "sync_opportunity_from_bid", args: { p_bid: BID } },
    ]);
    // The app writes the inspection link only.
    const upd = env.writes.find((w) => w.table === "bids" && w.op === "update");
    expect(upd?.payload).toEqual({ from_job_id: INS });
  });
  it("an inspection with no opportunity: linked, nothing to sync", async () => {
    setup({
      bids: [
        {
          id: BID,
          name: "Dock re-roof",
          status: "draft",
          from_job_id: null,
          opportunity_id: null,
          deleted_at: null,
        },
      ],
    });
    expect(await call<Row>(linkBidToInspection, { inspectionId: INS, bidId: BID })).toEqual({
      linked: true,
    });
    expect(env.rpcCalls.filter((c) => c.fn === "sync_opportunity_from_bid")).toEqual([]);
  });
  it("the estimator shows the opportunity at once and says a failed sync out loud", () => {
    const est = read("src/routes/estimate.tsx");
    const link = est.slice(
      est.indexOf("const linkInspection = ("),
      est.indexOf("const saveAndLeave"),
    );
    expect(link).toContain("if (r.opportunity_id) {");
    expect(link).toContain("setLinkedOppId(r.opportunity_id);");
    expect(link).toContain("if (r.opportunity_error)");
    // Every later save syncs because the row names its opportunity (bids.functions.ts, Oct 12).
    expect(read("src/lib/bids.functions.ts")).toContain(
      'if (asBidStatus(bid.status) !== "draft" && (statusChanged || bid.opportunity_id))',
    );
    // A copy still starts with no opportunity of its own (duplicate-bid.ts): one bid drives it.
    expect(read("src/lib/duplicate-bid.ts")).toContain("opportunity_id: null,");
  });
});

// ── 6. The migration and the types ────────────────────────────────────────────────────────

describe("6. the migration (20261113100000_opportunity_chain.sql) and the types", () => {
  const path = "supabase/migrations/20261113100000_opportunity_chain.sql";
  const sql = existsSync(path) ? read(path).replace(/--[^\n]*/g, "") : "";
  it("runs twice without harm", () => {
    expect(existsSync(path)).toBe(true);
    expect(sql).toContain(
      "alter table public.crm_opportunity_events add column if not exists note text;",
    );
    expect(sql.match(/create or replace function public\./g)).toHaveLength(6);
    expect(sql).not.toMatch(/create function public\./);
    for (const [trg, table] of [
      ["service_jobs_carry_opportunity", "service_jobs"],
      ["bids_carry_opportunity", "bids"],
      ["bids_carry_opportunity_link", "bids"],
    ]) {
      const drop = sql.indexOf(`drop trigger if exists ${trg} on public.${table};`);
      expect(drop).toBeGreaterThan(0);
      expect(sql.indexOf(`create trigger ${trg}\n`)).toBeGreaterThan(drop);
    }
  });
  it("the opportunity is carried: repair ticket before insert; bid before insert or a change of its inspection", () => {
    expect(sql).toMatch(
      /create trigger service_jobs_carry_opportunity\s+before insert on public\.service_jobs\s+for each row/,
    );
    expect(sql).toContain(
      "if new.from_job_id is not null and new.from_opportunity_id is null then",
    );
    expect(sql).toMatch(
      /create trigger bids_carry_opportunity\s+before insert or update of from_job_id on public\.bids/,
    );
    expect(sql).toContain("if new.from_job_id is null or new.opportunity_id is not null then");
    // One bid drives an opportunity: only a live opportunity with no live bid of its own.
    expect(sql).toMatch(
      /and o\.deleted_at is null\s+and \(\s+o\.bid_id is null\s+or o\.bid_id = new\.id\s+or exists \(select 1 from public\.bids b where b\.id = o\.bid_id and b\.deleted_at is not null\)/,
    );
    // Both sides, as linkBid keeps them.
    expect(sql).toMatch(
      /create trigger bids_carry_opportunity_link\s+after insert or update of from_job_id, opportunity_id on public\.bids/,
    );
    expect(sql).toMatch(/update public\.crm_opportunities o\s+set bid_id = new\.id,/);
  });
  it("nothing is backfilled", () => {
    expect(sql).not.toMatch(/update public\.service_jobs/);
    expect(sql).not.toMatch(/update public\.bids/);
    expect(sql).not.toMatch(/insert into public\.(service_jobs|bids|crm_opportunities)\b/);
  });
  it("the move: who may, what moves, never backwards or out of a closed status, never when deleted", () => {
    const fn = sql.slice(
      sql.indexOf("create or replace function public.move_opportunity_from_ticket("),
      sql.indexOf("create or replace function public.ticket_opportunity("),
    );
    expect(fn).toContain("security definer");
    expect(fn).toContain("set search_path to 'public'");
    // The people who create tickets (service_jobs_insert's rule), never a technician-only user.
    expect(fn).toMatch(
      /public\.followup_is_system\(\)\s+or \(\s+public\.has_access\('service'\)\s+and \(public\.is_admin\(\) or public\.is_manager\(\) or not public\.is_technician\(\)\)/,
    );
    expect(fn).toContain("raise exception 'Forbidden' using errcode = '42501';");
    expect(fn).toContain(
      "if not found or v_job.deleted_at is not null or v_job.from_opportunity_id is null then",
    );
    expect(fn).toContain("if not found or v_opp.deleted_at is not null then");
    expect(fn).toContain("if v_opp.status in ('won', 'lost', 'no_response') then");
    expect(fn).toContain("if p_to not in ('lost', 'no_response') then");
    expect(fn).toContain(
      "if v_job.service_type <> 'inspection' or v_job.inspection_outcome is distinct from 'none' then",
    );
    expect(fn).toContain("elsif v_job.service_type in ('inspection', 'warranty') then");
    expect(fn).toContain("v_to := case when v_opp.status = 'open' then 'contacted' else null end;");
    expect(fn).toContain("v_to := 'won';");
    // The log line names the ticket, for this one update only.
    expect(fn).toContain("v_note := 'from ticket #' || v_job.number;");
    expect(fn).toContain("v_note := 'from ticket #' || v_job.number || ': no action needed';");
    expect(fn).toContain("perform set_config('app.opportunity_move_note', v_note, true);");
    expect(fn).toContain("perform set_config('app.opportunity_move_note', '', true);");
    expect(sql).toContain(
      "v_note text := nullif(current_setting('app.opportunity_move_note', true), '');",
    );
    expect(sql).toMatch(
      /insert into public\.crm_opportunity_events \(opportunity_id, kind, status, by_user, by_name, note\)\s+values \(new\.id, 'status', new\.status, v_uid, v_name, v_note\);/,
    );
  });
  it("the answer carries what the reminders need, so the server reads nothing the caller cannot", () => {
    expect(sql).toMatch(
      /'ticket', v_job\.number,\s+'account_id', v_opp\.account_id, 'assignee_id', v_opp\.assignee_id,\s+'expected_close', v_opp\.expected_close\);/,
    );
  });
  it("ticket_opportunity: the title and status of a ticket's live opportunity, for the same people", () => {
    const fn = sql.slice(
      sql.indexOf("create or replace function public.ticket_opportunity("),
      sql.indexOf("revoke all on function public.move_opportunity_from_ticket"),
    );
    expect(fn).toContain("stable");
    expect(fn).toContain("security definer");
    expect(fn).toMatch(
      /public\.followup_is_system\(\)\s+or \(\s+public\.has_access\('service'\)\s+and \(public\.is_admin\(\) or public\.is_manager\(\) or not public\.is_technician\(\)\)/,
    );
    expect(fn).toContain("raise exception 'Forbidden' using errcode = '42501';");
    expect(fn).toContain(
      "select jsonb_build_object('id', o.id, 'title', o.title, 'status', o.status)",
    );
    expect(fn).toMatch(
      /where j\.id = p_job\s+and j\.deleted_at is null\s+and o\.deleted_at is null;/,
    );
    // No amount, no customer, nothing else of the opportunity.
    expect(fn).not.toMatch(/estimated|value|amount|account_id|notes/);
  });
  it("only the rights each needs", () => {
    expect(sql).toContain(
      "revoke all on function public.move_opportunity_from_ticket(uuid, text) from public, anon;",
    );
    expect(sql).toContain(
      "grant execute on function public.move_opportunity_from_ticket(uuid, text) to authenticated, service_role;",
    );
    expect(sql).toContain(
      "revoke all on function public.ticket_opportunity(uuid) from public, anon;",
    );
    expect(sql).toContain(
      "grant execute on function public.ticket_opportunity(uuid) to authenticated, service_role;",
    );
    for (const f of [
      "service_jobs_carry_opportunity",
      "bids_carry_opportunity",
      "bids_carry_opportunity_link",
    ])
      expect(sql).toContain(
        `revoke all on function public.${f}() from public, anon, authenticated;`,
      );
  });
  it("the types, by hand in the generator's style", () => {
    const types = readGeneratedTypes();
    expect(types).toContain(
      "move_opportunity_from_ticket: {\n        Args: { p_job: string; p_to?: string };\n        Returns: Json;\n      };",
    );
    const start = types.indexOf("      crm_opportunity_events: {");
    const block = types.slice(start, types.indexOf("      crm_settings: {", start));
    expect(block.match(/note\??: string \| null/g)).toHaveLength(3);
    expect(types).toContain("ticket_opportunity: { Args: { p_job: string }; Returns: Json };");
    // No contract correction is needed: p_to is optional, and is left out rather than sent null.
    expect(read("src/lib/database-rpc.ts")).not.toContain("move_opportunity_from_ticket");
  });
});

// ── 7. The log line ───────────────────────────────────────────────────────────────────────

describe("7. the status strip says where a move came from", () => {
  const events = [
    { kind: "created", status: "open", at: "2026-11-01T10:00:00Z", by_name: "Mo Manager" },
    {
      kind: "status",
      status: "contacted",
      at: "2026-11-02T10:00:00Z",
      by_name: "Olive Office",
      note: "from ticket #6041",
    },
    {
      kind: "status",
      status: "won",
      at: "2026-11-05T10:00:00Z",
      by_name: "Mo Manager",
      note: "from ticket #6042",
    },
  ];
  it("who, and the ticket, under the status it set", () => {
    expect(statusNotes(events)).toEqual({
      contacted: "from ticket #6041",
      won: "from ticket #6042",
    });
    const cells = oppStatusStrip("won", events);
    expect(cells.find((c) => c.key === "contacted")).toMatchObject({
      by: "Olive Office",
      note: "from ticket #6041",
    });
    expect(cells.find((c) => c.key === "outcome")).toMatchObject({
      label: "Won",
      by: "Mo Manager",
      note: "from ticket #6042",
    });
    expect(cells.find((c) => c.key === "open")).not.toHaveProperty("note");
  });
  it("a later change by hand carries no ticket", () => {
    const later = [
      ...events,
      {
        kind: "status",
        status: "contacted",
        at: "2026-11-06T10:00:00Z",
        by_name: "Mo Manager",
        note: null,
      },
    ];
    expect(statusNotes(later)).toEqual({ won: "from ticket #6042" });
  });
  it("the strip shows it, and the log is read whole", () => {
    const strip = read("src/components/stage-strip.tsx");
    expect(strip).toMatch(/\{c\.note && \(\s*<span className="[^"]*" data-note>\s*\{c\.note\}/);
    const fn = read("src/lib/opportunities.functions.ts");
    const list = fn.slice(fn.indexOf("export const listOpportunityEvents"));
    expect(list.slice(0, 500)).toContain('.select("*")');
  });
});
