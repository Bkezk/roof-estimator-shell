/**
 * Bids page → estimator hand-off for a PlanSwift import. The import dialog builds the seed on the
 * Bids page and opens `/estimate?planswift=<id>`; the estimator reads the seed from this tab's
 * sessionStorage and starts a NEW bid from it, exactly as `?takeoff=<id>` does for a drawing
 * (the estimator's own new-bid defaults apply, the customer is linked, and the bid is saved with
 * the estimator's Save). A reload of that page seeds again; closing the tab forgets it.
 */

import type { PlanSwiftBidSeed } from "./to-seed";

export interface PlanSwiftHandoff {
  seed: PlanSwiftBidSeed;
  bidName: string;
  account: { id: string; siteId: string | null; label: string } | null;
  createdAt: string;
}

const PREFIX = "planswift.seed.";
/** Older hand-offs beyond this many are dropped when a new one is stored. */
const KEEP = 5;

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;

/** Store a hand-off; returns its id. Throws (with a message for the toast) when storage fails. */
export function stashPlanSwiftHandoff(
  storage: StorageLike,
  h: PlanSwiftHandoff,
  id: string,
): string {
  try {
    const old: Array<{ key: string; at: string }> = [];
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (!k?.startsWith(PREFIX)) continue;
      try {
        const v = JSON.parse(storage.getItem(k) ?? "null") as { createdAt?: string } | null;
        old.push({ key: k, at: v?.createdAt ?? "" });
      } catch {
        old.push({ key: k, at: "" });
      }
    }
    old.sort((a, b) => a.at.localeCompare(b.at));
    for (const o of old.slice(0, Math.max(0, old.length - (KEEP - 1)))) storage.removeItem(o.key);
    storage.setItem(PREFIX + id, JSON.stringify(h));
    return id;
  } catch (e) {
    throw new Error(
      `Could not hand the import to the estimator (browser storage: ${e instanceof Error ? e.message : String(e)}).`,
    );
  }
}

/** The hand-off stored under `id`, or null when this tab no longer has it. */
export function readPlanSwiftHandoff(
  storage: Pick<Storage, "getItem"> | null | undefined,
  id: string,
): PlanSwiftHandoff | null {
  try {
    const raw = storage?.getItem(PREFIX + id);
    if (!raw) return null;
    const h = JSON.parse(raw) as PlanSwiftHandoff | null;
    return h && typeof h === "object" && h.seed && Array.isArray(h.seed.sections) ? h : null;
  } catch {
    return null;
  }
}
