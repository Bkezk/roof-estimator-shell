/**
 * A bid save from a stale tab (owner, Oct 6, Towneplace Suites: "we did an import and saved and
 * went back in and a lot of things were missing … we just saved again and the total price
 * changed"): the estimate sends the row's updated_at as it loaded it, and the server refuses
 * when the bid's contents were saved since, naming who saved and when.
 *
 * Owner, Oct 26 (Somerset Career Center): "he tries to save it but a toast pops up and it says
 * you cant save it brian saved this at 2 pm … and 7pm … no one is in the office at 7pm and only
 * brian is getting the error message on himself". Proof from audit_log: Brian had filed the bid
 * under a folder from the Bids list (10:19 am Eastern) and, on Oct 22, linked it to its customer
 * from the Customers page (3:07 pm Eastern) while his estimator tab had it open. Every row
 * update moves updated_at (the trigger), so the tab was told it was stale by a filing change;
 * the message named the last contents saver (Brian) and printed UTC ("7 pm"). Now the rule
 * reads bids.content_saved_at, the time is Eastern, and your own other tab is called that.
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { bidSaveIsStale, bidStaleMessage, staleSavedAtText } from "./bid-stale-save";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

describe("bidSaveIsStale", () => {
  it("is stale only when the bid's contents were saved after the copy this tab loaded", () => {
    const row = (content_saved_at: string) => ({ updated_at: content_saved_at, content_saved_at });
    expect(bidSaveIsStale("2026-10-06T19:00:00.000Z", row("2026-10-06T19:50:44.357Z"))).toBe(true);
    expect(bidSaveIsStale("2026-10-06T19:50:44.357Z", row("2026-10-06T19:50:44.357Z"))).toBe(false);
    expect(bidSaveIsStale("2026-10-06T19:51:00.000Z", row("2026-10-06T19:50:44.357Z"))).toBe(false);
  });
  it("Somerset Career Center: a folder move from the Bids list moved updated_at, not the contents — not stale", () => {
    const loadedAt = "2026-10-26T14:17:25.979Z"; // Brian's last estimator save, as his tab loaded it
    const row = { updated_at: "2026-10-26T14:19:41.200Z", content_saved_at: loadedAt };
    expect(bidSaveIsStale(loadedAt, row)).toBe(false);
    // The Oct 22 case: linked to its customer at 19:07 UTC, contents last saved 18:49.
    expect(
      bidSaveIsStale("2026-10-22T18:49:18.254Z", {
        updated_at: "2026-10-22T19:07:28.393Z",
        content_saved_at: "2026-10-22T18:49:18.254Z",
      }),
    ).toBe(false);
    // Another tab DID save the contents since: refused.
    expect(
      bidSaveIsStale(loadedAt, {
        updated_at: "2026-10-26T14:45:56.981Z",
        content_saved_at: "2026-10-26T14:45:56.981Z",
      }),
    ).toBe(true);
  });
  it("a row from before the column existed falls back to updated_at", () => {
    expect(
      bidSaveIsStale("2026-10-06T19:00:00.000Z", { updated_at: "2026-10-06T19:50:44.357Z" }),
    ).toBe(true);
    expect(
      bidSaveIsStale("2026-10-06T19:00:00.000Z", {
        updated_at: "2026-10-06T19:50:44.357Z",
        content_saved_at: null,
      }),
    ).toBe(true);
  });
  it("tolerates a second of clock slop and never fires without both stamps", () => {
    expect(
      bidSaveIsStale("2026-10-06T19:50:44.000Z", {
        updated_at: "2026-10-06T19:50:44.900Z",
        content_saved_at: "2026-10-06T19:50:44.900Z",
      }),
    ).toBe(false);
    expect(bidSaveIsStale(undefined, { updated_at: "2026-10-06T19:50:44.357Z" })).toBe(false);
    expect(bidSaveIsStale("2026-10-06T19:00:00.000Z", { updated_at: null })).toBe(false);
    expect(bidSaveIsStale("2026-10-06T19:00:00.000Z", null)).toBe(false);
  });
});

describe("the time in the message is the office's (Eastern), never the server's UTC", () => {
  const at = "2026-10-22T19:07:28.393Z"; // the "7 pm" save: 3:07 pm Eastern
  it("the same office day: the time alone", () => {
    expect(staleSavedAtText(at, new Date("2026-10-22T21:00:00Z"))).toBe("3:07 PM");
    expect(staleSavedAtText("2026-10-26T14:19:41.200Z", new Date("2026-10-26T15:00:00Z"))).toBe(
      "10:19 AM",
    );
  });
  it("another day: the day too", () => {
    expect(staleSavedAtText(at, new Date("2026-10-26T15:00:00Z"))).toBe("Oct 22 at 3:07 PM");
  });
  it("the office day, not UTC's: 11 pm Eastern is still today", () => {
    expect(staleSavedAtText("2026-10-23T03:00:00Z", new Date("2026-10-23T01:00:00Z"))).toBe(
      "11:00 PM",
    );
  });
});

describe("bidStaleMessage", () => {
  const at = "2026-10-22T19:07:28.393Z";
  const now = new Date("2026-10-22T21:00:00Z");
  it("names who saved, in Eastern, and says to reload", () => {
    const m = bidStaleMessage("Brian Folden", at, "RoAnna Sims", now);
    expect(m).toContain("Not saved: Brian Folden saved this bid at 3:07 PM");
    expect(m).toContain("Reload the bid");
    expect(bidStaleMessage(null, at, "RoAnna Sims", now)).toContain(
      "someone saved this bid at 3:07 PM",
    );
  });
  it("your own other tab is called that, not 'Brian saved this' to Brian", () => {
    const m = bidStaleMessage("Brian Folden", at, "Brian Folden", now);
    expect(m).toContain("Not saved: you saved this bid from another tab at 3:07 PM");
    expect(m).not.toContain("Brian Folden saved");
  });
});

describe("the wiring", () => {
  it("saveBid stamps content_saved_at and reads it for the stale check, before writing", () => {
    const src = read("./bids.functions.ts");
    expect(src).toContain("expectUpdatedAt: z.string().datetime({ offset: true }).optional()");
    expect(src).toContain("content_saved_at: now,");
    expect(src).toContain('"updated_at, content_saved_at, updated_by_name, status,');
    const check = src.indexOf("bidSaveIsStale(data.expectUpdatedAt, cur)");
    expect(src.indexOf("cur.content_saved_at ?? cur.updated_at")).toBeGreaterThan(check);
    const write = src.indexOf('.from("bids")\n        .update({\n          ...payload,');
    expect(check).toBeGreaterThan(0);
    expect(write).toBeGreaterThan(check);
    // A list-side status change moves updated_at only: an open tab's save is not refused by it.
    const list = src.slice(src.indexOf("export const setBidStatus"));
    expect(list.slice(0, list.indexOf("syncOpportunityFromBid"))).not.toContain("content_saved_at");
  });
  it("the estimate remembers the loaded row's updated_at, sends it, and refreshes it after a save", () => {
    const src = read("../routes/estimate.tsx");
    expect(src).toContain("loadedUpdatedAt.current = loadedBid.updated_at ?? null;");
    expect(src).toContain("expectUpdatedAt: loadedUpdatedAt.current");
    expect(src).toContain("if (row?.updated_at) loadedUpdatedAt.current = row.updated_at;");
  });
  it("the column exists in the migration and the types, backfilled without moving updated_at", () => {
    const dir = fileURLToPath(new URL("../../supabase/migrations/", import.meta.url));
    const file = `${dir}20261026120000_bid_content_saved_at.sql`;
    expect(existsSync(file)).toBe(true);
    const sql = readFileSync(file, "utf8");
    expect(sql).toContain(
      "add column if not exists content_saved_at timestamptz not null default now()",
    );
    const off = sql.indexOf("disable trigger update_bids_updated_at");
    const fill = sql.indexOf("set content_saved_at = updated_at");
    const on = sql.indexOf("enable trigger update_bids_updated_at");
    expect(off).toBeGreaterThan(0);
    expect(fill).toBeGreaterThan(off);
    expect(on).toBeGreaterThan(fill);
    // History does not list the stamp on every save.
    expect(sql).toMatch(/v_skip constant text\[\] := array\[[^\]]*'content_saved_at'/);
    expect(read("../integrations/supabase/types.ts")).toContain("content_saved_at: string;");
  });
});
