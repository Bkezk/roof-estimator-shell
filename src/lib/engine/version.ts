/**
 * Formula versioning (engine-truth §1). Every estimate carries a `FormulasVersion` string
 * (e.g. "4.0.230"); version-sensitive formulas dispatch on it via `SharedFuncs.CompareVersions`.
 * Observed ordering: 4.0.222 < 4.0.223 < 4.0.229 < 4.0.230 < 4.0.237.
 *
 * New bids compute under the current/highest version; imported .bax bids must reproduce under
 * their stamped version, so every version-sensitive branch keeps both code paths.
 */

/** Fixed version tokens that formulas branch on. */
export const V = {
  V4_0_222: "4.0.222",
  V4_0_223: "4.0.223",
  V4_0_229: "4.0.229",
  V4_0_230: "4.0.230",
  V4_0_237: "4.0.237",
} as const;

/** The newest known version; new bids are stamped with this. */
export const CURRENT_FORMULAS_VERSION = V.V4_0_237;

/**
 * Compare two dotted-numeric version strings. Returns -1 if a < b, 0 if equal, 1 if a > b.
 * Missing components are treated as 0 ("4.0" == "4.0.0"); non-numeric components compare as 0.
 */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const pa = a.split(".");
  const pb = b.split(".");
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const na = Number(pa[i] ?? "0") || 0;
    const nb = Number(pb[i] ?? "0") || 0;
    if (na < nb) return -1;
    if (na > nb) return 1;
  }
  return 0;
}

/** `version` is at least `token` (>= comparison). */
export const versionAtLeast = (version: string, token: string): boolean =>
  compareVersions(version, token) >= 0;

/** `version` is at most `token` (<= comparison). */
export const versionAtMost = (version: string, token: string): boolean =>
  compareVersions(version, token) <= 0;
