/**
 * Setup page review, Nov 4 (docs/qa/setup-review-2026-11-04.md; owner: "go on 1, 2, 3, 4, and
 * 5"). The pure rules run here; the pages are checked from their source; the server's duplicate
 * check runs against the in-memory stand-in (src/test/fake-supabase.ts).
 *
 * 1. Unsaved edits survive a tab switch (a visited tab's card stays mounted, hidden) and leaving
 *    the page asks — Stay / Leave without saving / Save and leave; Service rates has a dirty
 *    state; a dirty tab carries a dot.
 * 2. Material pricing: text rows under folding group headings, click to edit, "Priced here only",
 *    the count follows the search, Add material opens the new row with the cursor in its name;
 *    a save sends the changed rows only (and the server checks a name against the rows left out).
 * 3. Service rates: three headings; the CenterPoint note until "These rates are confirmed"; the
 *    tax hint says blank means no tax.
 * 4. Phones: the rates stack under each role; the checklist's note sits under its box.
 * 5. ?tab=vehicles waits for the profile; the locations load with the Vehicles tab; a line says
 *    vehicles are named on Inventory.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));

import {
  changedMaterials,
  filterMaterials,
  groupMaterials,
  groupOpen,
  isFiltering,
  materialCountLine,
  materialGroup,
  NEW_GROUP,
  NO_GROUP,
  PRICED_FROM_ESTIMATE,
  screenGroupName,
  type MaterialView,
} from "@/lib/material-pricing-view";
import { shouldBlockLeaving, tabOfFormKey } from "@/lib/setup-forms";
import { NAME_TAKEN, saveServiceMaterials } from "@/lib/service-materials.functions";
import { fakeSupabase } from "@/test/fake-supabase";

type Row = Record<string, unknown>;
const read = (p: string) => readFileSync(p, "utf8");
const page = read("src/routes/setup.tsx");
const rates = read("src/components/service-rates-settings.tsx");
const materials = read("src/components/service/material-pricing-settings.tsx");
const checklist = read("src/components/service/inspection-checklist-settings.tsx");
const vehicles = read("src/components/inventory/vehicle-drivers-card.tsx");
const fns = read("src/lib/invoices.functions.ts");
const flat = (s: string) => s.replace(/\s+/g, " ");
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const m = (over: Partial<MaterialView> & { key: string }): MaterialView => ({
  id: over.key,
  name: "Caulk",
  unit: "Each",
  cost: "5",
  active: true,
  category: "Sealants",
  shared: false,
  screen: null,
  ...over,
});

describe("1. unsaved edits survive a tab switch; leaving asks", () => {
  it("a visited tab's card is kept mounted and hidden, not unmounted", () => {
    expect(page).toContain('const KEEP = "mt-4 data-[state=inactive]:hidden";');
    expect(page).toContain("<TabsContent value={value} forceMount className={KEEP}>");
    expect(page).toContain('<TabsContent value="vehicles" forceMount className={KEEP}>');
    expect(page).toContain("visited.has(value) ? (");
    // The cards are not all mounted on load: only the tabs opened so far.
    expect(page).toMatch(
      /useState<Set<SetupTab>>\(\s*\(\) => new Set\(settling \? \[\] : \[active\]\)/,
    );
  });
  it("the leave rule: only leaving /setup with unsaved edits blocks; a tab switch never does", () => {
    expect(shouldBlockLeaving("/opportunities", true)).toBe(true);
    expect(shouldBlockLeaving("/setup", true)).toBe(false);
    expect(shouldBlockLeaving("/opportunities", false)).toBe(false);
    expect(page).toContain(
      "shouldBlockFn: ({ next }) => shouldBlockLeaving(next.pathname, dirtyRef.current),",
    );
    expect(page).toContain("enableBeforeUnload: () => dirtyRef.current,");
  });
  it("the dialog: Stay / Leave without saving / Save and leave, which saves every dirty card", () => {
    expect(page).toContain('<AlertDialogContent data-dialog="leave-setup">');
    expect(page).toContain("<AlertDialogTitle>Save changes to Setup?</AlertDialogTitle>");
    expect(page).toContain("<AlertDialogCancel onClick={stayHere}>Stay</AlertDialogCancel>");
    expect(page).toContain("Leave without saving");
    expect(page).toContain("Save and leave");
    expect(flat(page)).toContain(
      "await Promise.all([...forms.current.values()].filter((f) => f.dirty).map((f) => f.save()));",
    );
  });
  it("every editable card registers its dirty state and save with the page", () => {
    expect(rates).toContain('useSetupForm("rates", dirty, () => save.mutateAsync());');
    expect(materials).toContain('useSetupForm("materials", dirty, () => save.mutateAsync());');
    expect(checklist).toContain('useSetupForm("inspection", dirty, () => save.mutateAsync());');
    expect(vehicles).toContain("useSetupForm(`vehicles:${props.vehicle.id}`, dirty, save);");
    expect(tabOfFormKey("vehicles:abc")).toBe("vehicles");
    expect(tabOfFormKey("rates")).toBe("rates");
  });
  it("Service rates has a dirty state: Save and 'Unsaved changes' mean something", () => {
    expect(rates).toMatch(
      /const dirty =\s*!!loaded &&\s*!!s &&\s*JSON\.stringify\(\{ rates, s \}\) !==/,
    );
    expect(rates).toContain('<Button type="submit" disabled={!dirty || save.isPending}>');
    expect(rates).toContain(
      '{dirty && <span className="text-xs text-muted-foreground">Unsaved changes</span>}',
    );
    // A refetch never overwrites unsaved edits; a save refills the boxes.
    expect(rates).toContain("if (!loaded || (dirtyRef.current && !refillRef.current)) return;");
    expect(rates).toContain("refillRef.current = true;");
  });
  it("a tab with unsaved edits carries a dot", () => {
    expect(page).toContain(
      "const marked = useMemo(() => new Set(dirtyKeys.map(tabOfFormKey)), [dirtyKeys]);",
    );
    for (const t of ["rates", "materials", "inspection", "vehicles"])
      expect(page).toContain(`{dot("${t}")}`);
    expect(page).toContain('aria-label="unsaved changes"');
  });
});

describe("2. Material pricing: text rows under headings, click to edit, the filters, changed rows only", () => {
  it("materialGroup: New / the Group (No group) / From Estimate Pricing › <screen>", () => {
    expect(materialGroup(m({ key: "n", id: undefined }))).toBe(NEW_GROUP);
    expect(materialGroup(m({ key: "a" }))).toBe("Sealants");
    expect(materialGroup(m({ key: "b", category: "  " }))).toBe(NO_GROUP);
    expect(materialGroup(m({ key: "c", shared: true, screen: "duro_last:pipe_stacks" }))).toBe(
      `${PRICED_FROM_ESTIMATE} › Pipe Stacks`,
    );
    expect(screenGroupName("duro_last:fasteners_and_bits")).toBe("Fasteners And Bits");
  });
  it("groupMaterials: New first, the groups priced here A–Z with No group last of them, then Estimate Pricing's", () => {
    const g = groupMaterials([
      m({ key: "s1", shared: true, screen: "duro_last:sealants" }),
      m({ key: "u1", category: "Underlayment" }),
      m({ key: "x1", category: "" }),
      m({ key: "a1", category: "Adhesives" }),
      m({ key: "n1", id: undefined }),
      m({ key: "c1", shared: true, screen: "duro_last:corners" }),
      m({ key: "a2", category: "Adhesives" }),
    ]);
    expect(g.map((x) => x.label)).toEqual([
      NEW_GROUP,
      "Adhesives",
      "Underlayment",
      NO_GROUP,
      `${PRICED_FROM_ESTIMATE} › Corners`,
      `${PRICED_FROM_ESTIMATE} › Sealants`,
    ]);
    expect(g[1]!.rows.map((r) => r.key)).toEqual(["a1", "a2"]);
  });
  it("filterMaterials: 'Priced here only' drops the shared rows; a search matches name, unit, group; a new row always shows", () => {
    const rows = [
      m({ key: "a", name: "Caulk" }),
      m({ key: "b", name: "Tape", shared: true, screen: "duro_last:sealants", category: "" }),
      m({ key: "c", name: "Old", active: false }),
      m({ key: "n", id: undefined, name: "" }),
    ];
    const keys = (f: Parameters<typeof filterMaterials>[1]) =>
      filterMaterials(rows, f).map((r) => r.key);
    expect(keys({ search: "", showHidden: false, pricedHere: false })).toEqual(["a", "b", "n"]);
    expect(keys({ search: "", showHidden: false, pricedHere: true })).toEqual(["a", "n"]);
    expect(keys({ search: "sealants", showHidden: false, pricedHere: false })).toEqual([
      "a",
      "b",
      "n",
    ]);
    expect(keys({ search: "tape", showHidden: true, pricedHere: false })).toEqual(["b", "n"]);
    expect(keys({ search: "old", showHidden: true, pricedHere: false })).toEqual(["c", "n"]);
    // A shared row is found by its heading ("Sealants" from duro_last:sealants) as well.
    expect(keys({ search: "seal", showHidden: false, pricedHere: false })).toEqual(["a", "b", "n"]);
  });
  it("the count follows the filters: '137 materials', or '33 of 137 materials'", () => {
    expect(materialCountLine(137, 137, false)).toBe("137 materials");
    expect(materialCountLine(33, 137, true)).toBe("33 of 137 materials");
    expect(materialCountLine(1, 1, false)).toBe("1 material");
    expect(isFiltering({ search: "", showHidden: true, pricedHere: false })).toBe(false);
    expect(isFiltering({ search: " x", showHidden: false, pricedHere: false })).toBe(true);
    expect(isFiltering({ search: "", showHidden: false, pricedHere: true })).toBe(true);
    expect(materials).toContain("{materialCountLine(shownSaved, total, isFiltering(filters))}");
    expect(materials).toContain("Priced here only ({ownCount})");
  });
  it("groups start closed; a search opens them all; New is always open", () => {
    const none = new Set<string>();
    expect(groupOpen("Sealants", none, false)).toBe(false);
    expect(groupOpen("Sealants", new Set(["Sealants"]), false)).toBe(true);
    expect(groupOpen("Sealants", none, true)).toBe(true);
    expect(groupOpen(NEW_GROUP, none, false)).toBe(true);
    // A group holding an unsaved edit is never folded away (a cleared search would hide it).
    expect(groupOpen("Sealants", none, false, true)).toBe(true);
    expect(flat(materials)).toContain(
      "const open = groupOpen( g.label, opened, searching, g.rows.some((r) => changedKeys.has(r.key)), );",
    );
    expect(materials).toContain("aria-expanded={open}");
  });
  it("a row reads as text and opens its boxes when clicked; Show stays live on the text row; Add opens the new row with the cursor in its name", () => {
    expect(materials).toContain("const [editing, setEditing] = useState<string | null>(null);");
    expect(materials).toContain('aria-label={`Change ${r.name || "material"}`}');
    expect(materials).toContain("onClick={() => setEditing(r.key)}");
    expect(materials).toMatch(
      /aria-label="Material name"\s+className="col-span-2 h-9 md:col-span-1"\s+maxLength=\{200\}\s+autoFocus/,
    );
    expect(materials).toMatch(/const addRow = \(\) => \{[\s\S]*?setEditing\(key\);\s*\};/);
    // The text row's Show checkbox edits the row without opening it.
    expect(flat(materials)).toContain(
      '<label className="flex shrink-0 items-center gap-2 text-sm"> <Checkbox aria-label={`Show ${r.name || "material"} on tickets`} checked={r.active} onCheckedChange={(v) => edit(r.key, { active: v === true })} /> <span className="text-xs text-muted-foreground">Show</span> </label>',
    );
    expect(materials).toContain("Click a material to change");
  });
  it("changedMaterials: new rows and rows whose fields differ from the loaded row", () => {
    const loaded = new Map<string, MaterialView>([
      ["a", m({ key: "a", cost: "5" })],
      ["b", m({ key: "b", name: "Tape" })],
      ["c", m({ key: "c", category: "Misc" })],
    ]);
    const rows = [
      m({ key: "a", cost: "5.00" }), // the same number, typed differently
      m({ key: "b", name: "Tape 2" }),
      m({ key: "c", category: "Misc " }), // trailing space: the same group
      m({ key: "n", id: undefined }),
    ];
    expect(changedMaterials(rows, loaded).map((r) => r.key)).toEqual(["b", "n"]);
    expect(materials).toContain("const items = changedMaterials(rows ?? [], loaded).map((r) => {");
    expect(materials).toContain("saveFn({ data: { items, markup: markupPct / 100 } })");
  });
  it("the server: a renamed row sent alone is checked against the rows left out (NAME_TAKEN)", async () => {
    const env = fakeSupabase({
      profiles: [{ id: "u1", role: "admin", access: [], technician: false }],
      service_materials: [
        {
          id: "a",
          name: "Caulk",
          unit: "Each",
          cost: 5,
          active: true,
          category: "Sealants",
          sort: 0,
          stock_screen_id: null,
          stock_row_label: null,
          stock_price_col: null,
        },
        {
          id: "b",
          name: "Tape",
          unit: "Each",
          cost: 3,
          active: true,
          category: "Sealants",
          sort: 1,
          stock_screen_id: null,
          stock_row_label: null,
          stock_price_col: null,
        },
      ],
      service_settings: [{ id: 1, material_markup: 0.75 }],
    });
    const call = (data: Row) =>
      (saveServiceMaterials as unknown as (a: { data: Row; context: unknown }) => Promise<unknown>)(
        {
          data,
          context: { supabase: env.db, userId: "u1" },
        },
      );
    await expect(
      call({ items: [{ id: B, name: "Caulk", unit: "Each", cost: 3, active: true }] }),
    ).rejects.toThrow(NAME_TAKEN("Caulk"));
    expect(env.rpcCalls.filter((c) => c.fn === "save_service_materials")).toEqual([]);
  });
});

describe("3. Service rates: headings, the note until confirmed, the tax hint", () => {
  it("three headings over one form", () => {
    for (const h of ["Hourly rates", "Invoices", "Authorizing Done tickets"])
      expect(rates).toMatch(
        new RegExp(`<h3 id="rates-h-[a-z]+" className="text-sm font-semibold">\\s*${h}\\s*</h3>`),
      );
  });
  it("the CenterPoint note shows until 'These rates are confirmed'; confirmServiceRates stamps who and when", () => {
    expect(rates).toContain("{!q.data.settings.rates_confirmed_at ? (");
    expect(rates).toContain("These rates are confirmed");
    expect(rates).toContain('data-note="confirmed"');
    expect(rates).toContain("Rates confirmed {when(q.data.settings.rates_confirmed_at)}");
    expect(fns).toMatch(
      /export const confirmServiceRates = createServerFn\(\{ method: "POST" \}\)[\s\S]*?await ratesManager\(context\);[\s\S]*?\.update\(\{ rates_confirmed_at: at, rates_confirmed_by_name: by, updated_at: at \}\)/,
    );
    const sql = read("supabase/migrations/20261104220000_rates_confirmed.sql");
    expect(sql).toMatch(
      /alter table public\.service_settings\s+add column if not exists rates_confirmed_at timestamptz,\s+add column if not exists rates_confirmed_by_name text;/,
    );
    expect(read("src/integrations/supabase/types.ts")).toContain(
      "rates_confirmed_at: string | null;",
    );
  });
  it("the tax hint says blank means no tax", () => {
    expect(flat(rates)).toContain(
      "On the taxable lines of new invoices; blank means no tax, and a tax-exempt customer gets 0 either way.",
    );
  });
});

describe("4. phones", () => {
  it("the rates table is for md+ only; a stacked layout with the same boxes takes its place below", () => {
    expect(rates).toContain('<div className="hidden overflow-x-auto md:block">');
    expect(rates).toContain('<div className="space-y-3 md:hidden" data-layout="rates-stacked">');
    expect(rates).toContain('{rateBox(kind, role.key, c, "h-9 w-full")}');
    // The same draft state behind both.
    expect(rates.match(/rateBox\(kind, role\.key, c, /g)).toHaveLength(2);
  });
  it("the checklist's 'asked as the switch' note goes under the box on a phone, beside it on md+", () => {
    expect(checklist).toContain('<li key={r.key} className="flex flex-wrap items-center gap-1.5">');
    // The box shrinks so the number, the box and the three buttons share one line on a phone.
    expect(checklist).toContain('className="h-9 min-w-0 max-w-md flex-1"');
    expect(checklist).toContain(
      'className="order-last basis-full pl-7 text-xs text-muted-foreground md:order-none md:basis-auto md:pl-0"',
    );
  });
});

describe("5. small things", () => {
  it("?tab=vehicles waits for the profile instead of painting Service rates first", () => {
    expect(page).toContain('const settling = tab === "vehicles" && !profile;');
    expect(page).toMatch(
      /\{settling \? \(\s*<p className="flex items-center gap-2 text-sm text-muted-foreground">\s*<Loader2/,
    );
  });
  it("the vehicle list loads with the Vehicles tab, not on every tab", () => {
    expect(page).toMatch(
      /function VehiclesTab\(\{ canSetDrivers \}[\s\S]*?queryKey: \["inventory-locations"\]/,
    );
    expect(page).toContain(
      '{visited.has("vehicles") && <VehiclesTab canSetDrivers={canSetDrivers} />}',
    );
    // Not in the page component itself.
    expect(page.slice(0, page.indexOf("function VehiclesTab"))).not.toContain("listLocations)");
  });
  it("vehicles are named on Inventory: the card says so with a link", () => {
    expect(flat(vehicles)).toContain(
      'Vehicles are added and named on{" "} <Link to="/inventory" className="underline underline-offset-2"> Inventory </Link> .',
    );
  });
});
