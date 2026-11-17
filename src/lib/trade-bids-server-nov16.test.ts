/**
 * Trade Bids, the server side and everything that carries a bid's kind (owner, Nov 16: "fill it
 * in for painting save it, fill it in for siding save it" … "I don't want that list combined with
 * project bids, but I do want the statuses, owners page, needs attention, and margin report to
 * accurately reflect the trade bids, a saved bid should keep its own numbers").
 *
 * A trade bid is a row of `bids` with kind 'trade'; a roofing bid is kind 'roof' (a row read
 * before the column existed has no kind and is a roofing bid). The server functions run here
 * against the in-memory stand-in (src/test/fake-supabase.ts).
 *
 * One painting job runs through the tests. Every number was worked out by hand first:
 *
 *   measured: walls 3,000 sq ft, trim 400 linear ft, doors 6
 *
 *   materials
 *     wall paint   $38 a gallon, 350 sq ft a gallon, 10% waste, bought whole
 *                  3000 ÷ 350 = 8.571 → +10% = 9.429 → 10 gallons            $380.00
 *     primer       $25 a gallon, 400 sq ft a gallon → 7.5 gallons             $187.50
 *     trim paint   $45 a gallon, 200 linear ft a gallon, bought whole → 2     $90.00
 *     supplies     1 at $60                                                   $60.00
 *                                                              materials     $717.50
 *   tax 6% of materials                                                       $43.05
 *   labor
 *     roll walls   150 sq ft an hour at $28 → 20 h                           $560.00
 *     trim         40 linear ft an hour at $30 → 10 h                        $300.00
 *     doors        2 an hour at $30 → 3 h                                     $90.00
 *     set up       4 h flat at $28                                           $112.00
 *                                                       37 hours, labor    $1,062.00
 *   flat costs: lift rental                                                  $400.00
 *   cost      717.50 + 43.05 + 1,062.00 + 400.00                           $2,222.55
 *   overhead  15% of cost = 333.3825                                         $333.38
 *   price     2,222.55 × 1.15 × 1.20 = 2,222.55 × 1.38 = 3,067.119         $3,067.12
 *   profit    3,067.12 − 2,222.55 − 333.38                                   $511.19
 *
 *   The Margin report's figures (trade-bid.ts tradeFigures):
 *     revenue      price − tax = 3,067.12 − 43.05                          $3,024.07
 *     material $717.50 · labor $1,062.00 · other (flat costs) $400.00 · hours 37
 *     tax $43.05 · total $3,067.12 · materialTax $43.05 (tax PAID on materials: a cost)
 *
 *   The report's row (margin-report.ts bidToMarginIn, toMarginInvoiceRow):
 *     revenue      3,024.07 + 43.05 (the material tax counts on both sides)   $3,067.12
 *     material     717.50 + 43.05                                              $760.55
 *     cost         760.55 + 1,062.00 + 400.00                                $2,222.55
 *     margin       3,067.12 − 2,222.55 (= overhead 333.38 + profit 511.19)     $844.57
 *     margin %     844.57 ÷ 3,067.12 = 27.536…                                   27.5
 *
 * The same job with the walls measured again at 1,200 sq ft (the save-again tests):
 *
 *     wall paint   1200 ÷ 350 = 3.429 → +10% = 3.771 → 4 gallons             $152.00
 *     primer       1200 ÷ 400 = 3 gallons                                      $75.00
 *     trim paint   2 gallons $90.00 · supplies $60.00           materials     $377.00
 *   tax 6%                                                                     $22.62
 *     roll walls   1200 ÷ 150 = 8 h at $28                                    $224.00
 *     trim $300.00 · doors $90.00 · set up $112.00      25 hours, labor       $726.00
 *   flat costs                                                                $400.00
 *   cost      377.00 + 22.62 + 726.00 + 400.00                             $1,525.62
 *   price     1,525.62 × 1.38 = 2,105.3556                                 $2,105.36
 *   revenue   2,105.36 − 22.62                                             $2,082.74
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));
vi.mock("@/lib/notify.server", () => ({
  serverClient: async (fallback: unknown) => fallback,
  notify: vi.fn(async () => 0),
}));

import { canOpenPage, pageForPath } from "@/lib/access";
import {
  asBidKind,
  bidHref,
  bidKindLabel,
  bidLink,
  bidOpenWords,
  isTradeBid,
} from "@/lib/bid-kind";
import {
  BID_CUSTOMER_REQUIRED,
  BID_DUE_KEEP,
  BID_DUE_REQUIRED,
  bidDueNotice,
  bidOverdueNotice,
  bidReminderNotice,
} from "@/lib/bid-status";
import { duplicateBid, listBids, listDeletedBids } from "@/lib/bids.functions";
import {
  defaultTemplates,
  missingDefaultTemplates,
  TRADE_PROPOSAL_TEMPLATE,
} from "@/lib/documents/defaults";
import { richToText, type RichDoc } from "@/lib/documents/model";
import { backTo, bidFromSavedState } from "@/lib/documents/server-pure";
import {
  resolveVariables,
  variableDefs,
  variableLabel,
  type DocumentSource,
} from "@/lib/documents/variables";
import { hitRoute } from "@/lib/global-search";
import {
  bidToMarginIn,
  toMarginInvoiceRow,
  type MarginBidIn,
  type MarginReportResult,
} from "@/lib/margin-report";
import { listMarginReport } from "@/lib/margin-report.functions";
import { bidItem } from "@/lib/my-work";
import { ATTENTION_DEFAULTS, attentionList, type AttBid } from "@/lib/owner-attention";
import { emptySetup, type TradeBidData, type TradeSetup } from "@/lib/trade-bid";
import { parseTradeBidsSearch, tradeBidHref, tradeBidsView } from "@/lib/trade-bids-search";
import {
  deleteTradeType,
  getTradeBid,
  getTradeType,
  listTradeBids,
  listTradeTypes,
  NOT_A_TRADE_BID,
  saveTradeBid,
  saveTradeBidSchema,
  saveTradeBidWith,
  saveTradeType,
  TRADE_SETUP_IS_MANAGERS,
  type TradeBid,
  type TradeBidListRow,
  type TradeType,
  type TradeTypeRow,
} from "@/lib/trade-bids.functions";
import { buildChain, type ChainBid } from "@/lib/work-chain";
import { fakeSupabase } from "@/test/fake-supabase";
import { readGeneratedTypes, typesBlock, typesInclude } from "@/test/generated-types";

type Row = Record<string, unknown>;
type Env = ReturnType<typeof fakeSupabase>;

const read = (p: string) => readFileSync(p, "utf8");
/** A source file with its whitespace collapsed, so a pin does not depend on line breaks. */
const flat = (p: string) => read(p).replace(/\s+/g, " ");
/** A migration with its `--` comments taken out first: a comment cannot satisfy a pin. */
const flatSql = (p: string) =>
  read(p)
    .replace(/--[^\n]*/g, "")
    .replace(/\s+/g, " ");

const ADMIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MGR = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const EST = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"; // a plain user who bids (role "user")
const STRANGER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"; // no profile row at all
const PAINT = "11111111-1111-4111-8111-111111111111";
const SIDING = "22222222-2222-4222-8222-222222222222";
const GONE = "33333333-3333-4333-8333-333333333333"; // a trade that was deleted
const ACC = "44444444-4444-4444-8444-444444444444";
const TBID = "55555555-5555-4555-8555-555555555555"; // a trade bid
const RBID = "66666666-6666-4666-8666-666666666666"; // a roofing bid, kind 'roof'
const OLDBID = "77777777-7777-4777-8777-777777777777"; // a roofing bid read without a kind
const NOBODY = "99999999-9999-4999-8999-999999999999";

const material = (
  id: string,
  over: Partial<TradeSetup["materials"][number]>,
): TradeSetup["materials"][number] => ({
  id,
  name: id,
  unit: "gallon",
  cost: null,
  basis: "measure",
  measure_id: null,
  coverage: null,
  waste_pct: null,
  whole: false,
  qty: null,
  ...over,
});
const labor = (
  id: string,
  over: Partial<TradeSetup["labor"][number]>,
): TradeSetup["labor"][number] => ({
  id,
  name: id,
  basis: "measure",
  measure_id: null,
  per_hour: null,
  hours: null,
  rate: null,
  ...over,
});

const painting = (): TradeSetup => ({
  measures: [
    { id: "walls", name: "Walls", unit: "sq ft" },
    { id: "trim", name: "Trim", unit: "linear ft" },
    { id: "doors", name: "Doors", unit: "each" },
  ],
  materials: [
    material("Wall paint", {
      cost: 38,
      measure_id: "walls",
      coverage: 350,
      waste_pct: 10,
      whole: true,
    }),
    material("Primer", { cost: 25, measure_id: "walls", coverage: 400 }),
    material("Trim paint", { cost: 45, measure_id: "trim", coverage: 200, whole: true }),
    material("Supplies", { unit: "each", cost: 60, basis: "flat", qty: 1 }),
  ],
  labor: [
    labor("Roll walls", { measure_id: "walls", per_hour: 150, rate: 28 }),
    labor("Trim", { measure_id: "trim", per_hour: 40, rate: 30 }),
    labor("Doors", { measure_id: "doors", per_hour: 2, rate: 30 }),
    labor("Set up and clean up", { basis: "flat", hours: 4, rate: 28 }),
  ],
  fixed: [{ id: "lift", name: "Lift rental", cost: 400 }],
  overhead_pct: 15,
  profit_pct: 20,
  tax_pct: 6,
  crew_size: 2,
  hours_per_day: 8,
});
const JOB = { walls: 3000, trim: 400, doors: 6 };
const SMALLER_JOB = { walls: 1200, trim: 400, doors: 6 };

const SCOPE = "Prepare and paint the storefront walls and trim, two coats.";

const tradeData = (over: Partial<TradeBidData> = {}): TradeBidData => ({
  kind: "trade",
  v: 1,
  trade_type_id: PAINT,
  trade_name: "Painting",
  setup: painting(),
  quantities: { ...JOB },
  scope: SCOPE,
  customer: { name: "Acme Hardware", contact: "", projectAddress: "12 Main St", notes: "" },
  ...over,
});

/** The figures of the painting job, from the sums at the top of the file. */
const FIGURES = {
  v: 1,
  revenue: 3024.07,
  material: 717.5,
  labor: 1062,
  other: 400,
  hours: 37,
  tax: 43.05,
  total: 3067.12,
  materialTax: 43.05,
};
/** The figures with the walls at 1,200 sq ft. */
const SMALLER_FIGURES = {
  v: 1,
  revenue: 2082.74,
  material: 377,
  labor: 726,
  other: 400,
  hours: 25,
  tax: 22.62,
  total: 2105.36,
  materialTax: 22.62,
};

const SAVED = "2026-11-10T15:00:00.000Z";

const paintingType = (over: Row = {}): Row => ({
  id: PAINT,
  name: "Painting",
  setup: painting(),
  created_by: ADMIN,
  created_at: "2026-11-01T12:00:00.000Z",
  updated_at: SAVED,
  updated_by_name: "Dana Reed",
  ...over,
});
const sidingType = (over: Row = {}): Row => ({
  id: SIDING,
  name: "Siding",
  // Nothing set up yet (the column's default): read back as an empty setup.
  setup: {},
  created_by: ADMIN,
  created_at: "2026-11-02T12:00:00.000Z",
  updated_at: "2026-11-02T12:00:00.000Z",
  updated_by_name: null,
  ...over,
});

/** A saved trade bid as the table holds it. */
const tradeBidRow = (over: Row = {}): Row => ({
  id: TBID,
  kind: "trade",
  trade_type_id: PAINT,
  name: "Acme Hardware repaint",
  status: "draft",
  due_date: "2026-12-01",
  lost_reason: null,
  account_id: ACC,
  site_id: null,
  building_id: null,
  roof_id: null,
  folder: null,
  from_job_id: null,
  opportunity_id: null,
  takeoff_id: null,
  data: tradeData(),
  grand_total: 3067.12,
  figures: { ...FIGURES },
  created_by: EST,
  created_at: "2026-11-09T15:00:00.000Z",
  updated_at: SAVED,
  content_saved_at: SAVED,
  updated_by_name: "Lee Marsh",
  deleted_at: null,
  ...over,
});
/** A roofing bid as the table holds it (`kind` left off = a row read before the column). */
const roofBidRow = (id: string, over: Row = {}): Row => ({
  id,
  name: "Acme Hardware reroof",
  status: "draft",
  due_date: "2026-12-05",
  lost_reason: null,
  account_id: ACC,
  site_id: null,
  building_id: null,
  roof_id: null,
  folder: null,
  from_job_id: null,
  opportunity_id: null,
  takeoff_id: null,
  data: { roofSystem: "Duro-Last", sections: [], customer: { name: "Acme Hardware" } },
  grand_total: 52000,
  created_by: EST,
  created_at: "2026-11-08T15:00:00.000Z",
  updated_at: "2026-11-08T15:00:00.000Z",
  content_saved_at: "2026-11-08T15:00:00.000Z",
  updated_by_name: "Lee Marsh",
  deleted_at: null,
  ...over,
});

const world = (over: Record<string, Row[]> = {}): Env =>
  fakeSupabase({
    profiles: [
      { id: ADMIN, role: "admin", full_name: "Dana Reed" },
      { id: MGR, role: "manager", full_name: "Lee Marsh" },
      { id: EST, role: "user", full_name: "Sam Ortiz" },
    ],
    trade_types: [paintingType(), sidingType()],
    crm_accounts: [{ id: ACC, name: "Acme Hardware" }],
    bids: [],
    ...over,
  });

/** Async, so what the validator throws (it runs before the handler) is a rejection too. */
const call = async <T>(fn: unknown, data: unknown, env: Env, userId: string = EST): Promise<T> =>
  (fn as (a: { data: unknown; context: unknown }) => Promise<T>)({
    data,
    context: { supabase: env.db, userId },
  });

const bidsOf = (env: Env): Row[] => env.tables["bids"]!;
const tradesOf = (env: Env): Row[] => env.tables["trade_types"]!;

// ── 1. Which kind a bid is, and where it opens ─────────────────────────────────────────────────

describe("bid-kind.ts: which kind a bid is and where it opens", () => {
  it("asBidKind: only 'trade' is a trade bid; everything else is a roofing bid", () => {
    expect(asBidKind("trade")).toBe("trade");
    expect(asBidKind("roof")).toBe("roof");
    expect(asBidKind(null)).toBe("roof");
    expect(asBidKind(undefined)).toBe("roof");
    for (const junk of ["", "Trade", "TRADE", " trade", "painting", 1, true, {}, ["trade"]])
      expect(asBidKind(junk)).toBe("roof");
  });

  it("isTradeBid reads the row's kind; a row with no kind is a roofing bid", () => {
    expect(isTradeBid({ kind: "trade" })).toBe(true);
    expect(isTradeBid({ kind: "roof" })).toBe(false);
    expect(isTradeBid({ kind: null })).toBe(false);
    expect(isTradeBid({})).toBe(false);
    expect(isTradeBid({ kind: "siding" })).toBe(false);
  });

  it("bidHref: a trade bid opens on Trade Bids, a roofing bid in the estimator", () => {
    expect(bidHref({ id: TBID, kind: "trade" })).toBe(`/trade-bids?bid=${TBID}`);
    expect(bidHref({ id: RBID, kind: "roof" })).toBe(`/estimate?bid=${RBID}`);
    expect(bidHref({ id: OLDBID })).toBe(`/estimate?bid=${OLDBID}`);
    expect(bidHref({ id: OLDBID, kind: null })).toBe(`/estimate?bid=${OLDBID}`);
  });

  it("bidLink: the same address for the router", () => {
    expect(bidLink({ id: TBID, kind: "trade" })).toEqual({
      to: "/trade-bids",
      search: { bid: TBID },
    });
    expect(bidLink({ id: RBID, kind: "roof" })).toEqual({ to: "/estimate", search: { bid: RBID } });
    expect(bidLink({ id: OLDBID })).toEqual({ to: "/estimate", search: { bid: OLDBID } });
    expect(bidLink({ id: OLDBID, kind: undefined })).toEqual({
      to: "/estimate",
      search: { bid: OLDBID },
    });
  });

  it("bidKindLabel: what a list calls the bid", () => {
    expect(bidKindLabel("trade")).toBe("Trade Bid");
    expect(bidKindLabel("roof")).toBe("Project Bid");
    expect(bidKindLabel(null)).toBe("Project Bid");
    expect(bidKindLabel(undefined)).toBe("Project Bid");
  });

  it("bidOpenWords: a trade bid has no estimator to open", () => {
    expect(bidOpenWords("trade")).toBe("Open the bid");
    expect(bidOpenWords("roof")).toBe("Open the estimator");
    expect(bidOpenWords(null)).toBe("Open the estimator");
    expect(bidOpenWords(undefined)).toBe("Open the estimator");
  });
});

// ── 2. /trade-bids' address ────────────────────────────────────────────────────────────────────

describe("trade-bids-search.ts: what /trade-bids opens", () => {
  it("nothing: the list", () => {
    expect(parseTradeBidsSearch({})).toEqual({});
    expect(tradeBidsView({})).toEqual({ view: "list" });
  });

  it("?bid=<id>: that trade bid", () => {
    expect(parseTradeBidsSearch({ bid: TBID })).toEqual({ bid: TBID });
    expect(tradeBidsView({ bid: TBID })).toEqual({ view: "bid", bidId: TBID });
  });

  it("?new=<trade id>: a new bid of that trade", () => {
    expect(parseTradeBidsSearch({ new: PAINT })).toEqual({ new: PAINT });
    expect(tradeBidsView({ new: PAINT })).toEqual({ view: "new-bid", tradeTypeId: PAINT });
  });

  it("?trade=new sets up a new trade; ?trade=<id> changes that one", () => {
    expect(parseTradeBidsSearch({ trade: "new" })).toEqual({ trade: "new" });
    expect(tradeBidsView({ trade: "new" })).toEqual({ view: "trade", tradeTypeId: null });
    expect(parseTradeBidsSearch({ trade: SIDING })).toEqual({ trade: SIDING });
    expect(tradeBidsView({ trade: SIDING })).toEqual({ view: "trade", tradeTypeId: SIDING });
  });

  it("one at a time: a bid wins over a new bid, which wins over a trade", () => {
    expect(parseTradeBidsSearch({ bid: TBID, new: PAINT, trade: "new" })).toEqual({ bid: TBID });
    expect(parseTradeBidsSearch({ new: PAINT, trade: SIDING })).toEqual({ new: PAINT });
    expect(tradeBidsView({ bid: TBID, new: PAINT, trade: "new" })).toEqual({
      view: "bid",
      bidId: TBID,
    });
    expect(tradeBidsView({ new: PAINT, trade: SIDING })).toEqual({
      view: "new-bid",
      tradeTypeId: PAINT,
    });
  });

  it("junk is the list, never an error page; a junk bid lets a good one behind it through", () => {
    for (const junk of [
      { bid: "abc" },
      { bid: 7 },
      { bid: null },
      { bid: [TBID] },
      { new: "new" },
      { new: `${PAINT}x` },
      { trade: "old" },
      { trade: "" },
      { trade: 5 },
      { other: TBID },
    ]) {
      expect(parseTradeBidsSearch(junk)).toEqual({});
      expect(tradeBidsView(parseTradeBidsSearch(junk))).toEqual({ view: "list" });
    }
    expect(parseTradeBidsSearch({ bid: "junk", new: PAINT })).toEqual({ new: PAINT });
    expect(parseTradeBidsSearch({ bid: "junk", new: "junk", trade: "new" })).toEqual({
      trade: "new",
    });
  });

  it("tradeBidHref is the address bid-kind.ts gives a trade bid", () => {
    expect(tradeBidHref(TBID)).toBe(`/trade-bids?bid=${TBID}`);
    expect(tradeBidHref(TBID)).toBe(bidHref({ id: TBID, kind: "trade" }));
  });
});

// ── 3. Who may open the page ───────────────────────────────────────────────────────────────────

describe("access.ts: Trade Bids is a bidding page (Estimate access)", () => {
  it("pageForPath: /trade-bids and everything under it is 'estimate'", () => {
    expect(pageForPath("/trade-bids")).toBe("estimate");
    expect(pageForPath(`/trade-bids?bid=${TBID}`)).toBe("estimate");
    expect(pageForPath("/trade-bids?trade=new")).toBe("estimate");
    // The same page as Project Bids.
    expect(pageForPath("/trade-bids")).toBe(pageForPath("/bids"));
  });

  it("an estimator may open it; an office user without Estimate may not; an admin may", () => {
    const page = pageForPath("/trade-bids")!;
    expect(canOpenPage({ role: "user", access: ["estimate"], technician: false }, page)).toBe(true);
    expect(
      canOpenPage({ role: "user", access: ["customers", "service"], technician: false }, page),
    ).toBe(false);
    expect(canOpenPage({ role: "admin", access: [], technician: false }, page)).toBe(true);
  });
});

// ── 4. The trades ──────────────────────────────────────────────────────────────────────────────

describe("the trades (trade_types): anyone who bids reads, an admin or a manager sets up", () => {
  it("listTradeTypes: one row a trade with how much is set up, and never the setup itself", async () => {
    const env = world();
    const rows = await call<TradeTypeRow[]>(listTradeTypes, undefined, env, EST);
    // Painting: 3 measures, 4 materials, 4 labor lines. Siding: nothing set up yet.
    expect(rows).toEqual([
      {
        id: PAINT,
        name: "Painting",
        updated_at: SAVED,
        updated_by_name: "Dana Reed",
        measures: 3,
        materials: 4,
        labor: 4,
      },
      {
        id: SIDING,
        name: "Siding",
        updated_at: "2026-11-02T12:00:00.000Z",
        updated_by_name: null,
        measures: 0,
        materials: 0,
        labor: 0,
      },
    ]);
    expect(env.writes).toEqual([]);
  });

  it("listTradeTypes asks the database for them A to Z (the stand-in does not sort)", () => {
    const fns = flat("src/lib/trade-bids.functions.ts");
    expect(fns).toContain(
      '.from("trade_types") .select("id, name, setup, updated_at, updated_by_name") .order("name")',
    );
  });

  it("getTradeType: the trade with its setup, for anyone who bids", async () => {
    const env = world();
    expect(await call<TradeType>(getTradeType, { id: PAINT }, env, EST)).toEqual({
      id: PAINT,
      name: "Painting",
      setup: painting(),
      updated_at: SAVED,
    });
  });

  it("getTradeType: a setup that cannot be read is an empty setup; a missing trade says so", async () => {
    const env = world();
    expect((await call<TradeType>(getTradeType, { id: SIDING }, env)).setup).toEqual(emptySetup());
    await expect(call(getTradeType, { id: GONE }, env)).rejects.toThrow(
      "That trade was not found. It may have been deleted.",
    );
    await expect(call(getTradeType, { id: "painting" }, env)).rejects.toThrow();
  });

  it("the refusal is in plain words", () => {
    expect(TRADE_SETUP_IS_MANAGERS).toBe("Only an admin or a manager sets up a trade");
  });

  it("saveTradeType: a plain user is refused and nothing is written", async () => {
    const env = world();
    await expect(
      call(saveTradeType, { name: "Gutters", setup: emptySetup() }, env, EST),
    ).rejects.toThrow(TRADE_SETUP_IS_MANAGERS);
    // Changing an existing one is refused the same way.
    await expect(
      call(saveTradeType, { id: PAINT, name: "Painting", setup: emptySetup() }, env, EST),
    ).rejects.toThrow(TRADE_SETUP_IS_MANAGERS);
    // So is someone with no profile at all.
    await expect(
      call(saveTradeType, { name: "Gutters", setup: emptySetup() }, env, STRANGER),
    ).rejects.toThrow(TRADE_SETUP_IS_MANAGERS);
    expect(env.writes).toEqual([]);
    expect(tradesOf(env)).toHaveLength(2);
  });

  it("saveTradeType: an admin adds a trade (the name trimmed, who saved it stamped)", async () => {
    const env = world();
    const made = await call<TradeType>(
      saveTradeType,
      { name: "  Gutters ", setup: painting() },
      env,
      ADMIN,
    );
    expect(made.name).toBe("Gutters");
    expect(made.setup).toEqual(painting());
    expect(tradesOf(env)).toHaveLength(3);
    expect(tradesOf(env)[2]).toMatchObject({
      id: made.id,
      name: "Gutters",
      setup: painting(),
      created_by: ADMIN,
      updated_by_name: "Dana Reed",
    });
  });

  it("saveTradeType: a manager adds one too", async () => {
    const env = world();
    const made = await call<TradeType>(
      saveTradeType,
      { name: "Gutters", setup: emptySetup() },
      env,
      MGR,
    );
    expect(made.name).toBe("Gutters");
    expect(tradesOf(env)[2]).toMatchObject({ created_by: MGR, updated_by_name: "Lee Marsh" });
  });

  it("saveTradeType: a name is required", async () => {
    const env = world();
    await expect(
      call(saveTradeType, { name: "   ", setup: emptySetup() }, env, ADMIN),
    ).rejects.toThrow(/Give the trade a name/);
    expect(env.writes).toEqual([]);
  });

  it("saveTradeType: one Painting, whatever the capitals or the spaces typed around it", async () => {
    const env = world();
    for (const name of ["Painting", "painting", "  PAINTING  "])
      await expect(call(saveTradeType, { name, setup: emptySetup() }, env, ADMIN)).rejects.toThrow(
        "There is already a trade called Painting",
      );
    // Renaming Siding to it is the same clash.
    await expect(
      call(saveTradeType, { id: SIDING, name: "painting", setup: emptySetup() }, env, MGR),
    ).rejects.toThrow("There is already a trade called Painting");
    expect(env.writes).toEqual([]);
  });

  it("saveTradeType: a trade does not clash with itself (saving it again, a change of capitals)", async () => {
    const env = world();
    const saved = await call<TradeType>(
      saveTradeType,
      { id: PAINT, name: "PAINTING", setup: painting() },
      env,
      ADMIN,
    );
    expect(saved).toMatchObject({ id: PAINT, name: "PAINTING" });
    expect(tradesOf(env)).toHaveLength(2);
    expect(tradesOf(env)[0]!["name"]).toBe("PAINTING");
  });

  it("saveTradeType: changing a trade writes the trade and no bid (a bid keeps its own copy)", async () => {
    const env = world({ bids: [tradeBidRow()] });
    const dearer = painting();
    dearer.materials[0]!.cost = 55;
    const saved = await call<TradeType>(
      saveTradeType,
      { id: PAINT, name: "Painting", setup: dearer, expectUpdatedAt: SAVED },
      env,
      MGR,
    );
    expect(saved.setup.materials[0]!.cost).toBe(55);
    expect(saved.updated_at).not.toBe(SAVED);
    expect(tradesOf(env)[0]).toMatchObject({ updated_by_name: "Lee Marsh" });
    expect(env.writes.map((w) => `${w.op} ${w.table}`)).toEqual(["update trade_types"]);
    // The bid started from Painting still has the $38 paint and its own price.
    const bid = bidsOf(env)[0]!;
    expect((bid["data"] as TradeBidData).setup.materials[0]!.cost).toBe(38);
    expect(bid["grand_total"]).toBe(3067.12);
  });

  it("saveTradeType: a copy older than the last save is refused; the current copy saves", async () => {
    const env = world();
    // Loaded an hour before someone else's save at 15:00.
    await expect(
      call(
        saveTradeType,
        {
          id: PAINT,
          name: "Painting",
          setup: emptySetup(),
          expectUpdatedAt: "2026-11-10T14:00:00.000Z",
        },
        env,
        ADMIN,
      ),
    ).rejects.toThrow(
      "Not saved: someone else changed this trade while you had it open. Reload to see their changes.",
    );
    expect(env.writes).toEqual([]);
    expect(tradesOf(env)[0]!["setup"]).toEqual(painting());
    // The copy as it was last saved.
    await call(
      saveTradeType,
      { id: PAINT, name: "Painting", setup: emptySetup(), expectUpdatedAt: SAVED },
      env,
      ADMIN,
    );
    expect(tradesOf(env)[0]!["setup"]).toEqual(emptySetup());
  });

  it("saveTradeType: changing a trade that was deleted says so", async () => {
    const env = world();
    await expect(
      call(saveTradeType, { id: GONE, name: "Gutters", setup: emptySetup() }, env, ADMIN),
    ).rejects.toThrow("That trade was not found. It may have been deleted.");
    expect(env.writes).toEqual([]);
  });

  it("deleteTradeType: a plain user is refused and the trade stays", async () => {
    const env = world();
    await expect(call(deleteTradeType, { id: PAINT }, env, EST)).rejects.toThrow(
      TRADE_SETUP_IS_MANAGERS,
    );
    expect(env.writes).toEqual([]);
    expect(tradesOf(env).map((t) => t["id"])).toEqual([PAINT, SIDING]);
  });

  it("deleteTradeType: an admin or a manager deletes it; its bids are not touched", async () => {
    const env = world({ bids: [tradeBidRow()] });
    expect(await call(deleteTradeType, { id: PAINT }, env, MGR)).toEqual({ ok: true });
    expect(tradesOf(env).map((t) => t["id"])).toEqual([SIDING]);
    expect(await call(deleteTradeType, { id: SIDING }, env, ADMIN)).toEqual({ ok: true });
    expect(tradesOf(env)).toEqual([]);
    expect(env.writes.map((w) => `${w.op} ${w.table}`)).toEqual([
      "delete trade_types",
      "delete trade_types",
    ]);
    // The bid is whole: its own setup still prices it.
    expect(bidsOf(env)).toHaveLength(1);
    expect((bidsOf(env)[0]!["data"] as TradeBidData).setup).toEqual(painting());
  });
});

// ── 5. Saving, opening and listing a trade bid ─────────────────────────────────────────────────

describe("saveTradeBid, a new bid: priced on the server from its own numbers", () => {
  const input = (over: Row = {}): Row => ({
    name: "Acme Hardware repaint",
    data: tradeData(),
    accountId: ACC,
    dueDate: "2026-12-01",
    ...over,
  });

  it("stores the price and the Margin report's figures worked out from the setup and quantities", async () => {
    const env = world();
    const bid = await call<TradeBid>(saveTradeBid, input(), env, EST);
    expect(bidsOf(env)).toHaveLength(1);
    const row = bidsOf(env)[0]!;
    expect(row["grand_total"]).toBe(3067.12);
    expect(row["figures"]).toEqual(FIGURES);
    // What comes back is the row as saved.
    expect(bid.grand_total).toBe(3067.12);
    expect(bid.data).toEqual(tradeData());
    expect(bid.name).toBe("Acme Hardware repaint");
  });

  // Nov 17, subcontractor lines (the sum is worked by hand in trade-subs-nov17.test.ts): what
  // the subs are paid and a line's own markup are priced on the server like everything else.
  //   own costs 2,222.55; pressure washing 3,000 sq ft x $0.20 = 600.00 with its own 10% = 60.00;
  //   scaffolding crew quoted 1,500.00 with none; cost 4,322.55; overhead and profit worked on
  //   3,722.55 make 5,137.12 of it; price 5,137.12 + 600.00 + 60.00 = 5,797.12.
  it("a bid with subcontractor lines: the price and the figures hold what the subs are paid", async () => {
    const env = world();
    const data = tradeData();
    const withSubs: TradeBidData = {
      ...data,
      setup: {
        ...data.setup,
        subs: [
          {
            id: "wash",
            name: "Pressure washing",
            vendor_id: null,
            vendor_name: "Clean Walls LLC",
            basis: "measure",
            measure_id: "walls",
            rate: 0.2,
            amount: null,
            markup_pct: 10,
          },
          {
            id: "scaffold",
            name: "Scaffolding crew",
            vendor_id: null,
            vendor_name: "",
            basis: "flat",
            measure_id: null,
            rate: null,
            amount: 1500,
            markup_pct: null,
          },
        ],
      },
    };
    const bid = await call<TradeBid>(saveTradeBid, input({ data: withSubs }), env, EST);
    const row = bidsOf(env)[0]!;
    expect(row["grand_total"]).toBe(5797.12);
    // The subs sit with the flat costs: lift 400 + subs 2,100 = 2,500. No tax and no hours for
    // them: tax stays 6% of the materials, hours stay the crew's 37.
    expect(row["figures"]).toEqual({
      ...FIGURES,
      other: 2500,
      total: 5797.12,
      // price less the tax paid on materials: 5,797.12 - 43.05
      revenue: 5754.07,
    });
    // The lines are saved with the bid, as its own.
    expect(bid.data.setup.subs).toEqual(withSubs.setup.subs);
  });

  it("is a draft trade bid of its trade, the caller's, linked to the customer", async () => {
    const env = world();
    await call<TradeBid>(saveTradeBid, input(), env, EST);
    const row = bidsOf(env)[0]!;
    expect(row).toMatchObject({
      kind: "trade",
      trade_type_id: PAINT,
      status: "draft",
      created_by: EST,
      account_id: ACC,
      due_date: "2026-12-01",
      updated_by_name: "Sam Ortiz",
    });
    // A save of the bid's contents: the stale-copy rule's stamp is set with it.
    expect(row["content_saved_at"]).toBe(row["updated_at"]);
    expect(env.writes.map((w) => `${w.op} ${w.table}`)).toEqual(["insert bids"]);
  });

  it("ignores any price the caller sends: beside the bid, inside its data, or as figures", async () => {
    const env = world();
    const bid = await call<TradeBid>(
      saveTradeBid,
      input({
        grand_total: 1,
        price: 1,
        total: 1,
        figures: { ...FIGURES, revenue: 1, total: 1 },
        status: "won",
        kind: "roof",
        data: { ...tradeData(), price: 1, grand_total: 1, figures: { total: 1 } },
      }),
      env,
      EST,
    );
    const row = bidsOf(env)[0]!;
    expect(row["grand_total"]).toBe(3067.12);
    expect(row["figures"]).toEqual(FIGURES);
    expect(row["status"]).toBe("draft");
    expect(row["kind"]).toBe("trade");
    expect(row).not.toHaveProperty("price");
    expect(row).not.toHaveProperty("total");
    // The stored data is the bid's own numbers and nothing else.
    expect(row["data"]).toEqual(tradeData());
    expect(bid.grand_total).toBe(3067.12);
  });

  it("the plain function prices it the same way (saveTradeBidWith)", async () => {
    const env = world();
    const bid = await saveTradeBidWith(
      env.db,
      EST,
      // Checked as the server function checks it before it calls this.
      saveTradeBidSchema.parse({
        name: "Acme Hardware repaint",
        data: tradeData({ quantities: { ...SMALLER_JOB } }),
        accountId: ACC,
        dueDate: "2026-12-01",
      }),
    );
    expect(bid.grand_total).toBe(2105.36);
    expect(bidsOf(env)[0]!["figures"]).toEqual(SMALLER_FIGURES);
  });

  it("a customer is required: no link, or a link taken off, is refused and nothing is written", async () => {
    const env = world();
    const { accountId: _linked, ...unlinked } = input();
    // The name typed on the bid is not enough: a bid is linked to a customer profile.
    await expect(call(saveTradeBid, unlinked, env)).rejects.toThrow(BID_CUSTOMER_REQUIRED);
    await expect(call(saveTradeBid, input({ accountId: null }), env)).rejects.toThrow(
      BID_CUSTOMER_REQUIRED,
    );
    expect(env.writes).toEqual([]);
    expect(bidsOf(env)).toEqual([]);
  });

  it("a due date is required on a new bid", async () => {
    const env = world();
    const { dueDate: _day, ...undated } = input();
    await expect(call(saveTradeBid, undated, env)).rejects.toThrow(BID_DUE_REQUIRED);
    await expect(call(saveTradeBid, input({ dueDate: null }), env)).rejects.toThrow(
      BID_DUE_REQUIRED,
    );
    await expect(call(saveTradeBid, input({ dueDate: "12/01/2026" }), env)).rejects.toThrow(
      /The bid due date must be a day \(YYYY-MM-DD\)/,
    );
    expect(env.writes).toEqual([]);
  });

  it("an untitled bid is named after its customer", async () => {
    const env = world();
    const blank = await call<TradeBid>(saveTradeBid, input({ name: "" }), env);
    expect(blank.name).toBe("Acme Hardware");
    // The placeholder is untitled too; that name is taken now, so the next one is numbered.
    const second = await call<TradeBid>(saveTradeBid, input({ name: "Untitled bid" }), env);
    expect(second.name).toBe("Acme Hardware (1)");
    expect(bidsOf(env).map((b) => b["name"])).toEqual(["Acme Hardware", "Acme Hardware (1)"]);
  });

  it("a name that was typed is kept, trimmed", async () => {
    const env = world();
    const bid = await call<TradeBid>(saveTradeBid, input({ name: "  Storefront repaint " }), env);
    expect(bid.name).toBe("Storefront repaint");
  });

  it("a bid of a trade that was deleted is still a trade bid; the pointer is left off", async () => {
    const env = world();
    await call<TradeBid>(
      saveTradeBid,
      input({ data: tradeData({ trade_type_id: GONE, trade_name: "Gutters" }) }),
      env,
    );
    const row = bidsOf(env)[0]!;
    expect(row["kind"]).toBe("trade");
    expect(row["trade_type_id"]).toBeNull();
    // Its own copy still says what it was and prices it.
    expect((row["data"] as TradeBidData).trade_name).toBe("Gutters");
    expect(row["grand_total"]).toBe(3067.12);
  });

  it("what is sent must be a trade bid's data", async () => {
    const env = world();
    await expect(
      call(saveTradeBid, input({ data: { roofSystem: "Duro-Last", sections: [] } }), env),
    ).rejects.toThrow();
    await expect(
      call(saveTradeBid, input({ data: { ...tradeData(), kind: "roof" } }), env),
    ).rejects.toThrow();
    expect(env.writes).toEqual([]);
  });
});

describe("saveTradeBid, saving again", () => {
  const again = (over: Row = {}): Row => ({
    id: TBID,
    name: "Acme Hardware repaint",
    data: tradeData({ quantities: { ...SMALLER_JOB } }),
    expectUpdatedAt: SAVED,
    ...over,
  });

  it("the price and the figures follow the new quantities", async () => {
    const env = world({ bids: [tradeBidRow()] });
    const bid = await call<TradeBid>(saveTradeBid, again(), env, EST);
    expect(bid.grand_total).toBe(2105.36);
    const row = bidsOf(env)[0]!;
    expect(row["grand_total"]).toBe(2105.36);
    expect(row["figures"]).toEqual(SMALLER_FIGURES);
    expect(row["updated_by_name"]).toBe("Sam Ortiz");
    expect(row["updated_at"]).not.toBe(SAVED);
    expect(row["content_saved_at"]).toBe(row["updated_at"]);
    expect(bidsOf(env)).toHaveLength(1);
  });

  it("leaves alone what the save does not carry: kind, trade, status, customer, due date", async () => {
    const env = world({ bids: [tradeBidRow({ status: "submitted" })] });
    await call<TradeBid>(saveTradeBid, again({ kind: "roof", status: "won" }), env, EST);
    expect(env.writes).toHaveLength(1);
    const sent = env.writes[0]!;
    expect(`${sent.op} ${sent.table}`).toBe("update bids");
    for (const key of ["kind", "trade_type_id", "status", "account_id", "site_id", "due_date"])
      expect(sent.payload).not.toHaveProperty(key);
    expect(bidsOf(env)[0]).toMatchObject({
      kind: "trade",
      trade_type_id: PAINT,
      status: "submitted",
      account_id: ACC,
      due_date: "2026-12-01",
    });
  });

  it("a copy older than the last save is refused, naming who saved it; nothing is written", async () => {
    const env = world({ bids: [tradeBidRow()] });
    // This tab loaded the bid at 14:00; Lee saved it at 15:00.
    await expect(
      call(saveTradeBid, again({ expectUpdatedAt: "2026-11-10T14:00:00.000Z" }), env, EST),
    ).rejects.toThrow(/^Not saved: Lee Marsh saved this bid at .*after this tab opened it\./);
    expect(env.writes).toEqual([]);
    expect(bidsOf(env)[0]!["grand_total"]).toBe(3067.12);
  });

  it("a newer save of your own says it was another tab of yours", async () => {
    const env = world({ bids: [tradeBidRow({ updated_by_name: "Sam Ortiz" })] });
    await expect(
      call(saveTradeBid, again({ expectUpdatedAt: "2026-11-10T14:00:00.000Z" }), env, EST),
    ).rejects.toThrow(/^Not saved: you saved this bid from another tab at /);
    expect(env.writes).toEqual([]);
  });

  it("a status or due date change since is not a newer save of the contents", async () => {
    // Marked Submitted from the list at 16:00: updated_at moved, the contents stamp did not.
    const env = world({ bids: [tradeBidRow({ updated_at: "2026-11-10T16:00:00.000Z" })] });
    const bid = await call<TradeBid>(saveTradeBid, again(), env, EST);
    expect(bid.grand_total).toBe(2105.36);
  });

  it("a roofing bid is never saved through it", async () => {
    expect(NOT_A_TRADE_BID).toBe("That is a project bid. Open it from Project Bids.");
    const env = world({ bids: [roofBidRow(RBID, { kind: "roof" }), roofBidRow(OLDBID)] });
    await expect(call(saveTradeBid, again({ id: RBID }), env, EST)).rejects.toThrow(
      NOT_A_TRADE_BID,
    );
    // A row read without a kind is a roofing bid too.
    await expect(call(saveTradeBid, again({ id: OLDBID }), env, EST)).rejects.toThrow(
      NOT_A_TRADE_BID,
    );
    await expect(
      saveTradeBidWith(
        env.db,
        EST,
        saveTradeBidSchema.parse({ id: RBID, name: "Acme Hardware reroof", data: tradeData() }),
      ),
    ).rejects.toThrow(NOT_A_TRADE_BID);
    expect(env.writes).toEqual([]);
    expect(bidsOf(env)[0]!["grand_total"]).toBe(52000);
  });

  it("a deleted trade bid, and one that is gone, are refused", async () => {
    const env = world({ bids: [tradeBidRow({ deleted_at: "2026-11-12T15:00:00.000Z" })] });
    await expect(call(saveTradeBid, again(), env, EST)).rejects.toThrow(
      /^Not saved: this bid was deleted at /,
    );
    await expect(call(saveTradeBid, again({ id: NOBODY }), env, EST)).rejects.toThrow(
      "Not saved: this bid no longer exists.",
    );
    expect(env.writes).toEqual([]);
  });

  it("the customer cannot be taken off, nor the due date of a bid still in play", async () => {
    const env = world({ bids: [tradeBidRow()] });
    await expect(call(saveTradeBid, again({ accountId: null }), env, EST)).rejects.toThrow(
      BID_CUSTOMER_REQUIRED,
    );
    await expect(call(saveTradeBid, again({ dueDate: null }), env, EST)).rejects.toThrow(
      BID_DUE_KEEP,
    );
    expect(env.writes).toEqual([]);
    // A new day is taken.
    await call(saveTradeBid, again({ dueDate: "2026-12-15" }), env, EST);
    expect(bidsOf(env)[0]!["due_date"]).toBe("2026-12-15");
  });
});

describe("getTradeBid", () => {
  it("opens a trade bid with its own data and its price as a number", async () => {
    // `account` is seeded on the row: the stand-in does not follow an embedded resource.
    const env = world({
      bids: [tradeBidRow({ grand_total: "3067.12", account: { id: ACC, name: "Acme Hardware" } })],
    });
    const bid = await call<TradeBid>(getTradeBid, { id: TBID }, env, EST);
    expect(bid).toEqual({
      id: TBID,
      name: "Acme Hardware repaint",
      status: "draft",
      due_date: "2026-12-01",
      lost_reason: null,
      account_id: ACC,
      site_id: null,
      account: { id: ACC, name: "Acme Hardware" },
      data: tradeData(),
      grand_total: 3067.12,
      updated_at: SAVED,
      updated_by_name: "Lee Marsh",
      deleted_at: null,
    });
    expect(env.writes).toEqual([]);
  });

  it("refuses a roofing bid, with or without a kind on the row", async () => {
    const env = world({ bids: [roofBidRow(RBID, { kind: "roof" }), roofBidRow(OLDBID)] });
    await expect(call(getTradeBid, { id: RBID }, env)).rejects.toThrow(NOT_A_TRADE_BID);
    await expect(call(getTradeBid, { id: OLDBID }, env)).rejects.toThrow(NOT_A_TRADE_BID);
  });

  it("a bid that is not there, and one whose numbers cannot be read, say so", async () => {
    const env = world({ bids: [tradeBidRow({ data: { kind: "trade", v: 1 } })] });
    await expect(call(getTradeBid, { id: NOBODY }, env)).rejects.toThrow(
      "That bid was not found. It may have been deleted.",
    );
    await expect(call(getTradeBid, { id: TBID }, env)).rejects.toThrow(
      "This bid's saved numbers could not be read.",
    );
    await expect(call(getTradeBid, { id: "not-an-id" }, env)).rejects.toThrow();
  });
});

describe("listTradeBids: the Trade Bids list", () => {
  /**
   * A row as PostgREST answers the list's select (the JSON-path columns already flat). The
   * stand-in returns whole rows for a select with an embedded resource, so the flat columns
   * are seeded here and the column list itself is pinned as text below.
   */
  const listed = (id: string, over: Row = {}): Row => ({
    id,
    kind: "trade",
    name: "Acme Hardware repaint",
    status: "draft",
    grand_total: "3067.12",
    created_at: "2026-11-09T15:00:00.000Z",
    updated_at: SAVED,
    updated_by_name: "Lee Marsh",
    due_date: "2026-12-01",
    lost_reason: null,
    account_id: ACC,
    trade_type_id: PAINT,
    trade_name: " Painting ",
    estimator_name: null,
    typed_customer: " Acme Hardware ",
    hours: "37",
    account: { id: ACC, name: "Acme Hardware" },
    deleted_at: null,
    ...over,
  });

  it("only trade bids that are not deleted", async () => {
    const env = world({
      bids: [
        listed(TBID),
        listed(NOBODY, { deleted_at: "2026-11-12T15:00:00.000Z" }),
        roofBidRow(RBID, { kind: "roof" }),
        roofBidRow(OLDBID),
      ],
    });
    const rows = await call<TradeBidListRow[]>(listTradeBids, undefined, env, EST);
    expect(rows.map((r) => r.id)).toEqual([TBID]);
    expect(env.writes).toEqual([]);
  });

  it("each row: the trade, the customer, the total and the hours, tidied", async () => {
    const env = world({
      bids: [
        listed(TBID),
        listed(NOBODY, {
          trade_name: null,
          typed_customer: null,
          estimator_name: " Sam Ortiz ",
          hours: null,
          grand_total: null,
          account: null,
          account_id: null,
          trade_type_id: null,
        }),
      ],
    });
    const rows = await call<TradeBidListRow[]>(listTradeBids, undefined, env, EST);
    expect(rows[0]).toMatchObject({
      id: TBID,
      name: "Acme Hardware repaint",
      status: "draft",
      grand_total: 3067.12,
      due_date: "2026-12-01",
      updated_at: SAVED,
      updated_by_name: "Lee Marsh",
      account_id: ACC,
      account: { id: ACC, name: "Acme Hardware" },
      typed_customer: "Acme Hardware",
      estimator_name: "",
      trade_name: "Painting",
      trade_type_id: PAINT,
      hours: 37,
    });
    // Nothing known: blanks and a zero total, never undefined or NaN.
    expect(rows[1]).toMatchObject({
      grand_total: 0,
      account: null,
      typed_customer: "",
      estimator_name: "Sam Ortiz",
      trade_name: "",
      trade_type_id: null,
      hours: null,
    });
  });

  it("reads the trade, the customer and the hours off the row's own data, newest save first", () => {
    const fns = flat("src/lib/trade-bids.functions.ts");
    const columns = fns.slice(
      fns.indexOf("const LIST_COLUMNS"),
      fns.indexOf("export interface TradeBidListRow"),
    );
    for (const col of [
      "trade_type_id",
      "trade_name:data->>trade_name",
      "estimator_name:data->customer->>estimatorName",
      "typed_customer:data->customer->>name",
      "hours:figures->hours",
      "account:crm_accounts!bids_account_id_fkey(id, name)",
    ])
      expect(columns).toContain(col);
    // The whole payload never rides along with the list.
    expect(columns).not.toMatch(/[ "]data,/);
    expect(fns).toContain(
      '.select(LIST_COLUMNS) .eq("kind", "trade") .is("deleted_at", null) .order("updated_at", { ascending: false })',
    );
  });
});

// ── 6. The roofing readers leave trade bids out ────────────────────────────────────────────────

describe("Project Bids never lists a trade bid", () => {
  const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();

  it("listBids: roofing bids, a row with no kind included, and no trade bid", async () => {
    const env = world({
      bids: [
        roofBidRow(RBID, { kind: "roof" }),
        tradeBidRow(),
        roofBidRow(OLDBID),
        roofBidRow(NOBODY, { kind: "roof", deleted_at: "2026-11-12T15:00:00.000Z" }),
      ],
    });
    const rows = await call<{ id: string }[]>(listBids, undefined, env, EST);
    expect(rows.map((r) => r.id)).toEqual([RBID, OLDBID]);
    expect(env.writes).toEqual([]);
  });

  it("listDeletedBids: asked for nothing (or 'roof'), the roofing bin", async () => {
    const env = world({
      bids: [
        roofBidRow(RBID, { kind: "roof", deleted_at: daysAgo(2) }),
        roofBidRow(OLDBID, { deleted_at: daysAgo(3) }),
        tradeBidRow({ deleted_at: daysAgo(1) }),
        roofBidRow(NOBODY, { kind: "roof" }),
      ],
    });
    const ids = async (data: unknown) =>
      (await call<{ id: string }[]>(listDeletedBids, data, env)).map((r) => r.id);
    expect(await ids({})).toEqual([RBID, OLDBID]);
    expect(await ids(undefined)).toEqual([RBID, OLDBID]);
    expect(await ids({ kind: "roof" })).toEqual([RBID, OLDBID]);
    // Still inside the 30 days: nothing was purged.
    expect(env.writes).toEqual([]);
  });

  it("listDeletedBids({ kind: 'trade' }): the Trade Bids bin, deleted trade bids only", async () => {
    const env = world({
      bids: [
        roofBidRow(RBID, { kind: "roof", deleted_at: daysAgo(2) }),
        roofBidRow(OLDBID, { deleted_at: daysAgo(3) }),
        tradeBidRow({ deleted_at: daysAgo(1) }),
        tradeBidRow({ id: NOBODY }),
      ],
    });
    const rows = await call<Row[]>(listDeletedBids, { kind: "trade" }, env);
    expect(rows.map((r) => r["id"])).toEqual([TBID]);
    expect(rows[0]).toMatchObject({ name: "Acme Hardware repaint", grand_total: 3067.12 });
    await expect(call(listDeletedBids, { kind: "painting" }, env)).rejects.toThrow();
  });

  it("listDeletedBids: the purge of bids deleted over 30 days ago covers both kinds", async () => {
    const env = world({
      bids: [
        roofBidRow(RBID, { kind: "roof", deleted_at: daysAgo(40) }),
        tradeBidRow({ deleted_at: daysAgo(40) }),
        tradeBidRow({ id: NOBODY, deleted_at: daysAgo(5) }),
      ],
      documents: [],
    });
    // Project Bids opens its bin: the old trade bid goes too.
    expect(await call<Row[]>(listDeletedBids, {}, env)).toEqual([]);
    expect(bidsOf(env).map((b) => b["id"])).toEqual([NOBODY]);
  });
});

describe("duplicateBid: a copy of a trade bid is a trade bid", () => {
  it("carries the kind, the trade and its own data; the figures are worked out again", async () => {
    // The source's stored figures are wrong on purpose: the copy's come from its numbers.
    const env = world({
      bids: [tradeBidRow({ status: "submitted", figures: { ...FIGURES, revenue: 1, hours: 1 } })],
    });
    const copy = await call<Row>(duplicateBid, { id: TBID, dueDate: "2026-12-20" }, env, EST);
    expect(copy["id"]).not.toBe(TBID);
    expect(copy).toMatchObject({
      kind: "trade",
      trade_type_id: PAINT,
      name: "Acme Hardware repaint (copy)",
      status: "draft",
      due_date: "2026-12-20",
      account_id: ACC,
      grand_total: 3067.12,
      updated_by_name: "Sam Ortiz",
    });
    expect(copy["data"]).toEqual(tradeData());
    expect(copy["figures"]).toEqual(FIGURES);
    expect(bidsOf(env)).toHaveLength(2);
    // It opens where a trade bid opens.
    expect(bidHref({ id: String(copy["id"]), kind: copy["kind"] as string })).toBe(
      `/trade-bids?bid=${String(copy["id"])}`,
    );
  });

  it("a copy of a bid whose trade was deleted is still a trade bid", async () => {
    const env = world({ bids: [tradeBidRow({ trade_type_id: null })] });
    const copy = await call<Row>(
      duplicateBid,
      { id: TBID, name: "Acme Hardware back wall", dueDate: "2026-12-20" },
      env,
      EST,
    );
    expect(copy).toMatchObject({
      kind: "trade",
      trade_type_id: null,
      name: "Acme Hardware back wall",
    });
    expect(copy["figures"]).toEqual(FIGURES);
  });

  it("a copy of a roofing bid is as before: no kind sent, no figures", async () => {
    const env = world({ bids: [roofBidRow(RBID, { kind: "roof" }), roofBidRow(OLDBID)] });
    for (const id of [RBID, OLDBID]) {
      const copy = await call<Row>(duplicateBid, { id, dueDate: "2026-12-20" }, env, EST);
      // Nothing is sent, so the column's default ('roof') stands.
      expect(copy).not.toHaveProperty("kind");
      expect(copy).not.toHaveProperty("trade_type_id");
      expect(copy).not.toHaveProperty("figures");
      expect(copy["name"]).toBe("Acme Hardware reroof (copy)");
    }
  });
});

// ── 7. Links and notices: a trade bid opens on Trade Bids everywhere ───────────────────────────

describe("every link to a bid follows its kind", () => {
  const TRADE_URL = `/trade-bids?bid=${TBID}`;
  const ROOF_URL = `/estimate?bid=${RBID}`;
  const TODAY = "2026-11-16"; // a Monday

  it("the 'Bid due' notice", () => {
    const trade = { id: TBID, name: "Acme Hardware repaint", due_date: "2026-11-17" };
    expect(bidDueNotice({ ...trade, kind: "trade" }, "Acme Hardware", TODAY)).toEqual({
      kind: "bid_due",
      title: "Bid due tomorrow: Acme Hardware repaint",
      body: "Acme Hardware · due Tuesday, November 17, 2026. Open the bid to finish and submit it.",
      url: TRADE_URL,
    });
    const roof = { id: RBID, name: "Acme Hardware reroof", due_date: "2026-11-17" };
    const forRoof = bidDueNotice({ ...roof, kind: "roof" }, "Acme Hardware", TODAY);
    expect(forRoof.url).toBe(ROOF_URL);
    expect(forRoof.body).toBe(
      "Acme Hardware · due Tuesday, November 17, 2026. Open the estimator to finish and submit it.",
    );
    // A row read without a kind is a roofing bid.
    expect(bidDueNotice(roof, null, TODAY).url).toBe(ROOF_URL);
  });

  it("the 'Bid past due' notice", () => {
    // Due Friday the 13th, today Monday the 16th: 3 days.
    const trade = bidOverdueNotice(
      { id: TBID, name: "Acme Hardware repaint", due_date: "2026-11-13", kind: "trade" },
      "Acme Hardware",
      TODAY,
    );
    expect(trade).toEqual({
      kind: "bid_overdue",
      title: "Bid past due: Acme Hardware repaint",
      body: "3 days past due (due Friday, November 13, 2026) · Acme Hardware. Open the bid to submit it, or mark it won or lost.",
      url: TRADE_URL,
    });
    const roof = bidOverdueNotice(
      { id: RBID, name: "Acme Hardware reroof", due_date: "2026-11-13", kind: "roof" },
      null,
      TODAY,
    );
    expect(roof.url).toBe(ROOF_URL);
    expect(roof.body).toBe(
      "3 days past due (due Friday, November 13, 2026). Open the estimator to submit it, or mark it won or lost.",
    );
  });

  it("the estimator's own reminder", () => {
    const note = { name: "Acme Hardware repaint", reminder_note: "Call about the colors" };
    expect(bidReminderNotice({ ...note, id: TBID, kind: "trade" }, "Acme Hardware")).toEqual({
      kind: "bid_reminder",
      title: "Bid reminder: Acme Hardware repaint",
      body: "Call about the colors",
      url: TRADE_URL,
    });
    expect(bidReminderNotice({ ...note, id: RBID, kind: "roof" }, null).url).toBe(ROOF_URL);
    expect(bidReminderNotice({ ...note, id: RBID }, null).url).toBe(ROOF_URL);
  });

  it("the owner page's Needs attention rows: a late draft and a sent bid nobody followed up", () => {
    const bid = (over: Partial<AttBid> & { id: string }): AttBid => ({
      name: "Acme Hardware repaint",
      status: "draft",
      due_date: null,
      submitted_at: null,
      status_changed_at: null,
      updated_at: "2026-11-02T15:00:00Z",
      reminder_on: null,
      grand_total: 3067.12,
      created_by: EST,
      ...over,
    });
    const list = attentionList({
      today: TODAY,
      now: "2026-11-16T15:00:00Z",
      limits: { ...ATTENTION_DEFAULTS },
      tickets: [],
      untouched: [],
      opps: [],
      bids: [
        // Drafts due Friday the 13th: 3 days late on Monday the 16th.
        bid({ id: TBID, kind: "trade", due_date: "2026-11-13" }),
        bid({ id: RBID, kind: "roof", due_date: "2026-11-13" }),
        // Sent Nov 2 with no follow-up date: 14 days, past the 7-day limit.
        bid({
          id: NOBODY,
          kind: "trade",
          status: "submitted",
          submitted_at: "2026-11-02T15:00:00Z",
        }),
        bid({ id: OLDBID, status: "submitted", submitted_at: "2026-11-02T15:00:00Z" }),
      ],
      invoices: [],
      followups: [],
      repairFrom: [],
      bidFrom: [],
      names: { [EST]: "Sam Ortiz" },
    });
    const href = (key: string) => list.rows.find((r) => r.key === key)?.href;
    expect(href(`bid_draft_late:${TBID}`)).toBe(TRADE_URL);
    expect(href(`bid_draft_late:${RBID}`)).toBe(ROOF_URL);
    expect(href(`bid_sent:${NOBODY}`)).toBe(`/trade-bids?bid=${NOBODY}`);
    expect(href(`bid_sent:${OLDBID}`)).toBe(`/estimate?bid=${OLDBID}`);
    // A trade bid is counted like any bid: the same row, its own total.
    expect(list.rows.find((r) => r.key === `bid_draft_late:${TBID}`)).toMatchObject({
      tag: "Draft bid",
      who: "Sam Ortiz",
      age: 3,
      amount: 3067.12,
    });
    expect(list.rows).toHaveLength(4);
  });

  it("Work Overview's draft-bid row", () => {
    const row = { name: "Acme Hardware repaint", status: "draft", due_date: "2026-12-01" };
    expect(bidItem({ ...row, id: TBID, kind: "trade", created_by: EST })!.href).toBe(TRADE_URL);
    expect(bidItem({ ...row, id: RBID, kind: "roof", created_by: EST })!.href).toBe(ROOF_URL);
    expect(bidItem({ ...row, id: RBID, created_by: null })!.href).toBe(ROOF_URL);
  });

  it("the search box's hit", () => {
    expect(hitRoute("bid", { id: TBID, bid_kind: "trade" })).toEqual({
      to: "/trade-bids",
      search: { bid: TBID },
    });
    expect(hitRoute("bid", { id: RBID, bid_kind: "roof" })).toEqual({
      to: "/estimate",
      search: { bid: RBID },
    });
    expect(hitRoute("bid", { id: RBID })).toEqual({ to: "/estimate", search: { bid: RBID } });
    // The search reads a missing kind as "": still the estimator.
    expect(hitRoute("bid", { id: RBID, bid_kind: "" })).toEqual({
      to: "/estimate",
      search: { bid: RBID },
    });
  });

  it("the work chain's bid part carries 'trade', and nothing for a roofing bid", () => {
    const chainBid = (id: string, name: string, kind?: string): ChainBid => ({
      id,
      ...(kind ? { kind } : {}),
      name,
      status: "draft",
      deleted: false,
      opportunity_id: "opp-1",
      from_job_id: null,
    });
    const steps = buildChain(
      {
        opportunity: {
          id: "opp-1",
          title: "Acme Hardware storefront",
          status: "open",
          deleted: false,
        },
        tickets: [],
        bids: [
          chainBid(TBID, "A repaint", "trade"),
          chainBid(RBID, "B reroof", "roof"),
          chainBid(OLDBID, "C reroof"),
        ],
      },
      { kind: "opportunity", id: "opp-1" },
    );
    const parts = steps.flat().filter((p) => p.kind === "bid");
    expect(parts.map((p) => p.id)).toEqual([TBID, RBID, OLDBID]);
    expect(parts[0]!.bidKind).toBe("trade");
    expect(parts[1]).not.toHaveProperty("bidKind");
    expect(parts[2]).not.toHaveProperty("bidKind");
    // The line's link is built from the part (components/work-chain-line.tsx).
    expect(parts.map((p) => bidHref({ id: p.id, kind: p.bidKind }))).toEqual([
      TRADE_URL,
      ROOF_URL,
      `/estimate?bid=${OLDBID}`,
    ]);
    expect(flat("src/components/work-chain-line.tsx")).toContain(
      "<Link {...bidLink({ id: p.id, kind: p.bidKind })}",
    );
  });

  it("the Margin report's row: 'trade' on a trade bid, nothing on a roofing bid, the same sums", () => {
    const won = (over: Partial<MarginBidIn>): MarginBidIn => ({
      id: TBID,
      name: "Acme Hardware repaint",
      won_on: "2026-11-14",
      status_changed_at: null,
      updated_at: SAVED,
      accountName: "Acme Hardware",
      dataCustomerName: "",
      estimator: "Sam Ortiz",
      estimatorId: EST,
      figures: { ...FIGURES, v: 1 },
      ...over,
    });
    const tradeIn = bidToMarginIn(won({ bidKind: "trade" }));
    expect(tradeIn.bidKind).toBe("trade");
    const tradeRow = toMarginInvoiceRow(tradeIn);
    expect(tradeRow).toEqual({
      id: TBID,
      kind: "bid",
      bidKind: "trade",
      number: "Acme Hardware repaint",
      day: "2026-11-14",
      status: "won",
      customer: "Acme Hardware",
      technician: "Sam Ortiz",
      technicianId: EST,
      ticket: true,
      hours: 37,
      revenue: 3067.12,
      material: 760.55,
      labor: 1062,
      other: 400,
      purchaseOrders: 0,
      cost: 2222.55,
      margin: 844.57,
      marginPct: 27.5,
    });
    expect(bidLink({ id: tradeRow.id, kind: tradeRow.bidKind })).toEqual({
      to: "/trade-bids",
      search: { bid: TBID },
    });
    // A roofing bid's row says nothing about its kind, read with 'roof' or with none.
    for (const bidKind of ["roof", null, undefined]) {
      const row = toMarginInvoiceRow(bidToMarginIn(won({ id: RBID, bidKind })));
      expect(row).not.toHaveProperty("bidKind");
      expect(bidLink({ id: row.id, kind: row.bidKind })).toEqual({
        to: "/estimate",
        search: { bid: RBID },
      });
      // Counted by the same rules.
      expect(row.margin).toBe(844.57);
    }
  });

  it("the Margin report as the server reads it: a won trade bid is counted and says it is one", async () => {
    const won = { status: "won", won_on: "2026-11-14", status_changed_at: "2026-11-14T15:00:00Z" };
    const env = world({
      // In id order: the report reads in pages "after the last id", and the stand-in does not sort.
      bids: [
        // Won with no figures stored: counted nowhere, listed so each can be opened and saved.
        roofBidRow(GONE, { ...won, kind: "roof", name: "Acme Hardware annex", figures: null }),
        tradeBidRow({ ...won }),
        roofBidRow(RBID, { ...won, kind: "roof", figures: { ...FIGURES } }),
        roofBidRow(OLDBID, { ...won, figures: { ...FIGURES } }),
        tradeBidRow({ ...won, id: NOBODY, name: "Acme Hardware siding", figures: null }),
      ],
      invoices: [],
    });
    const report = await call<MarginReportResult>(
      listMarginReport,
      { from: "2026-11-01", to: "2026-11-30", groupBy: "month", source: "bids" },
      env,
      ADMIN,
    );
    const row = (id: string) => report.invoices.find((r) => r.id === id)!;
    expect(report.invoices.map((r) => r.id).sort()).toEqual([TBID, RBID, OLDBID].sort());
    // The painting job, by the sums at the top of the file.
    expect(row(TBID)).toMatchObject({
      kind: "bid",
      bidKind: "trade",
      number: "Acme Hardware repaint",
      day: "2026-11-14",
      customer: "Acme Hardware",
      technician: "Sam Ortiz",
      hours: 37,
      revenue: 3067.12,
      material: 760.55,
      labor: 1062,
      other: 400,
      cost: 2222.55,
      margin: 844.57,
      marginPct: 27.5,
    });
    expect(row(RBID)).not.toHaveProperty("bidKind");
    expect(row(OLDBID)).not.toHaveProperty("bidKind");
    // The bids without figures: `kind` on the trade bid only, so each opens in its own place.
    const missing = (id: string) => report.bidsWithoutFigures.find((b) => b.id === id)!;
    expect(report.bidsWithoutFigures).toHaveLength(2);
    expect(missing(NOBODY)).toEqual({
      id: NOBODY,
      name: "Acme Hardware siding",
      day: "2026-11-14",
      kind: "trade",
    });
    expect(missing(GONE)).toEqual({ id: GONE, name: "Acme Hardware annex", day: "2026-11-14" });
    expect(missing(GONE)).not.toHaveProperty("kind");
    expect(bidHref(missing(NOBODY))).toBe(`/trade-bids?bid=${NOBODY}`);
    expect(bidHref(missing(GONE))).toBe(`/estimate?bid=${GONE}`);
    expect(env.writes).toEqual([]);
  });

  it("a document's Back: the trade bid on Trade Bids, a roofing bid in the estimator", () => {
    expect(backTo("bid", { bidId: TBID, serviceJobId: null, bidKind: "trade" })).toEqual({
      to: "/trade-bids",
      search: { bid: TBID },
    });
    expect(backTo("bid", { bidId: RBID, serviceJobId: null })).toEqual({
      to: "/estimate",
      search: { bid: RBID },
    });
    expect(backTo("bid", { bidId: RBID, serviceJobId: null, bidKind: "roof" })).toEqual({
      to: "/estimate",
      search: { bid: RBID },
    });
    expect(backTo("bid", { bidId: RBID, serviceJobId: null, bidKind: null })).toEqual({
      to: "/estimate",
      search: { bid: RBID },
    });
    // The kind changes nothing for a ticket's document.
    expect(backTo("ticket", { bidId: null, serviceJobId: "job-1", bidKind: "trade" })).toEqual({
      to: "/service",
      search: { id: "job-1" },
    });
  });

  it("every server read that lists bids of both kinds asks for the kind with the row", () => {
    const reads: [file: string, select: string][] = [
      ["src/lib/owner-attention.functions.ts", '"id, name, kind, status, due_date, submitted_at,'],
      [
        "src/lib/my-work.functions.ts",
        '.select("id, name, kind, status, due_date, account_id, created_by")',
      ],
      [
        "src/lib/owner-view.functions.ts",
        '.select("id, name, kind, status, due_date, account_id, created_by")',
      ],
      [
        "src/lib/global-search.functions.ts",
        '.select("id, name, kind, status, updated_at, account_id")',
      ],
      ["src/lib/work-chain.functions.ts", 'const BID_COLS = "id, name, kind, status,'],
      ["src/lib/bids-notify.server.ts", '"id, name, kind, status, due_date, created_by,'],
      ["src/lib/margin-report.functions.ts", '"id, name, kind, status, status_changed_at,'],
      ["src/lib/crm.functions.ts", '.select("id, name, kind, status, grand_total, updated_at")'],
      [
        "src/lib/opportunities.functions.ts",
        '.select("id, name, kind, status, grand_total, submitted_at")',
      ],
      ["src/lib/documents.functions.ts", '.from("bids").select("name, kind")'],
    ];
    // The file's name is the failure's message: which read lost the column.
    for (const [file, select] of reads) expect(flat(file).includes(select), file).toBe(true);
  });

  it("the search and the Margin report hand the kind they read to the link", () => {
    expect(flat("src/lib/global-search.functions.ts")).toContain(
      '...hitRoute("bid", { id: s(r["id"]), bid_kind: s(r["kind"]) })',
    );
    expect(flat("src/lib/margin-report.functions.ts")).toContain("bidKind: b.kind,");
    expect(flat("src/lib/work-chain.functions.ts")).toContain("kind: r.kind ?? null,");
  });
});

// ── 8. Documents: a trade bid's proposal ───────────────────────────────────────────────────────

describe("documents: what a proposal knows of a trade bid", () => {
  const row = { name: "Acme Hardware repaint", grand_total: 3067.12, due_date: "2026-12-01" };
  const source = (bid: DocumentSource["bid"]): DocumentSource => ({
    kind: "bid",
    today: new Date("2026-11-16T15:00:00Z"),
    documentTitle: "Trade proposal",
    account: {
      name: "JBK, Inc.",
      address: "1 Shop Rd",
      city: "Corbin",
      state: "KY",
      zip: "40701",
      phone: "",
      website: "",
      email: "",
    },
    company: {
      name: "Acme Hardware",
      contact: "Pat Lane",
      contactPosition: "",
      phone: "",
      email: "",
      address: "12 Main St",
      city: "Corbin",
      state: "KY",
      zip: "40701",
      externalId: "",
    },
    property: {
      name: "Acme Hardware store",
      address: "12 Main St",
      city: "Corbin",
      county: "",
      state: "KY",
      zip: "40701",
      areaSqFt: null,
    },
    bid,
    ticket: null,
    manager: { name: "Dana Reed", email: "", phone: "" },
    accountManager: null,
  });

  it("bidFromSavedState: the job type in place of the roof, the scope trimmed, the bid's own total", () => {
    const bid = bidFromSavedState(
      tradeData({ trade_name: "  Painting ", scope: `  ${SCOPE}\n\n` }),
      row,
    );
    expect(bid).toEqual({
      name: "Acme Hardware repaint",
      total: 3067.12,
      system: "Painting",
      dueDate: "2026-12-01",
      sections: [],
      sqFt: null,
      warranty: "",
      trade: { name: "Painting", scope: SCOPE },
    });
  });

  it("bidFromSavedState reads a trade bid leniently: whatever the saved copy holds still prints", () => {
    const bid = bidFromSavedState({ kind: "trade", scope: 7 }, { ...row, grand_total: null });
    expect(bid.trade).toEqual({ name: "", scope: "" });
    expect(bid.system).toBe("");
    expect(bid.total).toBeNull();
    expect(bid.sections).toEqual([]);
  });

  it("bidFromSavedState on a roofing bid: no trade, and everything as before", () => {
    const bid = bidFromSavedState(
      {
        roofSystem: "Duro-Last",
        warrantyName: "20 Yr NDL",
        sections: [{ name: "Main", length: 200, width: 150, thickness: 60 }],
      },
      { name: "Acme Hardware reroof", grand_total: 52000, due_date: "2026-12-05" },
    );
    expect(bid.trade).toBeUndefined();
    // 200 ft × 150 ft = 30,000 sq ft.
    expect(bid).toEqual({
      name: "Acme Hardware reroof",
      total: 52000,
      system: "Duro-Last 60 mil",
      dueDate: "2026-12-05",
      sections: [{ name: "Main", lengthFt: 200, widthFt: 150, system: "Duro-Last 60 mil" }],
      sqFt: 30000,
      warranty: "20 Yr NDL",
    });
  });

  it("resolveVariables: Job Type and Scope of Work for a trade bid, with its price", () => {
    const v = resolveVariables(source(bidFromSavedState(tradeData(), row)));
    expect(v["opportunity.trade"]).toBe("Painting");
    expect(v["opportunity.scope"]).toBe(SCOPE);
    expect(v["opportunity.price"]).toBe("$3,067.12");
    expect(v["opportunity.product"]).toBe("Painting");
    expect(v["opportunity.sections"]).toBe("0");
    expect(v["opportunity.sqft"]).toBe("");
  });

  it("resolveVariables: both are blank on a roofing bid, never undefined", () => {
    const roofing = bidFromSavedState(
      { roofSystem: "Duro-Last", sections: [] },
      { name: "Acme Hardware reroof", grand_total: 52000, due_date: null },
    );
    const v = resolveVariables(source(roofing));
    expect(v["opportunity.trade"]).toBe("");
    expect(v["opportunity.scope"]).toBe("");
    expect(v["opportunity.price"]).toBe("$52,000.00");
    // A saved source with `trade: null` reads the same.
    const nulled = resolveVariables(source({ ...roofing, trade: null }));
    expect(nulled["opportunity.trade"]).toBe("");
    expect(nulled["opportunity.scope"]).toBe("");
  });

  it("the two variables are a bid document's, named for the editor's picker", () => {
    const keys = variableDefs("bid").map((d) => d.key);
    expect(keys).toContain("opportunity.trade");
    expect(keys).toContain("opportunity.scope");
    expect(variableDefs("ticket").map((d) => d.key)).not.toContain("opportunity.trade");
    expect(variableLabel("opportunity.trade")).toBe("Job Type");
    expect(variableLabel("opportunity.scope")).toBe("Scope of Work");
  });

  it("the shipped templates hold one Trade proposal, a bid template with no pricing table", () => {
    expect(TRADE_PROPOSAL_TEMPLATE).toBe("Trade proposal");
    const found = defaultTemplates().filter((t) => t.name === TRADE_PROPOSAL_TEMPLATE);
    expect(found).toHaveLength(1);
    const tpl = found[0]!;
    expect(tpl.kind).toBe("bid");
    const modules = tpl.pages.flatMap((p) => p.modules.map((m) => m.type));
    expect(modules).toEqual(["letterhead", "hr", "body", "signature"]);
    expect(modules).not.toContain("pricingTable");
    const text = JSON.stringify(tpl.pages);
    for (const key of ["opportunity.scope", "opportunity.trade", "opportunity.price"])
      expect(text).toContain(`"key":"${key}"`);
    // No roof in it.
    for (const key of ["opportunity.sqft", "opportunity.sections", "opportunity.warranty"])
      expect(text).not.toContain(`"key":"${key}"`);
  });

  it("the Trade proposal printed for the painting job: the job type, the scope, the price", () => {
    const tpl = defaultTemplates().find((t) => t.name === TRADE_PROPOSAL_TEMPLATE)!;
    const body = tpl.pages[0]!.modules.find((m) => m.type === "body") as unknown as {
      text: RichDoc;
    };
    const vars = resolveVariables(source(bidFromSavedState(tradeData(), row)));
    const lines = richToText(body.text, vars, variableLabel).split("\n");
    expect(lines).toContain("November 16, 2026");
    expect(lines).toContain("Re: Painting at Acme Hardware store");
    expect(lines).toContain("Dear Pat Lane,");
    expect(lines).toContain("Scope of work");
    expect(lines).toContain(SCOPE);
    expect(lines).toContain("Total: $3,067.12");
  });

  it("missingDefaultTemplates: an install with the two bid templates gets it, not as the default", () => {
    const added = missingDefaultTemplates([
      { kind: "bid", name: "Proposal", deleted_at: null },
      { kind: "bid", name: "Scope letter (no prices)", deleted_at: null },
    ]);
    const trade = added.filter((t) => t.name === TRADE_PROPOSAL_TEMPLATE);
    expect(trade).toHaveLength(1);
    expect(trade[0]!.kind).toBe("bid");
    expect(trade[0]!.isDefault).toBe(false);
    // The two it has are not added again.
    expect(added.filter((t) => t.kind === "bid").map((t) => t.name)).toEqual([
      TRADE_PROPOSAL_TEMPLATE,
    ]);
  });

  it("missingDefaultTemplates: a Trade proposal the office removed stays removed", () => {
    const added = missingDefaultTemplates([
      { kind: "bid", name: "Proposal", deleted_at: null },
      { kind: "bid", name: "trade proposal", deleted_at: "2026-11-20T00:00:00Z" },
    ]);
    expect(added.map((t) => t.name)).not.toContain(TRADE_PROPOSAL_TEMPLATE);
  });

  it("a trade bid's New document starts on the Trade proposal, ahead of the office's default", () => {
    const dialog = flat("src/components/documents/new-document-dialog.tsx");
    expect(dialog).toContain(
      "const defaultTemplate = (props.prefer ? rows.find((t) => t.name === props.prefer) : undefined) ?? rows.find((t) => t.is_default) ?? rows[0] ?? null;",
    );
    expect(dialog).toContain("prefer?: string | undefined;");
    // The Trade Bids list asks for it by name, and the panel hands it on to the dialog.
    const list = flat("src/components/trade/trade-bids-list.tsx");
    expect(list).toContain('import { TRADE_PROPOSAL_TEMPLATE } from "@/lib/documents/defaults";');
    expect(list).toContain("prefer={TRADE_PROPOSAL_TEMPLATE}");
    expect(flat("src/components/documents/documents-panel.tsx")).toContain("prefer={props.prefer}");
  });
});

// ── 9. The database ────────────────────────────────────────────────────────────────────────────

describe("the migration (20261116200000_trade_bids.sql)", () => {
  const sql = flatSql("supabase/migrations/20261116200000_trade_bids.sql");

  it("the comments are out of what is matched", () => {
    expect(sql).not.toContain("--");
    expect(sql).not.toContain("Trade Bids (owner");
  });

  it("trade_types: the table, one name whatever the capitals or spaces, row level security on", () => {
    expect(sql).toContain("create table if not exists public.trade_types (");
    expect(sql).toContain("name text not null check (length(btrim(name)) > 0)");
    expect(sql).toContain("setup jsonb not null default '{}'::jsonb");
    expect(sql).toContain(
      "create unique index if not exists trade_types_name_key on public.trade_types (lower(btrim(name)));",
    );
    expect(sql).toContain("alter table public.trade_types enable row level security;");
  });

  it("trade_types: whoever bids may read", () => {
    expect(sql).toContain(
      "create policy trade_types_read on public.trade_types for select to authenticated using ((select public.has_access('estimate')));",
    );
  });

  it("trade_types: only an admin or a manager writes", () => {
    expect(sql).toContain(
      "create policy trade_types_write on public.trade_types for all to authenticated using ((select public.is_admin()) or (select public.is_manager())) with check ((select public.is_admin()) or (select public.is_manager()));",
    );
    // Nobody signed out reaches the table.
    expect(sql).toContain("revoke all on public.trade_types from anon, public, authenticated;");
    expect(sql).toContain(
      "grant select, insert, update, delete on public.trade_types to authenticated;",
    );
    expect(sql).not.toMatch(/grant[^;]*on public\.trade_types to[^;]*anon/);
  });

  it("bids.kind: every existing row is a roofing bid, and there are two kinds", () => {
    expect(sql).toContain(
      "alter table public.bids add column if not exists kind text not null default 'roof';",
    );
    expect(sql).toContain(
      "alter table public.bids add constraint bids_kind_check check (kind in ('roof', 'trade'));",
    );
  });

  it("bids.trade_type_id: a deleted trade leaves the bid, and only a trade bid has one", () => {
    expect(sql).toContain(
      "add column if not exists trade_type_id uuid references public.trade_types(id) on delete set null;",
    );
    expect(sql).toContain(
      "add constraint bids_trade_type_kind check (trade_type_id is null or kind = 'trade');",
    );
  });

  it("a bid never changes kind (the trigger)", () => {
    expect(sql).toContain(
      "create trigger bids_kind_fixed before update of kind on public.bids for each row execute function public.bids_kind_fixed();",
    );
    expect(sql).toContain("if new.kind is distinct from old.kind then raise exception");
    expect(sql).toContain(
      "revoke all on function public.bids_kind_fixed() from public, anon, authenticated;",
    );
  });

  it("warranty leads are roofs: won roofing bids only", () => {
    const fn = sql.slice(sql.indexOf("create or replace function public.warranty_leads()"));
    expect(fn).toContain(
      "where b.deleted_at is null and b.status = 'won' and b.kind = 'roof' and public.has_access('prospect')",
    );
  });

  it("can be run twice", () => {
    expect(sql).toContain("drop policy if exists trade_types_read on public.trade_types;");
    expect(sql).toContain("drop policy if exists trade_types_write on public.trade_types;");
    expect(sql).toContain("alter table public.bids drop constraint if exists bids_kind_check;");
    expect(sql).toContain(
      "alter table public.bids drop constraint if exists bids_trade_type_kind;",
    );
    expect(sql).toContain("drop trigger if exists bids_kind_fixed on public.bids;");
  });

  it("the generated types know the table and the two columns", () => {
    const types = readGeneratedTypes();
    const trades = typesBlock(types, "trade_types");
    expect(trades).not.toBe("");
    expect(typesInclude(trades, "name: string;")).toBe(true);
    expect(typesInclude(trades, "setup: Json;")).toBe(true);
    expect(typesInclude(trades, "updated_by_name: string | null;")).toBe(true);
    const bids = typesBlock(types, "bids");
    expect(typesInclude(bids, "kind: string;")).toBe(true);
    expect(typesInclude(bids, "kind?: string;")).toBe(true);
    expect(typesInclude(bids, "trade_type_id: string | null;")).toBe(true);
    expect(typesInclude(bids, "trade_type_id?: string | null;")).toBe(true);
  });
});

// ── 10. The menu ───────────────────────────────────────────────────────────────────────────────

describe("the menu: Trade Bids is its own row, under Estimate Pricing and above Inventory", () => {
  // Owner, Nov 16: "Not under estimate pricing dropdown but under estimate pricing above
  // inventory on the nav bar".
  const nav = flat("src/components/app-sidebar.tsx");
  const group = nav.slice(
    nav.indexOf('<NavGroup label="Estimate"'),
    nav.indexOf("{/* Admins only (Nov 16)"),
  );

  it("the row: its marker, its page and its words", () => {
    expect(nav).toContain('const TRADE_BIDS_PATH = "/trade-bids";');
    const row = nav.slice(
      nav.indexOf("const tradeBidsRow = ("),
      nav.indexOf("const inventoryRows"),
    );
    expect(row).toContain('const tradeBidsRow = ( <SidebarMenuItem data-nav="trade-bids">');
    expect(row).toContain(
      '<SidebarMenuButton asChild isActive={isActive(TRADE_BIDS_PATH)} tooltip="Trade Bids">',
    );
    expect(row).toContain("<Link to={TRADE_BIDS_PATH}>");
    expect(row).toContain("{!collapsed && <span>Trade Bids</span>}");
    // One row, drawn in one place.
    expect(nav.split('data-nav="trade-bids"')).toHaveLength(2);
    expect(nav.split("tradeBidsRow")).toHaveLength(3);
  });

  it("sits in the Estimate group after the Estimate Pricing dropdown and before Inventory", () => {
    expect(group.length).toBeGreaterThan(0);
    const pricing = group.indexOf('<SidebarMenuItem data-nav="estimate-pricing">');
    const dropdownEnds = group.indexOf("</Collapsible>");
    const trade = group.indexOf("tradeBidsRow");
    const inventory = group.indexOf('{can("inventory") && inventoryRows}');
    expect(pricing).toBeGreaterThan(0);
    expect(dropdownEnds).toBeGreaterThan(pricing);
    expect(trade).toBeGreaterThan(dropdownEnds);
    expect(inventory).toBeGreaterThan(trade);
    // Nothing between the three.
    expect(group).toContain(
      '</Collapsible> ))} {can("estimate") && tradeBidsRow} {can("inventory") && inventoryRows}',
    );
  });

  it("shows with Estimate access, as Project Bids does", () => {
    expect(group).toContain('{can("estimate") && tradeBidsRow}');
    // No other rule draws it.
    expect(nav.split("&& tradeBidsRow}")).toHaveLength(2);
  });

  it("is not inside the dropdown: Estimate Pricing holds the pricing rows and keeps its own gate", () => {
    const inside = group.slice(
      group.indexOf("<CollapsibleContent>"),
      group.indexOf("</CollapsibleContent>"),
    );
    expect(inside).toContain("{pricingRows}");
    expect(inside).not.toContain("tradeBidsRow");
    expect(inside).not.toContain("trade-bids");
    expect(inside).not.toContain("TRADE_BIDS_PATH");
    // The dropdown shows with Pricing access alone, open or as icons.
    expect(group).toContain('{can("pricing") && (collapsed ? (');
    expect(group).toMatch(
      /\{can\("pricing"\) && \(collapsed \? \( \/\/ [^{}<>]* pricingRows \) : \(/,
    );
    expect(nav).not.toContain('can("pricing") || can("estimate")');
    expect(nav).not.toContain("pricingMenu");
  });

  it("Trade Bids is not an Estimate Pricing page: opening it does not open the dropdown", () => {
    const rule = nav.slice(
      nav.indexOf("const isPricingPath = "),
      nav.indexOf("/** Which menu groups the user folded up"),
    );
    expect(rule).toContain("const isPricingPath = (pathname: string): boolean => adminItems.some(");
    expect(rule).not.toContain("TRADE_BIDS_PATH");
    expect(rule).not.toContain("trade-bids");
    // The five pricing pages are the admin items; Trade Bids is not one of them.
    const items = nav.slice(nav.indexOf("const adminItems"), nav.indexOf("const TRADE_BIDS_PATH"));
    expect(items).toContain('url: "/admin/price-import"');
    expect(items).not.toContain('"/trade-bids"');
    expect(items).not.toContain('title: "Trade Bids"');
  });
});
