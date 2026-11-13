/**
 * Owner, Nov 13 — "show the whole chain": one line on the opportunity, its inspection ticket, the
 * repair ticket and the bid —
 *
 *   Opportunity: Leak at the dock (Quoted) › Inspection #6041 (Done) › Bid: Dock re-roof (Submitted)
 *
 * each part a link, the current one bold and not a link, the statuses in the pages' own words,
 * records at one step side by side, nothing for a record with nothing before or after, and only
 * the parts the reader may read (a technician sees tickets, never the opportunity or the bid;
 * never an amount).
 *
 *  1. buildChain (lib/work-chain.ts), the pure rule.
 *  2. readChain (lib/work-chain.functions.ts) from each of the four starting points, with the
 *     caller's own client.
 *  3. The line itself and where it is mounted.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));

import {
  buildChain,
  chainText,
  chainTicketLabel,
  type ChainBid,
  type ChainInput,
  type ChainOpportunity,
  type ChainTicket,
} from "@/lib/work-chain";
import { getWorkChain, readChain } from "@/lib/work-chain.functions";
import { fakeSupabase } from "@/test/fake-supabase";

const read = (p: string) => readFileSync(p, "utf8");

const OPP = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const INS = "11111111-1111-4111-8111-111111111111";
const REP = "22222222-2222-4222-8222-222222222222";
const BID = "33333333-3333-4333-8333-333333333333";
const BID2 = "44444444-4444-4444-8444-444444444444";

const opp = (o: Partial<ChainOpportunity> = {}): ChainOpportunity => ({
  id: OPP,
  title: "Leak at the dock",
  status: "quoted",
  deleted: false,
  ...o,
});
const inspection = (t: Partial<ChainTicket> = {}): ChainTicket => ({
  id: INS,
  number: 6041,
  service_type: "inspection",
  stage: "done",
  deleted: false,
  from_opportunity_id: OPP,
  from_job_id: null,
  ...t,
});
const repair = (t: Partial<ChainTicket> = {}): ChainTicket => ({
  id: REP,
  number: 6042,
  service_type: "repair",
  stage: "scheduled",
  deleted: false,
  // Since Nov 13 a repair ticket carries the inspection's opportunity too.
  from_opportunity_id: OPP,
  from_job_id: INS,
  ...t,
});
const bid = (b: Partial<ChainBid> = {}): ChainBid => ({
  id: BID,
  name: "Dock re-roof",
  status: "submitted",
  deleted: false,
  opportunity_id: OPP,
  from_job_id: INS,
  ...b,
});
const line = (input: ChainInput, current: { kind: "opportunity" | "ticket" | "bid"; id: string }) =>
  chainText(buildChain(input, current));

describe("1. buildChain", () => {
  it("an opportunity with an inspection and a bid: the owner's line", () => {
    const input = { opportunity: opp(), tickets: [inspection()], bids: [bid()] };
    expect(line(input, { kind: "opportunity", id: OPP })).toBe(
      "Opportunity: Leak at the dock (Quoted) › Inspection #6041 (Done) › Bid: Dock re-roof (Submitted)",
    );
    const steps = buildChain(input, { kind: "bid", id: BID });
    expect(steps.map((s) => s.map((p) => [p.kind, p.current]))).toEqual([
      [["opportunity", false]],
      [["ticket", false]],
      [["bid", true]],
    ]);
  });
  it("an inspection with a repair ticket and a bid: the two stand side by side after it", () => {
    const input = {
      opportunity: opp({ status: "won" }),
      tickets: [inspection(), repair()],
      bids: [bid()],
    };
    const steps = buildChain(input, { kind: "ticket", id: INS });
    expect(chainText(steps)).toBe(
      "Opportunity: Leak at the dock (Won) › Inspection #6041 (Done) › Repair ticket #6042 (Scheduled) · Bid: Dock re-roof (Submitted)",
    );
    // The repair ticket carries the opportunity too, and still stands after its inspection.
    expect(steps[2]!.map((p) => p.id)).toEqual([REP, BID]);
    expect(steps[1]![0]).toMatchObject({ id: INS, current: true, deleted: false });
  });
  it("a bid started straight from an opportunity", () => {
    const input = {
      opportunity: opp(),
      tickets: [],
      bids: [bid({ from_job_id: null, status: "draft" })],
    };
    expect(line(input, { kind: "bid", id: BID })).toBe(
      "Opportunity: Leak at the dock (Quoted) › Bid: Dock re-roof (Draft)",
    );
  });
  it("a deleted record in the middle stays, marked deleted and without a link; at the end it is left out", () => {
    const middle = {
      opportunity: opp(),
      tickets: [inspection({ deleted: true }), repair()],
      bids: [],
    };
    const steps = buildChain(middle, { kind: "ticket", id: REP });
    expect(chainText(steps)).toBe(
      "Opportunity: Leak at the dock (Quoted) › Inspection #6041 (deleted) › Repair ticket #6042 (Scheduled)",
    );
    expect(steps[1]![0]).toMatchObject({ deleted: true, current: false });
    // A deleted repair ticket and a deleted bid at the end: gone.
    const end = {
      opportunity: opp(),
      tickets: [inspection(), repair({ deleted: true })],
      bids: [bid({ deleted: true })],
    };
    expect(line(end, { kind: "opportunity", id: OPP })).toBe(
      "Opportunity: Leak at the dock (Quoted) › Inspection #6041 (Done)",
    );
    // A deleted opportunity with live work after it is the middle too.
    expect(
      line(
        { opportunity: opp({ deleted: true }), tickets: [inspection()], bids: [] },
        {
          kind: "ticket",
          id: INS,
        },
      ),
    ).toBe("Opportunity: Leak at the dock (deleted) › Inspection #6041 (Done)");
  });
  it("a part the caller cannot read is not there, and what hung under it moves up", () => {
    // A technician: the tickets, neither the opportunity nor the bid.
    const tech = { opportunity: null, tickets: [inspection(), repair()], bids: [] };
    expect(line(tech, { kind: "ticket", id: REP })).toBe(
      "Inspection #6041 (Done) › Repair ticket #6042 (Scheduled)",
    );
    // An estimator without Service access: the opportunity and the bid, not the ticket between.
    const estimator = { opportunity: opp(), tickets: [], bids: [bid()] };
    expect(line(estimator, { kind: "bid", id: BID })).toBe(
      "Opportunity: Leak at the dock (Quoted) › Bid: Dock re-roof (Submitted)",
    );
    // A technician on an inspection with nothing after it that they can see: no line.
    expect(
      buildChain(
        { opportunity: null, tickets: [inspection()], bids: [] },
        {
          kind: "ticket",
          id: INS,
        },
      ),
    ).toEqual([]);
  });
  it("a record with nothing before or after shows no line", () => {
    expect(
      buildChain({ opportunity: opp(), tickets: [], bids: [] }, { kind: "opportunity", id: OPP }),
    ).toEqual([]);
    expect(
      buildChain(
        {
          opportunity: null,
          tickets: [],
          bids: [bid({ opportunity_id: null, from_job_id: null })],
        },
        { kind: "bid", id: BID },
      ),
    ).toEqual([]);
    expect(
      buildChain(
        { opportunity: null, tickets: [inspection({ from_opportunity_id: null })], bids: [] },
        { kind: "ticket", id: INS },
      ),
    ).toEqual([]);
  });
  it("several children at one step: tickets by number, then bids by name", () => {
    const input = {
      opportunity: opp(),
      tickets: [inspection({ id: REP, number: 6050 }), inspection()],
      bids: [
        bid({ id: BID2, name: "Option B", from_job_id: null }),
        bid({ name: "Option A", from_job_id: null }),
      ],
    };
    expect(line(input, { kind: "opportunity", id: OPP })).toBe(
      "Opportunity: Leak at the dock (Quoted) › Inspection #6041 (Done) · Inspection #6050 (Done) · Bid: Option A (Submitted) · Bid: Option B (Submitted)",
    );
  });
  it("the words are the pages' own; a ticket is named by its type; the same row twice is one part", () => {
    expect(chainTicketLabel({ number: 7, service_type: "inspection" })).toBe("Inspection #7");
    expect(chainTicketLabel({ number: 7, service_type: "repair" })).toBe("Repair ticket #7");
    expect(chainTicketLabel({ number: 7, service_type: "warranty" })).toBe("Warranty ticket #7");
    expect(chainTicketLabel({ number: 7, service_type: "other" })).toBe("Ticket #7");
    const input = {
      opportunity: opp({ status: "no_response" }),
      tickets: [inspection({ stage: "authorized" }), inspection({ stage: "authorized" })],
      bids: [],
    };
    expect(line(input, { kind: "opportunity", id: OPP })).toBe(
      "Opportunity: Leak at the dock (No response) › Inspection #6041 (Authorized)",
    );
  });
  it("a loop in the data ends (two tickets naming each other)", () => {
    const input = {
      opportunity: null,
      tickets: [
        inspection({ from_job_id: REP, from_opportunity_id: null }),
        repair({ from_opportunity_id: null }),
      ],
      bids: [],
    };
    expect(buildChain(input, { kind: "ticket", id: INS }).flat()).toHaveLength(2);
  });
  it("no amount is ever part of it", () => {
    const steps = buildChain(
      { opportunity: opp(), tickets: [inspection()], bids: [bid()] },
      {
        kind: "opportunity",
        id: OPP,
      },
    );
    for (const p of steps.flat())
      expect(Object.keys(p).sort()).toEqual([
        "current",
        "deleted",
        "id",
        "kind",
        "label",
        "status",
      ]);
    // The read selects no money column (comments aside).
    const fn = read("src/lib/work-chain.functions.ts").replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
    expect(fn).not.toMatch(/grand_total|amount|price|total/i);
  });
});

// ---------------------------------------------------------------------------------------------

const rows = () => ({
  crm_opportunities: [
    { id: OPP, title: "Leak at the dock", status: "quoted", deleted_at: null, bid_id: BID },
  ],
  service_jobs: [
    {
      id: INS,
      number: 6041,
      service_type: "inspection",
      stage: "done",
      deleted_at: null,
      from_opportunity_id: OPP,
      from_job_id: null,
    },
    {
      id: REP,
      number: 6042,
      service_type: "repair",
      stage: "open",
      deleted_at: null,
      // A repair ticket from before Nov 13: the inspection only.
      from_opportunity_id: null,
      from_job_id: INS,
    },
    {
      id: "99999999-9999-4999-8999-999999999999",
      number: 6000,
      service_type: "repair",
      stage: "open",
      deleted_at: null,
      from_opportunity_id: null,
      from_job_id: null,
    },
  ],
  bids: [
    {
      id: BID,
      name: "Dock re-roof",
      status: "submitted",
      deleted_at: null,
      opportunity_id: OPP,
      from_job_id: INS,
      grand_total: 123456,
    },
    {
      id: BID2,
      name: "Someone else's",
      status: "draft",
      deleted_at: null,
      opportunity_id: null,
      from_job_id: null,
    },
  ],
});
const FULL =
  "Opportunity: Leak at the dock (Quoted) › Inspection #6041 (Done) › Repair ticket #6042 (Open) · Bid: Dock re-roof (Submitted)";

describe("2. readChain: the same chain from each of the four records", () => {
  it.each([
    ["opportunity", OPP],
    ["ticket", INS],
    ["ticket", REP],
    ["bid", BID],
  ] as const)("from the %s %s", async (kind, id) => {
    const env = fakeSupabase(rows());
    const input = await readChain(env.db, { kind, id });
    expect(chainText(buildChain(input, { kind, id }))).toBe(FULL);
    // Reads only: nothing is written, and no function with the server's rights is called.
    expect(env.writes).toEqual([]);
    expect(env.rpcCalls).toEqual([]);
  });
  it("getWorkChain answers the steps for the page, the current part marked", async () => {
    const env = fakeSupabase(rows());
    const steps = await (
      getWorkChain as unknown as (a: {
        data: { kind: string; id: string };
        context: unknown;
      }) => Promise<ReturnType<typeof buildChain>>
    )({ data: { kind: "ticket", id: REP }, context: { supabase: env.db, userId: "u" } });
    expect(chainText(steps)).toBe(FULL);
    expect(
      steps
        .flat()
        .filter((p) => p.current)
        .map((p) => p.id),
    ).toEqual([REP]);
    expect(JSON.stringify(steps)).not.toContain("123456");
  });
  it("a technician (no opportunity, no bid comes back): tickets only", async () => {
    const env = fakeSupabase({ ...rows(), crm_opportunities: [], bids: [] });
    const input = await readChain(env.db, { kind: "ticket", id: REP });
    expect(input.opportunity).toBeNull();
    expect(input.bids).toEqual([]);
    expect(chainText(buildChain(input, { kind: "ticket", id: REP }))).toBe(
      "Inspection #6041 (Done) › Repair ticket #6042 (Open)",
    );
  });
  it("an estimator without Service access (no ticket comes back): opportunity and bid", async () => {
    const env = fakeSupabase({ ...rows(), service_jobs: [] });
    const input = await readChain(env.db, { kind: "bid", id: BID });
    expect(chainText(buildChain(input, { kind: "bid", id: BID }))).toBe(
      "Opportunity: Leak at the dock (Quoted) › Bid: Dock re-roof (Submitted)",
    );
  });
  it("a ticket and a bid with nothing around them: no chain; a bid that cannot be read: nothing", async () => {
    const env = fakeSupabase(rows());
    const lone = "99999999-9999-4999-8999-999999999999";
    expect(
      buildChain(await readChain(env.db, { kind: "ticket", id: lone }), {
        kind: "ticket",
        id: lone,
      }),
    ).toEqual([]);
    expect(
      buildChain(await readChain(env.db, { kind: "bid", id: BID2 }), { kind: "bid", id: BID2 }),
    ).toEqual([]);
    expect(
      await readChain(env.db, { kind: "bid", id: "88888888-8888-4888-8888-888888888888" }),
    ).toEqual({
      opportunity: null,
      tickets: [],
      bids: [],
    });
  });
  it("every read is the caller's own client (the tables' own rules decide)", () => {
    const fn = read("src/lib/work-chain.functions.ts");
    expect(fn).not.toContain("serverClient");
    expect(fn).not.toContain("notify.server");
    expect(fn).toContain("const input = await readChain(context.supabase, data);");
    expect(fn).toContain(
      'const TICKET_COLS = "id, number, service_type, stage, deleted_at, from_opportunity_id, from_job_id";',
    );
    expect(fn).toContain(
      'const BID_COLS = "id, name, status, deleted_at, opportunity_id, from_job_id";',
    );
  });
});

// ---------------------------------------------------------------------------------------------

describe("3. the line and where it stands", () => {
  const comp = read("src/components/work-chain-line.tsx");
  it("each part links to its record; the current one is bold and not a link; a deleted one has no link", () => {
    expect(comp).toContain('<Link to="/opportunities" search={{ id: p.id }}');
    expect(comp).toContain('<Link to="/service" search={{ id: p.id }}');
    expect(comp).toContain('<Link to="/estimate" search={{ bid: p.id }}');
    const current = comp.slice(comp.indexOf("if (p.current)"), comp.indexOf("if (p.deleted)"));
    expect(current).toContain('className="font-semibold"');
    expect(current).toContain('aria-current="true"');
    expect(current).not.toContain("<Link");
    const deleted = comp.slice(comp.indexOf("if (p.deleted)"), comp.indexOf("const cls ="));
    expect(deleted).not.toContain("<Link");
  });
  it("on a phone it wraps and never scrolls sideways", () => {
    expect(comp).toContain("flex min-w-0 flex-wrap items-baseline");
    expect(comp).toContain("break-words");
    expect(comp).not.toMatch(/overflow-x|whitespace-nowrap|truncate/);
  });
  it("no chain: the lines the page had before stand in its place", () => {
    expect(comp).toContain("if (!steps.length) return <>{children}</>;");
    expect(comp).toContain("enabled: !!session && !!id,");
  });
  it("the opportunity page, the ticket page and the estimator's Setup mount it", () => {
    const opps = read("src/components/opportunities-page.tsx");
    expect(opps).toContain('{opp && <WorkChainLine kind="opportunity" id={opp.id} />}');
    const ticket = read("src/components/service-page.tsx");
    const at = ticket.indexOf('<WorkChainLine\n            kind="ticket"');
    expect(at).toBeGreaterThan(0);
    const block = ticket.slice(at, ticket.indexOf("</WorkChainLine>", at));
    // Read for a ticket that came from something or that something can come from.
    expect(block).toMatch(
      /job\.from_opportunity_id \|\| job\.from_job_id \|\| job\.service_type === "inspection"\s*\? job\.id\s*: null/,
    );
    // The two From lines are what shows while there is no chain.
    expect(block).toContain("<FromOpportunityNote id={job.from_opportunity_id} />");
    expect(block).toContain("<FromInspectionNote job={job} />");
    expect(ticket.match(/<FromInspectionNote job=\{job\} \/>/g)).toHaveLength(1);
    const est = read("src/routes/estimate.tsx");
    const e = est.indexOf('<WorkChainLine\n              kind="bid"');
    expect(e).toBeGreaterThan(0);
    const eBlock = est.slice(e, est.indexOf("</WorkChainLine>", e));
    expect(eBlock).toContain("id={fromOpportunityId || fromInspectionId ? bidId : null}");
    expect(eBlock).toContain('data-line="from-opportunity"');
    expect(eBlock).toContain('data-line="from-inspection"');
    // Under the Status select, where the From lines were.
    expect(est.indexOf("Lost: {lostReason")).toBeLessThan(e);
  });
  it("a move, a link or a save refreshes the line", () => {
    expect(read("src/lib/opportunity-move-toast.ts")).toContain(
      'void qc.invalidateQueries({ queryKey: ["work-chain"] });',
    );
    const est = read("src/routes/estimate.tsx");
    expect(est.match(/queryKey: \["work-chain"\]/g)!.length).toBeGreaterThanOrEqual(4);
    // The Status select saves on its own (not through Save bid): it refreshes the line too — found
    // in the browser on Nov 13, the line kept "(Draft)" after "Status saved: Submitted".
    expect(est).toMatch(
      /toast\.success\(`Status saved: \$\{STATUS_LABELS\[status\]\}`\);[\s\S]{0,260}void qc\.invalidateQueries\(\{ queryKey: \["work-chain"\] \}\);/,
    );
    expect(comp).toContain('["work-chain", kind, id] as const');
  });
});
