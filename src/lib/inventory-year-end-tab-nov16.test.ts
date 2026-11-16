/**
 * Inventory › Year end, the screen (owner, Nov 16: "as far as reporting for EOY stuff, is it as
 * efficient and good as it could be"). The server works the numbers out (inventory-cost.ts,
 * inventory-year-end.ts, with their own tests); this file pins what the SCREEN adds:
 *
 *  - the period: calendar years from the office's day, a From after a To refused in words, and a
 *    title built from the date's own digits (a Date in the reader's time zone would print
 *    December 31 for January 1 anywhere west of the office);
 *  - the Totals card as a sum a bookkeeper can check: the lines shown add up to closing, to the
 *    cent, and a line that is only ever zero is not printed;
 *  - which optional columns the item tables show;
 *  - the words of the three warnings, one item or many;
 *  - the price box: what a typed price comes to for the entry, and what is refused;
 *  - the component itself, read as text: the price box starts blank, the server is called the
 *    house way, the warnings and the test hooks are there, and no jargon reaches the screen;
 *  - the component rendered to a string (react-dom/server, the house way for a screen with no
 *    browser to test in) over a hand-made year: what a bookkeeper would actually see, and what
 *    Save price and Export do when the server answers. The data hooks are stand-ins that hand
 *    the component a ready answer and keep what it asked for; the server functions are never
 *    called for real.
 *
 * Every expected value below was worked out by hand; the sums are written out beside them.
 */
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

interface MutationOptions {
  mutationFn: (v: unknown) => unknown;
  onSuccess: (r: unknown) => void;
  onError: (e: unknown) => void;
}
interface QueryOptions {
  queryKey: unknown[];
  queryFn: () => unknown;
  enabled: boolean;
}

// What the stand-in hooks answer with, and what the component handed them.
const hooks = vi.hoisted(() => ({
  query: {
    data: undefined as unknown,
    isPending: true,
    isFetching: false,
    error: null as Error | null,
  },
  queries: [] as QueryOptions[],
  mutations: [] as MutationOptions[],
  invalidated: [] as unknown[],
  toasts: [] as string[],
  downloads: [] as string[],
  getYearEnd: vi.fn(),
  setEntryPrice: vi.fn(),
  exportInventoryCsv: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: (o: QueryOptions) => {
    hooks.queries.push(o);
    return hooks.query;
  },
  useMutation: (o: MutationOptions) => {
    hooks.mutations.push(o);
    return { mutate: () => {}, isPending: false };
  },
  useQueryClient: () => ({
    invalidateQueries: (f: unknown) => {
      hooks.invalidated.push(f);
      return Promise.resolve();
    },
  }),
}));
vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn }));
vi.mock("@tanstack/react-router", async () => {
  const react = await import("react");
  return {
    Link: (p: { to: string; search?: { id?: string }; children?: unknown }) =>
      react.createElement(
        "a",
        { href: p.to, "data-ticket": p.search?.id },
        p.children as React.ReactNode,
      ),
  };
});
vi.mock("@/lib/inventory-cost.functions", () => ({
  getYearEnd: hooks.getYearEnd,
  setEntryPrice: hooks.setEntryPrice,
}));
vi.mock("@/lib/inventory-export.functions", () => ({
  exportInventoryCsv: hooks.exportInventoryCsv,
}));
vi.mock("@/components/service/invoice-utils", () => ({
  downloadBlob: (_blob: Blob, name: string) => {
    hooks.downloads.push(name);
  },
}));
vi.mock("sonner", () => ({
  toast: {
    success: (m: string) => hooks.toasts.push(`success: ${m}`),
    info: (m: string) => hooks.toasts.push(`info: ${m}`),
    error: (m: string) => hooks.toasts.push(`error: ${m}`),
  },
}));

import { InventoryYearEndTab } from "@/components/inventory-year-end-tab";
import { FLOW_INFO } from "@/lib/inventory-cost";
import {
  officeToday,
  type Dollars,
  type UnpricedEntry,
  type YearEnd,
  type YearEndGroup,
  type YearEndRow,
} from "@/lib/inventory-year-end";
import {
  entryDate,
  itemName,
  lastYear,
  lineTotal,
  periodTitle,
  perUnit,
  plural,
  poLine,
  PRICE_MAX,
  priceProblem,
  priceToSave,
  qtyText,
  rangeProblem,
  REVALUED_HELP,
  shortDate,
  sourceWords,
  tableColumns,
  thisYear,
  totalLines,
  usedMeanwhile,
  visibleColumns,
  WARNING_KINDS,
  warningText,
  yearRange,
  type TotalLine,
} from "@/lib/inventory-year-range";

const dollars = (over: Partial<Dollars>): Dollars => ({
  opening: 0,
  received: 0,
  fromJobs: 0,
  openingStock: 0,
  used: 0,
  damaged: 0,
  counted: 0,
  other: 0,
  closing: 0,
  revalued: 0,
  ...over,
});

/** The sum a bookkeeper does down the card, in whole cents so float noise cannot hide a cent. */
const addUp = (lines: readonly TotalLine[]): number =>
  lines
    .filter((l) => l.show && l.sign !== "=")
    .reduce((sum, l) => sum + (l.sign === "−" ? -1 : 1) * Math.round(l.amount * 100), 0) / 100;

const shownKeys = (lines: readonly TotalLine[]): string[] =>
  lines.filter((l) => l.show).map((l) => l.key);

describe("the period", () => {
  it("a calendar year is January 1 to December 31", () => {
    expect(yearRange(2026)).toEqual({ from: "2026-01-01", to: "2026-12-31" });
    expect(yearRange(2024)).toEqual({ from: "2024-01-01", to: "2024-12-31" });
  });

  it("This year and Last year come from today's date", () => {
    expect(thisYear("2026-11-16")).toEqual({ from: "2026-01-01", to: "2026-12-31" });
    expect(lastYear("2026-11-16")).toEqual({ from: "2025-01-01", to: "2025-12-31" });
    expect(thisYear("2027-01-01")).toEqual({ from: "2027-01-01", to: "2027-12-31" });
    expect(lastYear("2027-01-01")).toEqual({ from: "2026-01-01", to: "2026-12-31" });
  });

  it("the year is the office's: 10 pm on New Year's Eve in New York is still the old year", () => {
    // 2027-01-01 03:00 UTC is 2026-12-31 22:00 Eastern (UTC−5 in winter).
    const today = officeToday(new Date("2027-01-01T03:00:00Z"));
    expect(today).toBe("2026-12-31");
    expect(thisYear(today)).toEqual({ from: "2026-01-01", to: "2026-12-31" });
  });

  it("a From after a To is refused in words; the same day is a period of one day", () => {
    expect(rangeProblem("2026-01-01", "2026-12-31")).toBeNull();
    expect(rangeProblem("2026-06-15", "2026-06-15")).toBeNull();
    expect(rangeProblem("2026-12-31", "2026-01-01")).toBe("From must be on or before To");
    expect(rangeProblem("2026-06-16", "2026-06-15")).toBe("From must be on or before To");
  });

  it("an emptied date box, or a day that does not exist, asks for both dates", () => {
    expect(rangeProblem("", "2026-12-31")).toBe("Pick a From and a To date");
    expect(rangeProblem("2026-01-01", "")).toBe("Pick a From and a To date");
    expect(rangeProblem("2026-02-30", "2026-12-31")).toBe("Pick a From and a To date");
    expect(rangeProblem("2026-13-01", "2026-12-31")).toBe("Pick a From and a To date");
    // 2024 is a leap year, 2026 is not.
    expect(rangeProblem("2024-02-29", "2024-12-31")).toBeNull();
    expect(rangeProblem("2026-02-29", "2026-12-31")).toBe("Pick a From and a To date");
  });

  it("the title prints the dates as typed, whatever time zone the reader is in", () => {
    expect(periodTitle("2026-01-01", "2026-12-31")).toBe("January 1, 2026 to December 31, 2026");
    expect(periodTitle("2025-07-04", "2026-02-09")).toBe("July 4, 2025 to February 9, 2026");
    expect(periodTitle("2026-03-05", "2026-03-05")).toBe("March 5, 2026");
  });

  it("the helpers never build the title through a Date in the reader's own time zone", () => {
    const src = readFileSync("src/lib/inventory-year-range.ts", "utf8");
    expect(src).not.toMatch(/\.getMonth\(|\.getDate\(|\.getFullYear\(|toLocaleDateString/);
  });

  it("short dates: a purchase order's day from its digits, an entry's day in office time", () => {
    expect(shortDate("2026-10-27")).toBe("Oct 27, 2026");
    expect(shortDate("2026-01-01")).toBe("Jan 1, 2026");
    expect(shortDate("not a date")).toBe("not a date");
    expect(entryDate("2026-10-28T15:00:00.000Z")).toBe("Oct 28, 2026");
    // 02:30 UTC on the 29th is 10:30 pm on the 28th in New York (UTC−4 until November 1).
    expect(entryDate("2026-10-29T02:30:00.000Z")).toBe("Oct 28, 2026");
  });
});

describe("the Totals card", () => {
  it("the owner's example adds up to closing, and the zero-only lines are not printed", () => {
    // 1,425.00 + 550.00 + 160.00 − 0.00 − 98.75 − 98.75 = 1,937.50
    const lines = totalLines(
      dollars({
        opening: 1425,
        received: 550,
        fromJobs: 160,
        damaged: 98.75,
        counted: -98.75,
        closing: 1937.5,
      }),
    );
    expect(shownKeys(lines)).toEqual([
      "opening",
      "received",
      "fromJobs",
      "used",
      "damaged",
      "counted",
      "closing",
    ]);
    expect(addUp(lines)).toBe(1937.5);
    expect(lines.find((l) => l.key === "closing")?.amount).toBe(1937.5);
    // Hidden, not dropped: the component maps one list and tests can still find every key.
    expect(lines.map((l) => l.key)).toEqual([
      "opening",
      "received",
      "fromJobs",
      "openingStock",
      "used",
      "damaged",
      "counted",
      "other",
      "revalued",
      "rounding",
      "closing",
    ]);
  });

  it("every line, when every line has a number, still adds up", () => {
    // 1,000 + 500 + 100 + 250 − 475 − 25 + 10 − 5 + 40 = 1,395
    const lines = totalLines(
      dollars({
        opening: 1000,
        received: 500,
        fromJobs: 100,
        openingStock: 250,
        used: 475,
        damaged: 25,
        counted: 10,
        other: -5,
        revalued: 40,
        closing: 1395,
      }),
    );
    expect(shownKeys(lines)).toEqual([
      "opening",
      "received",
      "fromJobs",
      "openingStock",
      "used",
      "damaged",
      "counted",
      "other",
      "revalued",
      "closing",
    ]);
    expect(addUp(lines)).toBe(1395);
  });

  it("the sign of each line is what a bookkeeper does with it", () => {
    const sign = Object.fromEntries(totalLines(dollars({})).map((l) => [l.key, l.sign]));
    expect(sign).toEqual({
      opening: "",
      received: "+",
      fromJobs: "+",
      openingStock: "+",
      used: "−",
      damaged: "−",
      counted: "",
      other: "",
      revalued: "",
      rounding: "",
      closing: "=",
    });
  });

  it("titles and help come from the cost rules' own words", () => {
    const by = Object.fromEntries(totalLines(dollars({})).map((l) => [l.key, l]));
    expect(by["opening"]?.title).toBe("Opening stock value");
    expect(by["closing"]?.title).toBe("Closing stock value");
    expect(by["revalued"]?.title).toBe("Revalued");
    expect(by["revalued"]?.help).toBe(REVALUED_HELP);
    expect(REVALUED_HELP).toBe(
      "Stock came in while an item was at or below zero, so its average cost started again at the new price. This line is the value that moved because of that.",
    );
    for (const k of [
      "received",
      "fromJobs",
      "openingStock",
      "used",
      "damaged",
      "counted",
      "other",
    ] as const) {
      expect(by[k]?.title).toBe(FLOW_INFO[k].title);
      expect(by[k]?.help).toBe(FLOW_INFO[k].help);
    }
    expect(by["used"]?.title).toBe("Used on jobs");
    expect(by["damaged"]?.title).toBe("Damaged / written off");
    expect(by["counted"]?.title).toBe("Count corrections");
  });

  it("with nothing at all, the card is the plain lines at zero", () => {
    const lines = totalLines(dollars({}));
    expect(shownKeys(lines)).toEqual([
      "opening",
      "received",
      "fromJobs",
      "used",
      "damaged",
      "counted",
      "closing",
    ]);
    expect(addUp(lines)).toBe(0);
  });

  it("a cent lost to rounding each line is shown, so the card still adds up", () => {
    // Each line is rounded to the cent by itself: 10.004 + 5.004 = 15.008 reads 10.00 + 5.00 and
    // 15.01. The missing cent is printed rather than left for the bookkeeper to find.
    const lines = totalLines(dollars({ opening: 10, received: 5, closing: 15.01 }));
    const rounding = lines.find((l) => l.key === "rounding");
    expect(rounding?.show).toBe(true);
    expect(rounding?.amount).toBe(0.01);
    expect(addUp(lines)).toBe(15.01);
    // The other way: 10.00 + 5.00 against 14.99 is one cent off the sum.
    const under = totalLines(dollars({ opening: 10, received: 5, closing: 14.99 }));
    expect(under.find((l) => l.key === "rounding")?.amount).toBe(-0.01);
    expect(addUp(under)).toBe(14.99);
  });

  it("float noise is not a rounding line", () => {
    // 0.1 + 0.2 is 0.30000000000000004 to a computer and 0.30 to a bookkeeper.
    const lines = totalLines(dollars({ opening: 0.1, received: 0.2, closing: 0.3 }));
    expect(lines.find((l) => l.key === "rounding")?.show).toBe(false);
    expect(addUp(lines)).toBe(0.3);
  });
});

describe("the item tables", () => {
  const amounts = () => ({
    opening: 0,
    received: 0,
    fromJobs: 0,
    openingStock: 0,
    used: 0,
    damaged: 0,
    counted: 0,
    other: 0,
    closing: 0,
  });
  const group = (
    category: string,
    rows: { qty?: Partial<ReturnType<typeof amounts>>; dollars?: Partial<Dollars> }[],
  ): YearEndGroup => ({
    category,
    dollars: dollars({}),
    rows: rows.map((r, i) => ({
      key: `${category}-${i}`,
      screen_id: "s",
      row_label: `row ${i}`,
      price_col: "price",
      category,
      item: `Item ${i}`,
      colour: "",
      unit: "box",
      qty: { ...amounts(), ...r.qty },
      dollars: dollars(r.dollars ?? {}),
      avg: null,
      estimated: false,
      unknown: false,
      below_zero: false,
    })),
  });

  it("the optional columns stay away until some row needs them", () => {
    expect(visibleColumns([])).toEqual({ openingStock: false, other: false, revalued: false });
    expect(
      visibleColumns([
        group("Fasteners", [{ qty: { received: 4 }, dollars: { received: 80 } }, {}]),
        group("Membrane", [{ qty: { used: 2 }, dollars: { used: 40 } }]),
      ]),
    ).toEqual({ openingStock: false, other: false, revalued: false });
  });

  it("one row anywhere in the report brings its column to every table", () => {
    expect(
      visibleColumns([
        group("Fasteners", [{}]),
        group("Membrane", [{}, { qty: { other: -1 }, dollars: { other: -5 } }]),
      ]),
    ).toEqual({ openingStock: false, other: true, revalued: false });
    expect(visibleColumns([group("Sealants", [{ dollars: { revalued: -12.5 } }])])).toEqual({
      openingStock: false,
      other: false,
      revalued: true,
    });
  });

  it("a quantity with no dollars still counts (opening stock nobody priced)", () => {
    expect(visibleColumns([group("Sealants", [{ qty: { openingStock: 3 } }])])).toEqual({
      openingStock: true,
      other: false,
      revalued: false,
    });
  });

  it("the columns, in the order of the Totals card", () => {
    expect(
      tableColumns({ openingStock: false, other: false, revalued: false }).map((c) => c.title),
    ).toEqual(["Opening", "Received", "From jobs", "Used", "Damaged", "Count", "Closing"]);
    expect(
      tableColumns({ openingStock: true, other: true, revalued: true }).map((c) => c.title),
    ).toEqual([
      "Opening",
      "Received",
      "From jobs",
      "Opening stock",
      "Used",
      "Damaged",
      "Count",
      "Other",
      "Revalued",
      "Closing",
    ]);
    expect(
      tableColumns({ openingStock: true, other: true, revalued: true }).map((c) => c.key),
    ).toEqual([
      "opening",
      "received",
      "fromJobs",
      "openingStock",
      "used",
      "damaged",
      "counted",
      "other",
      "revalued",
      "closing",
    ]);
  });

  it("an item reads with its colour after a dot, when it has one", () => {
    expect(itemName("TPO 60 mil", "White")).toBe("TPO 60 mil · White");
    expect(itemName("Drip edge", "")).toBe("Drip edge");
  });

  it("quantities: three decimals at most; a correction carries its sign", () => {
    expect(qtyText(3)).toBe("3");
    expect(qtyText(2.5)).toBe("2.5");
    expect(qtyText(1.23456)).toBe("1.235");
    expect(qtyText(-2)).toBe("−2");
    expect(qtyText(0)).toBe("0");
    expect(qtyText(2, true)).toBe("+2");
    expect(qtyText(-1.5, true)).toBe("−1.5");
    expect(qtyText(0, true)).toBe("0");
  });
});

describe("the warnings", () => {
  it("one or many", () => {
    expect(plural(1, "entry", "entries")).toBe("entry");
    expect(plural(2, "entry", "entries")).toBe("entries");
    expect(plural(0, "item", "items")).toBe("items");
  });

  it("the three warnings, in the order they are shown", () => {
    expect(WARNING_KINDS).toEqual(["needsPrice", "unknown", "belowZero"]);
  });

  it("entries with no price typed", () => {
    expect(warningText("needsPrice", 2)).toBe(
      "2 entries came in with no price typed. Their numbers are estimates until someone types what was paid, below.",
    );
    expect(warningText("needsPrice", 1)).toBe(
      "1 entry came in with no price typed. Its numbers are estimates until someone types what was paid, below.",
    );
  });

  it("items with no cost at all", () => {
    expect(warningText("unknown", 3)).toBe(
      "3 items have no cost at all, so they are left out of the dollars. Type a price on their entries below.",
    );
    expect(warningText("unknown", 1)).toBe(
      "1 item has no cost at all, so it is left out of the dollars. Type a price on its entries below.",
    );
  });

  it("items with no cost and no entry to price do not point at a list that is not there", () => {
    expect(warningText("unknown", 2, { nothingToPrice: true })).toBe(
      "2 items have no cost at all, so they are left out of the dollars. Give each one a cost in Setup.",
    );
    expect(warningText("unknown", 1, { nothingToPrice: true })).toBe(
      "1 item has no cost at all, so it is left out of the dollars. Give it a cost in Setup.",
    );
  });

  it("items below zero", () => {
    expect(warningText("belowZero", 2)).toBe(
      "2 items are below zero at the end of this period. Count them before relying on these numbers.",
    );
    expect(warningText("belowZero", 1)).toBe(
      "1 item is below zero at the end of this period. Count it before relying on these numbers.",
    );
  });
});

describe("an entry that needs a price", () => {
  it("where the cost used meanwhile came from, in plain words", () => {
    expect(sourceWords("average")).toBe("the item's average cost");
    expect(sourceWords("setup")).toBe("the Setup cost");
    expect(sourceWords("none")).toBe("nothing, no cost is known");
  });

  it("the Used meanwhile line", () => {
    expect(usedMeanwhile(95, "bundle", "average")).toBe(
      "Used meanwhile: $95.00 per bundle, the item's average cost",
    );
    expect(usedMeanwhile(12.5, "tube", "setup")).toBe(
      "Used meanwhile: $12.50 per tube, the Setup cost",
    );
    // "per each" is not English: a unit of "each" reads "each".
    expect(usedMeanwhile(0.0915, "each", "setup")).toBe(
      "Used meanwhile: $0.0915 each, the Setup cost",
    );
    expect(perUnit("box")).toBe("per box");
    expect(perUnit("4-Cartridge Case")).toBe("per 4-Cartridge Case");
    expect(perUnit("each")).toBe("each");
    expect(perUnit("EA")).toBe("each");
    expect(perUnit("")).toBe("each");
    expect(usedMeanwhile(null, "roll", "none")).toBe("Used meanwhile: nothing, no cost is known");
  });

  it("what a typed price comes to for the whole entry", () => {
    // 10 × 90 = 900; 2 × 1,250.50 = 2,501; 3 × 2.50 = 7.50; 1,000 × 0.0915 = 91.50
    expect(lineTotal("90", 10)).toBe(900);
    expect(lineTotal("$1,250.50", 2)).toBe(2501);
    expect(lineTotal("2.50", 3)).toBe(7.5);
    expect(lineTotal("0.0915", 1000)).toBe(91.5);
    // 3 × 33.333 = 99.999, which is $100.00 to the cent.
    expect(lineTotal("33.333", 3)).toBe(100);
    // Free stock is a price too: 5 × 0 = 0.
    expect(lineTotal("0", 5)).toBe(0);
  });

  it("no total until the box holds a price", () => {
    expect(lineTotal("", 10)).toBeNull();
    expect(lineTotal("   ", 10)).toBeNull();
    expect(lineTotal("abc", 10)).toBeNull();
    expect(lineTotal("-5", 10)).toBeNull();
    expect(lineTotal(".", 10)).toBeNull();
  });

  it("Save price waits for a price the server will take", () => {
    expect(priceToSave("")).toBeNull();
    expect(priceToSave("abc")).toBeNull();
    expect(priceToSave("90")).toBe(90);
    expect(priceToSave("$1,250.50")).toBe(1250.5);
    expect(priceToSave("0")).toBe(0);
    expect(PRICE_MAX).toBe(1_000_000);
    expect(priceToSave("1000000")).toBe(1_000_000);
    expect(priceToSave("1000000.01")).toBeNull();
    expect(lineTotal("1000000.01", 1)).toBeNull();
  });

  it("a blank box says nothing; a wrong one says what to type", () => {
    expect(priceProblem("")).toBeNull();
    expect(priceProblem("  ")).toBeNull();
    expect(priceProblem("12.50")).toBeNull();
    expect(priceProblem("abc")).toBe("Type the price in dollars, like 12.50");
    expect(priceProblem("-5")).toBe("Type the price in dollars, like 12.50");
    expect(priceProblem("2000000")).toBe(
      "That is over $1,000,000. Type the price of one unit, not of the whole order.",
    );
  });

  it("a purchase order reads on one line", () => {
    expect(
      poLine({ po_number: "4411", vendor: "ABC Supply", price: 1250.5, po_date: "2026-10-27" }),
    ).toBe("PO 4411 · ABC Supply · $1,250.50 · Oct 27, 2026");
    expect(poLine({ po_number: "77", vendor: "", price: 80, po_date: "2026-01-05" })).toBe(
      "PO 77 · $80.00 · Jan 5, 2026",
    );
  });
});

describe("the component, read as text", () => {
  const src = readFileSync("src/components/inventory-year-end-tab.tsx", "utf8");
  // What reaches the screen: the code without its comments.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  // A long sentence is wrapped over several lines in the file and is one sentence on screen.
  const flat = code.replace(/\s+/g, " ");

  it("exports the tab with the page's contract", () => {
    expect(src).toMatch(
      /export function InventoryYearEndTab\(props: \{ onChanged: \(\) => void \}\)/,
    );
  });

  it("the price box starts blank: its text is state that begins empty, with no default", () => {
    expect(code).not.toMatch(/defaultValue/);
    expect(code).toMatch(/const \[text, setText\] = useState\(""\)/);
    // The one <Input … /> that carries the hook, from its opening to its close.
    const hook = code.indexOf("data-unpriced-price");
    expect(hook).toBeGreaterThan(-1);
    const box = code.slice(code.lastIndexOf("<Input", hook), code.indexOf("/>", hook) + 2);
    expect(box.startsWith("<Input")).toBe(true);
    expect(box).toMatch(/value=\{text\}/);
    expect(box).not.toMatch(/placeholder=/);
    // "$1,250.50" must be typeable, which a number box refuses.
    expect(box).toMatch(/type="text"/);
    expect(box).toMatch(/inputMode="decimal"/);
  });

  it("the server is called the house way", () => {
    expect(code).toMatch(/useServerFn\(getYearEnd\)/);
    expect(code).toMatch(/useServerFn\(setEntryPrice\)/);
    expect(code).toMatch(/useServerFn\(exportInventoryCsv\)/);
    expect(code).toMatch(/queryKey: \["inventory-year-end", from, to\]/);
    expect(code).toMatch(/invalidateQueries\(\{ queryKey: \["inventory-year-end"\] \}\)/);
    expect(code).toMatch(/props\.onChanged\(\)/);
    expect(code).toMatch(/report: "year"/);
    expect(code).toMatch(/with_value: true/);
  });

  it("nothing is loaded for a period that is not one", () => {
    expect(code).toMatch(/enabled: problem === null/);
  });

  it("the three warnings are there, each under its own key, with an icon beside the words", () => {
    expect(code).toMatch(/WARNING_KINDS/);
    expect(code).toMatch(/data-year-warning=\{w\.kind\}/);
    expect(code).toMatch(/warningText\(/);
    expect(code).toMatch(/<TriangleAlert/);
    // Only when its number is above zero.
    expect(code).toMatch(/\(w\) => w\.n > 0/);
  });

  it("the words the brief asks for are on the screen", () => {
    for (const words of [
      "This year",
      "Last year",
      "Export this summary",
      "Nothing in inventory for that period.",
      "Nothing in inventory for this period.",
      "Working out the year…",
      "Could not load: ",
      "By category",
      "Entries that need a price",
      "These entries brought stock in with no price typed. Until a price is typed, inventory uses the cost shown, and the numbers above are estimates.",
      "Price paid {perUnit(u.unit)}",
      "Save price",
      "Keep the Setup cost (",
      "Price saved",
      "Average cost",
      "Estimate",
      "No cost",
      "Below zero",
    ])
      expect(flat, words).toContain(words);
    // {" "} is the space the formatter writes out where it breaks a line before a {value}.
    expect(flat.replace(/\{" "\}/g, "")).toContain(
      "Purchase orders on this ticket (a purchase order holds one total, so the price {perUnit(u.unit)} is typed here):",
    );
  });

  it("the test hooks are there", () => {
    for (const hook of [
      "data-year-end-tab",
      "data-year-total={l.key}",
      "data-year-group={g.category}",
      "data-year-row={r.key}",
      "data-unpriced={u.id}",
      "data-unpriced-price",
      "data-unpriced-save",
      "data-unpriced-setup",
      "data-year-export",
    ])
      expect(code, hook).toContain(hook);
  });

  it("no jargon reaches the screen, here or in the helpers' words", () => {
    const jargon = /ledger|replay|moving average|the app\b|the system\b|movement/i;
    // Identifiers the server's contract names (movement_id) are code, not words on screen.
    expect(code.replace(/movement_id/g, "")).not.toMatch(jargon);
    const words = [
      ...totalLines(dollars({})).flatMap((l) => [l.title, l.help]),
      ...WARNING_KINDS.flatMap((k) => [
        warningText(k, 1),
        warningText(k, 2),
        warningText(k, 1, { nothingToPrice: true }),
      ]),
      ...tableColumns({ openingStock: true, other: true, revalued: true }).flatMap((c) => [
        c.title,
        c.help,
      ]),
      sourceWords("average"),
      sourceWords("setup"),
      sourceWords("none"),
      sourceWords("paid"),
      sourceWords("putback"),
      priceProblem("abc") ?? "",
      priceProblem("2000000") ?? "",
      rangeProblem("", "") ?? "",
    ];
    for (const w of words) expect(w, w).not.toMatch(jargon);
  });
});

describe("the component, rendered over a hand-made year", () => {
  const TICKET = "11111111-1111-4111-8111-111111111111";
  const amounts = (over: Partial<YearEndRow["qty"]> = {}): YearEndRow["qty"] => ({
    opening: 0,
    received: 0,
    fromJobs: 0,
    openingStock: 0,
    used: 0,
    damaged: 0,
    counted: 0,
    other: 0,
    closing: 0,
    ...over,
  });
  const row = (
    key: string,
    category: string,
    item: string,
    over: Partial<YearEndRow> = {},
  ): YearEndRow => ({
    key,
    screen_id: "s",
    row_label: item,
    price_col: "price",
    category,
    item,
    colour: "",
    unit: "each",
    qty: amounts(),
    dollars: dollars({}),
    avg: null,
    estimated: false,
    unknown: false,
    below_zero: false,
    ...over,
  });

  // Shingles: 15 bundles at $95.00 = 1,425.00 to open; 5 more for 550.00 makes 20 worth
  // 1,975.00, an average of $98.75; one damaged (98.75) and one lost in a count (98.75) leave
  // 18 × 98.75 = 1,777.50.
  const shingles = row("a", "Shingles", "Landmark", {
    colour: "Weathered Wood",
    unit: "bundle",
    qty: amounts({ opening: 15, received: 5, damaged: 1, counted: -1, closing: 18 }),
    dollars: dollars({
      opening: 1425,
      received: 550,
      damaged: 98.75,
      counted: -98.75,
      closing: 1777.5,
    }),
    avg: 98.75,
  });
  // Caulk: 16 tubes left over from a ticket with no price typed, held at the $10.00 Setup cost.
  const caulk = row("b", "Sealants", "Duro-Caulk Plus", {
    unit: "tube",
    qty: amounts({ fromJobs: 16, closing: 16 }),
    dollars: dollars({ fromJobs: 160, closing: 160 }),
    avg: 10,
    estimated: true,
  });
  // Primer: two taken with none on hand and no cost known anywhere.
  const primer = row("c", "Sealants", "Primer", {
    unit: "gal",
    qty: amounts({ used: 2, closing: -2 }),
    unknown: true,
    below_zero: true,
  });
  const unpriced: UnpricedEntry = {
    id: 7,
    at: "2026-10-28T15:00:00.000Z",
    screen_id: "s",
    row_label: "Duro-Caulk Plus",
    price_col: "price",
    item: "Duro-Caulk Plus",
    colour: "",
    qty: 16,
    unit: "tube",
    location_name: "Shop",
    reason: "Put in from a job",
    job_name: "T-1042 Smith roof",
    service_job_id: TICKET,
    by_name: "Joe",
    unit_cost: 10,
    source: "setup",
    setup_cost: 10,
    pos: [{ po_number: "4411", vendor: "ABC Supply", price: 1250.5, po_date: "2026-10-27" }],
  };
  // 1,777.50 + 160.00 = 1,937.50, the owner's example: 1,425 + 550 + 160 − 98.75 − 98.75.
  const year = (over: Partial<YearEnd> = {}): YearEnd => ({
    from: "2026-01-01",
    to: "2026-12-31",
    groups: [
      {
        category: "Sealants",
        rows: [caulk, primer],
        dollars: dollars({ fromJobs: 160, closing: 160 }),
      },
      { category: "Shingles", rows: [shingles], dollars: shingles.dollars },
    ],
    dollars: dollars({
      opening: 1425,
      received: 550,
      fromJobs: 160,
      damaged: 98.75,
      counted: -98.75,
      closing: 1937.5,
    }),
    counts: { items: 3, estimated: 1, unknown: 1, belowZero: 1, needsPrice: 1 },
    unpriced: [unpriced],
    ...over,
  });

  let changed = 0;
  /** The page as text: React's markers between neighbouring pieces of text taken out. */
  const render = (data?: YearEnd, error?: Error, isFetching = false): string => {
    hooks.query = { data, isPending: !data && !error, isFetching, error: error ?? null };
    return renderToString(
      createElement(InventoryYearEndTab, {
        onChanged: () => {
          changed += 1;
        },
      }),
    ).replace(/<!-- -->/g, "");
  };
  const all = (html: string, hook: string): string[] =>
    [...html.matchAll(new RegExp(`${hook}="([^"]*)"`, "g"))].map((m) => m[1] ?? "");
  /** The opening tag that carries a hook. */
  const tagWith = (html: string, hook: string): string => {
    const at = html.indexOf(hook);
    return at < 0 ? "" : html.slice(html.lastIndexOf("<", at), html.indexOf(">", at) + 1);
  };
  /** One block of the page, from a hook to the next of the same kind (or the end). */
  const from = (html: string, hook: string): string => {
    const at = html.indexOf(hook);
    return at < 0 ? "" : html.slice(at);
  };

  beforeEach(() => {
    hooks.queries.length = 0;
    hooks.mutations.length = 0;
    hooks.invalidated.length = 0;
    hooks.toasts.length = 0;
    hooks.downloads.length = 0;
    hooks.getYearEnd.mockReset();
    hooks.setEntryPrice.mockReset();
    hooks.exportInventoryCsv.mockReset();
    changed = 0;
  });

  it("opens on this calendar year and asks the server for exactly that", () => {
    const html = render();
    const range = thisYear(officeToday());
    expect(html).toContain("data-year-end-tab");
    expect(html).toContain("Working out the year…");
    expect(tagWith(html, 'id="year-end-from"')).toContain(`value="${range.from}"`);
    expect(tagWith(html, 'id="year-end-to"')).toContain(`value="${range.to}"`);
    const q = hooks.queries[0];
    expect(q?.queryKey).toEqual(["inventory-year-end", range.from, range.to]);
    expect(q?.enabled).toBe(true);
    void q?.queryFn();
    expect(hooks.getYearEnd).toHaveBeenCalledWith({ data: range });
    // This year is the pressed preset; Last year is not.
    const pressed = [...html.matchAll(/aria-pressed="(true|false)"[^>]*>([^<]*)</g)].map(
      (m) => `${m[2]}=${m[1]}`,
    );
    expect(pressed).toEqual(["This year=true", "Last year=false"]);
  });

  it("says so when the server refuses, in its own words", () => {
    const html = render(undefined, new Error("Admins and managers only"));
    expect(html).toContain("Could not load: Admins and managers only");
    expect(html).not.toContain("Working out the year…");
    expect(html).not.toContain("data-year-total");
  });

  it("while the numbers are worked out again the old ones stay up, with a word saying so", () => {
    expect(render(year())).not.toContain("data-year-updating");
    const html = render(year(), undefined, true);
    expect(html).toContain("Working out the numbers again…");
    expect(html).not.toContain("Working out the year…");
    expect(all(html, "data-year-total")).toHaveLength(7);
  });

  it("the Totals card is the owner's example, line by line, under the period's name", () => {
    const html = render(year());
    expect(html).toContain("January 1, 2026 to December 31, 2026");
    expect(all(html, "data-year-total")).toEqual([
      "opening",
      "received",
      "fromJobs",
      "used",
      "damaged",
      "counted",
      "closing",
    ]);
    // One line of the card: from its hook to the next line's, or to the next card's.
    const line = (key: string) => {
      const block = from(html, `data-year-total="${key}"`);
      const next = block.slice(20).search(/data-year-total|data-card/);
      return next < 0 ? block : block.slice(0, next + 20);
    };
    expect(line("opening")).toContain("$1,425.00");
    expect(line("received")).toContain("$550.00");
    expect(line("fromJobs")).toContain("$160.00");
    expect(line("used")).toContain("$0.00");
    expect(line("damaged")).toContain("$98.75");
    expect(line("counted")).toContain("-$98.75");
    expect(line("closing")).toContain("$1,937.50");
    // The help is a hover note AND printed, for a phone.
    const help = FLOW_INFO.received.help;
    expect(tagWith(html, 'data-year-total="received"')).toContain(`title="${help}"`);
    expect(line("received").split(`>${help}</p>`).length - 1).toBe(1);
    // The answer line is ruled off and bold.
    expect(tagWith(html, 'data-year-total="closing"')).toMatch(/border-t-2[^"]*font-semibold/);
    expect(line("received")).toContain(">+</span>");
    expect(line("damaged")).toContain(">−</span>");
    expect(line("closing")).toContain(">=</span>");
  });

  it("the three warnings, each with an icon, one item each", () => {
    const html = render(year());
    expect(all(html, "data-year-warning")).toEqual(["needsPrice", "unknown", "belowZero"]);
    expect(html).toContain(
      "1 entry came in with no price typed. Its numbers are estimates until someone types what was paid, below.",
    );
    expect(html).toContain(
      "1 item has no cost at all, so it is left out of the dollars. Type a price on its entries below.",
    );
    expect(html).toContain(
      "1 item is below zero at the end of this period. Count it before relying on these numbers.",
    );
    expect(html.match(/lucide-triangle-alert/g)).toHaveLength(3);
  });

  it("a warning whose number is zero is not shown", () => {
    const html = render(
      year({
        counts: { items: 3, estimated: 0, unknown: 0, belowZero: 2, needsPrice: 0 },
        unpriced: [],
      }),
    );
    expect(all(html, "data-year-warning")).toEqual(["belowZero"]);
    expect(html).toContain("2 items are below zero at the end of this period.");
    expect(html).not.toContain("Entries that need a price");
  });

  it("two categories open as tables: quantity over dollars, tags in words, a dash for no cost", () => {
    const html = render(year());
    expect(all(html, "data-year-group")).toEqual(["Sealants", "Shingles"]);
    expect(all(html, "data-year-row")).toEqual(["b", "c", "a"]);
    const headings = [...html.matchAll(/<th[^>]*>([^<]*)<\/th>/g)].map((m) => m[1]);
    // One table's headings: none of the rare columns, since no row has a number for them.
    expect(headings.slice(0, 10)).toEqual([
      "Item",
      "Unit",
      "Opening",
      "Received",
      "From jobs",
      "Used",
      "Damaged",
      "Count",
      "Closing",
      "Average cost",
    ]);
    const rowOf = (key: string) => {
      const block = from(html, `data-year-row="${key}"`);
      return block.slice(0, block.indexOf("</tr>"));
    };
    const cells = (key: string) =>
      [...rowOf(key).matchAll(/<td[^>]*>(.*?)<\/td>/g)].map((m) =>
        (m[1] ?? "").replace(/<\/div>/g, "|").replace(/<[^>]+>/g, ""),
      );
    expect(cells("a")).toEqual([
      "Landmark · Weathered Wood",
      "bundle",
      "15|$1,425.00|",
      "5|$550.00|",
      "0|$0.00|",
      "0|$0.00|",
      "1|$98.75|",
      "−1|-$98.75|",
      "18|$1,777.50|",
      "$98.75",
    ]);
    expect(cells("b")).toEqual([
      "Duro-Caulk PlusEstimate",
      "tube",
      "0|$0.00|",
      "0|$0.00|",
      "16|$160.00|",
      "0|$0.00|",
      "0|$0.00|",
      "0|$0.00|",
      "16|$160.00|",
      "$10.00",
    ]);
    // No cost: the counts are real, the dollars are a dash and never a $0.00.
    expect(cells("c")).toEqual([
      "PrimerNo costBelow zero",
      "gal",
      "0|—|",
      "0|—|",
      "0|—|",
      "2|—|",
      "0|—|",
      "0|—|",
      "−2|—|",
      "—",
    ]);
    expect(all(html, "data-year-tag")).toEqual(["estimate", "no-cost", "below-zero"]);
    for (const tag of ["estimate", "no-cost", "below-zero"])
      expect(tagWith(html, `data-year-tag="${tag}"`)).toMatch(/title="[^"]{20,}"/);
    // The footer of the first table (Sealants) is its dollars.
    const foot = from(html, "<tfoot");
    expect(
      [...foot.slice(0, foot.indexOf("</tfoot>")).matchAll(/<td[^>]*>(.*?)<\/td>/g)].map((m) =>
        (m[1] ?? "").replace(/<[^>]+>/g, ""),
      ),
    ).toEqual([
      "Total in dollars",
      "$0.00",
      "$0.00",
      "$160.00",
      "$0.00",
      "$0.00",
      "$0.00",
      "$160.00",
      "",
    ]);
    // Sideways scrolling inside the card, for a phone.
    expect(html).toContain("overflow-x-auto");
  });

  it("a rare column appears in every table once one row has a number for it", () => {
    const revalued = { ...shingles, dollars: { ...shingles.dollars, revalued: 40 } };
    const html = render(
      year({
        groups: [
          { category: "Sealants", rows: [caulk], dollars: caulk.dollars },
          { category: "Shingles", rows: [revalued], dollars: revalued.dollars },
        ],
      }),
    );
    const headings = [...html.matchAll(/<th[^>]*>([^<]*)<\/th>/g)].map((m) => m[1]);
    expect(headings.filter((h) => h === "Revalued")).toHaveLength(2);
    expect(headings).not.toContain("Other");
    expect(headings).not.toContain("Opening stock");
  });

  it("more than three categories open closed: headings with their closing values", () => {
    const groups = ["Adhesives", "Fasteners", "Sealants", "Shingles"].map((category, i) => ({
      category,
      rows: [row(`k${i}`, category, `Item ${i}`)],
      dollars: dollars({ closing: 100 * (i + 1) }),
    }));
    const html = render(year({ groups }));
    expect(all(html, "data-year-group")).toEqual([
      "Adhesives",
      "Fasteners",
      "Sealants",
      "Shingles",
    ]);
    expect(all(html, "data-year-row")).toEqual([]);
    for (const value of ["$100.00", "$200.00", "$300.00", "$400.00"]) expect(html).toContain(value);
    // Three is still few enough to read in full.
    expect(all(render(year({ groups: groups.slice(0, 3) })), "data-year-row")).toHaveLength(3);
  });

  it("an empty period says so", () => {
    const html = render(
      year({
        groups: [],
        dollars: dollars({}),
        counts: { items: 0, estimated: 0, unknown: 0, belowZero: 0, needsPrice: 0 },
        unpriced: [],
      }),
    );
    expect(html).toContain("Nothing in inventory for this period.");
    expect(all(html, "data-year-warning")).toEqual([]);
    expect(html).not.toContain("Entries that need a price");
  });

  it("an entry that needs a price: what it was, what is used meanwhile, the PO, a blank box", () => {
    const html = render(year());
    expect(all(html, "data-unpriced")).toEqual(["7"]);
    const block = from(html, 'data-unpriced="7"');
    expect(block).toContain("Oct 28, 2026 · Duro-Caulk Plus · +16 tubes · Shop");
    expect(block.replace(/<[^>]+>/g, "")).toContain(
      "Put in from a job · T-1042 Smith roof · entered by Joe",
    );
    expect(block).toContain(`data-ticket="${TICKET}"`);
    expect(block).toContain("Used meanwhile: $10.00 per tube, the Setup cost");
    expect(block).toContain(
      "Purchase orders on this ticket (a purchase order holds one total, so the price per tube is typed here):",
    );
    expect(block).toContain("PO 4411 · ABC Supply · $1,250.50 · Oct 27, 2026");
    expect(block).toContain("Price paid per tube");
    // The box is blank, takes "$1,250.50", and is 16px at every width (no zoom on an iPhone).
    const box = tagWith(html, "data-unpriced-price");
    expect(box).toContain('value=""');
    expect(box).toContain('type="text"');
    expect(box).toContain('inputMode="decimal"');
    expect(box).not.toContain("placeholder=");
    expect(box).toContain("md:text-base");
    expect(box).not.toContain("md:text-sm");
    // Nothing to save yet; the Setup cost can be kept as it is.
    expect(tagWith(html, "data-unpriced-save")).toContain('disabled=""');
    expect(tagWith(html, "data-unpriced-setup")).not.toContain('disabled=""');
    expect(block).toContain("Keep the Setup cost ($10.00)");
    expect(html).not.toContain("data-unpriced-total");
  });

  it("an entry with no Setup cost, no ticket and no PO offers only the box", () => {
    const bare: UnpricedEntry = {
      ...unpriced,
      id: 9,
      job_name: null,
      service_job_id: null,
      by_name: null,
      unit_cost: null,
      source: "none",
      setup_cost: null,
      pos: [],
    };
    const html = render(year({ unpriced: [bare] }));
    const block = from(html, 'data-unpriced="9"');
    expect(block).toContain("Used meanwhile: nothing, no cost is known");
    expect(block).not.toContain("data-unpriced-setup");
    expect(block).not.toContain("Purchase orders on this ticket");
    expect(block).not.toContain("entered by");
    expect(block).not.toContain("data-ticket");
  });

  it("the date boxes are 16px too", () => {
    const html = render(year());
    for (const id of ["year-end-from", "year-end-to"]) {
      expect(tagWith(html, `id="${id}"`)).toContain("md:text-base");
      expect(tagWith(html, `id="${id}"`)).not.toContain("md:text-sm");
    }
  });

  it("Save price sends the price for that entry, then says so and refreshes", () => {
    render(year());
    // The first mutation is Export; the second belongs to the one entry on the page.
    const save = hooks.mutations[1];
    void save?.mutationFn(11.25);
    expect(hooks.setEntryPrice).toHaveBeenCalledWith({
      data: { movement_id: 7, unit_cost: 11.25 },
    });
    save?.onSuccess({ ok: true });
    expect(hooks.toasts).toEqual(["success: Price saved"]);
    expect(hooks.invalidated).toEqual([{ queryKey: ["inventory-year-end"] }]);
    expect(changed).toBe(1);
  });

  it("a refused price shows the server's own message and refreshes nothing", () => {
    render(year());
    hooks.mutations[1]?.onError(new Error("A price paid goes on stock coming in"));
    expect(hooks.toasts).toEqual(["error: A price paid goes on stock coming in"]);
    expect(hooks.invalidated).toEqual([]);
    expect(changed).toBe(0);
  });

  it("Export asks for the year summary with dollars and downloads the file", () => {
    const html = render(year());
    expect(tagWith(html, "data-year-export")).not.toContain('disabled=""');
    expect(from(html, "data-year-export")).toContain("Export this summary");
    const run = hooks.mutations[0];
    void run?.mutationFn({ from: "2026-01-01", to: "2026-12-31" });
    expect(hooks.exportInventoryCsv).toHaveBeenCalledWith({
      data: { report: "year", from: "2026-01-01", to: "2026-12-31", with_value: true },
    });
    run?.onSuccess({ csv: "Category,Item\r\n", count: 4, file_name: "inventory-year-2026.csv" });
    expect(hooks.downloads).toEqual(["inventory-year-2026.csv"]);
    expect(hooks.toasts).toEqual(["success: Summary exported"]);
  });

  it("Export with nothing in the period downloads nothing and says why", () => {
    render(year());
    hooks.mutations[0]?.onSuccess({ csv: "Category,Item\r\n", count: 0, file_name: "x.csv" });
    expect(hooks.downloads).toEqual([]);
    expect(hooks.toasts).toEqual(["info: Nothing in inventory for that period."]);
  });
});
