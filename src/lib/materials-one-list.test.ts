/**
 * Owner, Oct 9 ("go ahead and build all five materials changes"): the close-out's Materials
 * section had three ways to add, a dead truck block for someone with no truck and a heading
 * still saying "off the truck". Now: (1) ONE "On this ticket" list of everything logged from any
 * place, at the top, each line a stepper row; (2) one way in — the "Find any material" box, with a
 * "Browse the shop" link for anyone who does not know the name; (3) the truck list is a
 * "What's on my truck" fold, not rendered at all when the login has no truck; (4) the heading
 * reads "Anything used?"; (5) the Usual chips stay right under the heading. The helper is pure
 * (materials-on-ticket.ts); the markup pins fail on the old section.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { onTicketRows, type KnownCell, type OnTicketEntry } from "@/lib/materials-on-ticket";

const TRUCK = "truck-a";
const caulk = {
  screen_id: "duro_last:sealants",
  row_label: "Duro-Caulk",
  price_col: "White",
  label: "Duro-Caulk White",
  unit: "tube",
};
const glue = {
  screen_id: "duro_last:adhesives",
  row_label: "Duro-Fleece Adhesive",
  price_col: "price",
  label: null,
  unit: "4-Cartridge Case",
};
let nextId = 1;
const entry = (
  cell: typeof caulk | typeof glue,
  location_id: string,
  qty: number,
  created_at: string,
  extra: Partial<OnTicketEntry> = {},
): OnTicketEntry => ({
  id: nextId++,
  ...cell,
  location_id,
  qty,
  counted_note: null,
  created_by_name: "Tech",
  created_at,
  ...extra,
});
const truckCaulk: KnownCell = {
  ...caulk,
  location_id: TRUCK,
  category: "Sealants",
  on_hand: 7,
  piece: null,
  item_no: "1106",
  location_name: "Truck A",
};
const locName = (id: string) => (id === "shop" ? "Shop" : id === TRUCK ? "Truck A" : id);

describe("onTicketRows", () => {
  it("merges truck and shop cells into one list, first logged first, the ledger arriving newest first", () => {
    // listServiceJobMaterials returns newest first; the list reads oldest first.
    const ledger = [
      entry(caulk, "shop", -2, "2026-10-09T10:20:00Z"),
      entry(glue, TRUCK, -0.5, "2026-10-09T10:10:00Z", { counted_note: "2 cartridges" }),
      entry(caulk, TRUCK, -1, "2026-10-09T10:00:00Z"),
      entry(caulk, TRUCK, -1, "2026-10-09T10:30:00Z"),
    ];
    const rows = onTicketRows(ledger, [truckCaulk], locName);
    expect(rows.map((r) => [r.location_id, r.row_label, r.packs, r.from])).toEqual([
      [TRUCK, "Duro-Caulk", 2, "from Truck A"],
      [TRUCK, "Duro-Fleece Adhesive", 0.5, "from Truck A"],
      ["shop", "Duro-Caulk", 2, "from Shop"],
    ]);
    // A cell the screen has a row for lends its category, item #, on-hand and name.
    expect(rows[0]).toMatchObject({
      key: `${TRUCK}\u0000duro_last:sealants\u0000Duro-Caulk\u0000White`,
      label: "Duro-Caulk White",
      category: "Sealants",
      item_no: "1106",
      on_hand: 7,
      known: true,
      first: "2026-10-09T10:00:00Z",
    });
    // The same product on another shelf shares the piece and item #; the shop's on-hand is
    // unknown until the all-locations read answers, so + leaves the check to the server.
    expect(rows[2]).toMatchObject({
      item_no: "1106",
      category: "Sealants",
      on_hand: 0,
      known: false,
      location_name: "Shop",
    });
    // A cell no row knows reads its piece back from the counted note (2 cartridges = 0.5 case).
    expect(rows[1]).toMatchObject({
      piece: { name: "cartridge", perPack: 4 },
      unit: "4-Cartridge Case",
      label: null,
    });
  });
  it("a cell taken back to zero disappears; a returned-only cell shows as returned (negative packs)", () => {
    const ledger = [
      entry(caulk, TRUCK, -1, "2026-10-09T10:00:00Z"),
      entry(caulk, TRUCK, 1, "2026-10-09T10:01:00Z"),
      entry(glue, "shop", 0.25, "2026-10-09T10:02:00Z"),
    ];
    const rows = onTicketRows(ledger, [], locName);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ location_id: "shop", packs: -0.25, from: "from Shop" });
  });
  it("the all-locations read gives a shop line its on-hand, so + is checked on the screen", () => {
    const ledger = [entry(caulk, "shop", -2, "2026-10-09T10:20:00Z")];
    const [r] = onTicketRows(ledger, [], locName, (c) => (c.location_id === "shop" ? 10 : null));
    expect(r).toMatchObject({ on_hand: 10, known: true });
  });
  it("a row's place in the list is where it was first logged, not where it was last corrected", () => {
    const ledger = [
      entry(caulk, TRUCK, -1, "2026-10-09T12:00:00Z"),
      entry(caulk, "shop", -1, "2026-10-09T11:00:00Z"),
      entry(caulk, TRUCK, -1, "2026-10-09T10:00:00Z"),
    ];
    expect(onTicketRows(ledger, [], locName).map((r) => r.location_id)).toEqual([TRUCK, "shop"]);
    // Two cells first logged in the same instant: the lower entry id first.
    const same = [
      entry(glue, "shop", -1, "2026-10-09T10:00:00Z"),
      entry(caulk, "shop", -1, "2026-10-09T10:00:00Z"),
    ];
    expect(onTicketRows(same, [], locName).map((r) => r.row_label)).toEqual([
      "Duro-Fleece Adhesive",
      "Duro-Caulk",
    ]);
  });
  it("an empty ledger is an empty list", () => {
    expect(onTicketRows([], [truckCaulk], locName)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------

describe("the Materials section: one list, one way in", () => {
  const src = readFileSync("src/components/service/materials-section.tsx", "utf8");
  const body = src.slice(src.indexOf("const body = ("), src.indexOf("if (collapsible)"));
  const at = (s: string) => {
    const i = body.indexOf(s);
    expect(i, `"${s}" is in the body`).toBeGreaterThan(-1);
    return i;
  };

  it("reads heading → Usual chips → On this ticket → Find any material → What's on my truck", () => {
    const heading = at("Anything used?");
    const usual = at("Usual for {t.name}");
    const list = at('aria-label="On this ticket"');
    const find = at('aria-label="Find any material"');
    const browse = at("Browse the shop");
    const panel = at('aria-label="Material from elsewhere"');
    const fold = at('aria-label="What\'s on my truck"');
    const radio = at('aria-label="Which truck"');
    expect(heading).toBeLessThan(usual);
    expect(usual).toBeLessThan(list);
    expect(list).toBeLessThan(find);
    expect(find).toBeLessThan(browse);
    expect(browse).toBeLessThan(panel);
    expect(panel).toBeLessThan(fold);
    // With several trucks the radio sits inside the fold, at its top.
    expect(fold).toBeLessThan(radio);
    expect(radio).toBeLessThan(at('placeholder="Find on the truck (name, colour, item #)…"'));
  });
  it("(4) the heading reads 'Anything used?', only while nothing is logged", () => {
    expect(src).toMatch(/materials\.isSuccess && !anyUsed && \([\s\S]*?Anything used\?/);
    expect(src).not.toContain("Anything off the truck?");
  });
  it("(1) the On this ticket rows are TruckRows with where each came from under the name", () => {
    expect(src).toContain('import { onTicketRows } from "@/lib/materials-on-ticket";');
    expect(src).toContain(
      "const onTicket = onTicketRows(ledger, [...rows, ...otherRows], locName, (c) => {",
    );
    expect(body).toMatch(
      /aria-label="On this ticket"[\s\S]*?<TruckRow[\s\S]*?fromText=\{r\.from\}[\s\S]*?onAdd=\{\(n\) => add\(r, n, r\.known\)\}[\s\S]*?onReduce=\{\(n\) => reduce\(r, n\)\}[\s\S]*?onSet=\{\(n\) => setTotal\(r, n, r\.known\)\}/,
    );
    // The two old blocks are gone.
    expect(src).not.toContain("On this ticket — correct a quantity");
    expect(src).not.toContain("Also on this ticket");
    expect(src).not.toContain("officeRows");
    // Empty: no list. The "N items" count sits on the close-out's step card header now
    // (closeout.tsx, countMaterialItems; owner, Oct 9: no box in a box), so the section has no
    // heading of its own and no item count.
    expect(body).toContain("{onTicket.length > 0 && (");
    expect(src).not.toContain("const itemsOnTicket = onTicket.length;");
    expect(src).toContain('<section className="space-y-3" aria-label="Materials">');
  });
  it("(2) the search is the one way in; no add button, a Browse the shop link opens the shelf view at the shop", () => {
    expect(src).not.toContain("Add material (shop or a truck)");
    expect(src).not.toContain("From the shop / another truck");
    expect(body).toMatch(
      /variant="link"\s*className="h-10 px-0 text-sm"[\s\S]*?setFromLoc\(shop\?\.id \?\? "shop"\);[\s\S]*?Browse the shop/,
    );
    // The panel keeps its location select and the "Find any material" box keeps its label.
    expect(body).toContain('aria-label="Take material from"');
    expect(body).toMatch(/<Input[\s\S]*?aria-label="Find any material"/);
  });
  it("(3) the truck list is a fold, closed until a truck row has a count, and not rendered without a truck", () => {
    expect(src).toContain("const [truckOpen, setTruckOpen] = useState<boolean | null>(null);");
    expect(src).toContain("const truckHasCount = rows.some((r) => usedUnits(r) > EPS);");
    expect(src).toContain("const truckShown = truckOpen ?? truckHasCount;");
    expect(body).toMatch(
      /\) : vehicleId \? \([\s\S]*?aria-label="What's on my truck"[\s\S]*?className="flex h-10 w-full[\s\S]*?aria-expanded=\{truckShown\}[\s\S]*?onClick=\{\(\) => setTruckOpen\(!truckShown\)\}/,
    );
    expect(body).toMatch(/truckShown \? \(\s*<ChevronUp/);
    expect(body).toMatch(/\) : \(\s*<ChevronDown className="h-4 w-4 shrink-0"/);
    expect(body).toMatch(/\{truckShown && \(\s*<>\s*\{vehicles\.length > 1 && vehicleId && \(/);
    expect(body).toContain(") : null}");
    // No dead block for a login with no truck.
    expect(body).not.toContain("No truck is set up for you today");
    expect(src).not.toContain("From my truck");
    // A truck with nothing stocked says so inside the fold, with the office line.
    expect(body).toMatch(
      /rows\.length === 0 \? \(\s*<p className="text-sm text-muted-foreground">\s*Nothing is on \{locName\(vehicleId\)\} in inventory yet \(the office stocks trucks\s+in\s+Inventory\)\./,
    );
    // Show all stays in the fold.
    expect(body.indexOf("Show all {filtered.length}")).toBeGreaterThan(
      body.indexOf('aria-label="What\'s on my truck"'),
    );
  });
  it("keeps the queue, the optimistic caches and the collapsible office variant intact", () => {
    for (const s of [
      "const enqueue = (key: string, delta: number, what: string, run: () => Promise<void>) => {",
      "const moveTruck = (r: ListRow, packs: number) => {",
      "const refreshAll = () => {",
      "if (inFlight.current === 0) refreshAll();",
      'qc.setQueryData<StockRow[]>(["inventory-stock"], (old) =>',
      '`${lineCount} ${lineCount === 1 ? "line" : "lines"}`',
    ])
      expect(src).toContain(s);
  });
});
