/**
 * The Estimate Pricing side of the accessory families (owner, Oct 26–27: "on the estimate
 * pricing add [the Duro-Tech TPO accessories] under duro last pricing under their respective
 * labels … then in estimate pricing add non dl tpo and epdm accessories as an option under non
 * dl tpo and epdm. this will hold all the newly added accessories pricing and item numbers.
 * ensure everything is wired correctly"; Oct 27, question 8: a price-list upload updates those
 * rows by item number):
 *
 *  - two pages, /admin/non-dl-tpo (Non-DL TPO Accessories) and /admin/epdm (EPDM Accessories),
 *    a CatalogEditor on the `non_dl_tpo` / `epdm` branch with a category picker and ?cat=, gated
 *    like every pricing page; listed under Non Duro-Last Pricing in the menu, and Duro-Last
 *    Pricing lists its new Other Accessories screen;
 *  - the Item Numbers tab and the price import see every screen of the four branches
 *    (listPriceTargets), and an import writes to whatever screen a mapping names
 *    (applyPriceImport on epdm:sealants);
 *  - the editor shows item numbers on the family rows and on Non Duro-Last; nothing is locked;
 *  - the Adhesives hint names the three new coverage groups and the Group cell offers them.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));

import { pageForPath } from "@/lib/access";
import { ADHESIVE_COVERAGE_GROUPS, ADHESIVE_GROUPS_LIST_ID } from "@/lib/adhesive-groups";
import {
  addCatalogProduct,
  applyPriceImport,
  listPriceTargets,
  type PriceTarget,
} from "@/lib/admin-item-numbers.functions";
import { BRANCH_LABELS, EPDM_PATH, NON_DL_TPO_PATH } from "@/lib/catalog-branches";
import {
  DURO_LAST_OTHER_SCREEN,
  EPDM_BRANCH,
  NON_DL_TPO_BRANCH,
  OTHER_ACCESSORIES_CATEGORY,
} from "@/lib/pricing-seed/accessory-families";
import { fakeSupabase } from "@/test/fake-supabase";

type Row = Record<string, unknown>;
type Fn = (a: { data: unknown; context: unknown }) => Promise<unknown>;
const read = (p: string) => readFileSync(p, "utf8");
const call = <T>(fn: unknown, data: unknown, db: unknown, userId: string) =>
  (fn as Fn)({ data, context: { supabase: db, userId } }) as Promise<T>;

const ADMIN = "00000000-0000-4000-8000-00000000000d";
const profiles: Row[] = [
  { id: ADMIN, role: "admin", access: [], technician: false, full_name: "Ann", email: "a@x" },
];

describe("the two pages", () => {
  it("are pricing pages, like /admin/non-dl", () => {
    expect(NON_DL_TPO_PATH).toBe("/admin/non-dl-tpo");
    expect(EPDM_PATH).toBe("/admin/epdm");
    expect(pageForPath(NON_DL_TPO_PATH)).toBe("pricing");
    expect(pageForPath(EPDM_PATH)).toBe("pricing");
    expect(pageForPath("/admin/non-dl")).toBe("pricing");
  });
  it("Non-DL TPO Accessories: a CatalogEditor on the non_dl_tpo branch with a category picker and ?cat=", () => {
    const route = read("src/routes/admin.non-dl-tpo.tsx");
    expect(route).toContain(`createFileRoute("${NON_DL_TPO_PATH}")`);
    expect(route).toContain(`branch="${NON_DL_TPO_BRANCH}"`);
    expect(route).toContain('title="Non-DL TPO Accessories"');
    expect(route).toContain('title: "Non-DL TPO Accessories — JBK Portal"');
    expect(route).toContain("validateSearch");
    expect(route).toContain('search["cat"]');
    expect(route).toContain(
      "onCategoryChange={(c) => navigate({ search: { cat: c }, replace: true })}",
    );
    expect(route).not.toContain("hideCategoryPicker");
    expect(route).toMatch(
      /intro="[^"]*Non-DL TPO accessories group[^"]*compute like the Duro-Last screens/,
    );
  });
  it("EPDM Accessories: the same on the epdm branch", () => {
    const route = read("src/routes/admin.epdm.tsx");
    expect(route).toContain(`createFileRoute("${EPDM_PATH}")`);
    expect(route).toContain(`branch="${EPDM_BRANCH}"`);
    expect(route).toContain('title="EPDM Accessories"');
    expect(route).toContain('title: "EPDM Accessories — JBK Portal"');
    expect(route).toContain("validateSearch");
    expect(route).toContain(
      "onCategoryChange={(c) => navigate({ search: { cat: c }, replace: true })}",
    );
    expect(route).not.toContain("hideCategoryPicker");
    expect(route).toMatch(
      /intro="[^"]*EPDM accessories group[^"]*compute like the Duro-Last screens/,
    );
  });
  it("are in the generated route tree", () => {
    const tree = read("src/routeTree.gen.ts");
    expect(tree).toContain("'/admin/non-dl-tpo'");
    expect(tree).toContain("'/admin/epdm'");
  });
});

describe("the menu", () => {
  const nav = read("src/components/app-sidebar.tsx");
  const section = (title: string) => {
    const start = nav.indexOf(`title: "${title}"`);
    const end = nav.indexOf("sub: [", start) + "sub: [".length;
    const close = nav.indexOf("    ],\n  },", end);
    return nav.slice(end, close);
  };
  it("Non Duro-Last Pricing lists Non-DL TPO Accessories and EPDM Accessories after Non-DL TPO and EPDM", () => {
    const ndl = section("Non Duro-Last Pricing");
    expect(ndl).toContain('{ title: "Non-DL TPO and EPDM", url: "/admin/non-dl-membrane" }');
    expect(ndl).toContain(`{ title: "Non-DL TPO Accessories", url: "${NON_DL_TPO_PATH}" }`);
    expect(ndl).toContain(`{ title: "EPDM Accessories", url: "${EPDM_PATH}" }`);
    const order = [
      "Non-DL TPO and EPDM",
      "Non-DL TPO Accessories",
      "EPDM Accessories",
      "Roof Edge Blocking",
    ].map((t) => ndl.indexOf(`title: "${t}"`));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // The labels are the branch labels the Item Numbers tab groups by.
    expect(BRANCH_LABELS.non_dl_tpo).toBe("Non-DL TPO Accessories");
    expect(BRANCH_LABELS.epdm).toBe("EPDM Accessories");
  });
  it("Duro-Last Pricing lists Other Accessories after Membrane Accs, by the seeded category name", () => {
    const dl = section("Duro-Last Pricing");
    expect(dl).toContain(`{ title: "Other Accessories", cat: "${OTHER_ACCESSORIES_CATEGORY}" }`);
    expect(DURO_LAST_OTHER_SCREEN.category).toBe(OTHER_ACCESSORIES_CATEGORY);
    expect(dl.indexOf('title: "Membrane Accs"')).toBeLessThan(
      dl.indexOf('title: "Other Accessories"'),
    );
    expect(dl.indexOf('title: "Other Accessories"')).toBeLessThan(
      dl.indexOf('title: "EXCEPTIONAL Metals"'),
    );
  });
});

describe("the editor", () => {
  const editor = read("src/components/catalog-editor.tsx");
  it("shows item numbers on every pricing branch, not the Duro-Last one alone; seeded rows are not locked", () => {
    expect(editor).not.toContain('branch === "duro_last"');
    expect(editor).toContain("const showItemNumbers = hasItemNumbers(branch);");
    expect(editor).toContain("enabled: showItemNumbers,");
    expect(editor.match(/\{showItemNumbers &&/g)).toHaveLength(2);
    // `_locked` keeps its meaning (a seeded legacy row); the family seed sets it on no row.
    expect(editor).toContain('const LOCK_KEY = "_locked";');
    expect(read("src/lib/pricing-seed/accessory-families.ts")).not.toContain("_locked");
  });
  it("a fastener Subtype is a text cell, like a part number", () => {
    expect(editor).toContain('const isTextCol = (c: string) => isPartCol(c) || c === "Subtype";');
    expect(editor).toContain("{isTextCol(c) ? (");
  });
});

describe("the Adhesives hint and group picker", () => {
  const adh = read("src/components/adhesives-editor.tsx");
  it("names the Duro-Tech TPO, Non-DL TPO and EPDM Rubber groups and offers every group the engine knows", () => {
    expect(adh).toMatch(/Duro-Tech TPO, Non-DL TPO and EPDM Rubber for the accessory families/);
    expect(adh).toContain("<datalist id={ADHESIVE_GROUPS_LIST_ID}>");
    expect(adh).toContain("list={ADHESIVE_GROUPS_LIST_ID}");
    expect(ADHESIVE_GROUPS_LIST_ID).toBe("adhesive-coverage-groups");
    expect(ADHESIVE_COVERAGE_GROUPS).toEqual([
      "Duro-Last",
      "Duro-Bond",
      "Duro-Tuff",
      "Duro-Roof",
      "Duro-Fleece",
      "Duro-Tech TPO",
      "Non-DL TPO",
      "EPDM Rubber",
      "Insulations",
    ]);
  });
});

/* ---- the server functions, on the fake database ---- */

const screens: Row[] = [
  {
    id: "duro_last:sealants",
    branch: "duro_last",
    category: "Sealants",
    sort: 4,
    data: {
      columns: ["Description", "Part #", "Price"],
      rows: [{ Description: "Duro-Caulk Plus", "Part #": "1225B", Price: 11 }],
    },
  },
  {
    id: "non_dl:preset_custom_applications",
    branch: "non_dl",
    category: "Preset Custom Applications",
    sort: 8,
    data: {
      columns: ["Description", "Price", "LaborPerUnit", "Labor Rate"],
      rows: [
        {
          Description: "EPDM Membrane PreWash (per gal)",
          Price: 39,
          LaborPerUnit: 0,
          "Labor Rate": 0,
        },
      ],
    },
  },
  {
    id: "non_dl:lumber",
    branch: "non_dl",
    category: "Roof Edge Blocking",
    sort: 1,
    data: { columns: ["Description", "Price"], rows: [{ Description: "2x4", Price: 3 }] },
  },
  {
    id: "non_dl_tpo:sealants",
    branch: "non_dl_tpo",
    category: "Sealants",
    sort: 1,
    data: {
      columns: ["Description", "Part #", "Price"],
      rows: [
        { Description: "UltraPly TPO Cut Edge Sealant - White", "Part #": "W56TPO3001", Price: 58 },
      ],
    },
  },
  {
    id: "epdm:sealants",
    branch: "epdm",
    category: "Sealants",
    sort: 1,
    data: {
      columns: ["Description", "Part #", "Price"],
      rows: [
        { Description: "Lap Sealant (10.3 oz tube)", "Part #": "W56RAC4180", Price: 12.5 },
        { Description: "Water Block (10.3 oz tube)", "Part #": "W56RAC4190", Price: 9 },
      ],
    },
  },
  // Not a pricing branch: never a target.
  {
    id: "service:materials",
    branch: "service",
    category: "Service",
    sort: 1,
    data: { columns: ["Description", "Price"], rows: [{ Description: "Acetone", Price: 5 }] },
  },
];

function world() {
  return fakeSupabase({
    profiles: profiles.map((p) => ({ ...p })),
    pricing_catalog: JSON.parse(JSON.stringify(screens)) as Row[],
    catalog_item_numbers: [
      {
        item_no: "W56RAC4180",
        screen_id: "epdm:sealants",
        row_label: "Lap Sealant (10.3 oz tube)",
        price_col: "Price",
        dl_description: "Lap Sealant",
        last_price: null,
        last_import_at: null,
      },
    ],
    price_import_runs: [],
    price_import_changes: [],
  });
}

describe("listPriceTargets", () => {
  it("offers every screen of the four branches, grouped by branch in menu order, and no other branch", async () => {
    const env = world();
    const out = await call<PriceTarget[]>(listPriceTargets, undefined, env.db, ADMIN);
    expect(out.map((t) => t.screen_id)).toEqual([
      "duro_last:sealants",
      "non_dl:lumber",
      "non_dl:preset_custom_applications",
      "non_dl_tpo:sealants",
      "epdm:sealants",
    ]);
    const epdm = out.find((t) => t.screen_id === "epdm:sealants")!;
    expect(epdm.branch).toBe("epdm");
    expect(epdm.rows).toEqual(["Lap Sealant (10.3 oz tube)", "Water Block (10.3 oz tube)"]);
    expect(epdm.price_cols).toEqual(["Price"]);
    const custom = out.find((t) => t.screen_id === "non_dl:preset_custom_applications")!;
    expect(custom.price_cols).toEqual(["Price"]);
    // The source reads the four branches, not `.eq("branch", "duro_last")`.
    const src = read("src/lib/admin-item-numbers.functions.ts");
    expect(src).toContain('.in("branch", [...PRICE_TARGET_BRANCHES])');
    expect(src).not.toContain('.eq("branch", "duro_last")');
  });
});

describe("applyPriceImport", () => {
  it("writes the price into the screen a mapping names — epdm:sealants — stamps the mapping and logs the run", async () => {
    const env = world();
    const r = await call<{
      applied: { screen_id: string; old: number | null; new: number }[];
      missing: unknown[];
      run_id: string | null;
    }>(
      applyPriceImport,
      {
        file_name: "Firestone EPDM 2026.xlsx",
        updates: [
          {
            item_no: "W56RAC4180",
            screen_id: "epdm:sealants",
            row_label: "Lap Sealant (10.3 oz tube)",
            price_col: "Price",
            price: 13.75,
            dl_description: "Lap Sealant HS",
          },
        ],
      },
      env.db,
      ADMIN,
    );
    expect(r.missing).toEqual([]);
    expect(r.applied).toEqual([
      expect.objectContaining({ screen_id: "epdm:sealants", old: 12.5, new: 13.75 }),
    ]);
    expect(r.run_id).toBeTruthy();
    const screen = env.tables["pricing_catalog"]!.find((s) => s["id"] === "epdm:sealants")!;
    const rows = (screen["data"] as { rows: Row[] }).rows;
    expect(rows[0]!["Price"]).toBe(13.75);
    expect(rows[1]!["Price"]).toBe(9);
    // The other branches' screens are untouched.
    const tpo = env.tables["pricing_catalog"]!.find((s) => s["id"] === "non_dl_tpo:sealants")!;
    expect((tpo["data"] as { rows: Row[] }).rows[0]!["Price"]).toBe(58);
    const mapping = env.tables["catalog_item_numbers"]![0]!;
    expect(mapping["last_price"]).toBe(13.75);
    expect(mapping["dl_description"]).toBe("Lap Sealant HS");
    expect(env.tables["price_import_changes"]).toEqual([
      expect.objectContaining({
        screen_id: "epdm:sealants",
        row_label: "Lap Sealant (10.3 oz tube)",
        price_col: "Price",
        item_no: "W56RAC4180",
        old_price: 12.5,
        new_price: 13.75,
      }),
    ]);
  });
  it("a mapping on a screen that does not exist is reported, not guessed", async () => {
    const env = world();
    const r = await call<{ applied: unknown[]; missing: { item_no: string; reason: string }[] }>(
      applyPriceImport,
      {
        updates: [
          { item_no: "X1", screen_id: "epdm:nope", row_label: "A", price_col: "Price", price: 1 },
        ],
      },
      env.db,
      ADMIN,
    );
    expect(r.applied).toEqual([]);
    expect(r.missing).toEqual([{ item_no: "X1", reason: "screen epdm:nope not found" }]);
    expect(env.writes).toEqual([]);
  });
});

describe("addCatalogProduct", () => {
  it("adds a sheet line as a new row on a family screen, with its item number mapped", async () => {
    const env = world();
    await call(
      addCatalogProduct,
      {
        screen_id: "non_dl_tpo:sealants",
        row_label: "UltraPly TPO Cut Edge Sealant - Gray",
        price_col: "Price",
        price: 58,
        item_no: "W56TPOG001",
        dl_description: "Cut Edge Sealant Gray",
      },
      env.db,
      ADMIN,
    );
    const screen = env.tables["pricing_catalog"]!.find((s) => s["id"] === "non_dl_tpo:sealants")!;
    const rows = (screen["data"] as { rows: Row[] }).rows;
    expect(rows).toHaveLength(2);
    expect(rows[1]).toEqual({
      Description: "UltraPly TPO Cut Edge Sealant - Gray",
      "Part #": "W56TPOG001",
      Price: 58,
    });
    expect(env.tables["catalog_item_numbers"]).toContainEqual(
      expect.objectContaining({
        item_no: "W56TPOG001",
        screen_id: "non_dl_tpo:sealants",
        row_label: "UltraPly TPO Cut Edge Sealant - Gray",
        price_col: "Price",
        last_price: 58,
      }),
    );
  });
  it("still refuses a screen outside the pricing branches", async () => {
    const env = world();
    await expect(
      call(
        addCatalogProduct,
        {
          screen_id: "service:materials",
          row_label: "Tape",
          price_col: "Price",
          price: 1,
          item_no: "T1",
        },
        env.db,
        ADMIN,
      ),
    ).rejects.toThrow("Only the Estimate Pricing screens take imported products");
  });
});
