/**
 * The key an item-number mapping uses for a catalog row. Normally the row's label (Description /
 * Name); on a screen where a label repeats — Fasteners & Bits ("2"" under six subtypes), Facia
 * Bars / Vinyl Covers ("White Vinyl Cover" on two bar sizes) — the label plus " [Subtype]" or
 * " [Part #]" so each row is addressable. Server (targets / apply / upsert) and client (catalog
 * chips) must agree, so both call this.
 */
export type CatalogRow = Record<string, unknown>;

export const LABEL_COLS = new Set(["Description", "Name"]);

export const labelColOf = (cols: readonly string[]): string =>
  cols.find((c) => LABEL_COLS.has(c)) ?? cols[0] ?? "Description";

const str = (v: unknown): string => String(v ?? "").trim();

/** Row label → row key for every row of a screen (index-aligned with `rows`). */
export function rowKeys(cols: readonly string[], rows: readonly CatalogRow[]): string[] {
  const labelCol = labelColOf(cols);
  const counts = new Map<string, number>();
  for (const r of rows) {
    const l = str(r[labelCol]);
    counts.set(l, (counts.get(l) ?? 0) + 1);
  }
  return rows.map((r) => {
    const l = str(r[labelCol]);
    if ((counts.get(l) ?? 0) <= 1) return l;
    const disc = str(r["Subtype"]) || str(r["Part #"]);
    return disc ? `${l} [${disc}]` : l;
  });
}

/** The row whose key is `key`, or undefined. */
export function findRowByKey(
  cols: readonly string[],
  rows: readonly CatalogRow[],
  key: string,
): CatalogRow | undefined {
  const keys = rowKeys(cols, rows);
  const i = keys.indexOf(key);
  return i >= 0 ? rows[i] : undefined;
}
