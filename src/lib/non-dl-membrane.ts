/**
 * Non-DL TPO and EPDM on their own page (owner, Oct 22: "the non dl tpo and its thickness and
 * epdm rubber with its thicknesses are under the durolast membrane tab on estimate pricing. can
 * we move those to a new page under non Durolast pricing and have the page called Non-DL TPO and
 * EPDM. this is a front end change dont change the back end as it appears to currently be wired
 * correctly").
 *
 * The back end stays as it is: those rows live in the one "Duro-Last Membrane" pricing screen
 * (pricing_catalog duro_last:duro_last_membrane), and the engine reads every family from that
 * screen by the row's name ("Non-DL TPO - 45", "EPDM Rubber - 60"; engine/adapters.ts
 * buildFamilyMembranePrices*). So the split is a view: the new page (routes/admin.non-dl-
 * membrane.tsx) shows only the rows of these two families and the Duro-Last Membrane view
 * (routes/admin.duro-last.tsx) shows the rest; each edits its part and the editor
 * (components/catalog-editor.tsx) merges that part back into the whole screen on save
 * (mergeRows), so neither side can lose the other's rows.
 */

/** The two families' name prefixes, as the engine's regex has them. */
export const NON_DL_MEMBRANE_FAMILIES = ["Non-DL TPO", "EPDM Rubber"] as const;
const FAMILY_RE = /^(Non-DL TPO|EPDM Rubber) - /;

/** The screen both views edit (its category name in pricing_catalog). */
export const MEMBRANE_CATEGORY = "Duro-Last Membrane";
/** The new page's address (a Non Duro-Last Pricing menu entry; a pricing page by access.ts). */
export const NON_DL_MEMBRANE_PATH = "/admin/non-dl-membrane";
/** What a row added on the new page starts as: the engine needs the family in the name. */
export const NON_DL_MEMBRANE_NEW_ROW = "Non-DL TPO - ";

export type CatalogRow = Record<string, string | number | boolean>;

/** Is this membrane-screen row one of the two non-Duro-Last families? */
export function isNonDlMembraneRow(row: CatalogRow, labelCol: string): boolean {
  return FAMILY_RE.test(String(row[labelCol] ?? "").trim());
}

/**
 * The whole screen with one view's edits merged back in. `full` is the screen as stored, `keep`
 * picks the rows that view shows, `edited` is that view's rows after editing (the same rows in
 * the same order, some changed, some deleted, new ones at the end). Walking the stored rows, each
 * kept row is replaced by the next edited row (or dropped once the edited rows run out — a
 * deletion); the rows the view never showed stay where they were; edited rows beyond the stored
 * count (additions) go in after the last kept row, or at the end when there was none.
 */
export function mergeRows(
  full: readonly CatalogRow[],
  keep: (row: CatalogRow) => boolean,
  edited: readonly CatalogRow[],
): CatalogRow[] {
  const out: CatalogRow[] = [];
  let j = 0;
  let lastKeptAt = -1;
  for (const row of full) {
    if (!keep(row)) {
      out.push(row);
      continue;
    }
    if (j < edited.length) {
      out.push(edited[j++]!);
      lastKeptAt = out.length - 1;
    }
  }
  const extra = edited.slice(j);
  if (!extra.length) return out;
  const at = lastKeptAt >= 0 ? lastKeptAt + 1 : out.length;
  out.splice(at, 0, ...extra);
  return out;
}
