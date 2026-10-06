/**
 * A bid save from a stale tab (owner, Oct 6, Towneplace Suites: "we did an import and saved and
 * went back in and a lot of things were missing … we just saved again and the total price
 * changed"). saveBid had no check that the row was still the one the tab loaded: once the other
 * tab's 45-second edit lock had lapsed, an older copy could write over a newer save. Now the
 * estimate sends the row's updated_at as it loaded it, and the server refuses when the row has
 * moved on since, naming who saved and when.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { BID_STALE_MESSAGE, bidSaveIsStale } from "./bids.functions";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

describe("bidSaveIsStale", () => {
  it("is stale only when the row's updated_at is later than the copy this tab loaded", () => {
    expect(bidSaveIsStale("2026-10-06T19:00:00.000Z", "2026-10-06T19:50:44.357Z")).toBe(true);
    expect(bidSaveIsStale("2026-10-06T19:50:44.357Z", "2026-10-06T19:50:44.357Z")).toBe(false);
    expect(bidSaveIsStale("2026-10-06T19:51:00.000Z", "2026-10-06T19:50:44.357Z")).toBe(false);
  });
  it("tolerates a second of clock slop and never fires without both stamps", () => {
    expect(bidSaveIsStale("2026-10-06T19:50:44.000Z", "2026-10-06T19:50:44.900Z")).toBe(false);
    expect(bidSaveIsStale(undefined, "2026-10-06T19:50:44.357Z")).toBe(false);
    expect(bidSaveIsStale("2026-10-06T19:00:00.000Z", null)).toBe(false);
  });
  it("the message names who saved and says to reload", () => {
    const m = BID_STALE_MESSAGE("Brian Folden", "2026-10-06T19:50:44.357Z");
    expect(m).toContain("Not saved: Brian Folden saved this bid at ");
    expect(m).toContain("Reload the bid");
    expect(BID_STALE_MESSAGE(null, "2026-10-06T19:50:44.357Z")).toContain("someone saved this bid");
  });
});

describe("the wiring", () => {
  it("saveBid takes expectUpdatedAt and refuses a stale copy before writing", () => {
    const src = read("./bids.functions.ts");
    expect(src).toContain("expectUpdatedAt: z.string().datetime({ offset: true }).optional()");
    const check = src.indexOf("bidSaveIsStale(data.expectUpdatedAt, cur.updated_at)");
    const write = src.indexOf('.from("bids")\n        .update(payload)');
    expect(check).toBeGreaterThan(0);
    expect(write).toBeGreaterThan(check);
  });
  it("the estimate remembers the loaded row's updated_at, sends it, and refreshes it after a save", () => {
    const src = read("../routes/estimate.tsx");
    expect(src).toContain("loadedUpdatedAt.current = loadedBid.updated_at ?? null;");
    expect(src).toContain("expectUpdatedAt: loadedUpdatedAt.current");
    expect(src).toContain("if (row?.updated_at) loadedUpdatedAt.current = row.updated_at;");
  });
});
