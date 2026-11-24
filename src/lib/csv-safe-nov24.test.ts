// Nov 24 (public pages audit, B3): text in a spreadsheet file stays text. A cell of words that
// starts with =, +, -, @, a tab or a carriage return gets one single quote in front, in every
// file the site writes for a spreadsheet. A number is never touched.
// EVERY NAME AND NUMBER HERE IS MADE UP.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { csvCell, csvLine } from "@/components/takeoff/shapes";
import { csvSafeCell, csvSafeText, isPlainNumber } from "@/lib/csv-safe";
import { printSheetRows } from "@/lib/inventory-count-sheet";
import { sageCsv } from "@/lib/invoices.server";
import { marginCsvLine } from "@/lib/margin-report";
import { buildReviewRows, toCsv, type ReviewData } from "@/lib/review-export";

const read = (p: string) => readFileSync(p, "utf8");
const flat = (p: string) => read(p).replace(/\s+/g, " ");

/** Words that start the way a formula starts, one for each first character. */
const STARTS = ["=1+1", "+1 606 555 0100", "-2 hours", "@office", "\tindented", "\rnext"];

describe("the one rule (csv-safe.ts)", () => {
  it("words that start like a formula get one single quote in front", () => {
    for (const s of STARTS) expect(csvSafeText(s), JSON.stringify(s)).toBe(`'${s}`);
    expect(csvSafeText("=SUM(A1:A9)")).toBe("'=SUM(A1:A9)");
  });

  it("ordinary words are exactly as they were", () => {
    for (const s of [
      "",
      "Main Plant",
      "Bell County BOE, Pineville",
      "5\"x100' Quick Seam Flashing",
      "2026-11-24",
      "RC-1042",
      "a=b",
      "1+1",
      "x@example.com",
      " =kept as typed",
      "'=already quoted",
      "−3 each",
    ])
      expect(csvSafeText(s), JSON.stringify(s)).toBe(s);
  });

  it("a plain number is a number, with or without a minus sign", () => {
    for (const n of ["0", "12", "-12.50", "12.50", "-3", "0.0313", ".5", "-0.5", "1e+21", "-1e-7"])
      expect(isPlainNumber(n), n).toBe(true);
    for (const t of [
      "",
      "-",
      "+12",
      "=12",
      "-12.50+1",
      "- 12",
      "12 each",
      "-1,234.50",
      "--1",
      "@1",
    ])
      expect(isPlainNumber(t), t).toBe(false);
  });

  it("a cell that came as words: a number is left alone, anything else is guarded", () => {
    expect(csvSafeCell("-12.50")).toBe("-12.50");
    expect(csvSafeCell("-3")).toBe("-3");
    expect(csvSafeCell("1234.50")).toBe("1234.50");
    expect(csvSafeCell("")).toBe("");
    expect(csvSafeCell("-12.50+1")).toBe("'-12.50+1");
    expect(csvSafeCell("+12")).toBe("'+12");
    expect(csvSafeCell("-")).toBe("'-");
    for (const s of STARTS) expect(csvSafeCell(s), JSON.stringify(s)).toBe(`'${s}`);
  });
});

describe("toCsv: the Review file, the inventory files and the margin report", () => {
  it("guards words in any column and leaves amounts as numbers", () => {
    const csv = toCsv([
      ["Name", "Qty", "Value"],
      ["=1+1", "-3", "-12.50"],
      ["@office", "4", "100.00"],
      ["+1 606 555 0100", "", ""],
    ]);
    expect(csv).toBe(
      ["Name,Qty,Value", "'=1+1,-3,-12.50", "'@office,4,100.00", "'+1 606 555 0100,,", ""].join(
        "\r\n",
      ),
    );
  });

  it("the quote goes inside the quoting of a cell that also holds a comma, a quote mark or a line break", () => {
    expect(toCsv([['=A1,"x"']])).toBe(`"'=A1,""x"""\r\n`);
    expect(toCsv([["\tindented"]])).toBe("'\tindented\r\n");
    expect(toCsv([["\rnext"]])).toBe(`"'\rnext"\r\n`);
    expect(toCsv([["-line one\nline two"]])).toBe(`"'-line one\nline two"\r\n`);
  });

  it("an ordinary file is byte for byte what it was", () => {
    const rows = [
      ["Category", "Item", "Colour", "Unit", "Expected", "Counted"],
      ["Membrane", 'Roll, 10" wide', "White", "roll", "12.5", ""],
      ["Accessories", "Pipe boot", "", "each", "-2", ""],
    ];
    expect(toCsv(rows)).toBe(
      [
        "Category,Item,Colour,Unit,Expected,Counted",
        'Membrane,"Roll, 10"" wide",White,roll,12.5,',
        "Accessories,Pipe boot,,each,-2,",
        "",
      ].join("\r\n"),
    );
  });

  it("the Review file: a bid named like a formula is words, a discount is still a negative number", () => {
    const zero = Object.fromEntries(
      [
        "membraneMaterial parapetMaterial curbMaterial metalsMaterial adhesiveMaterial",
        "accessoryMaterial underlaymentMaterial otherMaterial warrantyCost shipping laborCost",
        "subsServices subtotal1 markupValue subtotal2 commissionValue perDiemCharge salesTaxValue",
        "grandTotal installHours setupHours inspectionHours tearOffHours accessoryHours",
        "parapetHours curbHours underlaymentHours ownRateHours totalManDays disposalUnits",
        "roofSqFt membraneSqFt",
      ]
        .join(" ")
        .split(" ")
        .map((k) => [k, 0]),
    );
    const data = {
      ...zero,
      bidName: "=cmd",
      statusLabel: "Draft",
      markupLabel: "25%",
      discounts: -150.5,
    } as unknown as ReviewData;
    const lines = toCsv(buildReviewRows(data)).split("\r\n");
    expect(lines).toContain("Bid,Name,'=cmd");
    expect(lines).toContain("Purchases,Discounts,-150.50");
  });

  it("the count sheet: an item named like a formula is words, a stock below zero is a number", () => {
    const csv = toCsv(
      printSheetRows({
        lines: [
          { category: "Other", item: "@special", colour: "-", unit: "each", expected: -2 },
          { category: "Other", item: "Pipe boot", colour: "", unit: "each", expected: 3.5 },
        ],
      }),
    );
    expect(csv.split("\r\n").slice(1, 3)).toEqual([
      "Other,'@special,'-,each,-2,",
      "Other,Pipe boot,,each,3.5,",
    ]);
  });

  it("the margin report: a customer named like a formula is words, a loss is a negative number", () => {
    const line = marginCsvLine("+Plus Supply", {
      invoices: 2,
      hours: 3.5,
      revenue: 100,
      avgRevenue: 50,
      material: 80,
      labor: 60,
      purchaseOrders: 0,
      other: 0,
      cost: 140,
      margin: -40,
      marginPct: -40,
    } as never);
    expect(toCsv([line])).toBe(
      "'+Plus Supply,2,3.5,100.00,50.00,80.00,60.00,0.00,0.00,140.00,-40.00,-40.0\r\n",
    );
  });
});

describe("the takeoff's quantities file (shapes.ts csvCell)", () => {
  it("a number is written as a number, negative or not", () => {
    expect(csvCell(-12.5)).toBe("-12.5");
    expect(csvCell(-12.504)).toBe("-12.5");
    expect(csvCell(40)).toBe("40");
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
  });

  it("words that start like a formula get the quote; ordinary words are as they were", () => {
    for (const s of ["=1+1", "+1 606 555 0100", "-2 hours", "@office"])
      expect(csvCell(s), s).toBe(`'${s}`);
    expect(csvCell("\tindented")).toBe("'\tindented");
    expect(csvCell("\rnext")).toBe(`"'\rnext"`);
    expect(csvCell("Area 1")).toBe("Area 1");
    expect(csvCell('RTU, 4" curb')).toBe('"RTU, 4"" curb"');
    expect(csvLine(["Section", "=A1", "Page 1", "", 1250.456, -3])).toBe(
      "Section,'=A1,Page 1,,1250.46,-3",
    );
  });
});

describe("the bookkeeper's invoice file (sageCsv)", () => {
  const bundle = (over: Record<string, unknown>, line: Record<string, unknown>) => ({
    invoice: {
      number: 6001,
      invoice_date: "2026-09-27",
      due_date: null,
      bill_to: { name: "Main Plant", external_id: "508373" },
      po_number: "218162",
      job_code: null,
      subtotal: 130,
      tax_amount: 0,
      total: 130,
      status: "final",
      paid_on: null,
      paid_amount: 0,
      ...over,
    } as never,
    lines: [
      {
        kind: "material",
        description: "Quick Seam Flashing",
        qty: 40,
        unit: "LF",
        rate: 3.25,
        total: 130,
        taxable: true,
        ...line,
      } as never,
    ],
  });

  it("an ordinary invoice is byte for byte what it was", () => {
    const lines = sageCsv([bundle({}, {})]).split("\r\n");
    expect(lines[1]).toBe(
      "INVOICE,6001,2026-09-27,,508373,Main Plant,218162,,,,,,,,,130.00,0.00,130.00,final,,0.00",
    );
    expect(lines[2]).toBe(
      "LINE,6001,2026-09-27,,508373,Main Plant,218162,,material,Quick Seam Flashing,40,LF,3.25,130.00,Y,,,,,,",
    );
  });

  it("a name, a PO, a job code, a description or a unit that starts like a formula is words", () => {
    const lines = sageCsv([
      bundle(
        { bill_to: { name: "=1+1", external_id: "@508" }, po_number: "+218", job_code: "-J7" },
        { description: "-2 hours, at the drain", unit: "=LF" },
      ),
    ]).split("\r\n");
    expect(lines[1]).toBe(
      "INVOICE,6001,2026-09-27,,'@508,'=1+1,'+218,'-J7,,,,,,,,130.00,0.00,130.00,final,,0.00",
    );
    expect(lines[2]).toBe(
      "LINE,6001,2026-09-27,,'@508,'=1+1,'+218,'-J7,material,\"'-2 hours, at the drain\",40,'=LF,3.25,130.00,Y,,,,,,",
    );
  });

  it("a credit is still a negative number, with no quote", () => {
    const lines = sageCsv([
      bundle({ subtotal: -12.5, total: -12.5 }, { qty: -1, rate: 12.5, total: -12.5 }),
    ]).split("\r\n");
    expect(lines[1]).toContain(",-12.50,0.00,-12.50,final,,0.00");
    expect(lines[2]).toContain(",-1,LF,12.5,-12.50,Y,");
    expect(lines.join("\n")).not.toContain("'");
  });

  it("a cell that holds a carriage return is quoted, so the row stays one row", () => {
    const csv = sageCsv([bundle({}, { description: "\rsecond line" })]);
    expect(csv).toContain(`,"'\rsecond line",`);
  });
});

describe("every spreadsheet writer goes through the one rule", () => {
  it("the three places a cell is quoted", () => {
    expect(flat("src/lib/review-export.ts")).toContain(
      'const field = (cell: string) => { const v = csvSafeCell(cell); return /[",\\r\\n]/.test(v)',
    );
    expect(flat("src/lib/invoices.server.ts")).toContain(
      'const s = csvSafeCell(v == null ? "" : String(v));',
    );
    expect(flat("src/components/takeoff/shapes.ts")).toContain(
      'const s = typeof v === "number" ? String(Math.round(v * 100) / 100) : csvSafeText(v);',
    );
  });

  it("no other file under src makes a spreadsheet cell of its own", () => {
    // A file that quotes a CSV cell doubles its quote marks. Readers of a CSV are not writers.
    const writers: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) {
          if (/replace\(\/"\/g, '""'\)/.test(read(p))) writers.push(p.replace(/\\/g, "/"));
        }
      }
    };
    walk("src");
    expect(writers.sort()).toEqual([
      "src/components/takeoff/shapes.ts",
      "src/lib/invoices.server.ts",
      "src/lib/review-export.ts",
    ]);
  });
});
