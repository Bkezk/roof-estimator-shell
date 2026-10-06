/**
 * Owner, Oct 6 (QA audit, bug 4): Setup › Material pricing's "Add material" puts the new row at
 * the top ("so the one just added is in view"), but the save gave it sort = max + 1, so after
 * the save the list came back sorted and the new material had jumped to the bottom. A new
 * material now takes sort = min − 1 (the column is a plain integer, no check constraint), so it
 * stays where it was added.
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    let validate: (d: unknown) => unknown = (d) => d;
    const b = {
      middleware: () => b,
      validator: (v: (d: unknown) => unknown) => {
        validate = v;
        return b;
      },
      handler:
        (h: (a: { data: unknown; context: unknown }) => unknown) =>
        (arg: { data: unknown; context: unknown }) =>
          h({ data: validate(arg.data), context: arg.context }),
    };
    return b;
  },
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));
const current: Row[] = [];
vi.mock("@/lib/service-materials.server", () => ({
  loadServiceMaterials: vi.fn(async () => current.map((m) => ({ ...m }))),
  loadServiceMaterialLinks: vi.fn(async () => []),
}));

import { newMaterialSort, saveServiceMaterials } from "@/lib/service-materials.functions";

type Row = Record<string, unknown>;

describe("newMaterialSort (pure)", () => {
  it("goes above the first row: min − 1, negative allowed", () => {
    expect(newMaterialSort([{ sort: 0 }, { sort: 1 }, { sort: 132 }])).toBe(-1);
    expect(newMaterialSort([{ sort: 5 }, { sort: 9 }])).toBe(4);
    expect(newMaterialSort([{ sort: -3 }, { sort: 0 }])).toBe(-4);
  });
  it("several added at once keep their order: the first takes min − n", () => {
    expect(newMaterialSort([{ sort: 0 }, { sort: 1 }], 3)).toBe(-3);
  });
  it("an empty list starts at 0", () => {
    expect(newMaterialSort([])).toBe(0);
    expect(newMaterialSort([], 4)).toBe(0);
  });
});

describe("saveServiceMaterials", () => {
  const inserts: Row[] = [];
  const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const A = "11111111-1111-4111-8111-111111111111";
  const B = "22222222-2222-4222-8222-222222222222";
  const sb = {
    from: (table: string) => {
      const b = {
        select: () => b,
        limit: async () => ({ data: [], error: null }),
        eq: () => b,
        maybeSingle: async () =>
          table === "profiles"
            ? { data: { id: ME, role: "manager", access: [], technician: false }, error: null }
            : { data: null, error: null },
        update: () => ({ eq: async () => ({ error: null }) }),
        insert: async (p: Row) => {
          inserts.push(p);
          return { error: null };
        },
      };
      return b;
    },
  };
  beforeEach(() => {
    inserts.length = 0;
    current.length = 0;
    current.push(
      { id: A, name: "Acetone", unit: "Gallon", cost: 10, active: true, sort: 0 },
      { id: B, name: "Bonding Adhesive", unit: "Pail", cost: 120, active: true, sort: 1 },
    );
  });
  it("new materials are inserted above the first row, in the order the screen shows them", async () => {
    await (saveServiceMaterials as unknown as (a: { data: unknown; context: unknown }) => unknown)({
      data: {
        items: [
          { name: "Zinc Strip", unit: "Each", cost: 4, active: true },
          { name: "Tape", unit: "Roll", cost: 9, active: true },
          { id: A, name: "Acetone", unit: "Gallon", cost: 10, active: true },
          { id: B, name: "Bonding Adhesive", unit: "Pail", cost: 120, active: true },
        ],
      },
      context: { supabase: sb, userId: ME },
    });
    // The screen shows Zinc Strip above Tape above Acetone (0): −2, −1, 0.
    expect(inserts.map((r) => [r["name"], r["sort"]])).toEqual([
      ["Zinc Strip", -2],
      ["Tape", -1],
    ]);
  });
});

describe("wired in", () => {
  it("the screen adds at the top; the migration's sort column has no check constraint", () => {
    const tab = readFileSync("src/components/service/material-pricing-settings.tsx", "utf8");
    expect(tab).toMatch(/setRows\(\(rs\) => \[\s*\{[\s\S]*?\},\s*\.\.\.\(rs \?\? \[\]\),\s*\]\)/);
    const sql = readFileSync("supabase/migrations/20261006130000_service_materials.sql", "utf8");
    expect(sql).toMatch(/^\s*sort integer not null default 0,\s*$/m);
  });
});
