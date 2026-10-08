/**
 * PlanSwift drains with a size (owner, Oct 8: "if there is say a 3" drain boot, it should know we
 * need the corresponding same size drain ring"): a `3" Drains` row lands on Accessories › Roof
 * Drains & Boots with the 3" boot AND the 3" ring picked, instead of waiting to be placed by hand.
 * The names come from the live price list (`2" Drain Boot` … `8" Drain Boot`, `2" Drain Rings` …
 * `8" Drain Rings`, halves spelled `2 1/2"`), matched by the size at the front of the name.
 */

/** A size in inches as the price list spells it: 3 → `3"`, 3.5 → `3 1/2"`, 3.25 → `3 1/4"`. */
export function inchToken(sizeIn: number): string {
  const whole = Math.floor(sizeIn);
  const frac = Math.round((sizeIn - whole) * 8) / 8;
  if (frac === 0) return `${whole}"`;
  const eighths = Math.round(frac * 8);
  const g = (a: number, b: number): number => (b === 0 ? a : g(b, a % b));
  const d = g(eighths, 8);
  return `${whole} ${eighths / d}/${8 / d}"`;
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

/** The price-list row for `sizeIn` among `names` whose name, after the size, says `kind`. */
function pick(sizeIn: number, names: readonly string[], kind: RegExp): string | null {
  const token = norm(inchToken(sizeIn));
  for (const n of names) {
    const v = norm(n);
    if (v.startsWith(token) && kind.test(v.slice(token.length))) return n;
  }
  return null;
}

/**
 * The boot and the matching ring for a drain of `sizeIn`, or null when the price list has no
 * row for that size (the drain is then listed to place by hand, as before).
 */
export function matchDrainPicks(
  sizeIn: number,
  boots: readonly string[],
  rings: readonly string[],
): { bootSize: string; ringSize: string } | null {
  const bootSize = pick(sizeIn, boots, /^\s*drain\s*boot/);
  const ringSize = pick(sizeIn, rings, /^\s*drain\s*rings?\b/);
  return bootSize && ringSize ? { bootSize, ringSize } : null;
}
