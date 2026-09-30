import { describe, expect, it } from "vitest";

import { classifyRows } from "./classify";
import { readPlanSwiftHandoff, stashPlanSwiftHandoff, type PlanSwiftHandoff } from "./handoff";
import {
  applyMappingMemory,
  MAPPING_MEMORY_LIMIT,
  MAPPING_STORAGE_KEY,
  readMappingMemory,
  rememberMappings,
} from "./mapping-memory";
import type { PlanSwiftRow } from "./parse";

/** A Map-backed Storage stand-in (the tests run without a browser). */
class MemStorage {
  private m = new Map<string, string>();
  get length() {
    return this.m.size;
  }
  key(i: number) {
    return [...this.m.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
}

const row = (sheetRow: number, name: string, qty: number, units: "SQ FT" | "FT" | "EA") =>
  ({
    sheetRow,
    name,
    description: "",
    qty,
    units,
    unitKind: units === "SQ FT" ? "sqft" : units === "FT" ? "ft" : "ea",
    linearTotal: null,
    wallHeight: null,
    wallArea: null,
  }) satisfies PlanSwiftRow;

describe("mapping memory (planswift.mapping)", () => {
  it("remembers choices per normalised name and pre-fills the next import", () => {
    const st = new MemStorage();
    const first = classifyRows([
      row(2, 'Parapet 01 ( 6"_/ 54" )', 100, "FT"),
      row(3, "ATR Hub", 1, "EA"),
      row(4, "Splash blocks", 7, "EA"),
    ]);
    expect(first.map((c) => c.target)).toEqual(["parapet", "accessory", "unmatched"]);
    // The estimator skips the hub and leaves the splash blocks to place by hand.
    rememberMappings(st, [
      { key: first[0]!.key, target: "parapet" },
      { key: first[1]!.key, target: "skip" },
      { key: first[2]!.key, target: "unmatched" },
    ]);
    expect(JSON.parse(st.getItem(MAPPING_STORAGE_KEY)!)).toEqual({
      parapet: "parapet",
      "atr hub": "skip",
    });

    const next = applyMappingMemory(
      classifyRows([
        row(2, "ATR  Hub", 2, "EA"),
        row(3, 'Parapet 07 (6"_/ 30")', 50, "FT"),
        row(4, "Splash blocks", 3, "EA"),
      ]),
      readMappingMemory(st),
    );
    expect(next.map((c) => [c.target, c.confidence, c.remembered ?? false])).toEqual([
      ["skip", "high", true],
      ["parapet", "high", true],
      ["unmatched", "low", false],
    ]);
    expect(next[0]!.reason).toBe("your choice for this name last time");
  });

  it("a newer choice replaces the older one; the oldest names drop past the limit", () => {
    const st = new MemStorage();
    rememberMappings(st, [{ key: "gutter", target: "gutter" }]);
    rememberMappings(st, [{ key: "gutter", target: "metals" }]);
    expect(readMappingMemory(st)).toEqual({ gutter: "metals" });
    rememberMappings(
      st,
      Array.from({ length: MAPPING_MEMORY_LIMIT + 5 }, (_, i) => ({
        key: `name ${i}`,
        target: "skip" as const,
      })),
    );
    const mem = readMappingMemory(st);
    expect(Object.keys(mem)).toHaveLength(MAPPING_MEMORY_LIMIT);
    expect(mem["gutter"]).toBeUndefined();
    expect(mem[`name ${MAPPING_MEMORY_LIMIT + 4}`]).toBe("skip");
  });

  it("bad or blocked storage just forgets", () => {
    const st = new MemStorage();
    st.setItem(MAPPING_STORAGE_KEY, "{not json");
    expect(readMappingMemory(st)).toEqual({});
    st.setItem(MAPPING_STORAGE_KEY, JSON.stringify({ a: "nonsense", b: "curb" }));
    expect(readMappingMemory(st)).toEqual({ b: "curb" });
    expect(readMappingMemory(null)).toEqual({});
    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readMappingMemory(blocked)).toEqual({});
    expect(() => rememberMappings(blocked, [{ key: "x", target: "skip" }])).not.toThrow();
  });
});

describe("hand-off to the estimator", () => {
  const h = (createdAt: string): PlanSwiftHandoff =>
    ({
      seed: { sections: [{ name: "Roof 1" }] },
      bidName: "Acme · roof",
      account: { id: "a", siteId: null, label: "Acme" },
      createdAt,
    }) as unknown as PlanSwiftHandoff;

  it("stores, reads back, and keeps only the latest few", () => {
    const st = new MemStorage();
    for (let i = 0; i < 7; i++) stashPlanSwiftHandoff(st, h(`2026-09-30T10:0${i}:00Z`), `id${i}`);
    expect(st.length).toBe(5);
    expect(readPlanSwiftHandoff(st, "id6")?.bidName).toBe("Acme · roof");
    expect(readPlanSwiftHandoff(st, "id0")).toBeNull();
    expect(readPlanSwiftHandoff(st, "nope")).toBeNull();
    expect(readPlanSwiftHandoff(null, "id6")).toBeNull();
  });

  it("a storage failure is thrown with a message for the toast", () => {
    const full = new MemStorage();
    full.setItem = () => {
      throw new Error("QuotaExceededError");
    };
    expect(() => stashPlanSwiftHandoff(full, h("x"), "id")).toThrow(
      /Could not hand the import to the estimator \(browser storage: QuotaExceededError\)/,
    );
  });
});
