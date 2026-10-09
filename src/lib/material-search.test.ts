/**
 * Owner, Oct 9: "for materials you add via the truck or the shop which is good but they need to
 * also be able to search materials and add, and when they do that they can assign it from the
 * shop or vehicle." searchMaterials groups every stocked cell (all locations) with the service
 * material list and says per result where it can be taken from; the screen's Find box turns a
 * tap on a source chip into one unit against the ticket at that location. The server function
 * carries no prices. These fail on the old code (no material-search.ts, no Find box, no
 * listServiceMaterialOptions).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import {
  SEARCH_MAX_RESULTS,
  searchMaterials,
  type SearchCatalog,
  type SearchLocation,
  type SearchStock,
} from "@/lib/material-search";

vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    let validate: (d: unknown) => unknown = (d) => d;
    const b = {
      middleware: () => b,
      validator: (v: (d: unknown) => unknown) => {
        validate = v;
        return b;
      },
      handler:
        (h: (a: { data: unknown; context: unknown }) => unknown) =>
        (arg: { data: unknown; context: unknown }) =>
          h({ data: validate(arg.data), context: arg.context }),
    };
    return b;
  },
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));
vi.mock("@/lib/ticket-events.server", () => ({ afterTicketStage: vi.fn(async () => {}) }));
vi.mock("@/lib/followups.server", () => ({ syncFollowup: vi.fn(async () => {}) }));

import {
  listServiceMaterialOptions,
  type ServiceMaterialOption,
} from "@/lib/service-field.functions";

const MINE = "truck-a";
const locations: SearchLocation[] = [
  { id: "shop", name: "Shop", kind: "shop" },
  { id: MINE, name: "Truck A", kind: "vehicle" },
  { id: "truck-b", name: "Truck B", kind: "vehicle" },
  { id: "truck-c", name: "Truck C", kind: "vehicle" },
];
const caulk = {
  screen_id: "duro_last:sealants",
  row_label: "Duro-Caulk",
  price_col: "White",
  category: "Sealants",
  unit: "tube",
};
const stock: SearchStock[] = [
  { ...caulk, location_id: "shop", on_hand: 10, item_nos: ["1106"] },
  { ...caulk, location_id: MINE, on_hand: 2, item_nos: ["1106"] },
  { ...caulk, location_id: "truck-b", on_hand: 3, item_nos: ["1106"] },
  { ...caulk, location_id: "truck-c", on_hand: 0, item_nos: ["1106"] },
  {
    screen_id: "duro_last:adhesives",
    row_label: "Duro-Fleece Adhesive",
    price_col: "price",
    category: "Adhesives",
    unit: "4-Cartridge Case",
    location_id: "shop",
    on_hand: 1.5,
    item_nos: [],
  },
];
const catalog: SearchCatalog[] = [
  {
    screen_id: "service",
    row_label: "Acetone",
    price_col: "price",
    label: "Acetone",
    category: "Cleaning Supplies",
    unit: "gal",
    piece: null,
    item_no: null,
  },
  {
    ...caulk,
    label: "Duro-Caulk White",
    category: "Sealants",
    unit: "tube",
    piece: null,
    item_no: "1106",
  },
];

describe("searchMaterials", () => {
  it("needs two characters, then matches name, colour, category and item # across cells", () => {
    expect(searchMaterials("c", stock, catalog, locations, MINE)).toEqual([]);
    expect(searchMaterials(" ", stock, catalog, locations, MINE)).toEqual([]);
    expect(
      searchMaterials("1106", stock, catalog, locations, MINE).map((r) => r.row_label),
    ).toEqual(["Duro-Caulk"]);
    expect(searchMaterials("clean", stock, catalog, locations, MINE).map((r) => r.label)).toEqual([
      "Acetone",
    ]);
  });
  it("groups one cell from every location, my truck first, then the shop, then other trucks that have it", () => {
    const [r, ...rest] = searchMaterials("caulk", stock, catalog, locations, MINE);
    expect(rest).toEqual([]);
    expect(r).toMatchObject({ label: "Duro-Caulk White", item_no: "1106", unit: "tube" });
    expect(r!.sources).toEqual([
      { location_id: MINE, location_name: "Truck A", kind: "mine", on_hand: 2 },
      { location_id: "shop", location_name: "Shop", kind: "shop", on_hand: 10 },
      { location_id: "truck-b", location_name: "Truck B", kind: "other", on_hand: 3 },
    ]);
  });
  it("a cell nobody stocked on my truck or the shop still offers both, with 0 on hand", () => {
    const [r] = searchMaterials("fleece", stock, catalog, locations, MINE);
    expect(r!.sources).toEqual([
      { location_id: MINE, location_name: "Truck A", kind: "mine", on_hand: 0 },
      { location_id: "shop", location_name: "Shop", kind: "shop", on_hand: 1.5 },
    ]);
  });
  it("a service material nobody has stocked comes up from the catalog alone", () => {
    const [r] = searchMaterials("acetone", stock, catalog, locations, MINE);
    expect(r).toMatchObject({
      screen_id: "service",
      row_label: "Acetone",
      label: "Acetone",
      category: "Cleaning Supplies",
      sources: [
        { kind: "mine", on_hand: 0 },
        { kind: "shop", on_hand: 0 },
      ],
    });
  });
  it("with no truck of my own, only the shop and the trucks that have it; stock not yet read: on-hand unknown", () => {
    const [r] = searchMaterials("caulk", stock, catalog, locations, null);
    expect(r!.sources.map((s) => [s.kind, s.location_name])).toEqual([
      ["shop", "Shop"],
      ["other", "Truck A"],
      ["other", "Truck B"],
    ]);
    const [u] = searchMaterials("caulk", null, catalog, locations, MINE);
    expect(u!.sources).toEqual([
      { location_id: MINE, location_name: "Truck A", kind: "mine", on_hand: null },
      { location_id: "shop", location_name: "Shop", kind: "shop", on_hand: null },
    ]);
  });
  it("what the screen already knows (the truck row's piece and name) wins over the derivation", () => {
    const [r] = searchMaterials("fleece", stock, catalog, locations, MINE, [
      {
        screen_id: "duro_last:adhesives",
        row_label: "Duro-Fleece Adhesive",
        price_col: "price",
        label: "Duro-Fleece Adhesive (cartridge)",
        piece: { name: "cartridge", perPack: 4 },
        item_no: "1106",
        unit: "4-Cartridge Case",
        category: "Adhesives",
      },
    ]);
    expect(r).toMatchObject({
      label: "Duro-Fleece Adhesive (cartridge)",
      piece: { name: "cartridge", perPack: 4 },
      item_no: "1106",
    });
  });
  it("caps the list at 12, what is on my truck first, then what is stocked anywhere, then by name", () => {
    const many: SearchCatalog[] = Array.from({ length: 20 }, (_, i) => ({
      screen_id: "service",
      row_label: `Thing ${String(i).padStart(2, "0")}`,
      price_col: "price",
      label: `Thing ${String(i).padStart(2, "0")}`,
      category: "Misc",
      unit: "each",
      piece: null,
      item_no: null,
    }));
    const stocked: SearchStock[] = [
      { ...many[15]!, location_id: "shop", on_hand: 1 },
      { ...many[19]!, location_id: MINE, on_hand: 1 },
    ];
    const out = searchMaterials("thing", stocked, many, locations, MINE);
    expect(out).toHaveLength(SEARCH_MAX_RESULTS);
    expect(out.slice(0, 3).map((r) => r.row_label)).toEqual(["Thing 19", "Thing 15", "Thing 00"]);
  });
});

// ---------------------------------------------------------------------------------------------

/** A PostgREST stand-in for the two reads the server function makes, plus the profile check. */
function fakeDb(tables: Record<string, Record<string, unknown>[]>) {
  const from = (table: string) => {
    const preds: ((r: Record<string, unknown>) => boolean)[] = [];
    const run = () => ({
      data: (tables[table] ?? []).filter((r) => preds.every((p) => p(r))),
      error: null,
    });
    const q = {
      select: () => q,
      eq: (c: string, v: unknown) => (preds.push((r) => r[c] === v), q),
      order: () => q,
      maybeSingle: async () => ({ data: run().data[0] ?? null, error: null }),
      then: (res: (r: unknown) => unknown, rej?: (e: unknown) => unknown) =>
        Promise.resolve(run()).then(res, rej),
    };
    return q;
  };
  return { from };
}

describe("listServiceMaterialOptions", () => {
  const TECH = "tech-1";
  const db = fakeDb({
    profiles: [
      {
        id: TECH,
        role: "user",
        access: ["service"],
        technician: true,
        full_name: "T",
        email: "t@x",
      },
    ],
    service_materials_catalog: [
      {
        id: "m1",
        name: '2" DL Open Stack',
        unit: "Each",
        sort: 1,
        active: true,
        stock_screen_id: "duro_last:pipe_stacks",
        stock_row_label: '2" Closed/Open',
        stock_price_col: "Price",
        category: null,
        stock_per_unit: null,
        piece_name: null,
      },
      {
        id: "m2",
        name: '2" DL Closed Stack',
        unit: "Each",
        sort: 2,
        active: true,
        stock_screen_id: "duro_last:pipe_stacks",
        stock_row_label: '2" Closed/Open',
        stock_price_col: "Price",
        category: null,
        stock_per_unit: null,
        piece_name: null,
      },
      {
        id: "m3",
        name: "ISO Board 4x8",
        unit: "Each",
        sort: 3,
        active: true,
        stock_screen_id: "duro_last:underlayment",
        stock_row_label: "ISO",
        stock_price_col: "Price",
        category: "Underlayment",
        stock_per_unit: 32,
        piece_name: "board",
      },
      {
        id: "m4",
        name: "Acetone",
        unit: "Gallon",
        sort: 4,
        active: true,
        stock_screen_id: null,
        stock_row_label: null,
        stock_price_col: null,
        category: "Cleaning Supplies",
        stock_per_unit: null,
        piece_name: null,
      },
      {
        id: "m5",
        name: "Old thing",
        unit: "ea",
        sort: 5,
        active: false,
        stock_screen_id: null,
        stock_row_label: null,
        stock_price_col: null,
        category: null,
        stock_per_unit: null,
        piece_name: null,
      },
    ],
    catalog_item_numbers: [
      {
        screen_id: "duro_last:pipe_stacks",
        row_label: '2" Closed/Open',
        price_col: "Price",
        item_no: "2020",
      },
      {
        screen_id: "duro_last:underlayment",
        row_label: "ISO",
        price_col: "Price",
        item_no: "3001",
      },
      {
        screen_id: "duro_last:underlayment",
        row_label: "ISO",
        price_col: "Price",
        item_no: "3002",
      },
    ],
  });
  it("one option per stock cell, named by the first material, with piece and a unique item #, no prices", async () => {
    // createServerFn is mocked above to "validate, then call the handler" (tech-price-free-reads).
    const fn = listServiceMaterialOptions as unknown as (a: {
      data: unknown;
      context: unknown;
    }) => Promise<ServiceMaterialOption[]>;
    const out = await fn({ data: undefined, context: { supabase: db, userId: TECH } });
    expect(out).toEqual([
      {
        screen_id: "duro_last:pipe_stacks",
        row_label: '2" Closed/Open',
        price_col: "Price",
        label: '2" DL Open Stack',
        category: "Service materials",
        unit: "each",
        piece: null,
        item_no: "2020",
      },
      {
        screen_id: "duro_last:underlayment",
        row_label: "ISO",
        price_col: "Price",
        label: "ISO Board 4x8",
        category: "Underlayment",
        unit: "sq ft",
        piece: { name: "board", perPack: 1 / 32 },
        item_no: null,
      },
      {
        screen_id: "service",
        row_label: "Acetone",
        price_col: "price",
        label: "Acetone",
        category: "Cleaning Supplies",
        unit: "gal",
        piece: null,
        item_no: null,
      },
    ]);
    for (const o of out) expect(Object.keys(o)).not.toContain("cost");
  });
  it("reads the price-free view, never the costs table", () => {
    const src = readFileSync("src/lib/service-field.functions.ts", "utf8");
    const start = src.indexOf("export const listServiceMaterialOptions = createServerFn");
    expect(start).toBeGreaterThan(0);
    const fn = src.slice(start, src.indexOf("\nexport ", start + 1));
    expect(fn).toContain("loadServiceMaterialLinks(sb)");
    expect(fn).not.toMatch(/cost|price\b|loadServiceMaterials\(/);
  });
});

// ---------------------------------------------------------------------------------------------

describe("the Materials section's Find box", () => {
  const src = readFileSync("src/components/service/materials-section.tsx", "utf8");
  it("searches any material once two characters are typed, reading the all-locations stock on demand", () => {
    expect(src).toContain('placeholder="Find any material (name, colour, item #)…"');
    expect(src).toContain('aria-label="Find any material"');
    expect(src).toContain("const finding = findQ.length >= SEARCH_MIN_CHARS;");
    expect(src).toMatch(
      /queryKey: \["inventory-stock"\],\s*queryFn: \(\) => stockFn\(\),\s*enabled: !!session && canLog && finding,\s*staleTime: 60_000,/,
    );
    expect(src).toContain('queryKey: ["service-material-options"],');
    expect(src).toContain("searchMaterials(\n        findQ,");
  });
  it("a source chip adds one unit against this ticket at that location through the truck row's own add", () => {
    expect(src).toContain("const addFromSearch = (res: MaterialResult, src: MaterialSource) => {");
    expect(src).toContain("key: cellKey({ ...res, location_id: src.location_id }),");
    expect(src).toContain("location_id: src.location_id,");
    expect(src).toContain("location_name: src.location_name,");
    expect(src).toContain("add(r, 1, src.on_hand !== null);");
    expect(src).toContain("onClick={() => addFromSearch(res, src)}");
    expect(src).toContain(
      'src.kind === "mine" ? "My truck" : src.kind === "shop" ? "Shop" : src.location_name',
    );
    // A source with nothing left reads "none", dashed and muted.
    expect(src).toContain(
      'return units <= EPS ? "none" : `${amountText(units, res.piece, res.unit)} left`;',
    );
    expect(src).toContain('none ? "border-dashed text-muted-foreground" : ""');
  });
  it("the truck list, the Usual chips and the elsewhere panel are still there; a logged tap moves the stock cache too", () => {
    expect(src).toContain("From my truck");
    expect(src).toContain("Usual for {t.name}");
    expect(src).toContain('aria-label="Material from elsewhere"');
    expect(src).toContain('qc.setQueryData<StockRow[]>(["inventory-stock"], (old) =>');
  });
});
