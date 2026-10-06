/**
 * Roof-type chips in the repair picker (owner, Oct 6: "the repair tags … please fix"). The
 * repair library (20261006120000_repair_library.sql) carries CenterPoint's roof-type tags on
 * every repair (repair_templates.tags); the close-out picker offers them as chips — All plus the
 * six below — so a tech on a Duro-Last roof is not scrolling past BUR repairs. The filter runs on
 * the server (listRepairTemplates' `tag`, so the top-N and the search limit apply after it); these
 * are the pure parts the picker and the server function share. No I/O beyond the remembered chip.
 *
 * Stored values are CenterPoint's spelling ("Sheetmetal"); the chip shows "Sheet Metal". The
 * library also carries rarer tags (TPO, EPDM, Tile, Shingles, Sloped …) that get no chip: a
 * repair tagged only with those shows under All. An untagged repair (6 of them, e.g. Brick Mason
 * Work) shows under every chip.
 */
export const REPAIR_TAGS = [
  { value: "General", label: "General" },
  { value: "BUR", label: "BUR" },
  { value: "Modified", label: "Modified" },
  { value: "Single Ply", label: "Single Ply" },
  { value: "Duro-Last", label: "Duro-Last" },
  { value: "Sheetmetal", label: "Sheet Metal" },
] as const;

/** A stored tag value one of the chips stands for. */
export type RepairTag = (typeof REPAIR_TAGS)[number]["value"];

/** The stored values in display order (the server function's zod enum). */
export const REPAIR_TAG_VALUES = REPAIR_TAGS.map((t) => t.value) as [RepairTag, ...RepairTag[]];

export const isRepairTag = (v: unknown): v is RepairTag =>
  typeof v === "string" && (REPAIR_TAG_VALUES as readonly string[]).includes(v);

/** The chip's label for a stored tag ("Sheetmetal" → "Sheet Metal"); any other tag as stored. */
export const repairTagLabel = (stored: string): string =>
  REPAIR_TAGS.find((t) => t.value === stored)?.label ?? stored;

/**
 * Does a repair with these tags belong under this chip? All (null) takes everything; an untagged
 * repair belongs under every chip. The client-side twin of `.contains("tags", [tag])` for the
 * rows that are not re-fetched per chip (the ticket's recent repairs).
 */
export function repairMatchesTag(
  tags: readonly string[] | null | undefined,
  tag: RepairTag | null,
): boolean {
  if (!tag) return true;
  if (!tags || tags.length === 0) return true;
  return tags.includes(tag);
}

/** The last chip chosen on this phone (All stores nothing). */
export const REPAIR_TAG_KEY = "bid-o-matic:repair-tag";

export function readRepairTag(): RepairTag | null {
  try {
    if (typeof window === "undefined") return null;
    const v = window.localStorage.getItem(REPAIR_TAG_KEY);
    return isRepairTag(v) ? v : null;
  } catch {
    return null; // Storage unavailable (private mode, blocked site data): All.
  }
}

export function writeRepairTag(tag: RepairTag | null): void {
  try {
    if (tag) window.localStorage.setItem(REPAIR_TAG_KEY, tag);
    else window.localStorage.removeItem(REPAIR_TAG_KEY);
  } catch {
    // Storage blocked: the chip lasts for this visit.
  }
}
