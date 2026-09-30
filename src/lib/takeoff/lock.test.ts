import { describe, expect, it } from "vitest";

import {
  bidActions,
  copyTakeoffName,
  copyTakeoffRow,
  isTakeoffLocked,
  lockBannerText,
  lockedSaveRefusal,
  lockedToast,
  lockMeta,
  setupForLinkChange,
  shouldAutosave,
  takeoffChangeList,
  toolAllowed,
  withoutLockMeta,
} from "./lock";
import { takeoffQuantities, type PagePoint, type TakeoffObject, type TakeoffPage } from "./model";

const BID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

describe("isTakeoffLocked", () => {
  it("is locked exactly when the takeoff built a bid", () => {
    expect(isTakeoffLocked({ bid_id: BID })).toBe(true);
    expect(isTakeoffLocked({ bid_id: null })).toBe(false);
    expect(isTakeoffLocked({ bid_id: undefined })).toBe(false);
    expect(isTakeoffLocked({ bid_id: "" })).toBe(false);
    expect(isTakeoffLocked(null)).toBe(false);
  });
});

describe("lockedSaveRefusal", () => {
  it("an unlocked takeoff accepts anything", () => {
    expect(lockedSaveRefusal({ objects: [], pages: [], setup: {} }, null)).toBeNull();
    expect(lockedSaveRefusal({ bid_id: BID }, null)).toBeNull();
  });
  it("a locked takeoff refuses every drawing field", () => {
    for (const k of ["objects", "pages", "setup", "building_id"] as const)
      expect(lockedSaveRefusal({ [k]: k === "building_id" ? null : [] }, BID)).toMatch(
        /^This takeoff is locked: it built a bid/,
      );
  });
  it("a locked takeoff accepts a rename / status / customer and its own bid id", () => {
    expect(lockedSaveRefusal({}, BID)).toBeNull();
    expect(lockedSaveRefusal({ bid_id: BID }, BID)).toBeNull();
  });
  it("clears the bid link only when the bid is gone", () => {
    expect(lockedSaveRefusal({ bid_id: null }, BID, "gone")).toBeNull();
    expect(lockedSaveRefusal({ bid_id: null }, BID, "exists")).toMatch(/still exists/);
    expect(lockedSaveRefusal({ bid_id: null }, BID, "unknown")).toMatch(/can see bids/);
    expect(lockedSaveRefusal({ bid_id: "another" }, BID, "gone")).toMatch(/another bid/);
  });
});

describe("setupForLinkChange", () => {
  const now = "2026-09-30T12:00:00.000Z";
  it("stamps lockedAt when a bid is linked and drops it when cleared", () => {
    expect(setupForLinkChange({ color: "White" }, null, BID, now)).toEqual({
      color: "White",
      lockedAt: now,
    });
    expect(setupForLinkChange({ color: "White", lockedAt: now }, BID, null, now)).toEqual({
      color: "White",
    });
  });
  it("leaves the setup alone when the link does not change", () => {
    expect(setupForLinkChange({}, BID, BID, now)).toBeNull();
    expect(setupForLinkChange({}, null, undefined, now)).toBeNull();
    expect(setupForLinkChange({}, null, null, now)).toBeNull();
  });
});

describe("copyTakeoffName", () => {
  it("is '<name> (copy)', numbered when taken, never stacking", () => {
    expect(copyTakeoffName("Acme roof", [])).toBe("Acme roof (copy)");
    expect(copyTakeoffName("Acme roof", ["Acme roof", "acme ROOF (copy)"])).toBe(
      "Acme roof (copy 2)",
    );
    expect(copyTakeoffName("Acme roof (copy)", ["Acme roof (copy)", "Acme roof (copy 2)"])).toBe(
      "Acme roof (copy 3)",
    );
    expect(copyTakeoffName("Acme roof (Copy 4)", [])).toBe("Acme roof (copy)");
    expect(copyTakeoffName("  ", [])).toBe("Untitled takeoff (copy)");
  });
  it("stays within the 200-character name limit", () => {
    const long = "x".repeat(200);
    expect(copyTakeoffName(long, []).length).toBeLessThanOrEqual(200);
    expect(copyTakeoffName(long, [copyTakeoffName(long, [])]).endsWith("(copy 2)")).toBe(true);
  });
});

describe("copyTakeoffRow", () => {
  it("copies the drawing and file, drops the bid and the lock stamp, records the origin", () => {
    const src = {
      id: "t1",
      name: "Acme",
      underlay_kind: "pdf",
      file_path: "t1/plans.pdf",
      file_name: "plans.pdf",
      file_size: 10,
      pages: [{ index: 0 }],
      objects: [{ id: "a" }],
      setup: {
        color: "White",
        lockedAt: "x",
        copiedFrom: { takeoffId: "t0", bidId: null, at: "y" },
      },
      building_id: "b1",
      account_id: "c1",
      bid_id: BID,
    };
    const row = copyTakeoffRow(src, {
      name: "Acme (copy)",
      now: "2026-09-30T12:00:00.000Z",
      userId: "u",
      updatedByName: "Braden",
    });
    expect(row).toMatchObject({
      name: "Acme (copy)",
      status: "draft",
      bid_id: null,
      file_path: "t1/plans.pdf",
      pages: [{ index: 0 }],
      objects: [{ id: "a" }],
      building_id: "b1",
      account_id: "c1",
    });
    expect(row.setup).toEqual({
      color: "White",
      copiedFrom: { takeoffId: "t1", bidId: BID, at: "2026-09-30T12:00:00.000Z" },
    });
    expect(row.objects).not.toBe(src.objects);
  });
});

describe("lock bookkeeping in setup", () => {
  it("reads copiedFrom / lockedAt and strips them for 'Use the setup from'", () => {
    const s = {
      color: "White",
      lockedAt: "2026-09-30",
      copiedFrom: { takeoffId: "t1", bidId: BID, at: "2026-09-30" },
    };
    expect(lockMeta(s)).toEqual({
      lockedAt: "2026-09-30",
      copiedFrom: { takeoffId: "t1", bidId: BID, at: "2026-09-30" },
    });
    expect(withoutLockMeta(s)).toEqual({ color: "White" });
    expect(lockMeta({ copiedFrom: "junk" })).toEqual({});
    expect(lockMeta(null)).toEqual({});
  });
});

describe("shouldAutosave (the autosave guard)", () => {
  it("never saves a locked takeoff, even with changes", () => {
    expect(shouldAutosave({ locked: true, changed: true })).toBe(false);
    expect(shouldAutosave({ locked: true, changed: false })).toBe(false);
  });
  it("saves an unlocked takeoff only when something changed", () => {
    expect(shouldAutosave({ locked: false, changed: true })).toBe(true);
    expect(shouldAutosave({ locked: false, changed: false })).toBe(false);
  });
});

describe("toolAllowed", () => {
  it("a locked takeoff can only select and measure", () => {
    for (const t of ["scale", "area", "linear", "count", "cutout"])
      expect(toolAllowed(t, true)).toBe(false);
    expect(toolAllowed("select", true)).toBe(true);
    expect(toolAllowed("dimension", true)).toBe(true);
    expect(toolAllowed("area", false)).toBe(true);
  });
});

describe("bidActions", () => {
  it("locked: only Edit a copy (no Create, no Update)", () => {
    expect(bidActions({ locked: true, originBid: { id: BID, name: "Acme" } })).toEqual({
      createBid: false,
      editCopy: true,
      updateBid: null,
    });
  });
  it("a copy: Create bid makes a NEW bid; Update of the original's bid needs a confirm", () => {
    const a = bidActions({ locked: false, originBid: { id: BID, name: "Acme" } });
    expect(a.createBid).toBe(true);
    expect(a.updateBid).toEqual({ bidId: BID, bidName: "Acme", needsConfirm: true });
  });
  it("a fresh takeoff: Create bid only", () => {
    expect(bidActions({ locked: false, originBid: null })).toEqual({
      createBid: true,
      editCopy: false,
      updateBid: null,
    });
  });
});

describe("takeoffChangeList", () => {
  const page: TakeoffPage = {
    index: 0,
    name: "A1",
    rotation: 0,
    scale: { ax: 0, ay: 0, bx: 100, by: 0, feet: 100 },
  };
  const area = (id: string, name: string, pts: PagePoint[]): TakeoffObject => ({
    id,
    kind: "area",
    page: 0,
    points: pts,
    attrs: { name },
  });
  const rect = (w: number, h: number): PagePoint[] => [
    [0, 0],
    [w, 0],
    [w, h],
    [0, h],
  ];
  const parapet = (len: number): TakeoffObject => ({
    id: "p",
    kind: "linear",
    page: 0,
    points: [
      [0, 0],
      [len, 0],
    ],
    attrs: { name: "Parapet 1", role: "parapet" },
  });
  const drains = (n: number): TakeoffObject => ({
    id: "d",
    kind: "count",
    page: 0,
    points: Array.from({ length: n }, (_, i) => [i, i] as PagePoint),
    attrs: { name: "Drain 1", role: "drain" },
  });
  const q = (objs: TakeoffObject[]) => takeoffQuantities([page], objs);

  it("lists what differs, by name", () => {
    const before = q([area("a", "Section 1", rect(100, 60)), parapet(100), drains(4)]);
    const after = q([
      area("a", "Section 1", rect(120, 60)),
      area("b", "Section 2", rect(10, 10)),
      parapet(120),
      drains(5),
    ]);
    expect(takeoffChangeList(before, after)).toEqual([
      "Section “Section 1”: 6,000 → 7,200 sq ft, 320 → 360 ft around.",
      "Section “Section 2” added: 100 sq ft, 40 ft around.",
      "“Parapet 1”: 100 → 120 ft.",
      "“Drain 1”: 4 → 5.",
    ]);
    expect(takeoffChangeList(after, before)).toContain("Section “Section 2” removed.");
  });

  it("is empty when nothing measured changed", () => {
    const objs = [area("a", "Section 1", rect(100, 60)), parapet(100)];
    expect(takeoffChangeList(q(objs), q(objs))).toEqual([]);
  });
});

describe("the words the user sees", () => {
  it("banner and toast name the bid", () => {
    expect(lockBannerText("Acme re-roof", "2026-09-30T12:00:00.000Z")).toBe(
      "This takeoff built bid “Acme re-roof” on Sep 30, 2026. It is locked so a slip cannot change that bid. To measure again, edit a copy.",
    );
    expect(lockBannerText(null, null)).toMatch(/^This takeoff built a bid\. It is locked/);
    expect(lockedToast("Acme re-roof")).toBe(
      "Takeoff locked: it built “Acme re-roof”. Edit a copy to measure again.",
    );
  });
});
