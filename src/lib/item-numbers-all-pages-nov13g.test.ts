/**
 * Nov 13: the item-number map holds more than 1,000 rows (1,252 on the live site) and one
 * request returns at most 1,000. listItemNumbers and listItemNumberKeys each made one request,
 * so the Price import, the Item numbers tab, the catalog editor and the Inventory page never saw
 * the mappings after the first 1,000 in screen order (most of the Non-DL TPO screens). A price
 * sheet's lines for those products came up "unmatched". Both now read every page.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));

import {
  listItemNumberKeys,
  listItemNumbers,
  parseItemNumberKeyLine,
} from "@/lib/admin-item-numbers.functions";
import { fakeSupabase } from "@/test/fake-supabase";

type Row = Record<string, unknown>;
type Fn = (a: { data: unknown; context: unknown }) => Promise<unknown>;
const ADMIN = "00000000-0000-4000-8000-00000000000d";
const TOTAL = 1252;

/** 1,252 mappings as the live map has them: 766 Duro-Last, 216 EPDM, 242 Non-DL TPO, 28 Non-DL. */
function mappings(): Row[] {
  const rows: Row[] = [];
  const add = (screen: string, n: number) => {
    for (let i = 0; i < n; i++)
      rows.push({
        item_no: `${screen.slice(0, 3).toUpperCase()}${String(i).padStart(4, "0")}`,
        screen_id: screen,
        row_label: `Row ${String(i).padStart(4, "0")}`,
        price_col: "Price",
        dl_description: null,
        last_price: null,
        last_import_at: null,
      });
  };
  add("duro_last:pipe_stacks", 766);
  add("epdm:other_accessories", 216);
  add("non_dl_tpo:other_accessories", 242);
  add("non_dl:preset_custom_applications", 28);
  return rows;
}

function world() {
  // maxRows: every select stops at 1,000 rows, as the live database's requests do.
  const env = fakeSupabase(
    {
      profiles: [{ id: ADMIN, role: "admin", access: [], technician: false }],
      catalog_item_numbers: mappings(),
    },
    { maxRows: 1000 },
  );
  return env.db;
}
const call = <T>(fn: unknown, db: unknown) =>
  (fn as Fn)({ data: undefined, context: { supabase: db, userId: ADMIN } }) as Promise<T>;

describe("the item-number map is read whole", () => {
  it("listItemNumbers returns all 1,252, the Non-DL TPO ones included", async () => {
    const rows = await call<Row[]>(listItemNumbers, world());
    expect(rows).toHaveLength(TOTAL);
    expect(rows.filter((r) => r["screen_id"] === "non_dl_tpo:other_accessories")).toHaveLength(242);
    expect(rows.filter((r) => r["screen_id"] === "non_dl:preset_custom_applications")).toHaveLength(
      28,
    );
    // No row twice: the paging has a unique last sort key.
    expect(
      new Set(rows.map((r) => `${r["screen_id"]}|${r["row_label"]}|${r["item_no"]}`)).size,
    ).toBe(TOTAL);
  });

  it("listItemNumberKeys returns all 1,252 lines too", async () => {
    const lines = await call<string[]>(listItemNumberKeys, world());
    expect(lines).toHaveLength(TOTAL);
    const keys = lines.map((l) => parseItemNumberKeyLine(l).key);
    expect(keys.filter((k) => k.startsWith("non_dl_tpo:other_accessories|"))).toHaveLength(242);
    expect(keys.filter((k) => k.startsWith("non_dl:preset_custom_applications|"))).toHaveLength(28);
  });

  it("both reads page with a unique last sort key", () => {
    const src = readFileSync("src/lib/admin-item-numbers.functions.ts", "utf8").replace(
      /\s+/g,
      " ",
    );
    expect(src).toContain('import { fetchAllPages } from "@/lib/paging";');
    expect(src.split("fetchAllPages<").length - 1).toBe(2);
    expect(
      src.split(
        '.order("screen_id") .order("row_label") .order("price_col") .order("item_no") .range(from, to)',
      ).length - 1,
    ).toBe(2);
  });
});
