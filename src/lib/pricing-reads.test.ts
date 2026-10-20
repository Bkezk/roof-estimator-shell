/**
 * Prices are an estimator's and the pricing page's to read (the fifth audit, Oct 20; item 1).
 *
 *  (i) Server: every pricing / labor / settings READ function asserts Estimate Pricing OR
 *      Estimate (assertPricingRead) before any row is read — a technician and an office user
 *      without either page are refused with zero reads; an estimator, a manager and an admin
 *      are served. The saves stay Estimate Pricing.
 * (ii) Database: 20261020120000_pricing_reads_narrowed.sql replaces the `using (true)` SELECT
 *      policies of every pricing table the earlier migrations created (the list is derived from
 *      those files here and compared) with `has_access('pricing') or has_access('estimate')`,
 *      serves the inventory a price-free `pricing_catalog_units` view (lib/catalog-units.ts
 *      unitDataOf is its twin), `catalog_item_numbers_map` and `company_settings_public`, and
 *      moves crm_settings behind is_admin() / is_manager() with three SECURITY DEFINER getters.
 *      The non-pricing readers — the inventory, the close-out's material list and drive time,
 *      the invoice and proposal headers, Work Overview's timer, a new opportunity's close date,
 *      the lazy reminder pass — read the views and the getters.
 * The real server functions run against the in-memory stand-in (src/test/fake-supabase.ts).
 */
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));
vi.mock("@/lib/notify.server", () => ({
  serverClient: async (fallback: unknown) => fallback,
  notify: vi.fn(async () => 0),
  hasServiceRole: () => false,
}));

import {
  listItemNumbers,
  listPriceImportChanges,
  listPriceImportRuns,
  listPriceTargets,
} from "@/lib/admin-item-numbers.functions";
import { getLaborEngines } from "@/lib/admin-labor.functions";
import { getPricingCatalog, getPricingScreen } from "@/lib/admin-pricing.functions";
import { getAccessoryLabor, getLaborTables, getRdlCombos } from "@/lib/admin-rdl.functions";
import { getGeneralSettings } from "@/lib/admin-settings.functions";
import { PRICING_READ_FORBIDDEN } from "@/lib/auth.functions";
import { getCompanyInfo, getMarkupPresets, getWarrantyData } from "@/lib/bids.functions";
import { UNIT_ROW_KEYS, unitDataOf } from "@/lib/catalog-units";
import {
  getAccessoryCatalog,
  getAccessoryLaborLookup,
  getEngineAdminData,
  getFastenerLookup,
  getMetalsCatalog,
  getNonDlCatalog,
} from "@/lib/engine.functions";
import { getCrmSettings } from "@/lib/followups.functions";
import { cellUnit } from "@/lib/inventory.functions";
import { listMyWork, type MyWorkResult } from "@/lib/my-work.functions";
import { fakeSupabase } from "@/test/fake-supabase";

type Row = Record<string, unknown>;
type Fn = (a: { data: unknown; context: unknown }) => Promise<unknown>;
const read = (p: string) => readFileSync(p, "utf8");
const noComments = (s: string) => s.replace(/--[^\n]*/g, "");
const flat = (s: string) => noComments(s).replace(/\s+/g, " ").trim();
const MIG = "supabase/migrations/20261020120000_pricing_reads_narrowed.sql";

const TECH = "00000000-0000-4000-8000-00000000000a";
const OFFICE_NO_PRICING = "00000000-0000-4000-8000-00000000000b";
const EST = "00000000-0000-4000-8000-00000000000c";
const ADMIN = "00000000-0000-4000-8000-00000000000d";
const MANAGER = "00000000-0000-4000-8000-00000000000e";
const RUN = "11111111-1111-4111-8111-111111111111";

const profiles: Row[] = [
  { id: TECH, role: "user", access: ["service"], technician: true, full_name: "Tim", email: "t@x" },
  // A plain user with the office's pages but neither Estimate nor Estimate Pricing.
  {
    id: OFFICE_NO_PRICING,
    role: "user",
    access: ["service", "customers", "invoices", "prospect", "takeoff"],
    technician: false,
    full_name: "Olive",
    email: "o@x",
  },
  { id: EST, role: "user", access: ["estimate"], technician: false, full_name: "Ed", email: "e@x" },
  { id: ADMIN, role: "admin", access: [], technician: false, full_name: "Ann", email: "a@x" },
  { id: MANAGER, role: "manager", access: [], technician: false, full_name: "Max", email: "m@x" },
];

const SCREEN = {
  id: "duro_last:fasteners_and_bits",
  branch: "duro_last",
  category: "Fasteners & Bits",
  sort: 1,
  data: {
    columns: ["Description", "Subtype", "Fasteners/Box", "Price/Box", "White Price", "Labor"],
    rows: [
      {
        Description: '2"',
        Subtype: "HD",
        "Fasteners/Box": 1000,
        "Price/Box": 92.5,
        "White Price": 3,
        Labor: 0.2,
      },
      { Description: '3"', Subtype: "XHD", "Fasteners/Box": 500, "Price/Box": 71, Labor: 0.3 },
    ],
  },
};

/** A stand-in whose non-profile reads are counted, so a refusal can be shown to read nothing. */
function world(extra: Row[] = []) {
  const env = fakeSupabase({
    profiles: profiles.map((p) => ({ ...p })),
    pricing_catalog: [SCREEN, ...extra],
    company_settings: [
      {
        id: 1,
        company_name: "JBK",
        address: "PO Box 1",
        city: "Corbin",
        state: "KY",
        zip: "40702",
        phone: "606",
        sales_tax_rate: 0.06,
        labor_display: "man_hours",
      },
    ],
    shipping_steps: [],
    markup_options: [],
    warranties: [],
    high_wind_upcharges: [],
    labor_setup: [],
    labor_setup_steps: [],
    labor_inspection_steps: [],
    labor_templates: [],
    labor_template_adjustments: [],
    labor_curb: [],
    labor_curb_deck: [],
    labor_curb_type: [],
    labor_parapet: [],
    rdl_combos: [],
    rdl_labor_tables: [],
    accessory_labor: [],
    catalog_item_numbers: [],
    price_import_runs: [],
    price_import_changes: [],
    mech_fastener_lookup: [],
    crm_settings: [
      { id: 1, unassigned_overdue_days: 4, opportunity_close_days: 30, last_dispatch_at: null },
    ],
  });
  const reads: string[] = [];
  const base = env.db as unknown as { from: (t: string) => unknown; rpc: unknown };
  const db = {
    ...base,
    from: (t: string) => {
      if (t !== "profiles") reads.push(t);
      return base.from(t);
    },
  };
  return { env, reads, db };
}
const call = <T>(fn: unknown, data: unknown, db: unknown, userId: string) =>
  (fn as Fn)({ data, context: { supabase: db, userId } }) as Promise<T>;

const READS: [string, unknown, unknown][] = [
  ["getPricingCatalog", getPricingCatalog, { branch: "duro_last" }],
  ["getPricingScreen", getPricingScreen, { id: SCREEN.id }],
  ["getGeneralSettings", getGeneralSettings, undefined],
  ["getLaborEngines", getLaborEngines, undefined],
  ["getRdlCombos", getRdlCombos, undefined],
  ["getLaborTables", getLaborTables, undefined],
  ["getAccessoryLabor", getAccessoryLabor, undefined],
  ["listItemNumbers", listItemNumbers, undefined],
  ["listPriceTargets", listPriceTargets, undefined],
  ["listPriceImportRuns", listPriceImportRuns, undefined],
  ["listPriceImportChanges", listPriceImportChanges, { run_id: RUN }],
  ["getEngineAdminData", getEngineAdminData, undefined],
  ["getAccessoryCatalog", getAccessoryCatalog, undefined],
  ["getAccessoryLaborLookup", getAccessoryLaborLookup, undefined],
  ["getNonDlCatalog", getNonDlCatalog, undefined],
  ["getMetalsCatalog", getMetalsCatalog, undefined],
  ["getFastenerLookup", getFastenerLookup, undefined],
  ["getMarkupPresets", getMarkupPresets, undefined],
  ["getWarrantyData", getWarrantyData, undefined],
];

describe("(i) every pricing read refuses a technician and an office user without the pages, with zero reads", () => {
  for (const [name, fn, data] of READS) {
    it(`${name}: technician → refused, nothing read`, async () => {
      const { db, reads } = world();
      await expect(call(fn, data, db, TECH)).rejects.toThrow(PRICING_READ_FORBIDDEN);
      expect(reads).toEqual([]);
    });
    it(`${name}: office without Estimate / Estimate Pricing → refused, nothing read`, async () => {
      const { db, reads } = world();
      await expect(call(fn, data, db, OFFICE_NO_PRICING)).rejects.toThrow(PRICING_READ_FORBIDDEN);
      expect(reads).toEqual([]);
    });
    it(`${name}: an estimator, a manager and an admin pass the gate`, async () => {
      for (const who of [EST, MANAGER, ADMIN]) {
        const { db, reads } = world();
        // Past the gate the fake's empty tables may not satisfy the engine's assembly; what
        // matters here is that the refusal is not raised and the rows are read.
        await call(fn, data, db, who).catch((e: unknown) => {
          expect(String(e instanceof Error ? e.message : e)).not.toBe(PRICING_READ_FORBIDDEN);
        });
        expect(reads.length).toBeGreaterThan(0);
      }
    });
  }
  it("the simple reads answer an estimator (the catalog screen, the settings, the presets)", async () => {
    const { db } = world();
    const rows = await call<Row[]>(getPricingCatalog, { branch: "duro_last" }, db, EST);
    expect(rows.map((r) => r["id"])).toEqual([SCREEN.id]);
    const one = await call<Row>(getPricingScreen, { id: SCREEN.id }, db, EST);
    expect(one["id"]).toBe(SCREEN.id);
    const gs = await call<{ company: Row | null }>(getGeneralSettings, undefined, db, EST);
    expect(gs.company?.["company_name"]).toBe("JBK");
    expect(await call(getMarkupPresets, undefined, db, EST)).toEqual([]);
    expect(await call(listItemNumbers, undefined, db, EST)).toEqual([]);
  });
  it("the helper is one, in auth.functions.ts, and every read module calls it; the saves keep Estimate Pricing", () => {
    const auth = read("src/lib/auth.functions.ts");
    expect(auth).toContain("export async function assertPricingRead(");
    expect(auth).toContain('canAccess(data, "pricing") || canAccess(data, "estimate")');
    for (const f of [
      "src/lib/admin-pricing.functions.ts",
      "src/lib/admin-settings.functions.ts",
      "src/lib/admin-labor.functions.ts",
      "src/lib/admin-rdl.functions.ts",
      "src/lib/admin-item-numbers.functions.ts",
      "src/lib/engine.functions.ts",
      "src/lib/bids.functions.ts",
    ]) {
      const s = read(f);
      expect(s, f).toContain("await assertPricingRead(context.supabase, context.userId);");
    }
    for (const f of [
      "src/lib/admin-pricing.functions.ts",
      "src/lib/admin-settings.functions.ts",
      "src/lib/admin-labor.functions.ts",
      "src/lib/admin-rdl.functions.ts",
      "src/lib/admin-item-numbers.functions.ts",
    ])
      expect(read(f), f).toContain('await assertPageAccess(supabase, userId, "pricing");');
  });
});

describe("(ii) the migration: the table list is the earlier migrations', every policy narrowed", () => {
  const sql = read(MIG);
  const f = flat(sql);
  const DIR = "supabase/migrations";
  /** Every table an earlier migration gave a `using (true)` SELECT policy named <t>_read. */
  const earlier = (): string[] => {
    const out = new Set<string>();
    for (const name of readdirSync(DIR)
      .filter((x) => x.endsWith(".sql") && x < "20261020")
      .sort()) {
      const t = flat(read(`${DIR}/${name}`));
      for (const m of t.matchAll(
        /create policy "?([a-z0-9_]+)_read"? on public\.([a-z0-9_]+) for select to authenticated using \(true\);/g,
      ))
        if (m[1] === m[2]) out.add(m[2]!);
      // The two loops: `foreach t in array array['a','b'] loop … using (true)`.
      for (const m of t.matchAll(/foreach t in array array\[([^\]]+)\] loop([\s\S]*?)end loop/g))
        if (m[2]!.includes("using (true)"))
          for (const n of m[1]!.matchAll(/'([a-z0-9_]+)'/g)) out.add(n[1]!);
    }
    return [...out].sort();
  };
  const listed = (): string[] => {
    const m = /foreach t in array array\[(.*?)\] loop/.exec(f);
    expect(m).not.toBeNull();
    return [...m![1]!.matchAll(/'([a-z0-9_]+)'/g)].map((x) => x[1]!).sort();
  };
  /** The tables outside the pricing family whose `using (true)` reads stay (not pricing). */
  const NOT_PRICING = new Set([
    "bid_locks",
    "inventory_settings",
    "inventory_movements",
    "inventory_locations",
    "vehicle_drivers",
    "service_rates",
    "service_settings",
    "storm_settings",
    "lead_settings",
    "county_codes",
    "lead_sources",
    "data_refreshes",
    "crm_settings",
  ]);
  it("lists every pricing, labor and settings table the earlier migrations opened, and no other", () => {
    const want = earlier().filter((t) => !NOT_PRICING.has(t));
    expect(listed()).toEqual(want);
    expect(want).toEqual(
      expect.arrayContaining([
        "pricing_catalog",
        "company_settings",
        "catalog_item_numbers",
        "price_import_runs",
        "price_import_changes",
        "labor_parapet",
        "rdl_combos",
        "rdl_labor_tables",
        "rdl_adhered_sheet_multi",
        "rdl_roll_good_width",
        "accessory_labor",
        "underlayment_board_group",
        "mech_tab_multi",
        "adhesive_allowed_under",
      ]),
    );
    expect(want.length).toBeGreaterThanOrEqual(36);
  });
  it("drops and recreates <t>_read with pricing OR estimate; pricing_catalog alone adds is_sales_pm() (exception 5)", () => {
    expect(f).toContain(
      "execute format('drop policy if exists %I on public.%I;', t || '_read', t);",
    );
    expect(f).toContain(
      "'create policy %I on public.%I for select to authenticated using (public.has_access(''pricing'') or public.has_access(''estimate''));', t || '_read', t);",
    );
    expect(f).toContain(
      "if t = 'pricing_catalog' then execute format( 'create policy %I on public.%I for select to authenticated using (public.has_access(''pricing'') or public.has_access(''estimate'') or public.is_sales_pm());', t || '_read', t);",
    );
    expect(f).not.toContain("using (true)");
    // The writes are left alone.
    expect(f).not.toContain("_write");
  });
  it("service_settings is not touched; crm_settings is admins and managers, with the three getters", () => {
    expect(listed()).not.toContain("service_settings");
    expect(f).toContain(
      "drop policy if exists crm_settings_read on public.crm_settings; create policy crm_settings_read on public.crm_settings for select to authenticated using (public.is_admin() or public.is_manager());",
    );
    for (const [fn, col, type] of [
      ["unassigned_overdue_days", "unassigned_overdue_days", "integer"],
      ["opportunity_close_days", "opportunity_close_days", "integer"],
      ["crm_last_dispatch_at", "last_dispatch_at", "timestamptz"],
    ]) {
      expect(f).toContain(
        `create or replace function public.${fn}() returns ${type} language sql stable security definer set search_path = public as $$ select s.${col} from public.crm_settings s where s.id = 1; $$;`,
      );
      expect(f).toContain(`revoke all on function public.${fn}() from public;`);
      expect(f).toContain(`grant execute on function public.${fn}() to authenticated;`);
    }
  });
  it("the price-free views: plain (security_invoker = false), owned by the migration's role, granted to authenticated only", () => {
    expect(f).toContain(
      "create or replace view public.pricing_catalog_units with (security_invoker = false, security_barrier = true) as select pc.id, pc.branch, pc.category, pc.sort, public.pricing_catalog_unit_data(pc.data) as data from public.pricing_catalog pc;",
    );
    expect(f).toContain(
      "create or replace view public.catalog_item_numbers_map with (security_invoker = false, security_barrier = true) as select n.item_no, n.screen_id, n.row_label, n.price_col, n.dl_description from public.catalog_item_numbers n;",
    );
    expect(f).toContain(
      "create or replace view public.company_settings_public with (security_invoker = false, security_barrier = true) as select c.id, c.company_name, c.address, c.city, c.state, c.zip, c.phone, c.shop_address, c.shop_city, c.shop_state, c.shop_zip from public.company_settings c;",
    );
    for (const v of [
      "pricing_catalog_units",
      "catalog_item_numbers_map",
      "company_settings_public",
    ]) {
      expect(f).toContain(`revoke all on public.${v} from public, anon, authenticated;`);
      expect(f).toContain(`grant select on public.${v} to authenticated;`);
    }
    // No price column leaves through a view.
    expect(f).not.toMatch(/create or replace view public\.catalog_item_numbers_map[^;]*last_price/);
    expect(f).not.toMatch(
      /create or replace view public\.company_settings_public[^;]*(sales_tax_rate|shipping|labor_display|hours_per_man_day|master_elite|dl_account)/,
    );
  });
  it("pricing_catalog_unit_data keeps exactly the unit keys (the twin's list) and the first column, nothing priced", () => {
    const m = /e\.key in \(([^)]*)\) or e\.key = \(d->'columns'->>0\)/.exec(f);
    expect(m).not.toBeNull();
    const keys = [...m![1]!.matchAll(/'([^']+)'/g)].map((x) => x[1]!);
    expect(keys).toEqual([...UNIT_ROW_KEYS]);
    expect(keys.some((k) => /price|cost|labor/i.test(k))).toBe(false);
    expect(f).toContain(
      "when d->>'kind' = 'adhesives' then jsonb_build_object( 'kind', 'adhesives', 'products', coalesce(( select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('name', p.value->'name', 'unit_type', p.value->'unit_type')) order by p.ordinality)",
    );
    expect(f).toContain("when d->>'kind' is not null then jsonb_build_object('kind', d->'kind')");
    expect(f).toContain(
      "'columns', case when jsonb_typeof(d->'columns') = 'array' then d->'columns' else '[]'::jsonb end,",
    );
  });
  it("is idempotent and replayable: drop if exists before every create policy; create or replace throughout; the helpers it names exist", () => {
    // The loop: one drop, then the create (one of two texts); crm_settings: its own pair.
    expect(f).toMatch(
      /drop policy if exists %I on public\.%I;', t \|\| '_read', t\); if t = 'pricing_catalog' then execute format\( 'create policy/,
    );
    const code = noComments(sql);
    expect((code.match(/create policy/g) ?? []).length).toBe(3);
    expect((code.match(/drop policy if exists/g) ?? []).length).toBe(2);
    expect(sql).not.toMatch(/^create (view|function)\b/m);
    for (const h of ["has_access", "is_admin", "is_manager", "is_sales_pm"])
      expect(
        readdirSync(DIR).some(
          (n) => n < "20261020" && read(`${DIR}/${n}`).includes(`function public.${h}(`),
        ),
      ).toBe(true);
  });
  it("types.ts knows the views, the getters and the fence helpers", () => {
    const t = read("src/integrations/supabase/types.ts");
    for (const v of [
      "pricing_catalog_units: {",
      "catalog_item_numbers_map: {",
      "company_settings_public: {",
    ])
      expect(t).toContain(v);
    expect(t).toContain("unassigned_overdue_days: { Args: never; Returns: number };");
    expect(t).toContain("opportunity_close_days: { Args: never; Returns: number };");
    expect(t).toContain("crm_last_dispatch_at: { Args: never; Returns: string | null };");
    expect(t).not.toMatch(/catalog_item_numbers_map: \{\s*Row: \{[^}]*last_price/);
  });
});

describe("(ii) unitDataOf — the TypeScript twin of pricing_catalog_unit_data", () => {
  it("a flat screen keeps columns by name and only the label / Subtype / Part # / pack cells of each row", () => {
    const d = unitDataOf(SCREEN.data);
    expect(d["columns"]).toEqual(SCREEN.data.columns);
    expect(d["rows"]).toEqual([
      { Description: '2"', Subtype: "HD", "Fasteners/Box": 1000 },
      { Description: '3"', Subtype: "XHD", "Fasteners/Box": 500 },
    ]);
    const keys = new Set((d["rows"] as Row[]).flatMap((r) => Object.keys(r)));
    for (const k of keys) expect([...UNIT_ROW_KEYS, "Description"]).toContain(k);
    expect(JSON.stringify(d)).not.toMatch(/92\.5|"71"|71,|"Labor":|White Price":/);
  });
  it("the first column is kept when it is the label (no Description / Name); colour price columns are not", () => {
    const d = unitDataOf({
      columns: ["Item", "White", "Tan", "Price"],
      rows: [{ Item: "Cover", White: 9, Tan: 10, Price: 8 }],
    });
    expect(d["rows"]).toEqual([{ Item: "Cover" }]);
  });
  it("an adhesives screen keeps each product's name and unit_type only; nulls are left out as jsonb_strip_nulls does", () => {
    const d = unitDataOf({
      kind: "adhesives",
      products: [
        { name: "DL Adhesive", unit_type: "4-Cartridge Case", price: 120, labor: 2 },
        { name: "Primer", unit_type: null, price: 50 },
      ],
    });
    expect(d).toEqual({
      kind: "adhesives",
      products: [{ name: "DL Adhesive", unit_type: "4-Cartridge Case" }, { name: "Primer" }],
    });
  });
  it("a master-detail screen keeps only its kind; junk data shapes to empty", () => {
    expect(unitDataOf({ kind: "membrane", sheets: [{ price: 1 }] })).toEqual({ kind: "membrane" });
    expect(unitDataOf(null)).toEqual({ columns: [], rows: [] });
    expect(unitDataOf({ columns: "x", rows: [1, "a", null] })).toEqual({
      columns: [],
      rows: [{}, {}, {}],
    });
  });
  it("UNIT_ROW_KEYS is the label, the two disambiguators and the pack columns", () => {
    expect([...UNIT_ROW_KEYS]).toEqual([
      "Description",
      "Name",
      "Subtype",
      "Part #",
      "Fasteners/Box",
      "Parts/Bag",
      "Parts/Package",
    ]);
  });
});

describe("(ii) the non-pricing readers use the views and the getters", () => {
  it("inventory.functions.ts: categories() and cellUnit() read pricing_catalog_units; item numbers through the map; never the base tables", () => {
    const s = read("src/lib/inventory.functions.ts");
    expect(s).toContain(
      'sb.from("pricing_catalog_units").select("id, category").eq("branch", "duro_last")',
    );
    expect(s).toMatch(
      /\.from\("pricing_catalog_units"\)\s*\.select\("data"\)\s*\.eq\("id", cell\.screen_id\)/,
    );
    expect((s.match(/from\("catalog_item_numbers_map"\)/g) ?? []).length).toBe(3);
    expect(s).not.toContain('from("pricing_catalog")');
    expect(s).not.toContain('from("catalog_item_numbers")');
  });
  it("cellUnit through the stand-in's view: the pack size is found while the view's data carries no price", async () => {
    const { env, db } = world();
    const r = await cellUnit(db as never, {
      screen_id: SCREEN.id,
      row_label: '2"',
      price_col: "Price/Box",
    });
    expect(r.piece).toEqual({ name: "fastener", perPack: 1000 });
    const view = env.db as unknown as {
      from: (t: string) => { select: (c: string) => PromiseLike<{ data: Row[] }> };
    };
    const { data } = await view.from("pricing_catalog_units").select("*");
    expect(JSON.stringify(data)).not.toMatch(/Price\/Box":|White Price":|Labor":/);
    expect(JSON.stringify(data)).toContain('"Fasteners/Box":1000');
  });
  it("service-field.functions.ts: the close-out's drive time and material list read the views", () => {
    const s = read("src/lib/service-field.functions.ts");
    expect(s).toContain('.from("company_settings_public")');
    expect(s).not.toContain('.from("company_settings")');
    expect(s).toContain(
      'sb.from("catalog_item_numbers_map").select("screen_id, row_label, price_col, item_no")',
    );
    expect(s).not.toContain('from("catalog_item_numbers")');
  });
  it("the invoice header and the proposal header read company_settings_public; engine.functions and invoices.server keep the catalog (estimate / invoice paths)", () => {
    const inv = read("src/lib/invoices.server.ts");
    expect(inv).toMatch(
      /\.from\("company_settings_public"\)\s*\.select\("company_name, address, city, state, zip, phone"\)/,
    );
    expect(inv).not.toContain('from("company_settings")');
    expect(inv).toContain('.from("pricing_catalog")');
    const bids = read("src/lib/bids.functions.ts");
    expect(bids).toMatch(
      /getCompanyInfo = createServerFn[\s\S]*?\.from\("company_settings_public"\)/,
    );
    expect(bids).not.toContain('from("company_settings")');
    expect(read("src/lib/engine.functions.ts")).toContain('.from("pricing_catalog")');
  });
  it("getCompanyInfo still answers any signed-in user (a technician's proposal header), from the view", async () => {
    const { db } = world();
    expect(await call<Row>(getCompanyInfo, undefined, db, TECH)).toMatchObject({
      company_name: "JBK",
      city: "Corbin",
    });
  });
  it("listMyWork takes the timer from unassigned_overdue_days(), never from crm_settings", async () => {
    const { env, db, reads } = world();
    const r = await call<MyWorkResult>(listMyWork, {}, db, ADMIN);
    expect(r).toBeTruthy();
    expect(env.rpcCalls.map((c) => c.fn)).toContain("unassigned_overdue_days");
    expect(reads).not.toContain("crm_settings");
    const s = read("src/lib/my-work.functions.ts");
    expect(s).toContain('sb.rpc("unassigned_overdue_days")');
    expect(s).not.toContain('from("crm_settings")');
  });
  it("a new opportunity's close window and the lazy reminder pass read their getters", () => {
    const o = read("src/lib/opportunities.functions.ts");
    expect(o).toContain('await sb.rpc("opportunity_close_days")');
    expect(o).not.toContain('from("crm_settings")');
    const fu = read("src/lib/followups.functions.ts");
    expect(fu).toContain('await context.supabase.rpc("crm_last_dispatch_at")');
    expect(fu).not.toMatch(
      /dispatchRemindersIfDue[\s\S]{0,600}\.from\("crm_settings"\)\s*\.select\("last_dispatch_at"\)/,
    );
  });
  it("getCrmSettings (Admin › Reminders) is an admin's and a manager's; a technician and the office are refused with no read", async () => {
    for (const who of [TECH, OFFICE_NO_PRICING, EST]) {
      const { db, reads } = world();
      await expect(call(getCrmSettings, undefined, db, who)).rejects.toThrow(
        "Forbidden: admin or manager access required",
      );
      expect(reads).toEqual([]);
    }
    for (const who of [ADMIN, MANAGER]) {
      const { db } = world();
      expect((await call<Row>(getCrmSettings, undefined, db, who))["unassigned_overdue_days"]).toBe(
        4,
      );
    }
  });
});
