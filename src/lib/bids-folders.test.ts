/**
 * Project Bids' folder views: the List / Years toggle, year folders and the groups inside a year
 * (owner, Oct 7), and the assigned folders (owner, Oct 13: "Bid Advantage, when a bid was saved,
 * was able to save it in a file, so Bell County Schools could be saved under a folder separately
 * from the other bids" → "ok lets just do a by folder view that you assign"): a folder is a label
 * on the bid (bids.folder), not the customer; the By folder view, Move to folder…, Rename, the
 * Setup › Bid Info Folder box, and migration 20261013130000.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  bidsInFolder,
  bidsInYear,
  bidYear,
  FOLDER_GROUP_LABELS,
  FOLDER_GROUPS,
  FOLDER_MAX,
  folderCards,
  folderKey,
  folderOptions,
  foldersFor,
  normalizeFolder,
  readBidsView,
  readFolderGroup,
  suggestFolder,
  UNFILED,
  UNFILED_KEY,
  writeBidsView,
  writeFolderGroup,
  yearFolders,
} from "./bids-folders";

const here = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

interface R {
  id: string;
  created_at: string;
  grand_total: number;
  customer: string;
  estimator: string;
  systems: string[];
  status: string;
  folder?: string | null | undefined;
}
const bid = (
  id: string,
  created: string,
  total: number,
  extra: Pick<R, "customer" | "estimator" | "systems" | "status"> & {
    folder?: string | null | undefined;
  },
): R => ({ id, created_at: created, grand_total: total, ...extra });
const rows: R[] = [
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
const facts = (b: R) => ({
  customer: b.customer,
  estimator: b.estimator,
  systems: b.systems,
  status: b.status,
  folder: b.folder,
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
    expect(FOLDER_GROUPS).toEqual(["month", "customer", "status", "estimator", "system", "folder"]);
    expect(FOLDER_GROUP_LABELS.folder).toBe("Folder");
  });
  it("by folder (owner, Oct 13): A–Z, one spelling per folder, Unfiled last", () => {
    const filed: R[] = [
      bid("a", "2026-10-06T12:00:00Z", 100, { ...facts(rows[0]!), folder: "Bell County Schools" }),
      bid("b", "2026-03-02T12:00:00Z", 50, { ...facts(rows[1]!), folder: null }),
      bid("c", "2026-02-01T12:00:00Z", 7, { ...facts(rows[2]!), folder: "bell county schools" }),
      bid("d", "2026-01-01T12:00:00Z", 1, { ...facts(rows[2]!), folder: "  Airports " }),
    ];
    expect(
      foldersFor(filed, "folder", facts).map((g) => [g.label, g.rows.map((b) => b.id)]),
    ).toEqual([
      ["Airports", ["d"]],
      ["Bell County Schools", ["a", "c"]],
      [UNFILED, ["b"]],
    ]);
    // Older callers that give no folder: everything is Unfiled.
    expect(foldersFor(rows, "folder", (b) => ({ ...facts(b), folder: undefined }))).toEqual([
      { label: UNFILED, rows },
    ]);
  });
});

describe("assigned folders (owner, Oct 13)", () => {
  it("normalizeFolder: trims, collapses inner whitespace, cuts at 80, blank → null, Unfiled → null", () => {
    expect(normalizeFolder("  Bell   County\tSchools ")).toBe("Bell County Schools");
    expect(normalizeFolder("")).toBeNull();
    expect(normalizeFolder("   ")).toBeNull();
    expect(normalizeFolder(null)).toBeNull();
    expect(normalizeFolder(undefined)).toBeNull();
    expect(normalizeFolder("unfiled")).toBeNull();
    expect(normalizeFolder(UNFILED)).toBeNull();
    expect(FOLDER_MAX).toBe(80);
    const long = `${"x".repeat(79)} yz`;
    expect(normalizeFolder(long)).toBe("x".repeat(79));
    expect(normalizeFolder("a".repeat(120))).toHaveLength(80);
    expect(normalizeFolder("Airports")).toBe("Airports");
  });
  it("folderKey: case-insensitive, whitespace-insensitive; a null folder keys to Unfiled", () => {
    expect(folderKey("Bell County")).toBe("bell county");
    expect(folderKey("bell  county ")).toBe(folderKey("Bell County"));
    expect(folderKey(null)).toBe(UNFILED_KEY);
    expect(folderKey("")).toBe(UNFILED_KEY);
    expect(folderKey("Unfiled")).toBe(UNFILED_KEY);
    expect(UNFILED_KEY).toBe("");
  });
  it("suggestFolder: the customer's name, normalized, or nothing", () => {
    expect(suggestFolder(" Bell County  Schools ")).toBe("Bell County Schools");
    expect(suggestFolder("")).toBeNull();
    expect(suggestFolder(undefined)).toBeNull();
  });
  const filed: R[] = [
    bid("a", "2026-10-06T12:00:00Z", 100, { ...facts(rows[0]!), folder: "Bell County Schools" }),
    bid("b", "2026-03-02T12:00:00Z", 50, { ...facts(rows[1]!), folder: null }),
    bid("c", "2026-02-01T12:00:00Z", 7, { ...facts(rows[2]!), folder: "bell county schools" }),
    bid("d", "2026-01-01T12:00:00Z", 1, { ...facts(rows[2]!), folder: "Airports" }),
    bid("e", "2025-01-01T12:00:00Z", 2, { ...facts(rows[2]!) }),
  ];
  it("folderCards: A–Z, first-seen spelling, count and total, Unfiled last; a folder opens to its bids", () => {
    expect(
      folderCards(filed).map((c) => [c.key, c.name, c.count, c.total, c.bids.map((b) => b.id)]),
    ).toEqual([
      ["airports", "Airports", 1, 1, ["d"]],
      ["bell county schools", "Bell County Schools", 2, 107, ["a", "c"]],
      [UNFILED_KEY, UNFILED, 2, 52, ["b", "e"]],
    ]);
    expect(bidsInFolder(filed, "bell county schools").map((b) => b.id)).toEqual(["a", "c"]);
    expect(bidsInFolder(filed, UNFILED_KEY).map((b) => b.id)).toEqual(["b", "e"]);
    expect(bidsInFolder(filed, "nope")).toEqual([]);
    // No Unfiled card when every bid is filed; nothing at all for no bids.
    expect(folderCards(filed.filter((b) => b.folder)).map((c) => c.name)).toEqual([
      "Airports",
      "Bell County Schools",
    ]);
    expect(folderCards([])).toEqual([]);
    // The second spelling does not become its own card.
    expect(folderCards([filed[2]!, filed[0]!]).map((c) => c.name)).toEqual(["bell county schools"]);
  });
  it("folderOptions: the names in use for the picker, A–Z, never Unfiled", () => {
    expect(folderOptions(filed)).toEqual(["Airports", "Bell County Schools"]);
    expect(folderOptions([])).toEqual([]);
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
    // The third view (owner, Oct 13); a value stored before it existed still reads back.
    writeBidsView(s, "byFolder");
    expect(readBidsView(s)).toBe("byFolder");
    s.setItem("bid-o-matic:bids-view", "folders");
    expect(readBidsView(s)).toBe("folders");
    s.setItem("bid-o-matic:bids-view", "garbage");
    expect(readBidsView(s)).toBe("list");
    expect(readFolderGroup(s)).toBe("month");
    writeFolderGroup(s, "customer");
    expect(readFolderGroup(s)).toBe("customer");
    writeFolderGroup(s, "folder");
    expect(readFolderGroup(s)).toBe("folder");
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
  const page = here("../routes/bids.tsx");
  it("the Project Bids page has the three-way toggle, the year folders and the grouping chips, and one card render for every view", () => {
    for (const v of [
      '["list", "List", List,',
      '["folders", "Years", Folder,',
      '["byFolder", "By folder", FolderOpen,',
    ])
      expect(page).toContain(v);
    expect(page).toContain("onClick={() => setView(v)}");
    expect(page).toContain("yearFolders(filtered).map(");
    expect(page).toContain("foldersFor(bidsInYear(filtered, folderYear), folderGroup,");
    expect(page).toContain("FOLDER_GROUPS.map((g) =>");
    // The year view's grouping callback hands the folder over, so "Folder" is a sixth chip.
    expect(page).toContain("folder: b.folder,");
    expect((page.match(/\.map\(renderBid\)/g) ?? []).length).toBe(2);
    // The status groups are one block, shown in the list and inside an assigned folder.
    expect((page.match(/\bstatusGroups\b/g) ?? []).length).toBe(3);
  });
  it("By folder (owner, Oct 13): folder cards with Unfiled last, a folder opens to its status groups with a back link and Rename", () => {
    expect(page).toContain('view === "byFolder" && folderOpen === null');
    expect(page).toContain("folderCards(filtered)");
    expect(page).toContain('aria-label="Bids by folder"');
    expect(page).toContain("onClick={() => setFolderOpen(f.key)}");
    expect(page).toContain('view === "byFolder" && folderOpen !== null');
    expect(page).toContain("bidsInFolder(filtered, folderOpen)");
    expect(page).toContain("All folders");
    expect(page).toContain("rename.mutate({ from: openName, to })");
    expect(page).toContain("renameBidFolder");
    expect(page).toContain("setFolderOpen(folderKey(r.folder))");
    // Unfiled cannot be renamed.
    expect(page).toContain("folderOpen !== UNFILED_KEY && (");
    // Search matches the folder name too, and sort runs inside a folder (scopeRows → groups).
    expect(page).toContain('!(b.folder ?? "").toLowerCase().includes(q)');
    expect(page).toContain("scopeRows.filter((b) => asBidStatus(b.status) === status)");
  });
  it("Move to folder…: on every row, on the ticked selection, a datalist of folders in use, the customer suggested, Unfiled clears", () => {
    expect(page).toContain("openMove([bid.id])");
    expect(page).toContain("openMove(combineSel)");
    expect(page).toContain("Move {combineSel.length} to folder…");
    expect(page).toContain('list="bid-folder-options"');
    expect(page).toContain("folderNames.map((f) =>");
    expect(page).toContain("suggestFolder(customerOf(one))");
    expect(page).toContain(
      "moveFolder.mutate({ ids: moveFor.ids, folder: normalizeFolder(moveText) })",
    );
    expect(page).toContain("moveFolder.mutate({ ids: moveFor.ids, folder: null })");
    expect(page).toContain("setBidFolder");
    expect(page).toContain("` · Folder: ${bid.folder}`");
  });
  it("Setup › Bid Info has the Folder box (datalist of folders in use, customer suggested) saved on the row", () => {
    const est = here("../routes/estimate.tsx");
    expect(est).toContain('<Field label="Folder">');
    expect(est).toContain('id="bid-folder"');
    expect(est).toContain('list="bid-folder-options"');
    expect(est).toContain("placeholder={suggestFolder(customer.name) ?? UNFILED}");
    expect(est).toContain("(bidFolderNames ?? []).map((f) =>");
    expect(est).toContain("listBidFolders");
    expect(est).toContain('setBidFolder(loadedBid.folder ?? "")');
    expect(est).toContain("folder: normalizeFolder(bidFolder),");
    // A folder change is an unsaved change like a link change.
    expect(est).toContain('|${normalizeFolder(bidFolder) ?? ""}`');
  });
  it("the server stores it: saveBid takes folder, setBidFolder / renameBidFolder / listBidFolders exist, listBids returns the row", () => {
    const fns = here("./bids.functions.ts");
    expect(fns).toContain("folder: folderText.nullable().optional(),");
    expect(fns).toContain(
      "...(data.folder !== undefined ? { folder: normalizeFolder(data.folder) } : {}),",
    );
    expect(fns).toContain("export const setBidFolder = createServerFn");
    expect(fns).toContain("ids: z.array(z.string().uuid()).min(1).max(200),");
    expect(fns).toContain("export const renameBidFolder = createServerFn");
    expect(fns).toContain("export const listBidFolders = createServerFn");
    // listBids selects * so the column rides along.
    expect(fns).toContain('.select("*, account:crm_accounts!bids_account_id_fkey(id, name)")');
    const types = here("../integrations/supabase/types.ts");
    expect(types).toContain("folder: string | null;");
    expect(types).toContain("folder?: string | null;");
  });
  it("migration 20261013130000: the nullable folder column, its comment and the lower() index on live filed bids; idempotent", () => {
    const sql = here("../../supabase/migrations/20261013130000_bid_folders.sql")
      .replace(/--[^\n]*/g, "")
      .replace(/\s+/g, " ");
    expect(sql).toContain("alter table public.bids add column if not exists folder text;");
    expect(sql).toContain("comment on column public.bids.folder is");
    expect(sql).toContain(
      "create index if not exists bids_folder_idx on public.bids (lower(folder)) where folder is not null and deleted_at is null;",
    );
    expect(sql).not.toMatch(/not null default/);
  });
});
