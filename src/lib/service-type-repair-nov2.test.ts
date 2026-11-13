/**
 * Owner, Nov 2:
 *  1. "just call it repair" — Leak is Repair; "remove scope" — the Scope type went (migration
 *     20261102230000: the check, the default, the live rows).
 *  2. "the create repair ticket should be somewhere more noticeable" — a Done inspection with
 *     no outcome yet carries a banner under the ticket's title with the same three choices.
 *  3. "a module that allows descriptors and prices to be put in and the bottom totals it
 *     automatically" — the Price lines document module (lib/documents/price-lines.ts).
 * Fails on the old code: leak in the lists, no banner, no module.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { CP_SERVICE_TYPE_MAP, cpServiceType } from "@/lib/centerpoint-import";
import {
  MODULE_LABELS,
  MODULE_TILES,
  MODULE_TYPES,
  newModule,
  newPage,
  pagesSchema,
  pagesVariables,
} from "@/lib/documents/model";
import {
  moneyText,
  parseMoney,
  priceLinesEmpty,
  priceLinesTable,
  priceLinesTotal,
} from "@/lib/documents/price-lines";
import { layoutModule } from "@/lib/documents/pdf-layout";
import { SERVICE_TYPES, TYPE_LABELS } from "@/lib/service.functions";
import { TYPE_VALUES } from "@/lib/service-search";

const read = (p: string) => readFileSync(p, "utf8");
const flat = (p: string) =>
  read(p)
    .replace(/--[^\n]*/g, "")
    .replace(/\s+/g, " ");

describe("1. Repair, no Scope", () => {
  it("the types: Repair, Warranty, Inspection, Other; the search agrees; Repair is the default", () => {
    expect([...SERVICE_TYPES]).toEqual(["repair", "warranty", "inspection", "other"]);
    expect(TYPE_LABELS).toEqual({
      repair: "Repair",
      warranty: "Warranty",
      inspection: "Inspection",
      other: "Other",
    });
    expect([...TYPE_VALUES]).toEqual([...SERVICE_TYPES]);
    expect(read("src/lib/service.functions.ts")).toContain(
      'service_type: z.enum(SERVICE_TYPES).default("repair"),',
    );
    expect(read("src/components/service-page.tsx")).toContain('service_type: "repair",');
    expect(read("src/components/service-page.tsx")).not.toContain('"leak"');
  });
  it("the inspection's repair ticket offers Repair / Warranty / Other", () => {
    expect(read("src/lib/service-inspection.functions.ts")).toContain(
      'service_type: z.enum(["repair", "warranty", "other"]),',
    );
    const section = read("src/components/service/inspection-section.tsx");
    expect(section).toContain('<SelectItem value="repair">Repair</SelectItem>');
    expect(section).toContain('useState<RepairType>("repair")');
    expect(section).not.toContain('"leak"');
  });
  it("the CenterPoint import: Leak → repair, Scope → other", () => {
    expect(CP_SERVICE_TYPE_MAP).toEqual({
      leak: "repair",
      scope: "other",
      warranty: "warranty",
      inspection: "inspection",
    });
    expect(cpServiceType("Leak")).toBe("repair");
    expect(cpServiceType(" SCOPE ")).toBe("other");
  });
  it("the migration: the check and the default move to repair, the live rows with them", () => {
    const sql = flat("supabase/migrations/20261102230000_service_type_repair.sql");
    expect(sql).toContain(
      "alter table public.service_jobs drop constraint if exists service_jobs_service_type_check;",
    );
    expect(sql).toContain(
      "update public.service_jobs set service_type = 'repair' where service_type = 'leak';",
    );
    expect(sql).toContain(
      "update public.service_jobs set service_type = 'other' where service_type = 'scope';",
    );
    expect(sql).toContain("alter column service_type set default 'repair';");
    expect(sql).toContain("check (service_type in ('repair', 'warranty', 'inspection', 'other'));");
  });
});

describe("1b. the repair ticket's description names the items alone (owner, Nov 3)", () => {
  it("inspection #6040's four items read as one line instead of 560 characters cut mid-sentence", async () => {
    const { clipWords, repairTicketText } = await import("@/lib/inspection");
    const item = (label: string, note: string) => ({
      id: label.toLowerCase(),
      label,
      status: "issue" as const,
      note,
      photos: [],
    });
    const t = repairTicketText(6040, {
      items: [
        item(
          "Membrane condition",
          "Existing metal roof.  Panels look to be aluminum, no rust except at fasteners.  Panels are bellowed as aluminum panel thickness allows for deflection.  Several ribs are creased due to foot traffic and/or panel movement.",
        ),
        item(
          "Seams",
          "Total of six horizontal seams on roof.  These seams are gapping open due to building movement and foot traffic.",
        ),
        item(
          "Flashings",
          "Wall flashing at low to high roof transition.   Low roof panels at wall flashing show deflection.",
        ),
        item(
          "Sealants",
          "sealant failure at horizontal seams of roof panel, extreme movement and age deterioration.",
        ),
      ] as never,
      notes: "",
    });
    expect(t.description).toBe(
      "From inspection #6040: Membrane condition, Seams, Flashings, Sealants",
    );
    // The notes keep every word.
    expect(t.notes).toContain("- Sealants: sealant failure at horizontal seams of roof panel");
    // With nothing flagged, the findings note, cut at a word when long.
    const long = repairTicketText(6040, { items: [], notes: "word ".repeat(200) });
    expect(long.description.length).toBeLessThanOrEqual(500);
    expect(long.description).toMatch(/ word…$/);
    expect(clipWords("abc def ghi", 8)).toBe("abc def…");
    expect(clipWords("abcdefghij", 8)).toBe("abcdefg…");
    expect(clipWords("short", 8)).toBe("short");
  });
});

describe("2. the Done inspection's banner", () => {
  it("InspectionNextStep: an inspection, Done, the office, no outcome yet; the three choices; under the title", () => {
    const section = read("src/components/service/inspection-section.tsx");
    expect(section).toContain("export function InspectionNextStep({");
    expect(section).toContain(
      'job.service_type === "inspection" && officeOrAdmin && inspectionComplete(job.stage);',
    );
    // Since Nov 13 an outcome hides the banner unless the opportunity question is still owed.
    expect(section).toContain("if (!applies || !q.data) return null;");
    expect(section).toContain("if (q.data.outcome)");
    expect(section).toContain('data-banner="inspection-next"');
    expect(section).toContain("<OfficeActions job={job} data={q.data} dirty={false} />");
    const page = read("src/components/service-page.tsx");
    expect(page).toContain(
      "{job && <InspectionNextStep job={job} officeOrAdmin={officeOrAdmin} />}",
    );
  });
});

describe("3. Price lines", () => {
  it("parseMoney reads what people type; moneyText writes dollars and cents", () => {
    expect(parseMoney("1,250")).toBe(1250);
    expect(parseMoney("$1,250.50")).toBe(1250.5);
    expect(parseMoney(" 1 200 ")).toBe(1200);
    expect(parseMoney("-50")).toBe(-50);
    expect(parseMoney("(50)")).toBe(-50);
    expect(parseMoney("")).toBeNull();
    expect(parseMoney("TBD")).toBeNull();
    expect(parseMoney("1.2.3")).toBeNull();
    expect(moneyText(1250)).toBe("$1,250.00");
    expect(moneyText(1250.5)).toBe("$1,250.50");
    expect(moneyText(-50)).toBe("-$50.00");
    expect(moneyText(0)).toBe("$0.00");
  });
  it("the total adds the numbers and skips the rest; empty is empty", () => {
    const rows = [
      { description: "Reseal 4 pitch pans", price: "$450" },
      { description: "Clear 2 drains", price: "120.50" },
      { description: "Flashing — on inspection", price: "TBD" },
      { description: "", price: "" },
    ];
    expect(priceLinesTotal(rows)).toBe(570.5);
    expect(priceLinesEmpty(rows)).toBe(false);
    expect(priceLinesEmpty([{ description: " ", price: "" }])).toBe(true);
  });
  it("the printable table: Description | Price, prices as money, TBD as typed, the Total row last", () => {
    const t = priceLinesTable({
      rows: [
        { description: "Reseal 4 pitch pans", price: "450" },
        { description: "Flashing", price: "TBD" },
      ],
      totalLabel: "Quote total",
    });
    expect(t.columns.map((c) => `${c.title}:${c.align}`)).toEqual([
      "Description:left",
      "Price:right",
    ]);
    expect(t.rows).toEqual([
      ["Reseal 4 pitch pans", "$450.00"],
      ["Flashing", "TBD"],
      ["Quote total", "$450.00"],
    ]);
    expect(priceLinesTable({ rows: [], totalLabel: "  " }).rows).toEqual([["Total", "$0.00"]]);
  });
  it("the module: a tile with a label, a new one starts with one blank line and Total, the schema takes it, descriptions carry variables", () => {
    expect(MODULE_TYPES).toContain("priceLines");
    expect(MODULE_TILES).toContain("priceLines");
    expect(MODULE_LABELS.priceLines).toBe("Price lines");
    const m = newModule("priceLines");
    expect(m).toMatchObject({
      type: "priceLines",
      rows: [{ description: "", price: "" }],
      totalLabel: "Total",
    });
    expect(pagesSchema.safeParse([newPage([m])]).success).toBe(true);
    const page = newPage([
      {
        ...m,
        rows: [{ description: "Roof at {{property.name}}", price: "10" }],
      } as typeof m,
    ]);
    expect(pagesVariables([page])).toContain("property.name");
  });
  it("the PDF: a table with the Total row bold; an empty module prints nothing", () => {
    const ctx = {
      measure: (text: string, size: number) => text.length * size * 0.5,
      vars: {},
      labelOf: (k: string) => k,
      pricing: { bid: null },
    } as never;
    const full = layoutModule(
      {
        ...newModule("priceLines"),
        rows: [
          { description: "Reseal pans", price: "450" },
          { description: "Drains", price: "120" },
        ],
      } as never,
      0,
      468,
      ctx,
    );
    const rows = full.filter((p) => p.kind === "tableRow");
    expect(rows.length).toBe(4); // header + 2 lines + Total
    expect(layoutModule(newModule("priceLines") as never, 0, 468, ctx)).toEqual([]);
    const src = read("src/lib/documents/pdf-layout.ts");
    expect(src).toContain("boldRow: (_r, i) => i === data.rows.length - 1");
  });
  it("the editor: a description and a price per line, the total under them, Add line; the tile has an icon", () => {
    const view = read("src/components/documents/editor/module-view.tsx");
    expect(view).toContain("function PriceLines({ m, set }: { m: PriceLinesModule; set: Setter })");
    expect(view).toContain("data-price-total");
    expect(view).toContain("{moneyText(total)}");
    expect(view).toContain('<Plus className="h-3 w-3" /> Add line');
    expect(read("src/components/documents/editor-screen.tsx")).toContain(
      "priceLines: CircleDollarSign,",
    );
  });
});
