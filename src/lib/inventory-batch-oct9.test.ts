/**
 * Inventory, the Oct 9 batch (owner-approved after a review; B2 and B3 revised the same day:
 * "with inventory we are very rarely if ever just ordering to have things stocked, the majority
 * of the time it's materials left over from bids"):
 *   B1  History pages through the whole ledger (listMovements { limit, before }) and says how
 *       much is shown, with Show older and the page's Where filter.
 *   B2  Put-in keeps the remembered job, shown as an unmistakable "Left over from …" line, with
 *       "Bought or delivered (no job)" as the other choice (reason stays `leftover`).
 *   B3  Two amount boxes side by side — whole packs and pieces — either or both filled; the
 *       total goes in pieces when any pieces were typed.
 *   B4  Every stock row has Set count (one adjustment) for canAccess(estimate).
 *   B5  A blank Counted box never enables Set count (the box tracks its text).
 *   B6  The Record dialog's refresh also invalidates the Reconcile report.
 *   S1  The dialog stays open after Save; S3 the shop is the default place without a vehicle;
 *   S4  truck → truck; S14 names and units as on the close-out.
 *   Managers set drivers (migration + server function + Setup tab).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));

import { canAccess } from "@/lib/access";
import {
  buildReconciliation,
  cellName,
  COUNT_NOTE,
  parseCounted,
  RECONCILE_NOTE,
  reconcileAdjustment,
  type Reconciliation,
} from "@/lib/inventory-reconcile";
import { getReconciliation } from "@/lib/inventory-reconcile.functions";
import {
  listMovements,
  listStock,
  MOVEMENTS_PAGE,
  priceColLabel,
  setVehicleDrivers,
  type MovementRow,
  type StockRow,
} from "@/lib/inventory.functions";
import {
  combinedCount,
  describeStock,
  displayStock,
  isPriceCol,
  packUnitLabel,
  variantOf,
} from "@/lib/stock-units";
import { fakeSupabase } from "@/test/fake-supabase";

const read = (p: string) => readFileSync(p, "utf8");
const page = read("src/components/inventory-page.tsx");
const fns = read("src/lib/inventory.functions.ts");
const between = (src: string, from: string, to: string) =>
  src.slice(src.indexOf(from), src.indexOf(to, src.indexOf(from)));
const dialog = between(page, "function RecordDialog(", "function LedgerTable(");
const ledger = between(page, "function LedgerTable(", "function FixOnReconcile(");
// The last function in the file (the Settings card after it went on Oct 9).
const setCountButton = page.slice(page.indexOf("function SetCountButton("));

const ADMIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MGR = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const USER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const TECH = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const CAULK = {
  screen_id: "duro_last:sealants",
  row_label: "Duro-Caulk Plus",
  price_col: "White",
};
const move = (id: number, over: Record<string, unknown>) => ({
  id,
  location_id: "shop",
  ...CAULK,
  qty: 1,
  unit: "tube",
  reason: "leftover",
  item_no: null,
  pair_id: null,
  bid_id: null,
  bid_name: null,
  service_job_id: null,
  service_job_name: null,
  counted_note: null,
  note: null,
  created_by: ADMIN,
  created_by_name: "Ann",
  created_at: "2026-10-07T14:00:00Z",
  ...over,
});
/** The service material that names the caulk cell (CenterPoint's name). */
const CAULK_MATERIAL = {
  id: "m1",
  name: "Caulk, Duro-Caulk White",
  unit: "each",
  sort: 1,
  active: true,
  stock_screen_id: CAULK.screen_id,
  stock_row_label: CAULK.row_label,
  stock_price_col: CAULK.price_col,
  category: null,
  stock_per_unit: null,
  piece_name: null,
};

function world(over: Record<string, Record<string, unknown>[]> = {}) {
  return fakeSupabase({
    profiles: [
      { id: ADMIN, role: "admin", access: [], full_name: "Ann", email: "ann@example.com" },
      { id: MGR, role: "manager", access: [], full_name: "Mo", email: "mo@example.com" },
      { id: USER, role: "user", access: ["estimate"], full_name: "Est", email: "e@example.com" },
      {
        id: TECH,
        role: "user",
        access: ["service"],
        technician: true,
        full_name: "Tech",
        email: "t@example.com",
      },
    ],
    inventory_locations: [
      { id: "shop", name: "Shop", kind: "shop", sort: 0, active: true },
      { id: "van-1", name: "Van 1", kind: "vehicle", sort: 1, active: true },
    ],
    pricing_catalog: [],
    catalog_item_numbers: [],
    service_materials_catalog: [],
    vehicle_drivers: [],
    inventory_movements: [],
    ...over,
  });
}
type Call<T> = (a: { data: unknown; context: unknown }) => Promise<T>;
const call = <T>(
  fn: unknown,
  env: ReturnType<typeof fakeSupabase>,
  userId: string,
  data?: unknown,
) => (fn as Call<T>)({ data, context: { supabase: env.db, userId } });

// ---------------------------------------------------------------------------------------------
describe("B1 · listMovements pages the ledger", () => {
  const three = [
    move(1, { created_at: "2026-10-01T10:00:00Z" }),
    move(2, { created_at: "2026-10-02T10:00:00Z" }),
    move(3, { created_at: "2026-10-03T10:00:00Z" }),
  ];
  it("no arguments: one full page (1,000), not 300", async () => {
    expect(MOVEMENTS_PAGE).toBe(1000);
    const rows = await call<MovementRow[]>(
      listMovements,
      world({ inventory_movements: three }),
      ADMIN,
      {},
    );
    expect(rows.map((r) => r.id).sort()).toEqual([1, 2, 3]);
    expect(fns).toContain(".limit(data.limit ?? MOVEMENTS_PAGE);");
    expect(fns).not.toContain("?? 300");
  });
  it("limit caps a page; before (the oldest shown entry's created_at) returns what came before it", async () => {
    const env = world({ inventory_movements: three });
    expect(await call<MovementRow[]>(listMovements, env, ADMIN, { limit: 2 })).toHaveLength(2);
    const older = await call<MovementRow[]>(listMovements, env, ADMIN, {
      before: "2026-10-02T10:00:00Z",
    });
    expect(older.map((r) => r.id)).toEqual([1]);
    expect(fns).toContain('if (data.before) q = q.lt("created_at", data.before);');
    expect(fns).toContain('.order("created_at", { ascending: false })');
  });
  it("refuses a page over 1,000 and a cursor that is not a timestamp", () => {
    const env = world({ inventory_movements: three });
    expect(() => call(listMovements, env, ADMIN, { limit: 1001 })).toThrow();
    expect(() => call(listMovements, env, ADMIN, { before: "yesterday" })).toThrow();
  });
});

describe("B1 · the History tab says how much is shown, pages on Show older and filters by Where", () => {
  it("the header is honest: 'latest N shown' while there may be more, else 'N entries'", () => {
    expect(page).toContain(
      "const hasOlder = movesQ.isFetched && lastPage.length >= MOVEMENTS_PAGE;",
    );
    expect(page).toContain("? `latest ${moves.length} shown`");
    expect(page).toContain(': `${moves.length} entr${moves.length === 1 ? "y" : "ies"}`');
  });
  it("Show older appends the next page by cursor; older pages are dropped when the first page re-reads", () => {
    expect(page).toContain("const page = await movesFn({ data: { before: oldest.created_at } });");
    expect(page).toContain("setOlder((o) => [...o, ...page]);");
    expect(page).toMatch(/\{hasOlder && \(\s*<Button[\s\S]*?Show older/);
    expect(page).toMatch(
      /useEffect\(\(\) => \{\s*setOlder\(\[\]\);\s*\}, \[movesQ\.dataUpdatedAt\]\);/,
    );
    // The cache keeps its plain-array shape: the close-out and the estimator invalidate this key.
    expect(page).toContain('queryKey: ["inventory-movements"],');
    expect(page).not.toContain("useInfiniteQuery");
  });
  it("the ledger reuses the page's Where state so one truck's entries can be seen alone", () => {
    expect(page).toContain("where={where}");
    expect(page).toContain("onWhere={setWhere}");
    expect(ledger).toContain(
      'props.where === "all" ? props.rows : props.rows.filter((r) => r.location_id === props.where);',
    );
    expect(ledger).toContain("<Select value={props.where} onValueChange={props.onWhere}>");
    expect(ledger).toContain("{here.length} at {locName(props.where)}");
  });
});

// ---------------------------------------------------------------------------------------------
describe("B2 (revised) · Put-in keeps the remembered job and shows it unmistakably", () => {
  it("the dialog still starts on the last job used on this phone", () => {
    expect(dialog).toContain("useState<string>(() => props.initialJob ?? readLastJob())");
  });
  it("'Left over from a job' is the first purpose, 'Bought or delivered (no job)' the second (put-in only)", () => {
    const purposes = between(dialog, "data-purposes>", "</ul>");
    const leftover = purposes.indexOf('consumed ? "A job" : "Left over from a job"');
    const bought = purposes.indexOf('"Bought or delivered (no job)"');
    expect(leftover).toBeGreaterThan(-1);
    expect(bought).toBeGreaterThan(leftover);
    expect(purposes).toMatch(
      /\{!consumed && \(\s*<li>\s*\{choice\(\s*"Bought or delivered \(no job\)"/,
    );
    expect(purposes).toContain('setPurpose({ kind: "purchase" })');
    expect(dialog).not.toContain("A delivery / purchase");
  });
  it("the chosen job is a highlighted 'Left over from <job>' line with Change, not a quiet picker", () => {
    const picker = between(page, "function JobPicker(", "function LocationPicker(");
    expect(picker).toContain("data-chosen-job");
    expect(picker).toContain("border-2 border-primary/60 bg-primary/10");
    expect(picker).toContain("{props.prefix} <JobKindTag kind={chosen.kind} />");
    expect(picker).toMatch(
      /variant="outline" onClick=\{\(\) => props\.onChange\("__pick__"\)\}>\s*Change/,
    );
    expect(dialog).toContain('prefix={consumed ? "For" : "Left over from"}');
  });
  it("a job purpose needs its job in both modes; 'Bought or delivered' sends neither bid nor ticket, reason leftover", () => {
    expect(dialog).toContain('const jobOk = purpose?.kind === "job" ? !!job : true;');
    expect(dialog).toContain("required\n");
    expect(dialog).not.toContain("optional — leave blank for a purchase");
    expect(dialog).toContain('const reason = consumed ? "consumed" : "leftover";');
    expect(dialog).toContain('const forJob = purpose.kind === "job" ? job : undefined;');
    expect(dialog).toContain('bid_id: forJob?.kind === "bid" ? forJob.id : null,');
    expect(dialog).toContain('service_job_id: forJob?.kind === "service" ? forJob.id : null,');
    expect(dialog).toContain('" (bought or delivered)"');
    // No new reason: the RLS insert policy's list is untouched.
    expect(fns).toMatch(
      /reason: z\.enum\(\["leftover", "adjustment", "damaged", "consumed", "released"\]\)/,
    );
  });
});

// ---------------------------------------------------------------------------------------------
describe("B3 (revised) · two amount boxes, whole packs and pieces", () => {
  const box = { name: "fastener", perPack: 1000 };
  it("combinedCount: blank is nothing; packs alone go as packs; any pieces make the total pieces", () => {
    expect(combinedCount("", "", box)).toBeNull();
    expect(combinedCount("3", "", box)).toEqual({
      qty: 3,
      inPieces: false,
      packs: 3,
      pieces: 3000,
    });
    expect(combinedCount("", "600", box)).toEqual({
      qty: 600,
      inPieces: true,
      packs: 0.6,
      pieces: 600,
    });
    expect(combinedCount("3", "600", box)).toEqual({
      qty: 3600,
      inPieces: true,
      packs: 3.6,
      pieces: 3600,
    });
    // "12" at the shop is twelve boxes, never 0.012 of one.
    expect(combinedCount("12", "", box)?.qty).toBe(12);
  });
  it("combinedCount: a product without pieces has one box in its unit; junk, negatives and zero are nothing", () => {
    expect(combinedCount("2", "", null)).toEqual({
      qty: 2,
      inPieces: false,
      packs: 2,
      pieces: null,
    });
    expect(combinedCount("", "5", null)).toBeNull();
    expect(combinedCount("abc", "", box)).toBeNull();
    expect(combinedCount("-1", "", box)).toBeNull();
    expect(combinedCount("0", "", box)).toBeNull();
    expect(combinedCount("0", "0", box)).toBeNull();
    expect(combinedCount("1.5", "", null)?.qty).toBe(1.5);
  });
  it("the dialog has the two boxes (blank), no Count-in toggle, and sends in_pieces with the piece total", () => {
    expect(dialog).toContain('const [packsText, setPacksText] = useState("");');
    expect(dialog).toContain('const [piecesText, setPiecesText] = useState("");');
    expect(dialog).toContain("const count = combinedCount(packsText, piecesText, piece);");
    expect(dialog).toContain("{piece ? `Whole ${packUnitLabel(2, unit)}` : unit}");
    expect(dialog).toContain(
      '<Label className="text-xs text-muted-foreground">{plural(2, piece.name)}</Label>',
    );
    expect(dialog).not.toContain("Count in");
    expect(dialog).not.toContain("countMode");
    expect(dialog).toContain("const n = count.qty;");
    expect(dialog).toContain("const pieces = count.inPieces ? { in_pieces: true as const } : {};");
    expect(dialog).toContain("const amountOk = !!count;");
  });
  it("the total shows under the boxes in both units", () => {
    expect(dialog).toMatch(
      /data-conversion>\s*= \{describeStock\(count\.packs, unit, null\)\} ·\{" "\}\s*\{describeStock\(count\.packs, unit, piece\)\}/,
    );
    expect(dialog).toContain("{piece.perPack} {plural(piece.perPack, piece.name)} per {unit}");
  });
});

// ---------------------------------------------------------------------------------------------
describe("B4 · Set count on every stock row", () => {
  const row: StockRow = {
    location_id: "shop",
    ...CAULK,
    category: "Sealants",
    unit: "tube",
    on_hand: 7,
    last_at: null,
    item_nos: [],
    piece: null,
    label: null,
  };
  it("reconcileAdjustment takes a cell at or above zero DOWN to the typed count, with the stock table's note", () => {
    expect(reconcileAdjustment(row, 5, COUNT_NOTE)).toEqual({
      ...CAULK,
      location_id: "shop",
      qty: -2,
      reason: "adjustment",
      note: "Counted on Inventory",
    });
    expect(reconcileAdjustment(row, 0, COUNT_NOTE)?.qty).toBe(-7);
    expect(reconcileAdjustment(row, 7, COUNT_NOTE)).toBeNull();
    // The Reconcile tab keeps its own note by default.
    expect(reconcileAdjustment({ ...row, on_hand: -2 }, 0)?.note).toBe(RECONCILE_NOTE);
  });
  it("the button is on each row (phone card and table) for canAccess(estimate): admins and managers pass, a technician does not", () => {
    expect(page).toContain('const canSetCount = canAccess(profile, "estimate");');
    expect(page.match(/\{canSetCount && \(\s*<SetCountButton/g)).toHaveLength(2);
    expect(setCountButton).toContain("const addFn = useServerFn(addMovement);");
    expect(setCountButton).toContain(
      "const payload = counted === null ? null : reconcileAdjustment(r, counted, COUNT_NOTE);",
    );
    expect(setCountButton).toContain("await addFn({ data: payload });");
    expect(setCountButton).toContain("disabled={!payload || busy}");
    // Owner, Oct 9 (later the same day): the Reconcile tab's words — "Really on the shelf now",
    // the unit after the box, Save count (inventory-tabs.test.ts pins the rest).
    expect(setCountButton).toContain("Really on the {placeWord(r.location_id)} now");
    expect(setCountButton).toContain("{packUnitLabel(2, r.unit)}</span>");
    expect(canAccess({ role: "admin", access: [] }, "estimate")).toBe(true);
    expect(canAccess({ role: "manager", access: [] }, "estimate")).toBe(true);
    expect(canAccess({ role: "user", access: ["service"], technician: true }, "estimate")).toBe(
      false,
    );
    // The Reconcile tab keeps the same gate (seesEveryone shows the tab; canSetCount the box).
    expect(page).toContain('{tab === "reconcile" && <ReconcileTab canSetCount={canSetCount} />}');
  });
});

describe("B5 · a blank Counted box never enables Set count", () => {
  it("parseCounted: blank, junk and negatives are nothing; a typed 0 is a count", () => {
    expect(parseCounted("")).toBeNull();
    expect(parseCounted("  ")).toBeNull();
    expect(parseCounted("x")).toBeNull();
    expect(parseCounted("-1")).toBeNull();
    expect(parseCounted("0")).toBe(0);
    expect(parseCounted("2.5")).toBe(2.5);
  });
  it("both Set count boxes track their text, not a NumberField's number", () => {
    const negative = between(page, "function NegativeRow(", "function SetCountButton(");
    for (const src of [negative, setCountButton]) {
      expect(src).toContain('const [text, setText] = useState("");');
      expect(src).toContain("const counted = parseCounted(text);");
      expect(src).not.toContain("NumberField");
    }
    expect(page).not.toContain("import { NumberField }");
  });
});

describe("B6 · the dialog's refresh also invalidates the Reconcile report", () => {
  it("refresh() names all three keys", () => {
    const refresh = between(page, "const refresh = () => {", "};");
    expect(refresh).toContain('queryKey: ["inventory-stock"]');
    expect(refresh).toContain('queryKey: ["inventory-movements"]');
    expect(refresh).toContain('queryKey: ["inventory-reconcile"]');
  });
});

// ---------------------------------------------------------------------------------------------
describe("S1 · the dialog stays open after Save", () => {
  it("clears the product, the amount and the note; keeps the place, purpose and job; Cancel becomes Close", () => {
    expect(dialog).toMatch(
      /props\.onSaved\(saved\);\s*\/\/[^\n]*\n(\s*\/\/[^\n]*\n)*\s*setSavedCount\(\(c\) => c \+ 1\);\s*setRef\(null\);\s*clearAmount\(\);\s*setNote\(""\);/,
    );
    expect(dialog).not.toMatch(/props\.onSaved\(saved\);\s*props\.onClose\(\);/);
    expect(dialog).toContain('{savedCount > 0 ? "Close" : "Cancel"}');
    expect(dialog).toContain("data-saved-line");
    expect(page).toContain('toast.success("Saved — add another", {');
    expect(page).toContain("description: saved.message,");
    // The chosen place stays a chip with Change (the Sep 24 where-first flow).
    expect(page).toMatch(/function LocationPicker\([\s\S]*?Change/);
  });
});

describe("S3 · the shop is the default place for anyone without a vehicle", () => {
  it("the header buttons and both deep links start on my vehicle, else the shop", () => {
    expect(page).toContain("location: r ? r.location_id : (myVehicle ?? SHOP_LOCATION_ID),");
    expect(page).toMatch(
      /mode: "consumed",\s*ref: null,\s*location: myVehicle \?\? SHOP_LOCATION_ID,/,
    );
    expect(page).toMatch(/mode: "leftover",\s*ref: null,\s*location: SHOP_LOCATION_ID,/);
    expect(page).not.toContain("take && myVehicle ? myVehicle : null");
  });
});

describe("S4 · truck to truck", () => {
  it("taking off a vehicle offers the other vehicles ('Move to …') through transferStock", () => {
    expect(dialog).toContain('{(location.kind === "shop" || consumed) &&');
    expect(dialog).toMatch(
      /location\.kind === "vehicle"\s*\? `Move to \$\{v\.name\}`\s*: `Load onto \$\{v\.name\}`/,
    );
    expect(dialog).toContain("from_location_id: consumed ? location.id : vehicle.id,");
    expect(dialog).toContain("to_location_id: consumed ? vehicle.id : location.id,");
    expect(dialog).toMatch(
      /location\?\.kind === "vehicle"\s*\? `Move to \$\{vehicle\?\.name \?\? "the vehicle"\}`/,
    );
    // transferStock accepts any two different locations.
    expect(fns).toContain("if (data.from_location_id === data.to_location_id)");
  });
});

// ---------------------------------------------------------------------------------------------
describe("S14 · names and units as on the close-out", () => {
  it("(a) listStock and listMovements carry the service material's label; the page shows it first and searches it", async () => {
    const env = world({
      inventory_movements: [move(1, {})],
      service_materials_catalog: [CAULK_MATERIAL],
    });
    const stock = await call<StockRow[]>(listStock, env, ADMIN);
    expect(stock).toHaveLength(1);
    expect(stock[0]!.label).toBe("Caulk, Duro-Caulk White");
    const moves = await call<MovementRow[]>(listMovements, env, ADMIN, {});
    expect(moves[0]!.label).toBe("Caulk, Duro-Caulk White");
    // Without a service material the label is null and the catalog's name shows.
    const bare = await call<StockRow[]>(
      listStock,
      world({ inventory_movements: [move(1, {})] }),
      ADMIN,
    );
    expect(bare[0]!.label).toBeNull();
    expect(page).toContain('<p className="truncate font-medium">{cellName(r)}</p>');
    expect(page).toMatch(/\{cellName\(r\)\}\s*\{r\.label && \(\s*<span[^>]*>\s*\{r\.row_label\}/);
    expect(page).toContain('(r.label ?? "").toLowerCase().includes(filter) ||');
    expect(ledger).toContain("{cellName(r)}");
    expect(ledger).toContain('(r.label ?? "").toLowerCase().includes(f) ||');
  });
  it("(a) cellName: the label first, else the row with its colour; a price column is no colour", () => {
    expect(cellName({ label: "Caulk, Duro-Caulk White", ...CAULK })).toBe(
      "Caulk, Duro-Caulk White",
    );
    expect(cellName(CAULK)).toBe("Duro-Caulk Plus · White");
    expect(cellName({ row_label: "OlyBond", price_col: "price" })).toBe("OlyBond");
    expect(cellName({ row_label: '3" [Spade]', price_col: "Price/Box" })).toBe('3" [Spade]');
    expect(cellName({ label: null, row_label: "ISO", price_col: "Cost/Sq. Ft." })).toBe("ISO");
  });
  it("(a) the Reconcile report names cells by their label too", async () => {
    const r = buildReconciliation({
      movements: [{ ...move(1, { qty: -2 }), label: "Caulk, Duro-Caulk White" }],
      locations: [{ id: "shop", name: "Shop" }],
      since: "2026-10-05T04:00:00.000Z",
      until: "2026-10-12T04:00:00.000Z",
    });
    expect(r.negatives.map((n) => n.name)).toEqual(["Caulk, Duro-Caulk White"]);
    const env = world({
      inventory_movements: [move(1, { qty: -2 })],
      service_materials_catalog: [CAULK_MATERIAL],
    });
    const rep = await call<Reconciliation>(getReconciliation, env, MGR, {
      weekStart: "2026-10-05",
    });
    expect(rep.negatives[0]!.name).toBe("Caulk, Duro-Caulk White");
  });
  it("(b) packUnitLabel pluralises pack units in one place and describeStock / displayStock use it", () => {
    expect(packUnitLabel(2, "box")).toBe("boxes");
    expect(packUnitLabel(1, "box")).toBe("box");
    expect(packUnitLabel(3, "case")).toBe("cases");
    expect(packUnitLabel(2, "4-Cartridge Case")).toBe("4-Cartridge Cases");
    expect(packUnitLabel(1, "4-Cartridge Case")).toBe("4-Cartridge Case");
    expect(packUnitLabel(2, "sq ft")).toBe("sq ft");
    expect(packUnitLabel(2, "each")).toBe("each");
    expect(packUnitLabel(0.5, "pail")).toBe("pails");
    expect(describeStock(2, "box", null)).toBe("2 boxes");
    expect(describeStock(1, "4-Cartridge Case", null)).toBe("1 4-Cartridge Case");
    expect(describeStock(3, "case", null)).toBe("3 cases");
    expect(displayStock(2, "bag", null)).toEqual({ amount: 2, unit: "bags" });
    // Pieces still win when the product has them.
    expect(describeStock(0.75, "4-Cartridge Case", { name: "cartridge", perPack: 4 })).toBe(
      "3 cartridges",
    );
    // The same rule as the close-out's helper, kept there for its own callers.
    expect(read("src/components/service/materials-utils.ts")).toContain(
      "export function packUnitLabel(",
    );
    // Used by the picker's "on hand", History and the row's Set count.
    expect(page).toContain("`${describeStock(onHand(p), p.unit, p.piece)} on hand`");
    expect(page).toContain("{describeStock(onHand(chosen), chosen.unit, chosen.piece)} on hand");
    expect(ledger).toContain("{describeStock(r.qty, r.unit, props.pieceFor(r))}");
  });
  it("(c) a pack price column is not a colour / size", () => {
    expect(isPriceCol("price")).toBe(true);
    expect(isPriceCol("Price/Box")).toBe(true);
    expect(isPriceCol("Price/Part")).toBe(true);
    expect(isPriceCol("Cost/Sq. Ft.")).toBe(true);
    expect(isPriceCol("White")).toBe(false);
    expect(isPriceCol('2"')).toBe(false);
    expect(variantOf("Price/Box")).toBeNull();
    expect(variantOf("Tan")).toBe("Tan");
    expect(priceColLabel("Price/Box")).toBe("—");
    expect(priceColLabel("price")).toBe("—");
    expect(priceColLabel("White")).toBe("White");
  });
  it("(d) the page reads the piece off the stock row (listStock's), not the catalog targets", () => {
    expect(page).toContain("const d = displayStock(r.on_hand, r.unit, r.piece);");
    expect(page).toContain("const piece = r.piece;");
    expect(page).not.toContain("pieceOf(");
    expect(page).toContain(
      "stockPiece.get(`${cell.screen_id}|${cell.row_label}|${cell.price_col}`) ??",
    );
  });
});

// ---------------------------------------------------------------------------------------------
describe("managers set drivers (owner, Oct 9)", () => {
  const sql = read("supabase/migrations/20261009130000_managers_set_drivers.sql");
  it("the migration makes vehicle_drivers_write admins OR managers, idempotently", () => {
    expect(sql).toContain("drop policy if exists vehicle_drivers_write on public.vehicle_drivers;");
    expect(sql).toMatch(
      /create policy vehicle_drivers_write on public\.vehicle_drivers for all to authenticated\s*using \(public\.is_admin\(\) or public\.is_manager\(\)\)\s*with check \(public\.is_admin\(\) or public\.is_manager\(\)\);/,
    );
    // Every create policy is preceded by its drop; nothing else is touched.
    expect(sql.match(/create policy/g)).toHaveLength(1);
    expect(sql.match(/drop policy if exists/g)).toHaveLength(1);
    expect(sql).not.toMatch(/create table|alter table|create or replace function/);
    // is_manager() exists.
    expect(read("supabase/migrations/20260930093000_manager_role.sql")).toContain(
      "create or replace function public.is_manager()",
    );
  });
  it("setVehicleDrivers: a manager sets today's driver; an estimator and a technician are refused", async () => {
    const env = world();
    const r = await call<{ ok: boolean; added: number }>(setVehicleDrivers, env, MGR, {
      location_id: "van-1",
      user_ids: [TECH],
    });
    expect(r).toMatchObject({ ok: true, added: 1, closed: 0 });
    const rows = env.tables["vehicle_drivers"]!;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ location_id: "van-1", user_id: TECH, created_by: MGR });
    expect(rows[0]!["from_date"]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    for (const who of [USER, TECH]) {
      await expect(
        call(setVehicleDrivers, world(), who, { location_id: "van-1", user_ids: [TECH] }),
      ).rejects.toThrow("Forbidden: admins and managers only");
    }
    expect(fns).toContain(
      'if (!seesEveryone(me)) throw new Error("Forbidden: admins and managers only");',
    );
  });
  it("the Setup tab shows for managers too", () => {
    const setup = read("src/routes/setup.tsx");
    expect(setup).toContain("const canSetDrivers = seesEveryone(profile);");
    expect(setup).toMatch(/\{canSetDrivers && \(\s*<TabsTrigger value="vehicles"/);
    expect(setup).toMatch(/\{canSetDrivers && \(\s*<TabsContent value="vehicles"/);
    expect(setup).toContain("enabled: canSetDrivers,");
    expect(setup).not.toContain('role === "admin"');
  });
});
