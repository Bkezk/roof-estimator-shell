/**
 * The PlanSwift importer's memory (per browser): the target the estimator CHOSE for a normalised
 * row name (`normalizeRowName`) when it differed from the importer's own guess, so the next export
 * with similar names — the same estimator types the same names job after job — opens pre-filled
 * with those choices. Only real changes are kept (owner, Oct 6): the first version remembered
 * every row's target, guesses included, so a wrong guess on one import ("Roof Type 1 …" as a
 * tapered quote, the metal panel as the roof) came back as "your choice" on the next, over the
 * corrected importer. Hence the key's `.v2`: the old entries are left unread. Pure over a
 * Storage-like object so it can be tested without a browser; every read and write is guarded
 * (private windows and blocked storage just forget).
 */

import { PLANSWIFT_TARGETS, type ClassifiedRow, type PlanSwiftTarget } from "./classify";

export const MAPPING_STORAGE_KEY = "planswift.mapping.v2";
/** The first version's key: guesses were remembered as choices, so it is ignored, never read. */
export const LEGACY_MAPPING_STORAGE_KEY = "planswift.mapping";
/** Oldest names are dropped past this many. */
export const MAPPING_MEMORY_LIMIT = 400;

export type MappingMemory = Record<string, PlanSwiftTarget>;

type StorageLike = Pick<Storage, "getItem" | "setItem">;

const isTarget = (v: unknown): v is PlanSwiftTarget =>
  typeof v === "string" && (PLANSWIFT_TARGETS as readonly string[]).includes(v);

export function readMappingMemory(storage: StorageLike | null | undefined): MappingMemory {
  try {
    const raw = storage?.getItem(MAPPING_STORAGE_KEY);
    if (!raw) return {};
    const o = JSON.parse(raw) as unknown;
    if (!o || typeof o !== "object" || Array.isArray(o)) return {};
    const out: MappingMemory = {};
    for (const [k, v] of Object.entries(o as Record<string, unknown>))
      if (k && isTarget(v) && v !== "unmatched") out[k] = v;
    return out;
  } catch {
    return {};
  }
}

/**
 * Remember the final choices of one import. Only a target that differs from the importer's own
 * guess (`guessed`) is a choice: a row left on its guess is not remembered, and a name whose
 * target is set back to the guess is forgotten (that is how a wrong memory is undone). "Place by
 * hand" is not a choice either (it is what is left when nothing fits); a name chosen again moves
 * to the newest end.
 */
export function rememberMappings(
  storage: StorageLike | null | undefined,
  choices: ReadonlyArray<{ key: string; target: PlanSwiftTarget; guessed?: PlanSwiftTarget }>,
): MappingMemory {
  const mem = readMappingMemory(storage);
  for (const c of choices) {
    if (!c.key) continue;
    if (c.target === "unmatched" || (c.guessed !== undefined && c.target === c.guessed)) {
      delete mem[c.key];
      continue;
    }
    delete mem[c.key];
    mem[c.key] = c.target;
  }
  const keys = Object.keys(mem);
  const trimmed: MappingMemory = {};
  for (const k of keys.slice(Math.max(0, keys.length - MAPPING_MEMORY_LIMIT))) trimmed[k] = mem[k]!;
  try {
    storage?.setItem(MAPPING_STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // Storage full or blocked: the import still works, it just does not remember.
  }
  return trimmed;
}

/** Pre-fill rows from the memory: a remembered name takes the remembered target. */
export function applyMappingMemory(
  rows: readonly ClassifiedRow[],
  mem: MappingMemory,
): ClassifiedRow[] {
  return rows.map((r) => {
    const t = mem[r.key];
    if (!t || t === r.target) return t ? { ...r, remembered: true } : r;
    return {
      ...r,
      target: t,
      confidence: "high",
      reason: "your choice for this name last time",
      remembered: true,
      guessed: r.target,
    };
  });
}
