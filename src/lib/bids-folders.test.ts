/**
 * Project Bids' folder view (owner, Oct 7): a List / Folders toggle, year folders, and the
 * groups inside a year.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  bidsInYear,
  bidYear,
  FOLDER_GROUPS,
  foldersFor,
  readBidsView,
  readFolderGroup,
  writeBidsView,
  writeFolderGroup,
  yearFolders,
} from "./bids-folders";

const bid = (id: string, created: string, total: number, extra: Record<string, unknown> = {}) => ({
  id,
  created_at: created,
  grand_total: total,
  ...extra,
});
const rows = [
  bid("a", "2026-10-06T12:00:00Z", 100, {
    customer: "Owens",
    estimator: "Brian",
    systems: ["Duro-Last"],
    status: "Draft",
  }),
  bid("b", "2026-03-02T12:00:00Z", 50, {
    customer: "",
    estimator: "Brian",
    systems: [],
    status: "Won",
  }),
  bid("c", "2025-12-31T12:00:00Z", 7, {
    customer: "Bell",
    estimator: "",
    systems: ["Duro-Last", "EPDM"],
    status: "Draft",
  }),
];
type R = (typeof rows)[number];
const facts = (b: R) => ({
  customer: b.customer,
  estimator: b.estimator,
  systems: b.systems,
  status: b.status,
});

describe("year folders", () => {
  it("one per year with a count and total, newest first; a year opens to its bids", () => {
    expect(yearFolders(rows)).toEqual([
      { year: 2026, count: 2, total: 150 },
      { year: 2025, count: 1, total: 7 },
    ]);
    expect(bidsInYear(rows, 2026).map((b) => b.id)).toEqual(["a", "b"]);
    expect(bidYear("2025-12-31T12:00:00Z")).toBe(2025);
    expect(yearFolders([])).toEqual([]);
  });
});

describe("groups inside a year", () => {
  const y = bidsInYear(rows, 2026);
  it("months newest first", () => {
    expect(foldersFor(y, "month", facts).map((g) => [g.label, g.rows.map((b) => b.id)])).toEqual([
      ["October 2026", ["a"]],
      ["March 2026", ["b"]],
    ]);
  });
  it("customers A–Z with the blank last; estimators the same", () => {
    expect(foldersFor(y, "customer", facts).map((g) => g.label)).toEqual(["Owens", "No customer"]);
    expect(foldersFor(rows, "estimator", facts).map((g) => [g.label, g.rows.length])).toEqual([
      ["Brian", 2],
      ["No estimator", 1],
    ]);
  });
  it("status by name; a bid with two roof systems sits in both system folders", () => {
    expect(foldersFor(rows, "status", facts).map((g) => [g.label, g.rows.length])).toEqual([
      ["Draft", 2],
      ["Won", 1],
    ]);
    expect(
      foldersFor(rows, "system", facts).map((g) => [g.label, g.rows.map((b) => b.id)]),
    ).toEqual([
      ["Duro-Last", ["a", "c"]],
      ["EPDM", ["c"]],
      ["No roof system", ["b"]],
    ]);
    expect(FOLDER_GROUPS).toEqual(["month", "customer", "status", "estimator", "system"]);
  });
});

describe("the remembered view", () => {
  const mem = () => {
    const m = new Map<string, string>();
    return {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
    };
  };
  it("defaults to the list and the month grouping; survives a reload; blocked storage is fine", () => {
    const s = mem();
    expect(readBidsView(s)).toBe("list");
    writeBidsView(s, "folders");
    expect(readBidsView(s)).toBe("folders");
    expect(readFolderGroup(s)).toBe("month");
    writeFolderGroup(s, "customer");
    expect(readFolderGroup(s)).toBe("customer");
    const throwing = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readBidsView(throwing)).toBe("list");
    expect(() => writeBidsView(throwing, "folders")).not.toThrow();
    expect(readBidsView(null)).toBe("list");
  });
});

describe("the wiring", () => {
  it("the Project Bids page has the toggle, the year folders and the grouping chips, and one card render for both views", () => {
    const src = readFileSync(fileURLToPath(new URL("../routes/bids.tsx", import.meta.url)), "utf8");
    expect(src).toContain('onClick={() => setView(view === "folders" ? "list" : "folders")}');
    expect(src).toContain("yearFolders(filtered).map(");
    expect(src).toContain("foldersFor(bidsInYear(filtered, folderYear), folderGroup,");
    expect(src).toContain("FOLDER_GROUPS.map((g) =>");
    expect((src.match(/\.map\(renderBid\)/g) ?? []).length).toBe(2);
  });
});
