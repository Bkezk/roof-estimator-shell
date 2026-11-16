/**
 * Trade Bids, Nov 16: the roofing estimator never loads or writes over a trade bid.
 *
 * A trade bid is a row of `bids` like a roofing bid, so an old link, a typed address or a stale
 * tab could point the estimator at one. Its data means nothing to the roofing calculator, and a
 * save from there would replace the bid's own numbers with a roof's. Two guards:
 *
 *  - the estimator page sends a trade bid to Trade Bids and loads nothing of it;
 *  - saveBid refuses to update a trade bid, whatever sent the save.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeCreateServerFn, fakeSupabase } from "@/test/fake-supabase";

vi.mock("@tanstack/react-start", () => ({ createServerFn: fakeCreateServerFn }));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));

import { saveBid, TRADE_BID_NOT_SAVED_HERE } from "./bids.functions";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const flat = (s: string) => s.replace(/\s+/g, " ");

const ME = "11111111-1111-4111-8111-111111111111";
const TRADE_ID = "22222222-2222-4222-8222-222222222222";
const ROOF_ID = "33333333-3333-4333-8333-333333333333";
const ACCOUNT = "44444444-4444-4444-8444-444444444444";

const bidRow = (id: string, kind: string) => ({
  id,
  name: kind === "trade" ? "Acme Hardware painting" : "Acme Hardware roof",
  kind,
  status: "draft",
  data: kind === "trade" ? { kind: "trade", v: 1, scope: "Paint the walls" } : { sections: [] },
  grand_total: 3067.12,
  figures: null,
  account_id: ACCOUNT,
  site_id: null,
  due_date: "2026-12-01",
  won_on: null,
  submitted_at: null,
  status_changed_at: null,
  deleted_at: null,
  updated_at: "2026-11-16T15:00:00.000Z",
  content_saved_at: "2026-11-16T15:00:00.000Z",
  updated_by_name: "Brandon Keck",
  created_by: ME,
});

type Save = (a: { data: unknown; context: unknown }) => Promise<unknown>;

describe("saveBid and a trade bid", () => {
  let env: ReturnType<typeof fakeSupabase>;
  beforeEach(() => {
    env = fakeSupabase({
      profiles: [{ id: ME, full_name: "Brandon Keck", email: "", role: "admin", access: [] }],
      bids: [bidRow(TRADE_ID, "trade"), bidRow(ROOF_ID, "roof")],
      bid_locks: [],
      crm_accounts: [{ id: ACCOUNT, name: "Acme Hardware", deleted_at: null }],
    });
  });
  const roofingSave = (id: string) =>
    (saveBid as unknown as Save)({
      data: {
        id,
        name: "Acme Hardware roof",
        data: { sections: [{ name: "Main", length: 100, width: 50 }] },
        grandTotal: 99999,
      },
      context: { supabase: env.db, userId: ME },
    });

  it("refuses to write over a trade bid, in plain words, and changes nothing", async () => {
    await expect(roofingSave(TRADE_ID)).rejects.toThrow(TRADE_BID_NOT_SAVED_HERE);
    const row = env.tables["bids"]!.find((b) => b["id"] === TRADE_ID)!;
    expect(row["grand_total"]).toBe(3067.12);
    expect(row["data"]).toEqual({ kind: "trade", v: 1, scope: "Paint the walls" });
    expect(row["name"]).toBe("Acme Hardware painting");
  });
  it("the message says what the bid is and where to open it", () => {
    expect(TRADE_BID_NOT_SAVED_HERE).toContain("trade bid");
    expect(TRADE_BID_NOT_SAVED_HERE).toContain("Trade Bids");
    expect(TRADE_BID_NOT_SAVED_HERE).toMatch(/^Not saved/);
  });
  it("the check comes before anything is written or compared", () => {
    const src = flat(read("./bids.functions.ts"));
    const guard = src.indexOf(
      'if (cur.kind === "trade") throw new Error(TRADE_BID_NOT_SAVED_HERE);',
    );
    const stale = src.indexOf(
      "if (data.expectUpdatedAt && bidSaveIsStale(data.expectUpdatedAt, cur))",
    );
    expect(guard).toBeGreaterThan(0);
    expect(stale).toBeGreaterThan(guard);
  });
});

describe("the estimator page and a trade bid", () => {
  const src = flat(read("../routes/estimate.tsx"));
  it("sends a trade bid to Trade Bids, replacing the address so Back does not loop", () => {
    expect(src).toContain(
      'const loadedTradeId = loadedBid?.kind === "trade" ? loadedBid.id : null;',
    );
    expect(src).toContain(
      'void navigate({ to: "/trade-bids", search: { bid: loadedTradeId }, replace: true });',
    );
  });
  it("loads nothing of it into the roofing form", () => {
    const hydrate = src.indexOf("if (!loadedBid || hydratedFor.current === loadedBid.id) return;");
    const skip = src.indexOf('if (loadedBid.kind === "trade") return;');
    const mark = src.indexOf("hydratedFor.current = loadedBid.id;");
    expect(hydrate).toBeGreaterThan(0);
    expect(skip).toBeGreaterThan(hydrate);
    expect(mark).toBeGreaterThan(skip);
  });
});
