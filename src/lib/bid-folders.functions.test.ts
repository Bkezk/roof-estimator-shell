/**
 * Assigned bid folders on the server (owner, Oct 13: "ok lets just do a by folder view that you
 * assign"): saveBid stores the Setup › Bid Info folder on the row (absent = left as is), the
 * Bids page's setBidFolder files one or several live bids (blank / Unfiled → null), renameBidFolder
 * moves every bid in a folder — both spellings — to the new name, and listBidFolders hands the
 * estimator's picker the names in use. The real server functions run against the in-memory
 * stand-in (src/test/fake-supabase.ts); nothing touches a live database.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));
vi.mock("@/lib/notify.server", () => ({
  serverClient: async (fallback: unknown) => fallback,
  notify: vi.fn(async () => 0),
}));

import { listBidFolders, renameBidFolder, saveBid, setBidFolder } from "@/lib/bids.functions";
import { fakeSupabase } from "@/test/fake-supabase";

type Row = Record<string, unknown>;
type Fn = (a: { data: unknown; context: unknown }) => Promise<unknown>;
const call = <T>(fn: unknown, data: unknown, env: ReturnType<typeof fakeSupabase>) =>
  (fn as Fn)({ data, context: { supabase: env.db, userId: EST } }) as Promise<T>;

const EST = "00000000-0000-4000-8000-00000000000e";
const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const C = "00000000-0000-4000-8000-00000000000c";
const D = "00000000-0000-4000-8000-00000000000d";
const GONE = "00000000-0000-4000-8000-000000000099";

const bid = (id: string, over: Row = {}): Row => ({
  id,
  name: `Bid ${id.slice(-1)}`,
  status: "draft",
  grand_total: 100,
  data: {},
  lost_reason: null,
  opportunity_id: null,
  submitted_at: null,
  status_changed_at: null,
  deleted_at: null,
  due_date: "2026-10-20",
  folder: null,
  account_id: null,
  created_by: EST,
  updated_at: "2026-10-10T12:00:00Z",
  updated_by_name: "Brian",
  created_at: "2026-10-01T12:00:00Z",
  ...over,
});

describe("bid folders on the server", () => {
  let env: ReturnType<typeof fakeSupabase>;
  const row = (id: string) => env.tables["bids"]!.find((r) => r["id"] === id)!;
  const bidWrites = () => env.writes.filter((w) => w.table === "bids");
  beforeEach(() => {
    env = fakeSupabase({
      profiles: [{ id: EST, full_name: "Brian", email: "brian@example.com" }],
      bids: [
        bid(A, { folder: "Bell County Schools" }),
        bid(B, { folder: "bell county schools" }),
        bid(C),
        bid(D, { folder: "Airports" }),
        // In Recently deleted: never touched, never listed.
        bid(GONE, { folder: "Bell County Schools", deleted_at: "2026-10-12T12:00:00Z" }),
      ],
      bid_locks: [],
      crm_opportunities: [],
      crm_followups: [],
      crm_accounts: [],
    });
  });

  describe("setBidFolder", () => {
    it("files the bids under the normalized name and says how many; a deleted id is skipped", async () => {
      const r = await call<{ count: number; folder: string | null }>(
        setBidFolder,
        { ids: [C, D, GONE], folder: "  Knox   County " },
        env,
      );
      expect(r).toEqual({ count: 2, folder: "Knox County" });
      expect(row(C)["folder"]).toBe("Knox County");
      expect(row(D)["folder"]).toBe("Knox County");
      expect(row(GONE)["folder"]).toBe("Bell County Schools");
      // Only the folder changes: "Last saved … by" is left alone.
      expect(bidWrites()).toHaveLength(1);
      expect(bidWrites()[0]!.payload).toEqual({ folder: "Knox County" });
      expect(row(C)["updated_at"]).toBe("2026-10-10T12:00:00Z");
    });
    it("null, blank and 'Unfiled' all take the bid out of its folder", async () => {
      await call(setBidFolder, { ids: [A], folder: null }, env);
      expect(row(A)["folder"]).toBeNull();
      await call(setBidFolder, { ids: [D], folder: "   " }, env);
      expect(row(D)["folder"]).toBeNull();
      await call(setBidFolder, { ids: [B], folder: "Unfiled" }, env);
      expect(row(B)["folder"]).toBeNull();
    });
    it("takes 1–200 uuids and a name of at most 400 characters as typed (stored cut to 80)", async () => {
      expect(() => call(setBidFolder, { ids: [], folder: "x" }, env)).toThrow();
      expect(() => call(setBidFolder, { ids: ["nope"], folder: "x" }, env)).toThrow();
      expect(() =>
        call(setBidFolder, { ids: Array.from({ length: 201 }, () => A), folder: "x" }, env),
      ).toThrow();
      expect(() => call(setBidFolder, { ids: [A], folder: "x".repeat(401) }, env)).toThrow();
      await call(setBidFolder, { ids: [A], folder: "y".repeat(120) }, env);
      expect(row(A)["folder"]).toBe("y".repeat(80));
      expect(bidWrites()).toHaveLength(1);
    });
  });

  describe("renameBidFolder", () => {
    it("moves every live bid in the folder, whatever its spelling, to the new name", async () => {
      const r = await call<{ count: number; folder: string }>(
        renameBidFolder,
        { from: "BELL COUNTY SCHOOLS", to: " Bell County  Board of Education " },
        env,
      );
      expect(r).toEqual({ count: 2, folder: "Bell County Board of Education" });
      expect(row(A)["folder"]).toBe("Bell County Board of Education");
      expect(row(B)["folder"]).toBe("Bell County Board of Education");
      expect(row(C)["folder"]).toBeNull();
      expect(row(D)["folder"]).toBe("Airports");
      expect(row(GONE)["folder"]).toBe("Bell County Schools");
    });
    it("a folder nobody is in moves nothing; a blank or 'Unfiled' target, or renaming Unfiled, is refused", async () => {
      expect(await call(renameBidFolder, { from: "Nowhere", to: "Somewhere" }, env)).toEqual({
        count: 0,
        folder: "Somewhere",
      });
      await expect(call(renameBidFolder, { from: "Airports", to: "   " }, env)).rejects.toThrow(
        /name/,
      );
      await expect(call(renameBidFolder, { from: "Airports", to: "Unfiled" }, env)).rejects.toThrow(
        /name/,
      );
      await expect(call(renameBidFolder, { from: "Unfiled", to: "Airports" }, env)).rejects.toThrow(
        /Unfiled/,
      );
      expect(bidWrites()).toEqual([]);
    });
  });

  it("listBidFolders: the names in use on live bids, A–Z, one per folder", async () => {
    expect(await call(listBidFolders, undefined, env)).toEqual(["Airports", "Bell County Schools"]);
    await call(setBidFolder, { ids: [A, B, D], folder: null }, env);
    expect(await call(listBidFolders, undefined, env)).toEqual([]);
  });

  describe("saveBid", () => {
    const base = { name: "Bid C", data: {}, grandTotal: 100, status: "draft" as const };
    it("stores the folder with the save (normalized), clears it on null, leaves it alone when absent", async () => {
      await call(saveBid, { ...base, id: C, folder: "  Bell County  Schools " }, env);
      expect(row(C)["folder"]).toBe("Bell County Schools");
      await call(saveBid, { ...base, id: C }, env);
      expect(row(C)["folder"]).toBe("Bell County Schools");
      await call(saveBid, { ...base, id: C, folder: null }, env);
      expect(row(C)["folder"]).toBeNull();
      await call(saveBid, { ...base, id: C, folder: "" }, env);
      expect(row(C)["folder"]).toBeNull();
    });
    it("a new bid is filed from its first save", async () => {
      const made = await call<Row>(
        saveBid,
        { ...base, name: "New bid", dueDate: "2026-10-20", folder: "Airports" },
        env,
      );
      expect(made["folder"]).toBe("Airports");
      const unfiled = await call<Row>(
        saveBid,
        { ...base, name: "New bid 2", dueDate: "2026-10-20" },
        env,
      );
      expect(unfiled["folder"]).toBeUndefined();
    });
  });
});
