/**
 * "If it doesn't know, it'll ask" (owner, Oct 8, Pineville Independent Preschool): the rows the
 * review screen must ask about before Create bid, and the pick each one needs.
 *
 * Two kinds of asking:
 *   - a row the classifier is unsure of (confidence "low") has no target until the estimator
 *     picks one (the review screen's "Goes to" starts blank for it);
 *   - a row that has a target but not enough to place it — a gutter with no style / size, a
 *     downspout part with no size, an elbow with no style, a drain with no size — gets a second
 *     box with the price list's choices for that one thing (`pickFor`).
 * The pick is stored on the choice (`PlanSwiftChoice.pick`) and the seed uses it. Pure rules.
 */
import type { MetalsCatalogItem } from "@/lib/engine/adapters";
import type { ClassifiedRow, PlanSwiftTarget } from "./classify";
import { inchToken, matchDrainPicks } from "./drain-picks";

export interface PickLists {
  /** Metals › Gutters: sizes by style ("LX-Style" → ['A = 6" B = 4" C = 4"', …]). */
  gutterSizesByStyle?: Record<string, readonly string[]> | undefined;
  /** The Metals screen catalog (downspouts by size, elbows, drops). */
  metalsCatalog?: readonly MetalsCatalogItem[] | undefined;
  /** Roof Drains & Boots: boot and ring descriptions. */
  drainBoots?: readonly string[] | undefined;
  drainRings?: readonly string[] | undefined;
}

export interface PickOption {
  value: string;
  label: string;
}
export interface RowPick {
  /** The question above the box ("Which gutter?"). */
  question: string;
  options: PickOption[];
}

export const PICK_SEP = "|";

/** The downspout sizes the Metals catalog knows (`Downspouts 4"X5"` → `4"X5"`). */
export function catalogDownspoutSizes(catalog: readonly MetalsCatalogItem[] | undefined): string[] {
  const out: string[] = [];
  for (const i of catalog ?? []) {
    const m = /^downspouts\s+(.+)$/i.exec(i.category.trim());
    if (m && !out.includes(m[1]!)) out.push(m[1]!);
  }
  return out;
}

/** The elbow rows for one downspout size. */
export function elbowRows(
  catalog: readonly MetalsCatalogItem[] | undefined,
  size: string,
): MetalsCatalogItem[] {
  const want = `downspouts ${size}`.replace(/\s+/g, "").toLowerCase();
  return (catalog ?? []).filter(
    (i) => i.category.replace(/\s+/g, "").toLowerCase() === want && /elbow/i.test(i.description),
  );
}

/** A gutter pick: `LX-Style|A = 6" B = 4" C = 4"` → the style and the size. */
export function parseGutterPick(v: string | undefined): { style: string; size: string } | null {
  if (!v) return null;
  const at = v.indexOf(PICK_SEP);
  if (at <= 0 || at === v.length - 1) return null;
  return { style: v.slice(0, at), size: v.slice(at + 1) };
}

/** An elbow pick: `4"X5"|45° A-Style Elbow` → the size and the row. */
export function parseElbowPick(
  v: string | undefined,
): { size: string; description: string } | null {
  if (!v) return null;
  const at = v.indexOf(PICK_SEP);
  if (at <= 0 || at === v.length - 1) return null;
  return { size: v.slice(0, at), description: v.slice(at + 1) };
}

/**
 * The pick a row needs for its target, or null when the row can be placed as it is (or cannot
 * be placed by any pick). `sheetSizes` are the downspout sizes the sheet's other rows name: an
 * elbow or a length with no size of its own offers those first, else every size the catalog has.
 */
export function pickFor(
  c: ClassifiedRow,
  target: PlanSwiftTarget,
  lists: PickLists,
  sheetSizes: readonly string[] = [],
): RowPick | null {
  const d = c.details;
  if (target === "gutter") {
    const styles = lists.gutterSizesByStyle ?? {};
    const options: PickOption[] = [];
    for (const [style, sizes] of Object.entries(styles))
      for (const size of sizes)
        options.push({
          value: `${style}${PICK_SEP}${size}`,
          label: `${style.replace(/-Style$/, "")} · ${size}`,
        });
    return options.length ? { question: "Which gutter (style and size)?", options } : null;
  }
  if (target === "downspout") {
    if (d.dsPart === "count") return null;
    const sizes = catalogDownspoutSizes(lists.metalsCatalog);
    if (!sizes.length) return null;
    if (d.dsPart === "elbow") {
      const pool = d.dsSize ? [d.dsSize] : sheetSizes.length ? [...sheetSizes] : sizes;
      const deg = /\b45\b/.test(c.row.name) ? "45" : /\b80\b|\b90\b/.test(c.row.name) ? "80" : null;
      const options: PickOption[] = [];
      for (const size of pool)
        for (const row of elbowRows(lists.metalsCatalog, size)) {
          if (deg && !row.description.includes(`${deg}°`)) continue;
          options.push({
            value: `${size}${PICK_SEP}${row.description}`,
            label: pool.length > 1 ? `${size} · ${row.description}` : row.description,
          });
        }
      return options.length ? { question: "Which elbow?", options } : null;
    }
    if (!d.dsSize) {
      const pool = sheetSizes.length ? [...sheetSizes] : sizes;
      return {
        question: `Which size of downspout?`,
        options: pool.map((s) => ({ value: s, label: s })),
      };
    }
    return null;
  }
  if (target === "drain") {
    const boots = lists.drainBoots ?? [];
    const rings = lists.drainRings ?? [];
    if (!boots.length || !rings.length) return null;
    if (d.sizeIn !== undefined && matchDrainPicks(d.sizeIn, boots, rings)) return null;
    const options = boots
      .filter((b) => {
        const m = /^\s*(\d+(?:\s+\d\/\d)?)\s*"/.exec(b);
        return !!m && !!matchDrainPicks(inchFrom(m[1]!), boots, rings);
      })
      .map((b) => ({ value: b, label: b }));
    return options.length ? { question: "Which drain size?", options } : null;
  }
  return null;
}

/** `3 1/2` → 3.5; `3` → 3. */
function inchFrom(s: string): number {
  const m = /^(\d+)(?:\s+(\d)\/(\d))?$/.exec(s.trim());
  if (!m) return Number(s) || 0;
  return Number(m[1]) + (m[2] && m[3] ? Number(m[2]) / Number(m[3]) : 0);
}

/** The size (in inches) a boot pick names, for the matching ring: `3 1/2" Drain Boot` → 3.5. */
export function bootPickSize(boot: string): number | null {
  const m = /^\s*(\d+(?:\s+\d\/\d)?)\s*"/.exec(boot);
  return m ? inchFrom(m[1]!) : null;
}

/** For messages: a size as the price list spells it. */
export { inchToken };

/** The review's row state: its choice, and whether the estimator has answered what it asks. */
export interface ReviewRow {
  row: ClassifiedRow;
  target: PlanSwiftTarget | null;
  pick?: string | undefined;
}

/**
 * What still needs the estimator before Create bid: rows with no target yet (unsure rows start
 * blank) and rows whose pick box is empty. Skipped rows and "place by hand" rows need nothing.
 */
export function unresolvedRows(
  rows: readonly ReviewRow[],
  lists: PickLists,
  sheetSizes: readonly string[] = [],
): number[] {
  const out: number[] = [];
  rows.forEach((r, i) => {
    if (r.target === null) {
      out.push(i);
      return;
    }
    if (r.target === "skip" || r.target === "unmatched") return;
    const p = pickFor(r.row, r.target, lists, sheetSizes);
    if (p && !(r.pick && p.options.some((o) => o.value === r.pick))) out.push(i);
  });
  return out;
}

/** The downspout sizes the sheet's rows name (`4" X 5" Down Spout Drops` → `4"X5"`). */
export function sheetDownspoutSizes(rows: readonly { row: ClassifiedRow }[]): string[] {
  const out: string[] = [];
  for (const r of rows) {
    const s = r.row.details.dsSize;
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}
