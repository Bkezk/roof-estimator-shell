/**
 * PlanSwift Excel export → rows (pure apart from `readPlanSwiftWorkbook`, which loads the xlsx
 * package on demand like the price-list import).
 *
 * PlanSwift 11's "Export to Excel" writes one sheet with a header row — Name, Description,
 * Takeoff (the quantity), Units (SQ FT / FT / EA), Wall Height, Wall Area, Price Each, Price
 * Total, Color and, on newer exports, Linear total (the perimeter of an area, the length of a
 * linear) followed by a SECOND Units column for it. Names are typed by hand and not uniform;
 * `classify.ts` reads them. This file only finds the columns and the numbers:
 *  - the header row is the first row (of the first sheet that has one) with a Name column and a
 *    Takeoff / Quantity column; case, spacing and punctuation in the headers do not matter;
 *  - "Units" appearing twice: the first one after Takeoff is the quantity's unit;
 *  - no "Linear total" column (older exports) → every row's `linearTotal` is null;
 *  - blank rows are skipped; a named row without a number in Takeoff is skipped with a warning.
 */

export type PlanSwiftUnitKind = "sqft" | "ft" | "ea" | "other";

export interface PlanSwiftRow {
  /** 1-based row number on the sheet (as Excel shows it), for messages. */
  sheetRow: number;
  name: string;
  description: string;
  qty: number;
  /** The Units cell as written, trimmed ("SQ FT", "FT", "EA"). */
  units: string;
  unitKind: PlanSwiftUnitKind;
  /** The Linear total column (an area's perimeter, a linear's length); null when absent / blank. */
  linearTotal: number | null;
  wallHeight: number | null;
  wallArea: number | null;
}

export interface PlanSwiftSheet {
  sheetName: string;
  rows: PlanSwiftRow[];
  /** True when the export has the Linear total column (PlanSwift's newer layout). */
  hasLinearTotal: boolean;
  warnings: string[];
}

/** Header cell → comparable key: lower case, letters and digits only ("Linear  Total" → "lineartotal"). */
const headerKey = (v: unknown): string =>
  String(v ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

/** A number from a cell: numbers as they are, strings with thousands separators parsed; else null. */
export function cellNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const t = v.trim().replace(/,/g, "");
  if (!t || !/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

const cellText = (v: unknown): string =>
  v === null || v === undefined ? "" : String(v).replace(/\s+/g, " ").trim();

/** "SQ FT", "sq. ft.", "SF", "sqft" → sqft; "FT", "LF", "lin ft" → ft; "EA", "each", "count" → ea. */
export function unitKind(units: string): PlanSwiftUnitKind {
  const k = headerKey(units);
  if (["sqft", "sf", "sqfeet", "squarefeet", "squarefoot", "ft2"].includes(k)) return "sqft";
  if (["ft", "lf", "linft", "linearft", "feet", "foot", "linealft", "lnft"].includes(k))
    return "ft";
  if (["ea", "each", "count", "ct", "pcs", "pc", "qty"].includes(k)) return "ea";
  return "other";
}

interface Columns {
  name: number;
  description: number;
  qty: number;
  units: number;
  linearTotal: number;
  wallHeight: number;
  wallArea: number;
}

function findColumns(row: readonly unknown[]): Columns | null {
  const keys = row.map(headerKey);
  const first = (pred: (k: string) => boolean, from = 0) => {
    for (let i = from; i < keys.length; i++) if (pred(keys[i]!)) return i;
    return -1;
  };
  const name = first((k) => k === "name" || k === "item" || k === "itemname");
  const qty = first((k) => k === "takeoff" || k === "quantity" || k === "qty");
  if (name < 0 || qty < 0) return null;
  // The quantity's unit: the first Units column after Takeoff (the second one is Linear total's).
  let units = first((k) => k === "units" || k === "unit" || k === "uom", qty + 1);
  if (units < 0) units = first((k) => k === "units" || k === "unit" || k === "uom");
  return {
    name,
    description: first((k) => k === "description" || k === "desc"),
    qty,
    units,
    linearTotal: first((k) => k === "lineartotal" || k === "linear" || k === "lineartotalft"),
    wallHeight: first((k) => k === "wallheight"),
    wallArea: first((k) => k === "wallarea"),
  };
}

/**
 * Read one sheet's cell matrix (as `XLSX.utils.sheet_to_json(ws, { header: 1 })` returns it).
 * Returns null when the sheet has no PlanSwift header row.
 */
export function parsePlanSwiftMatrix(
  matrix: readonly (readonly unknown[] | null | undefined)[],
  sheetName = "Sheet1",
): PlanSwiftSheet | null {
  let headerAt = -1;
  let cols: Columns | null = null;
  for (let i = 0; i < Math.min(matrix.length, 30); i++) {
    const c = findColumns(matrix[i] ?? []);
    if (c) {
      headerAt = i;
      cols = c;
      break;
    }
  }
  if (!cols) return null;
  const at = (r: readonly unknown[], i: number) => (i >= 0 ? r[i] : undefined);
  const rows: PlanSwiftRow[] = [];
  const warnings: string[] = [];
  for (let i = headerAt + 1; i < matrix.length; i++) {
    const r = matrix[i] ?? [];
    const name = cellText(at(r, cols.name));
    const qtyCell = at(r, cols.qty);
    const qty = cellNumber(qtyCell);
    if (!name && (qty === null || qty === 0)) continue; // blank row
    if (qty === null) {
      warnings.push(`Row ${i + 1} "${name}": no number in Takeoff — skipped.`);
      continue;
    }
    // A named row with nothing counted ("1.5" Stack" × 0, owner's file Oct 5): nothing to bid.
    if (qty === 0) {
      warnings.push(`Row ${i + 1} "${name}": quantity 0 — skipped.`);
      continue;
    }
    const units = cellText(at(r, cols.units));
    rows.push({
      sheetRow: i + 1,
      name: name || `Row ${i + 1}`,
      description: cellText(at(r, cols.description)),
      qty,
      units,
      unitKind: unitKind(units),
      linearTotal: cols.linearTotal >= 0 ? cellNumber(at(r, cols.linearTotal)) : null,
      wallHeight: cellNumber(at(r, cols.wallHeight)),
      wallArea: cellNumber(at(r, cols.wallArea)),
    });
  }
  return { sheetName, rows, hasLinearTotal: cols.linearTotal >= 0, warnings };
}

/** Read an .xlsx / .xls export: the first sheet with a PlanSwift header row. Throws when none. */
export async function readPlanSwiftWorkbook(
  bytes: ArrayBuffer | Uint8Array,
): Promise<PlanSwiftSheet> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(bytes, { type: "array" });
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (!ws) continue;
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(ws, {
      header: 1,
      raw: true,
      defval: null,
      blankrows: true,
    });
    const sheet = parsePlanSwiftMatrix(matrix, name);
    if (sheet) {
      if (sheet.rows.length === 0) throw new Error(`Sheet "${name}" has the headers but no rows.`);
      return sheet;
    }
  }
  throw new Error(
    "This workbook has no PlanSwift export on it: expected a header row with Name, Takeoff and Units.",
  );
}
