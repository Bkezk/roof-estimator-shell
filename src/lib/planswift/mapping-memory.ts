/**
 * The PlanSwift importer's memory (per browser): the target the estimator chose for each
 * normalised row name (`normalizeRowName`), so the next export with similar names — the same
 * estimator types the same names job after job — opens pre-filled with those choices.
 * Pure over a Storage-like object so it can be tested without a browser; every read and write is
 * guarded (private windows and blocked storage just forget).
 */

import { PLANSWIFT_TARGETS, type ClassifiedRow, type PlanSwiftTarget } from "./classify";

export const MAPPING_STORAGE_KEY = "planswift.mapping";
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
 * Remember the final choices of one import. "Place by hand" is not a choice (it is what is left
 * when nothing fits), so it is never remembered; a name chosen again moves to the newest end.
 */
export function rememberMappings(
  storage: StorageLike | null | undefined,
  choices: ReadonlyArray<{ key: string; target: PlanSwiftTarget }>,
): MappingMemory {
  const mem = readMappingMemory(storage);
  for (const c of choices) {
    if (!c.key || c.target === "unmatched") continue;
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
    };
  });
}
