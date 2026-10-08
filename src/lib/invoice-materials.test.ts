/**
 * Owner, Oct 1 (invoice 6000): a screws line from the ticket read 0.05 box @ $159.25 (cost
 * $91/box). He edited it to 3 screws @ $15 and the Cost box read $273 — the hidden per-box cost
 * stayed on a line now counted in screws. "For the material units need to be a bit smaller for
 * repairs — we won't need a box of screws."
 *
 * Material lines are written in PIECES when the catalog says how many a pack holds
 * (invoice-materials.ts, used by buildLinesFromJob in invoices.server.ts), and the editor's
 * hidden cost per unit of a ticket line edited by hand moves with its rate (rescaleCost). The
 * owner then said cost is not to be shown on the line ("this is going out to a customer"): Cost
 * and Margin sit in a closed "Internal" fold for admins and managers only.
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  materialLineFor,
  pieceFromCatalog,
  rateText,
  rescaleCost,
  unitText,
  type CatalogData,
} from "@/lib/invoice-materials";
import { pieceFromCountedNotes } from "@/lib/stock-units";

const read = (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : "");

const screws = {
  row_label: '1 1/2" [Collated Screws]',
  price_col: "Price/Box",
  item_no: null,
  unit: "box",
};
const fasteners = { name: "fastener", perPack: 1000 };

describe("materialLineFor — a material line in pieces when the pack size is known", () => {
  it("0.05 box of 1,000 fasteners @ $91 → 50 fasteners at $0.091 cost, rate = cost × 1.75", () => {
    const l = materialLineFor(screws, 0.05, 91, 0.75, fasteners);
    expect(l.qty).toBe(50);
    expect(l.unit).toBe("fastener");
    expect(l.cost_rate).toBe(0.091);
    expect(l.rate).toBe(0.1593); // 0.091 × 1.75 = 0.15925, kept to 4 decimals
    expect(l.rate).toBeCloseTo(l.cost_rate * 1.75, 4);
    expect(l.total).toBe(7.97); // r2(50 × 0.1593)
    expect(l.cost_total).toBe(4.55); // r2(50 × 0.091)
    expect(l.description).toBe('1 1/2" [Collated Screws] — 1,000 fasteners per box');
  });
  it("a pail with no piece def stays 1 pail at the pack rate", () => {
    const pail = { row_label: "Bonding Adhesive", price_col: "Price", item_no: "77", unit: "pail" };
    expect(materialLineFor(pail, 1, 120, 0.75, null)).toEqual({
      description: "Bonding Adhesive (Price) #77",
      qty: 1,
      unit: "pail",
      rate: 210,
      total: 210,
      cost_rate: 120,
      cost_total: 120,
    });
  });
  it("snaps 49.99 pieces to 50 (the ledger keeps a few decimals of the pack)", () => {
    expect(materialLineFor(screws, 0.04999, 91, 0.75, fasteners).qty).toBe(50);
  });
  it("a 0.0003-box sliver is 0.3 fasteners, not 0", () => {
    const l = materialLineFor(screws, 0.0003, 91, 0.75, fasteners);
    expect(l.qty).toBe(0.3);
    expect(l.total).toBeGreaterThanOrEqual(0);
  });
  it("adhesive cartridges name the case", () => {
    const l = materialLineFor(
      { row_label: "Sealant X", price_col: "Price", item_no: null, unit: "4-Cartridge Case" },
      0.75,
      100,
      0.75,
      { name: "cartridge", perPack: 4 },
    );
    expect([l.qty, l.unit, l.cost_rate, l.rate]).toEqual([3, "cartridge", 25, 43.75]);
    expect(l.description).toBe("Sealant X — 4 cartridges per case");
  });
});

describe("cellPiece's extraction from a pricing_catalog data shape", () => {
  const fastenerScreen: CatalogData = {
    columns: ["Part #", "Subtype", "Description", "Price/Box", "Fasteners/Box"],
    rows: [
      {
        "Part #": "1446",
        Subtype: "Collated Screws",
        Description: '1 1/2"',
        "Price/Box": 91,
        "Fasteners/Box": 1000,
      },
      { "Part #": "1447", Subtype: "Spade", Description: '1 1/2"', "Price/Box": 149.5 },
    ],
  };
  const adhesives: CatalogData = {
    kind: "adhesives",
    products: [
      { name: "Sealant X", unit_type: "4-Cartridge Case", price: 100 },
      { name: "Bonding Adhesive", unit_type: "5-gal. Box Set", price: 120 },
    ],
  };
  it("reads the row's Fasteners/Box", () => {
    expect(pieceFromCatalog(fastenerScreen, { row_label: '1 1/2" [Collated Screws]' })).toEqual(
      fasteners,
    );
  });
  it("no count on the row, or the row is gone → null", () => {
    expect(pieceFromCatalog(fastenerScreen, { row_label: '1 1/2" [Spade]' })).toBeNull();
    expect(pieceFromCatalog(fastenerScreen, { row_label: "Nope" })).toBeNull();
    expect(pieceFromCatalog(null, { row_label: "Nope" })).toBeNull();
  });
  it("reads an adhesive's unit type", () => {
    expect(pieceFromCatalog(adhesives, { row_label: "Sealant X" })).toEqual({
      name: "cartridge",
      perPack: 4,
    });
    expect(pieceFromCatalog(adhesives, { row_label: "Bonding Adhesive" })).toBeNull();
  });
  it("falls back to the ledger's counted_note", () => {
    expect(pieceFromCountedNotes([{ qty: -0.05, counted_note: "50 fasteners" }])).toEqual(
      fasteners,
    );
    expect(pieceFromCountedNotes([{ qty: -1, counted_note: null }])).toBeNull();
  });
});

describe("display", () => {
  it("pluralises piece units and shows a per-piece rate to 4 decimals", () => {
    expect(unitText(50, "fastener")).toBe("fasteners");
    expect(unitText(1, "cartridge")).toBe("cartridge");
    expect(unitText(2, "box")).toBe("box");
    expect(rateText(0.1593)).toBe("$0.1593");
    expect(rateText(15)).toBe("$15.00");
  });
});

describe("buildLinesFromJob writes material lines with materialLineFor", () => {
  const server = read("src/lib/invoices.server.ts");
  it("reads the piece def server-side and passes it in", () => {
    expect(server).toContain("export async function cellPiece(");
    expect(server).toContain("pieceFromCatalog(screen.data as CatalogData, cell)");
    expect(server).toContain("catalogPiece ?? pieceFromCountedNotes(c.notes)");
    // Priced from the service material list since Oct 6 (service-materials.test.ts).
    expect(server).toContain("...materialLineFor(named, c.qty, cost, markup, piece),");
    expect(server).toMatch(/\.select\(\s*"[^"]*counted_note[^"]*"/);
  });
  it("Rebuild from ticket uses buildLinesFromJob", () => {
    const fns = read("src/lib/invoices.functions.ts");
    const rebuild = fns.slice(fns.indexOf("export const rebuildInvoiceLines"));
    // With the invoice's own markup since Oct 6.
    expect(rebuild).toContain("await buildLinesFromJob(sb, inv.service_job_id, {");
  });
});

describe("rescaleCost — a ticket line edited by hand keeps a truthful cost", () => {
  const built = {
    source: "cell:duro_last:fasteners_and_bits|x|Price/Box",
    rate: 159.25,
    cost_rate: 91,
  };
  it("the owner's edit: 0.05 box @ $159.25 (cost $91) → 3 screws @ $15 → cost $8.5714 each", () => {
    const cost = rescaleCost(built, 15);
    expect(cost).toBe(8.5714);
    expect(Math.round(3 * cost * 100) / 100).toBe(25.71); // not 3 × 91 = $273
  });
  it("an unchanged rate keeps the cost; a blank rate keeps it too", () => {
    expect(rescaleCost(built, 159.25)).toBe(91);
    expect(rescaleCost(built, null)).toBe(91);
  });
  it("a ticket line re-priced to $0 (no charge) keeps its cost, so the margin stays true", () => {
    // 7 patches billed $5.25, cost $3 each: given away, the $21 of cost must stay.
    expect(rescaleCost({ source: "cell:a|b|c", rate: 5.25, cost_rate: 3 }, 0)).toBe(3);
    expect(rescaleCost(built, 0)).toBe(91);
  });
  it("a labor line, a new line and a zero-rate line keep their cost", () => {
    expect(rescaleCost({ source: "time:12", rate: 95, cost_rate: 40 }, 50)).toBe(40);
    expect(rescaleCost({ source: null, rate: null, cost_rate: 0 }, 20)).toBe(0);
    expect(rescaleCost({ source: "cell:a|b|c", rate: 0, cost_rate: 0 }, 20)).toBe(0);
  });
});

describe("the editor: no per-line cost; cost and margin folded for managers", () => {
  const ed = read("src/components/service/invoice-editor.tsx");
  const header = ed.slice(
    ed.indexOf("<span>Kind</span>"),
    ed.indexOf('<span className="sr-only">Remove</span>'),
  );
  it("the line table has no Cost column or cost box", () => {
    expect(header).toContain("Rate");
    expect(header).not.toContain("Cost");
    expect(ed).not.toMatch(/label=\{`Line \$\{i \+ 1\} cost/);
    expect(ed).not.toContain("setLine(l.key, { cost_rate");
  });
  it("Subtotal / Tax / Total stay; Cost, Margin, Margin / hour sit in a closed fold for managesTickets", () => {
    const totals = ed.slice(ed.indexOf("function Totals("), ed.indexOf("// ---- Final / sent"));
    expect(totals).toContain("const internal = managesTickets(profile);");
    expect(totals).toContain("const [open, setOpen] = useState(false);");
    expect(totals).toContain('localStorage.getItem(INTERNAL_OPEN_KEY) === "1"');
    expect(totals).toContain("Internal — cost and margin");
    const fold = totals.indexOf("{internal && (");
    const sub = totals.indexOf("<dt>Subtotal</dt>");
    expect(sub).toBeGreaterThan(-1);
    expect(sub).toBeLessThan(fold);
    expect(totals.indexOf("<dt>Total</dt>")).toBeLessThan(fold);
    for (const label of ["<dt>Cost</dt>", "<dt>Margin</dt>", "<dt>Margin / hour"])
      expect(totals.indexOf(label)).toBeGreaterThan(totals.indexOf("{open && ("));
  });
  it("a hand edit of qty / unit / rate on a ticket line rescales its cost; a new line costs 0", () => {
    expect(ed).toContain('if (l.orig && ("qty" in patch || "unit" in patch || "rate" in patch))');
    expect(ed).toContain(
      "next.cost_rate = rescaleCost({ source: l.source, ...l.orig }, next.rate);",
    );
    const add = ed.slice(ed.indexOf("const addLine = () => {"), ed.indexOf("const tryFinal"));
    expect(add).toContain("cost_rate: 0,");
    expect(add).toContain("orig: null,");
    expect(ed).toContain(
      "if (l.qty === null || l.rate === null) return `Line ${i + 1} needs a quantity and a rate`;",
    );
  });
});

describe("the invoice PDF prints no cost or margin", () => {
  const server = read("src/lib/invoices.server.ts");
  const pdf = server.slice(
    server.indexOf("export async function renderInvoicePdf"),
    server.indexOf("export function sageCsv"),
  );
  it("renderInvoicePdf / emailInvoice read no cost field and print no cost or margin", () => {
    expect(pdf.length).toBeGreaterThan(1000);
    expect(pdf).not.toMatch(/cost_rate|cost_total|margin/i);
    expect(pdf).not.toMatch(/"[^"]*\bcost\b[^"]*"/i);
  });
  it("prints per-piece units and rates readably", () => {
    expect(pdf).toContain("unitText(Number(l.qty), l.unit)");
    expect(pdf).toContain("rateText(Number(l.rate))");
  });
});
