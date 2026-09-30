/**
 * Matching buildings to 911 address points in memory (scripts/load-kentucky.ts). Pure: no I/O.
 *
 * The exact pass takes the nearest point inside max(100 m, √roof area). About 29 % of the
 * Kentucky outlines have none — rural shops and barns set back from the road — so a second,
 * approximate pass follows the owner's three rules (Sep 29):
 *   1. the nearest point within 300 m, not further;
 *   2. only when it is clearly nearest: the next-nearest point must be at least twice as far
 *      (two close contenders → leave the address blank rather than guess);
 *   3. stored flagged as approximate, with the distance (buildings.address_approx / _m).
 * Rule 2 compares ADDRESSES: a second point carrying the same street address (a house and its
 * garage both typed "1169 STATE ROUTE 136 W") is not a contender, since either gives the same
 * answer. `strictNextM` still reports the plain next-nearest point so the effect can be counted.
 */

/** Rule 1: the furthest an approximate address may come from. */
export const APPROX_MAX_M = 300;
/** Rule 2: the next-nearest (different) address must be at least this many times as far. */
export const APPROX_CLEAR_RATIO = 2;
/** Every point within this distance of a building must be offered to `approxMatch`. */
export const APPROX_SEARCH_M = APPROX_MAX_M * APPROX_CLEAR_RATIO;

/** Equirectangular distance in metres (the same arithmetic as the SQL matcher). */
export const metres = (lat1: number, lng1: number, lat2: number, lng2: number): number => {
  const dy = (lat2 - lat1) * 111320;
  const dx = (lng2 - lng1) * 111320 * Math.cos((lat1 * Math.PI) / 180);
  return Math.sqrt(dx * dx + dy * dy);
};

/** The exact pass's radius: 100 m, or the building's own size for the biggest roofs. */
export const exactRadiusM = (roofSqFt: number | null | undefined): number =>
  Math.max(100, Math.sqrt((roofSqFt ?? 0) * 0.092903));

/**
 * Grid cells of 0.0015° (≈ 165 m north–south, ≈ 130 m east–west in Kentucky). `around` returns
 * what sits in the cell and its eight neighbours, so every exact match radius (100 m, or the
 * building's own size — ~300 m for the biggest roofs) is covered; `within` returns every cell
 * that can hold something inside a given radius (a superset: callers measure the distance).
 */
export const GRID_DEG = 0.0015;
/** The widest neighbourhood `within` will search, in cells each way (≈ 8 km at this latitude). */
const MAX_CELLS = 60;
export class Grid {
  private cells = new Map<string, number[]>();
  private key(la: number, lo: number) {
    return `${la}|${lo}`;
  }
  add(lat: number, lng: number, idx: number) {
    const k = this.key(Math.floor(lat / GRID_DEG), Math.floor(lng / GRID_DEG));
    const list = this.cells.get(k);
    if (list) list.push(idx);
    else this.cells.set(k, [idx]);
  }
  private collect(lat: number, lng: number, rLat: number, rLng: number): number[] {
    const la0 = Math.floor(lat / GRID_DEG);
    const lo0 = Math.floor(lng / GRID_DEG);
    const out: number[] = [];
    for (let a = -rLat; a <= rLat; a++)
      for (let b = -rLng; b <= rLng; b++) {
        const list = this.cells.get(this.key(la0 + a, lo0 + b));
        if (list) out.push(...list);
      }
    return out;
  }
  around(lat: number, lng: number): number[] {
    return this.collect(lat, lng, 1, 1);
  }
  within(lat: number, lng: number, radiusM: number): number[] {
    const rLat = Math.ceil(radiusM / (GRID_DEG * 111320));
    const rLng = Math.ceil(radiusM / (GRID_DEG * 111320 * Math.cos((lat * Math.PI) / 180)));
    // A position that is not degrees (Fleming's 911 file gave a "latitude" of 315,450, whose
    // cosine is ~0) would ask for trillions of cells and hang the process; nothing real in
    // Kentucky or Tennessee needs more than a few dozen. Off the map = no neighbours.
    if (!Number.isFinite(rLng) || rLng < 0 || rLng > MAX_CELLS || rLat > MAX_CELLS) return [];
    return this.collect(lat, lng, rLat, rLng);
  }
}

export interface PointLike {
  lat: number;
  lng: number;
  address: string;
}

export type ApproxOutcome<P extends PointLike> =
  /** Rules 1 and 2 hold: `point` is the approximate address. `nextM` null = none within 600 m. */
  | {
      outcome: "approx";
      point: P;
      distanceM: number;
      nextM: number | null;
      strictNextM: number | null;
    }
  /** Rule 2 fails: another address lies less than twice as far. Left blank. */
  | { outcome: "contested"; point: P; distanceM: number; next: P; nextM: number }
  /** Rule 1 fails: no point within 300 m. Left blank. */
  | { outcome: "none"; nearestM: number | null };

const addressKey = (a: string) => a.trim().replace(/\s+/g, " ").toUpperCase();

/**
 * The owner's rules 1 and 2 for one building. `candidates` must hold every usable address point
 * within APPROX_SEARCH_M (600 m) of it — further ones cannot change the answer.
 */
export function approxMatch<P extends PointLike>(
  at: { lat: number; lng: number },
  candidates: Iterable<P>,
): ApproxOutcome<P> {
  const scored: { p: P; d: number }[] = [];
  for (const p of candidates) scored.push({ p, d: metres(at.lat, at.lng, p.lat, p.lng) });
  scored.sort((x, y) => x.d - y.d);
  const first = scored[0];
  if (!first || first.d > APPROX_MAX_M) return { outcome: "none", nearestM: first?.d ?? null };
  const key = addressKey(first.p.address);
  const next = scored.find((s) => s !== first && addressKey(s.p.address) !== key);
  if (next && next.d < APPROX_CLEAR_RATIO * first.d) {
    return {
      outcome: "contested",
      point: first.p,
      distanceM: first.d,
      next: next.p,
      nextM: next.d,
    };
  }
  const strict = scored[1];
  return {
    outcome: "approx",
    point: first.p,
    distanceM: first.d,
    nextM: next && next.d <= APPROX_SEARCH_M ? next.d : null,
    strictNextM: strict && strict.d <= APPROX_SEARCH_M ? strict.d : null,
  };
}
