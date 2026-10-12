/**
 * Owner decisions, Oct 12 (A, B, D):
 *
 *  A. The bid drives the opportunity it was started from, one direction only. Submitted makes an
 *     Open / Contacted opportunity Quoted (never backwards from Won / Lost / No response); Won
 *     makes it Won; Lost makes it Lost. Both status paths (saveBid in the estimator, setBidStatus
 *     on the Bids page) run the sync server-side after the bid write, and the follow-up closes or
 *     reopens as for a manual change. Closing the opportunity never touches the bid. linkBid also
 *     writes bids.opportunity_id (backfilled by the migration). bids.submitted_at is stamped once;
 *     bids.status_changed_at on every change. The opportunity page gets a bid card and the list a
 *     chip; the Bids page and the estimator say "From opportunity: <title>".
 *  B. claimOpportunity starts the follow-up timer (as a save would) and applies the manager date
 *     rule to a dropped day; restoreOpportunity re-syncs the follow-up.
 *  D. The customer detail gets an Opportunities section (getAccount returns them).
 *
 * The real server functions run against the in-memory stand-in (src/test/fake-supabase.ts); the
 * database function sync_opportunity_from_bid is answered here with the same mapping as the pure
 * twin (oppStatusFromBid), which the migration pins below keep in step with the SQL.
 */
import { existsSync, readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));
const notified: unknown[] = [];
vi.mock("@/lib/notify.server", () => ({
  serverClient: async (fallback: unknown) => fallback,
  notify: vi.fn(async (...a: unknown[]) => {
    notified.push(a);
    return 0;
  }),
}));

import {
  BID_DRIVES_OPP_NOTE,
  bidStatusStamps,
  fromOpportunityLine,
  oppStatusFromBid,
} from "@/lib/bid-status";
import { listBids, saveBid, setBidStatus } from "@/lib/bids.functions";
import {
  claimOpportunity,
  getOpportunity,
  linkBid,
  listOpportunities,
  restoreOpportunity,
  setOpportunityStatus,
} from "@/lib/opportunities.functions";
import { getAccount, orderAccountOpportunities } from "@/lib/crm.functions";
import { DATE_MOVE_MANAGER_ONLY } from "@/lib/followup-rules";
import { fakeSupabase, type FakeRpc } from "@/test/fake-supabase";

type Row = Record<string, unknown>;
const read = (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : "");
const src = (p: string) => read(p).replace(/\s+/g, " ");
const flatSql = (p: string) =>
  read(p)
    .replace(/--[^\n]*/g, "")
    .replace(/\s+/g, " ");

const EST = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"; // Estimate only — not a manager
const MGR = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const REP = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"; // the opportunity's assignee
const CLAIMER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"; // office, ticked Technician
const OPP = "11111111-1111-4111-8111-111111111111";
const OPP2 = "22222222-2222-4222-8222-222222222222";
const BID = "33333333-3333-4333-8333-333333333333";
const BID2 = "44444444-4444-4444-8444-444444444444";
const ACC = "55555555-5555-4555-8555-555555555555";
const SITE = "66666666-6666-4666-8666-666666666666";
const FU = "77777777-7777-4777-8777-777777777777";

const estimator = {
  id: EST,
  role: "user",
  access: ["estimate"],
  technician: false,
  full_name: "Eve Estimator",
  email: "eve@example.com",
};
const manager = { ...estimator, id: MGR, role: "manager", access: [], full_name: "Mo Manager" };
const rep = { ...estimator, id: REP, access: ["customers"], full_name: "Rae Rep" };
const claimer = {
  ...estimator,
  id: CLAIMER,
  access: ["service", "customers"],
  technician: true,
  full_name: "Cal Claimer",
};

const opportunity = (over: Row = {}): Row => ({
  id: OPP,
  title: "Reroof gym",
  account_id: ACC,
  site_id: SITE,
  bid_id: BID,
  assignee_id: REP,
  status: "open",
  expected_close: "2026-10-20",
  deleted_at: null,
  created_at: "2026-10-01T12:00:00Z",
  updated_at: "2026-10-10T12:00:00Z",
  ...over,
});
const bid = (over: Row = {}): Row => ({
  id: BID,
  name: "Gym reroof bid",
  status: "draft",
  grand_total: 48250,
  data: {},
  lost_reason: null,
  opportunity_id: null,
  submitted_at: null,
  status_changed_at: null,
  deleted_at: null,
  account_id: ACC,
  updated_at: "2026-10-10T12:00:00Z",
  created_at: "2026-10-01T12:00:00Z",
  ...over,
});
const followup = (over: Row = {}): Row => ({
  id: FU,
  kind: "opportunity",
  item_id: OPP,
  assignee_id: REP,
  status: "open",
  title: "Reroof gym",
  url: `/opportunities?id=${OPP}`,
  due_at: "2026-10-20T12:00:00.000Z",
  next_remind_at: "2026-10-13T12:00:00.000Z",
  reminders_sent: 0,
  ...over,
});

/** The database function, as the test answers it: the same mapping as the pure twin. */
const syncRpc: FakeRpc = (args, tables) => {
  const b = (tables["bids"] ?? []).find((r) => r["id"] === args["p_bid"]);
  if (!b) return { action: "none", reason: "no bid" };
  const opps = (tables["crm_opportunities"] ?? []).filter(
    (o) => !o["deleted_at"] && (o["bid_id"] === b["id"] || o["id"] === b["opportunity_id"]),
  );
  const o = opps.find((x) => x["bid_id"] === b["id"]) ?? opps[0];
  if (!o) return { action: "none", reason: "no opportunity" };
  const to = oppStatusFromBid(b["status"] as string, o["status"] as string);
  if (!to) return { action: "unchanged", opportunity_id: o["id"], status: o["status"] };
  const from = o["status"];
  o["status"] = to;
  return { action: "updated", opportunity_id: o["id"], from, to };
};

let env: ReturnType<typeof fakeSupabase>;
function setup(opts: { opp?: Row; bid?: Row; followups?: Row[]; more?: Row[] } = {}) {
  notified.length = 0;
  env = fakeSupabase(
    {
      profiles: [estimator, manager, rep, claimer],
      crm_opportunities: [opportunity(opts.opp), ...(opts.more ?? [])],
      crm_followups: opts.followups ?? [],
      crm_contact_log: [],
      crm_accounts: [{ id: ACC, name: "Bell County Schools", phone: "606-555-0100" }],
      crm_sites: [{ id: SITE, account_id: ACC, name: "Gym", deleted_at: null }],
      bids: [bid(opts.bid), bid({ id: BID2, name: "Other bid" })],
      bid_locks: [],
      service_jobs: [],
      tasks: [],
      crm_settings: [
        {
          id: 1,
          opportunity_close_days: 30,
          opportunity_first_days: 3,
          opportunity_every_days: 7,
          ticket_first_days: 1,
          ticket_every_days: 3,
        },
      ],
    },
    { rpcs: { sync_opportunity_from_bid: syncRpc } },
  );
}
const call = <T = unknown>(fn: unknown, data: Row, userId: string) =>
  (fn as (a: { data: Row; context: unknown }) => Promise<T>)({
    data,
    context: { supabase: env.db, userId },
  });
const oppRow = (id = OPP) => env.tables["crm_opportunities"]!.find((r) => r["id"] === id)!;
const bidRow = (id = BID) => env.tables["bids"]!.find((r) => r["id"] === id)!;
const followups = () => env.tables["crm_followups"]!;
const bidWrites = () => env.writes.filter((w) => w.table === "bids");
const syncCalls = () => env.rpcCalls.filter((c) => c.fn === "sync_opportunity_from_bid");

beforeEach(() => setup());

// ---------------------------------------------------------------------------------------------

describe("A. the mapping (pure, oppStatusFromBid)", () => {
  it("submitted → quoted only from open / contacted", () => {
    expect(oppStatusFromBid("submitted", "open")).toBe("quoted");
    expect(oppStatusFromBid("submitted", "contacted")).toBe("quoted");
    expect(oppStatusFromBid("submitted", "quoted")).toBeNull();
    for (const closed of ["won", "lost", "no_response"])
      expect(oppStatusFromBid("submitted", closed)).toBeNull();
  });
  it("won → won, lost → lost, from any status (and nothing when already there)", () => {
    for (const from of ["open", "contacted", "quoted", "lost", "no_response"])
      expect(oppStatusFromBid("won", from)).toBe("won");
    expect(oppStatusFromBid("won", "won")).toBeNull();
    for (const from of ["open", "contacted", "quoted", "won", "no_response"])
      expect(oppStatusFromBid("lost", from)).toBe("lost");
    expect(oppStatusFromBid("lost", "lost")).toBeNull();
  });
  it("draft (and a legacy in-progress value) moves nothing", () => {
    expect(oppStatusFromBid("draft", "open")).toBeNull();
    expect(oppStatusFromBid("in_progress", "quoted")).toBeNull();
    expect(oppStatusFromBid(null, "open")).toBeNull();
    // Legacy outcomes fold in (accepted = won, denied = lost).
    expect(oppStatusFromBid("accepted", "quoted")).toBe("won");
    expect(oppStatusFromBid("denied", "quoted")).toBe("lost");
  });
});

describe("A. the stamps (pure, bidStatusStamps)", () => {
  const NOW = "2026-10-12T15:00:00.000Z";
  it("becoming submitted stamps submitted_at and status_changed_at", () => {
    expect(bidStatusStamps({ status: "draft", submitted_at: null }, "submitted", NOW)).toEqual({
      status_changed_at: NOW,
      submitted_at: NOW,
    });
  });
  it("submitted again later (draft → submitted → draft → submitted) keeps the first stamp", () => {
    expect(
      bidStatusStamps({ status: "draft", submitted_at: "2026-10-05T12:00:00Z" }, "submitted", NOW),
    ).toEqual({ status_changed_at: NOW });
  });
  it("won / lost stamp status_changed_at only; the same status stamps nothing", () => {
    expect(bidStatusStamps({ status: "submitted", submitted_at: NOW }, "won", NOW)).toEqual({
      status_changed_at: NOW,
    });
    expect(bidStatusStamps({ status: "won", submitted_at: NOW }, "won", NOW)).toEqual({});
    expect(bidStatusStamps({ status: "draft", submitted_at: null }, "draft", NOW)).toEqual({});
  });
  it("a new bid: submitted_at when created as submitted, no status_changed_at", () => {
    expect(bidStatusStamps(null, "submitted", NOW)).toEqual({ submitted_at: NOW });
    expect(bidStatusStamps(null, "draft", NOW)).toEqual({});
  });
});

describe("A. saveBid (the estimator's Status select) drives the opportunity", () => {
  const save = (status: string, over: Row = {}) =>
    call<Row>(
      saveBid,
      { id: BID, name: "Gym reroof bid", data: {}, grandTotal: 48250, status, ...over },
      EST,
    );
  it("submitted: the open opportunity becomes quoted; submitted_at and status_changed_at are stamped; the follow-up stays running", async () => {
    setup({ followups: [followup()] });
    const before = Date.now();
    const row = await save("submitted");
    expect(row["status"]).toBe("submitted");
    expect(Date.parse(bidRow()["submitted_at"] as string)).toBeGreaterThanOrEqual(before - 1000);
    expect(bidRow()["status_changed_at"]).toBe(bidRow()["submitted_at"]);
    expect(syncCalls()).toEqual([{ fn: "sync_opportunity_from_bid", args: { p_bid: BID } }]);
    expect(oppRow()["status"]).toBe("quoted");
    // The sync runs after the bid write.
    const writeIdx = env.writes.findIndex((w) => w.table === "bids");
    expect(writeIdx).toBeGreaterThanOrEqual(0);
    expect(followups()).toHaveLength(1);
    expect(followups()[0]!["status"]).toBe("open");
  });
  it("submitted_at is stamped once: a later save at submitted, or submitted again after draft, keeps it", async () => {
    await save("submitted");
    const first = bidRow()["submitted_at"];
    expect(first).toBeTruthy();
    await save("submitted", { grandTotal: 50000 });
    expect(bidRow()["submitted_at"]).toBe(first);
    await save("draft");
    await save("submitted");
    expect(bidRow()["submitted_at"]).toBe(first);
  });
  it("a save that does not change the status does not call the sync", async () => {
    await save("draft");
    expect(syncCalls()).toEqual([]);
    expect(oppRow()["status"]).toBe("open");
  });
  it("won, by a non-manager estimator: the opportunity is won and its follow-up closes (status won)", async () => {
    setup({ opp: { status: "quoted" }, bid: { status: "submitted" }, followups: [followup()] });
    await save("won");
    expect(oppRow()["status"]).toBe("won");
    expect(followups()).toHaveLength(1);
    expect(followups()[0]).toMatchObject({ status: "closed", closed_reason: "status won" });
  });
  it("lost: the opportunity is lost, with the bid's reason kept on the bid", async () => {
    setup({ opp: { status: "contacted" }, bid: { status: "submitted" }, followups: [followup()] });
    await save("lost", { lostReason: "Price" });
    expect(bidRow()["lost_reason"]).toBe("Price");
    expect(oppRow()["status"]).toBe("lost");
    expect(followups()[0]).toMatchObject({ status: "closed", closed_reason: "status lost" });
  });
  it("submitted never moves a closed opportunity back", async () => {
    for (const closed of ["won", "lost", "no_response"]) {
      setup({ opp: { status: closed } });
      await save("submitted");
      expect(oppRow()["status"]).toBe(closed);
    }
  });
  it("reaches the opportunity through bids.opportunity_id too (an older link with no bid_id)", async () => {
    setup({ opp: { bid_id: null }, bid: { opportunity_id: OPP } });
    await save("submitted");
    expect(oppRow()["status"]).toBe("quoted");
  });
  it("a bid with no opportunity saves as before", async () => {
    setup({ opp: { bid_id: null } });
    await save("won");
    expect(bidRow()["status"]).toBe("won");
    expect(oppRow()["status"]).toBe("open");
  });
  it("a deleted opportunity is left alone", async () => {
    setup({ opp: { deleted_at: "2026-10-11T12:00:00Z" } });
    await save("won");
    expect(oppRow()["status"]).toBe("open");
  });
});

describe("A. setBidStatus (the Bids page dropdown) drives it the same way", () => {
  it("submitted → quoted, stamped", async () => {
    const before = Date.now();
    const r = await call<Row>(setBidStatus, { id: BID, status: "submitted" }, EST);
    expect(r["status"]).toBe("submitted");
    expect(Date.parse(bidRow()["submitted_at"] as string)).toBeGreaterThanOrEqual(before - 1000);
    expect(oppRow()["status"]).toBe("quoted");
    expect(syncCalls()).toHaveLength(1);
  });
  it("won → won and lost → lost, by a non-manager", async () => {
    setup({ opp: { status: "quoted" }, bid: { status: "submitted" } });
    await call(setBidStatus, { id: BID, status: "won" }, EST);
    expect(oppRow()["status"]).toBe("won");
    setup({ opp: { status: "quoted" }, bid: { status: "submitted" } });
    await call(setBidStatus, { id: BID, status: "lost", lostReason: "Price" }, EST);
    expect(oppRow()["status"]).toBe("lost");
  });
  it("the same status again calls no sync; a bid that is gone is refused", async () => {
    await call(setBidStatus, { id: BID, status: "draft" }, EST);
    expect(syncCalls()).toEqual([]);
    await expect(
      call(setBidStatus, { id: "99999999-9999-4999-8999-999999999999", status: "won" }, EST),
    ).rejects.toThrow("Bid not found");
  });
});

describe("A. the opportunity's status never changes the bid", () => {
  it("closing the opportunity (lost) leaves a submitted bid submitted; nothing is written to bids", async () => {
    setup({ opp: { status: "quoted" }, bid: { status: "submitted" } });
    await call(setOpportunityStatus, { id: OPP, status: "lost" }, REP);
    expect(oppRow()["status"]).toBe("lost");
    expect(bidRow()["status"]).toBe("submitted");
    expect(bidWrites()).toEqual([]);
    expect(syncCalls()).toEqual([]);
  });
  it("winning the opportunity by hand leaves a draft bid a draft", async () => {
    await call(setOpportunityStatus, { id: OPP, status: "won" }, MGR);
    expect(bidRow()["status"]).toBe("draft");
    expect(bidWrites()).toEqual([]);
  });
});

describe("A. linkBid writes both sides", () => {
  it("crm_opportunities.bid_id and bids.opportunity_id", async () => {
    setup({ opp: { bid_id: null } });
    await expect(call(linkBid, { opportunityId: OPP, bidId: BID }, EST)).resolves.toEqual({
      linked: true,
    });
    expect(oppRow()["bid_id"]).toBe(BID);
    expect(bidRow()["opportunity_id"]).toBe(OPP);
  });
  it("already linked to this bid: nothing written; to another: refused, the bid untouched", async () => {
    await expect(call(linkBid, { opportunityId: OPP, bidId: BID }, EST)).resolves.toEqual({
      linked: true,
    });
    expect(env.writes).toEqual([]);
    await expect(call(linkBid, { opportunityId: OPP, bidId: BID2 }, EST)).rejects.toThrow(
      "already linked to another bid",
    );
    expect(bidRow(BID2)["opportunity_id"]).toBeNull();
  });
});

describe("A. what the pages read", () => {
  it("the opportunity carries the bid's name, status, grand total and submitted_at (withNames)", async () => {
    setup({ bid: { status: "submitted", submitted_at: "2026-10-11T14:00:00Z" } });
    const o = await call<Row>(getOpportunity, { id: OPP }, REP);
    expect(o).toMatchObject({
      bid_name: "Gym reroof bid",
      bid_status: "submitted",
      bid_grand_total: 48250,
      bid_submitted_at: "2026-10-11T14:00:00Z",
    });
    const list = await call<Row[]>(listOpportunities, {}, REP);
    expect(list[0]).toMatchObject({ bid_status: "submitted" });
  });
  it("no bid: the four are null", async () => {
    setup({ opp: { bid_id: null } });
    const o = await call<Row>(getOpportunity, { id: OPP }, REP);
    expect(o).toMatchObject({
      bid_name: null,
      bid_status: null,
      bid_grand_total: null,
      bid_submitted_at: null,
    });
  });
  it("listBids attaches the opportunity's title for 'From opportunity: …'", async () => {
    setup({ bid: { opportunity_id: OPP } });
    const rows = await call<Row[]>(listBids, {}, EST);
    expect(rows.find((r) => r["id"] === BID)!["opportunity"]).toEqual({
      id: OPP,
      title: "Reroof gym",
    });
    expect(rows.find((r) => r["id"] === BID2)!["opportunity"]).toBeNull();
  });
  it("the opportunity page: the bid card (name, status badge, total, Submitted <date>, the one-way line) and the list chip", () => {
    const page = src("src/components/opportunities-page.tsx");
    expect(page).toContain("<BidCard opp={opp} />");
    expect(page).not.toContain('Bid: {opp.bid_name ?? "open it"}');
    expect(page).toContain('data-card="bid"');
    expect(page).toContain("{BID_STATUS_LABELS[st]}");
    expect(page).toContain("{opp.bid_grand_total != null && (");
    expect(page).toContain("Submitted {when(opp.bid_submitted_at)}");
    expect(page).toContain(
      '<p className="text-xs text-muted-foreground">{BID_DRIVES_OPP_NOTE}</p>',
    );
    expect(BID_DRIVES_OPP_NOTE).toBe(
      "Won/Lost on the bid updates this opportunity; closing the opportunity leaves the bid alone.",
    );
    // The list row's chip.
    expect(page).toContain(
      '{o.bid_id && ( <Badge variant="outline" className="px-1.5 py-0 text-[11px]" data-chip="bid"> Bid: {BID_STATUS_LABELS[asBidStatus(o.bid_status)]} </Badge> )}',
    );
  });
  it("the Bids page row and the estimator say 'From opportunity: <title>', linking to /opportunities?id=…", () => {
    expect(fromOpportunityLine("Reroof gym")).toBe("From opportunity: Reroof gym");
    const bids = src("src/routes/bids.tsx");
    expect(bids).toContain(
      '{bid.opportunity?.title && ( <p className="text-xs text-muted-foreground" data-line="from-opportunity"> <Link to="/opportunities" search={{ id: bid.opportunity.id }}',
    );
    expect(bids).toContain("{fromOpportunityLine(bid.opportunity.title)}");
    const est = src("src/routes/estimate.tsx");
    expect(est).toContain("const fromOpportunityId = loadedBid?.opportunity_id ?? null;");
    expect(est).toContain('queryKey: ["opportunity", fromOpportunityId],');
    expect(est).toContain(
      '<Link to="/opportunities" search={{ id: fromOpportunity.data.id }} className="hover:underline"',
    );
    expect(est).toContain("{fromOpportunityLine(fromOpportunity.data.title)}");
  });
});

// ---------------------------------------------------------------------------------------------

describe("B. claimOpportunity starts the follow-up and keeps the date rule (owner item 7)", () => {
  it("claiming starts the claimer's timer; no 'assigned to you' notice to themselves", async () => {
    setup({ opp: { assignee_id: null } });
    const r = await call<Row>(claimOpportunity, { id: OPP }, CLAIMER);
    expect(r).toEqual({ id: OPP, assignee_id: CLAIMER, expected_close: "2026-10-20" });
    expect(oppRow()["assignee_id"]).toBe(CLAIMER);
    expect(followups()).toHaveLength(1);
    expect(followups()[0]).toMatchObject({
      kind: "opportunity",
      item_id: OPP,
      assignee_id: CLAIMER,
      created_by: CLAIMER,
    });
    expect(notified).toEqual([]);
  });
  it("a dropped day on an opportunity that already has a date: the manager rule (as saveOpportunity); nothing written", async () => {
    setup({ opp: { assignee_id: null } });
    await expect(call(claimOpportunity, { id: OPP, date: "2026-10-25" }, CLAIMER)).rejects.toThrow(
      DATE_MOVE_MANAGER_ONLY,
    );
    expect(env.writes).toEqual([]);
    expect(oppRow()["expected_close"]).toBe("2026-10-20");
    expect(oppRow()["assignee_id"]).toBeNull();
  });
  it("a manager (ticked Technician) may drop it on a day; no date keeps the date", async () => {
    setup({ opp: { assignee_id: null } });
    const mgrTech = { ...manager, technician: true, access: ["service"] };
    env.tables["profiles"] = [mgrTech, claimer, rep, estimator];
    await call(claimOpportunity, { id: OPP, date: "2026-10-25" }, MGR);
    expect(oppRow()["expected_close"]).toBe("2026-10-25");
    expect(followups()[0]).toMatchObject({ due_at: "2026-10-25T12:00:00.000Z" });
    setup({ opp: { assignee_id: null } });
    await call(claimOpportunity, { id: OPP, date: null }, CLAIMER);
    expect(oppRow()["expected_close"]).toBe("2026-10-20");
  });
  it("an undated opportunity takes the dropped day from anyone who may claim", async () => {
    setup({ opp: { assignee_id: null, expected_close: null } });
    await call(claimOpportunity, { id: OPP, date: "2026-10-25" }, CLAIMER);
    expect(oppRow()["expected_close"]).toBe("2026-10-25");
  });
  it("the Oct 8 rules stay: canClaim, no assignee yet, open", () => {
    const fn = src("src/lib/opportunities.functions.ts");
    const body = fn.slice(fn.indexOf("export const claimOpportunity"));
    expect(body).toContain("if (!canClaim(p)) throw new Error(CLAIM_NEEDS_TICK);");
    expect(body).toContain("if (cur.assignee_id) throw new Error(CLAIM_TAKEN);");
    expect(body).toContain("await syncOppFollowup(row, cur.status, context, nameOf(p));");
  });
});

describe("B. restoreOpportunity re-syncs the follow-up", () => {
  it("assigned and open: a fresh timer, and the assignee hears about it", async () => {
    setup({ opp: { deleted_at: "2026-10-11T12:00:00Z" } });
    await call(restoreOpportunity, { id: OPP }, MGR);
    expect(oppRow()["deleted_at"]).toBeNull();
    expect(followups()).toHaveLength(1);
    expect(followups()[0]).toMatchObject({ kind: "opportunity", item_id: OPP, assignee_id: REP });
    expect(notified).toHaveLength(1);
    expect((notified[0] as unknown[])[0]).toEqual([REP]);
  });
  it("closed, or unassigned: no timer", async () => {
    setup({ opp: { deleted_at: "2026-10-11T12:00:00Z", status: "won" } });
    await call(restoreOpportunity, { id: OPP }, MGR);
    expect(followups()).toEqual([]);
    setup({ opp: { deleted_at: "2026-10-11T12:00:00Z", assignee_id: null } });
    await call(restoreOpportunity, { id: OPP }, MGR);
    expect(followups()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------

describe("D. the customer's Opportunities section", () => {
  it("getAccount returns the account's opportunities with the assignee's name and the bid's status, live open first, closed next, deleted last", async () => {
    setup({
      bid: { status: "submitted" },
      more: [
        opportunity({
          id: OPP2,
          title: "Old one",
          status: "lost",
          bid_id: null,
          assignee_id: null,
          updated_at: "2026-10-11T12:00:00Z",
        }),
        opportunity({
          id: "88888888-8888-4888-8888-888888888888",
          title: "Gone",
          deleted_at: "2026-10-09T12:00:00Z",
          bid_id: null,
          updated_at: "2026-10-12T12:00:00Z",
        }),
      ],
    });
    const d = await call<{ opportunities: Row[] }>(getAccount, { id: ACC }, REP);
    expect(d.opportunities.map((o) => o["title"])).toEqual(["Reroof gym", "Old one", "Gone"]);
    expect(d.opportunities[0]).toMatchObject({
      id: OPP,
      status: "open",
      assignee_name: "Rae Rep",
      expected_close: "2026-10-20",
      bid_id: BID,
      bid_status: "submitted",
    });
    expect(d.opportunities[1]).toMatchObject({ assignee_name: null, bid_status: null });
  });
  it("orderAccountOpportunities: open by newest change, then closed, then deleted", () => {
    const o = (
      id: string,
      status: string,
      updated_at: string,
      deleted_at: string | null = null,
    ) => ({
      id,
      status,
      updated_at,
      deleted_at,
    });
    expect(
      orderAccountOpportunities([
        o("won-new", "won", "2026-10-12"),
        o("open-old", "open", "2026-10-01"),
        o("deleted", "open", "2026-10-12", "2026-10-12"),
        o("quoted-new", "quoted", "2026-10-11"),
        o("lost-old", "lost", "2026-10-02"),
      ]).map((x) => x.id),
    ).toEqual(["quoted-new", "open-old", "won-new", "lost-old", "deleted"]);
  });
  it("the detail pane mounts it after Tickets for those who see the Opportunities list; rows link to /opportunities?id=…", () => {
    const page = src("src/components/customers-page.tsx");
    const tickets = page.indexOf("<TicketsSection jobs={d.jobs} />");
    const opps = page.indexOf(
      "{seesOpportunitiesList(profile) && <OpportunitiesSection opportunities={d.opportunities} />}",
    );
    const bids = page.indexOf('{can("estimate") && <BidsSection');
    expect(tickets).toBeGreaterThan(0);
    expect(opps).toBeGreaterThan(tickets);
    expect(bids).toBeGreaterThan(opps);
    expect(page).toContain(
      '<section className="space-y-3 rounded-lg border p-4" aria-label="Opportunities">',
    );
    expect(page).toContain('<Link key={o.id} to="/opportunities" search={{ id: o.id }}');
    expect(page).toContain('{showClosed ? "Hide" : "Show"} {closed.length} closed');
    expect(page).toContain("Bid: {BID_STATUS_LABELS[asBidStatus(o.bid_status)]}");
    const fn = src("src/lib/crm.functions.ts");
    expect(fn).toContain(
      'sb .from("crm_opportunities") .select("id, title, status, assignee_id, expected_close, bid_id, deleted_at, updated_at") .eq("account_id", data.id)',
    );
  });
});

// ---------------------------------------------------------------------------------------------

describe("the migration, 20261012100000_bid_drives_opportunity.sql", () => {
  const PATH = "supabase/migrations/20261012100000_bid_drives_opportunity.sql";
  const flat = flatSql(PATH);
  it("exists; adds submitted_at and status_changed_at to bids", () => {
    expect(existsSync(PATH)).toBe(true);
    expect(flat).toContain(
      "alter table public.bids add column if not exists submitted_at timestamptz, add column if not exists status_changed_at timestamptz;",
    );
  });
  it("backfills bids.opportunity_id from crm_opportunities.bid_id, clears dangling values, adds the key and an index", () => {
    expect(flat).toContain(
      "update public.bids b set opportunity_id = o.id from public.crm_opportunities o where o.bid_id = b.id and b.opportunity_id is distinct from o.id;",
    );
    expect(flat).toContain(
      "update public.bids b set opportunity_id = null where b.opportunity_id is not null and not exists (select 1 from public.crm_opportunities o where o.id = b.opportunity_id);",
    );
    expect(flat).toContain(
      "alter table public.bids add constraint bids_opportunity_id_fkey foreign key (opportunity_id) references public.crm_opportunities(id) on delete set null;",
    );
    expect(flat).toContain(
      "create index if not exists bids_opportunity_idx on public.bids (opportunity_id);",
    );
    expect(read("src/integrations/supabase/types.ts")).toContain(
      'foreignKeyName: "bids_opportunity_id_fkey";',
    );
  });
  it("the stamps trigger: status_changed_at on a change, submitted_at once, an older one kept", () => {
    expect(flat).toContain(
      "if tg_op = 'UPDATE' and new.status is distinct from old.status and new.status_changed_at is not distinct from old.status_changed_at then new.status_changed_at := now(); end if;",
    );
    expect(flat).toContain(
      "if new.status = 'submitted' and new.submitted_at is null and (tg_op = 'INSERT' or new.status is distinct from old.status) then new.submitted_at := now(); end if;",
    );
    expect(flat).toContain(
      "if tg_op = 'UPDATE' and old.submitted_at is not null and new.submitted_at is distinct from old.submitted_at then new.submitted_at := old.submitted_at; end if;",
    );
    expect(flat).toContain(
      "drop trigger if exists bids_status_stamps on public.bids; create trigger bids_status_stamps before insert or update of status, submitted_at on public.bids for each row execute function public.bids_status_stamps();",
    );
  });
  it("the mapping in SQL is the pure twin's", () => {
    expect(flat).toContain(
      "create or replace function public.opportunity_status_from_bid(p_bid_status text, p_opp_status text) returns text language sql immutable as $$ select case when p_bid_status = 'submitted' and p_opp_status in ('open', 'contacted') then 'quoted' when p_bid_status = 'won' and p_opp_status is distinct from 'won' then 'won' when p_bid_status = 'lost' and p_opp_status is distinct from 'lost' then 'lost' else null end; $$;",
    );
  });
  it("sync_opportunity_from_bid: SECURITY DEFINER, whoever may edit the bid (Estimate) or the system; finds the live opportunity by bid_id first, else bids.opportunity_id; a plain status update (no flag needed since Oct 12)", () => {
    const fn = flat.slice(
      flat.indexOf("create or replace function public.sync_opportunity_from_bid(p_bid uuid)"),
      flat.indexOf("comment on function public.sync_opportunity_from_bid(uuid)"),
    );
    expect(fn).toContain(
      "returns jsonb language plpgsql security definer set search_path = public",
    );
    expect(fn).toContain(
      "if not (public.followup_is_system() or public.has_access('estimate')) then raise exception 'Forbidden' using errcode = '42501'; end if;",
    );
    expect(fn).toContain(
      "where o.deleted_at is null and (o.bid_id = p_bid or o.id = v_bid.opportunity_id) order by (o.bid_id is not distinct from p_bid) desc, o.updated_at desc limit 1 for update;",
    );
    expect(fn).toContain("v_to := public.opportunity_status_from_bid(v_bid.status, v_opp.status);");
    expect(fn).toContain(
      "update public.crm_opportunities set status = v_to, updated_by_name = public.event_actor_name(auth.uid()) where id = v_opp.id;",
    );
    expect(fn).not.toContain("set_config");
    expect(fn).toContain(
      "return jsonb_build_object('action', 'updated', 'opportunity_id', v_opp.id, 'from', v_opp.status, 'to', v_to);",
    );
    expect(flat).toContain(
      "revoke all on function public.sync_opportunity_from_bid(uuid) from public; revoke all on function public.sync_opportunity_from_bid(uuid) from anon; grant execute on function public.sync_opportunity_from_bid(uuid) to authenticated, service_role;",
    );
    // The status log row comes from the existing trigger on update of status: it is untouched.
    expect(flat).not.toContain("crm_opportunities_log");
    expect(read("src/integrations/supabase/types.ts")).toContain(
      "sync_opportunity_from_bid: {\n        Args: { p_bid: string };\n        Returns: Json;\n      };",
    );
  });
  it("the server calls it after the bid write, in both paths, then syncs the follow-up", () => {
    const bids = src("src/lib/bids.functions.ts");
    expect(bids).toContain("if (statusChanged) await syncOpportunityFromBid(context, bid.id);");
    expect(bids).toContain(
      "if (asBidStatus(cur.status) !== data.status) await syncOpportunityFromBid(context, bid.id);",
    );
    const opps = src("src/lib/opportunities.functions.ts");
    expect(opps).toContain(
      'await ctx.supabase.rpc("sync_opportunity_from_bid", { p_bid: bidId });',
    );
    expect(opps).toContain("await syncOppFollowup(row, out.from ?? null, ctx, nameOf(p));");
    // linkBid writes the bid side.
    expect(opps).toContain(
      'await admin .from("bids") .update({ opportunity_id: data.opportunityId }) .eq("id", data.bidId);',
    );
  });
});
