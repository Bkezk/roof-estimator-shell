/**
 * Roof-type chips in the repair picker (owner, Oct 6: "the repair tags … please fix"). The
 * library (20261006120000_repair_library.sql) loaded every CenterPoint repair with its roof-type
 * tags, and nothing read them: the close-out picker showed one long list. Now a chip row — All
 * plus General, BUR, Modified, Single Ply, Duro-Last, Sheet Metal — filters the list on the
 * server (listRepairTemplates' `tag`, `.contains("tags", [tag])` on both the manager's table
 * branch and the technician's catalog branch, so the top-N / search limit applies after the
 * filter), the last chip is remembered per phone, and the price-free view carries `tags`
 * (20261006220000_repair_catalog_tags.sql) so a technician's read never touches the table.
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

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
vi.mock("@/lib/ticket-events.server", () => ({ afterTicketStage: vi.fn(async () => {}) }));
vi.mock("@/lib/followups.server", () => ({ syncFollowup: vi.fn(async () => {}) }));

import {
  REPAIR_TAGS,
  REPAIR_TAG_KEY,
  REPAIR_TAG_VALUES,
  isRepairTag,
  repairMatchesTag,
  repairTagLabel,
} from "@/lib/repair-tags";
import { catalogTemplate } from "@/lib/ticket-money";
import { listRepairTemplates } from "@/lib/service-field.functions";

const read = (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : "");
const flat = (s: string) => s.replace(/--[^\n]*/g, "").replace(/\s+/g, " ");
function serverFn(src: string, name: string): string {
  const start = src.indexOf(`export const ${name} = createServerFn`);
  expect(start, `${name} not found`).toBeGreaterThanOrEqual(0);
  const next = src.indexOf("\nexport ", start + 1);
  return src.slice(start, next < 0 ? undefined : next);
}

// ---------------------------------------------------------------------------------------------

describe("the chips (repair-tags.ts)", () => {
  it("six roof types in display order, the stored 'Sheetmetal' shown as 'Sheet Metal'", () => {
    expect(REPAIR_TAGS.map((t) => t.value)).toEqual([
      "General",
      "BUR",
      "Modified",
      "Single Ply",
      "Duro-Last",
      "Sheetmetal",
    ]);
    expect(REPAIR_TAGS.map((t) => t.label)).toEqual([
      "General",
      "BUR",
      "Modified",
      "Single Ply",
      "Duro-Last",
      "Sheet Metal",
    ]);
    expect(REPAIR_TAG_VALUES).toEqual(REPAIR_TAGS.map((t) => t.value));
    expect(repairTagLabel("Sheetmetal")).toBe("Sheet Metal");
    expect(repairTagLabel("Duro-Last")).toBe("Duro-Last");
    // A tag the chips do not offer (CenterPoint also has TPO, EPDM, Tile …) keeps its own name.
    expect(repairTagLabel("TPO")).toBe("TPO");
  });
  it("the stored values are what the seed migration wrote", () => {
    const seed = read("supabase/migrations/20261006120000_repair_library.sql");
    for (const v of REPAIR_TAG_VALUES) expect(seed).toContain(`'${v}'`);
    expect(seed).not.toContain("'Sheet Metal'");
  });
  it("isRepairTag: only the six stored values (what localStorage may hand back)", () => {
    expect(isRepairTag("BUR")).toBe(true);
    expect(isRepairTag("Sheetmetal")).toBe(true);
    expect(isRepairTag("Sheet Metal")).toBe(false);
    expect(isRepairTag("")).toBe(false);
    expect(isRepairTag(null)).toBe(false);
    expect(isRepairTag(42)).toBe(false);
  });
  it("repairMatchesTag: All shows everything; a chip shows its repairs; untagged shows everywhere", () => {
    const ac = ["General", "BUR", "Sheetmetal", "Modified", "Single Ply", "Duro-Last"];
    expect(repairMatchesTag(ac, null)).toBe(true);
    expect(repairMatchesTag(ac, "Duro-Last")).toBe(true);
    expect(repairMatchesTag(["General", "BUR", "Modified"], "Duro-Last")).toBe(false);
    expect(repairMatchesTag(["Tile"], "General")).toBe(false);
    // The 6 untagged repairs (e.g. Brick Mason Work) are offered under every chip.
    expect(repairMatchesTag([], "BUR")).toBe(true);
    expect(repairMatchesTag(null, "BUR")).toBe(true);
    expect(repairMatchesTag(undefined, "Single Ply")).toBe(true);
  });
  it("the remembered chip lives under the app's localStorage prefix", () => {
    expect(REPAIR_TAG_KEY).toBe("bid-o-matic:repair-tag");
  });
});

// ---------------------------------------------------------------------------------------------

describe("migration 20261006220000_repair_catalog_tags.sql", () => {
  const PATH = "supabase/migrations/20261006220000_repair_catalog_tags.sql";
  const sql = read(PATH);
  const f = flat(sql);
  it("exists", () => {
    expect(existsSync(PATH)).toBe(true);
  });
  it("re-creates repair_templates_catalog as 20261002160000 had it, plus tags (appended: or-replace may only add at the end), still without unit_price", () => {
    expect(f).toContain(
      "create or replace view public.repair_templates_catalog with (security_invoker = false, security_barrier = true) as select t.id, t.name, t.category, t.unit, t.description, t.work_completed, t.favorite, t.usage_count, t.active, t.centerpoint_template_id, t.created_at, t.updated_at, t.tags from public.repair_templates t where public.has_access('service') or public.has_access('customers') or public.has_access('estimate');",
    );
    const at = f.indexOf("create or replace view public.repair_templates_catalog");
    const view = f.slice(at, f.indexOf(";", at));
    expect(view).not.toMatch(/price|rate|cost|\*/);
    // The view is not dropped (its grants and dependents stay); the column is appended.
    expect(f).not.toMatch(/drop view/);
  });
  it("re-states the view's grants: select for authenticated, nothing else", () => {
    expect(f).toContain(
      "revoke all on public.repair_templates_catalog from public, anon, authenticated;",
    );
    expect(f).toContain("grant select on public.repair_templates_catalog to authenticated;");
    expect(f).not.toMatch(/grant (all|insert|update|delete)[^;]*repair_templates_catalog/);
  });
  it("touches no policy and no other relation", () => {
    expect(f).not.toContain("create policy");
    expect(f).not.toContain("service_job_crew");
    expect(f).not.toMatch(/alter table/);
  });
});

describe("generated types", () => {
  const types = read("src/integrations/supabase/types.ts");
  const views = types.slice(types.indexOf("    Views: {"), types.indexOf("    Functions: {"));
  it("repair_templates_catalog Row has tags, still no unit_price", () => {
    const at = views.indexOf("      repair_templates_catalog: {");
    expect(at).toBeGreaterThanOrEqual(0);
    const cat = views.slice(at, views.indexOf("\n      };", at));
    expect(cat).toMatch(/tags: string\[\]/);
    expect(cat).not.toContain("unit_price");
  });
  it("catalogTemplate carries the tags through (an older view without them: untagged)", () => {
    const row = {
      id: "66666666-6666-4666-8666-666666666666",
      name: "Base Flashing - Slip",
      category: "Base Flashing",
      unit: "LF",
      description: null,
      work_completed: null,
      favorite: false,
      usage_count: 0,
      active: true,
      centerpoint_template_id: null,
      created_at: "2026-10-06T00:00:00Z",
      updated_at: "2026-10-06T00:00:00Z",
      tags: ["General", "BUR", "Modified", "Single Ply", "Spray Foam"],
    };
    expect(catalogTemplate(row).tags).toEqual(row.tags);
    expect(catalogTemplate(row).unit_price).toBeNull();
    expect(catalogTemplate({ ...row, tags: null } as never).tags).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------

type Row = Record<string, unknown>;
type Filter = { table: string; op: string; column: string; value: unknown };
/**
 * A PostgREST stand-in that records every filter (eq, ilike, contains) with its table, so the
 * test sees on which branch — table or view — the tag filter ran, and how.
 */
function fakeDb(tables: Record<string, Row[]>) {
  const filters: Filter[] = [];
  const reads: string[] = [];
  const from = (table: string) => {
    reads.push(table);
    const preds: ((r: Row) => boolean)[] = [];
    let limit: number | null = null;
    const run = () => {
      const hit = (tables[table] ?? []).filter((r) => preds.every((p) => p(r)));
      return {
        data: (limit == null ? hit : hit.slice(0, limit)).map((r) => ({ ...r })),
        error: null,
      };
    };
    const q = {
      select: () => q,
      eq: (column: string, value: unknown) => {
        filters.push({ table, op: "eq", column, value });
        preds.push((r) => r[column] === value);
        return q;
      },
      ilike: (column: string, value: unknown) => {
        filters.push({ table, op: "ilike", column, value });
        return q;
      },
      contains: (column: string, value: unknown[]) => {
        filters.push({ table, op: "contains", column, value });
        preds.push((r) => {
          const have = r[column];
          return Array.isArray(have) && value.every((v) => have.includes(v));
        });
        return q;
      },
      order: () => q,
      limit: (n: number) => ((limit = n), q),
      maybeSingle: async () => ({ data: run().data[0] ?? null, error: null }),
      then: (res: (r: unknown) => unknown, rej?: (e: unknown) => unknown) =>
        Promise.resolve(run()).then(res, rej),
    };
    return q;
  };
  return { from, filters, reads };
}
const call = <T>(fn: unknown, data: unknown, supabase: unknown, userId: string): Promise<T> =>
  (fn as (a: { data: unknown; context: unknown }) => Promise<T>)({
    data,
    context: { supabase, userId },
  });

const TECH = "22222222-2222-4222-8222-222222222222";
const MANAGER = "55555555-5555-4555-8555-555555555555";
const profiles: Row[] = [
  {
    id: TECH,
    role: "user",
    access: ["service"],
    technician: true,
    full_name: "Tech",
    email: "t@x",
  },
  { id: MANAGER, role: "manager", access: [], technician: false, full_name: "M", email: "m@x" },
];
const tpl = (id: string, name: string, tags: string[], unit_price: number | null = 25): Row => ({
  id,
  name,
  category: null,
  unit: "LF",
  description: null,
  work_completed: null,
  unit_price,
  favorite: false,
  usage_count: 0,
  active: true,
  centerpoint_template_id: null,
  created_at: "2026-10-06T00:00:00Z",
  updated_at: "2026-10-06T00:00:00Z",
  tags,
});
const library = (): Row[] => [
  tpl("a", "Base Flashing - Racking", ["General", "BUR", "Modified"]),
  tpl("b", "Batten Strip", ["Sheetmetal", "Single Ply"]),
  tpl("c", "Brick Mason Work", []),
];
const catalog = (): Row[] =>
  library().map((r) => {
    const { unit_price: _drop, ...rest } = r;
    return rest;
  });

describe("listRepairTemplates filters by tag on the server, on both branches", () => {
  const src = read("src/lib/service-field.functions.ts");
  const fn = serverFn(src, "listRepairTemplates");

  it('accepts tag (the stored values only) and applies .contains("tags", [tag]) before the limit', () => {
    expect(fn).toContain("tag: z.enum(REPAIR_TAG_VALUES).optional()");
    expect(fn.match(/\.contains\("tags", \[data\.tag\]\)/g)).toHaveLength(2);
    // Once on the manager's table branch, once on the catalog branch.
    const table = fn.indexOf('.from("repair_templates")');
    const view = fn.indexOf('.from("repair_templates_catalog")');
    const hits = [...fn.matchAll(/\.contains\("tags", \[data\.tag\]\)/g)].map((m) => m.index);
    expect(hits.filter((i) => i > table && i < view)).toHaveLength(1);
    expect(hits.filter((i) => i > view)).toHaveLength(1);
  });

  it("a technician: the catalog view, filtered by the tag (the view carries tags; the table is never read)", async () => {
    const db = fakeDb({
      profiles,
      repair_templates: library(),
      repair_templates_catalog: catalog(),
    });
    const rows = await call<Row[]>(listRepairTemplates, { tag: "Sheetmetal" }, db, TECH);
    expect(db.reads).toEqual(["profiles", "repair_templates_catalog"]);
    expect(db.filters.filter((f) => f.op === "contains")).toEqual([
      { table: "repair_templates_catalog", op: "contains", column: "tags", value: ["Sheetmetal"] },
    ]);
    expect(rows.map((r) => r["name"])).toEqual(["Batten Strip"]);
    expect(rows.every((r) => r["unit_price"] === null)).toBe(true);
    expect(rows[0]!["tags"]).toEqual(["Sheetmetal", "Single Ply"]);
  });

  it("a manager: the table, filtered by the tag, prices kept", async () => {
    const db = fakeDb({
      profiles,
      repair_templates: library(),
      repair_templates_catalog: catalog(),
    });
    const rows = await call<Row[]>(listRepairTemplates, { tag: "BUR", q: "Rack" }, db, MANAGER);
    expect(db.reads).toEqual(["profiles", "repair_templates"]);
    expect(db.filters.filter((f) => f.op === "contains")).toEqual([
      { table: "repair_templates", op: "contains", column: "tags", value: ["BUR"] },
    ]);
    expect(db.filters.some((f) => f.op === "ilike" && f.column === "name")).toBe(true);
    expect(rows.map((r) => r["name"])).toEqual(["Base Flashing - Racking"]);
    expect(rows[0]!["unit_price"]).toBe(25);
  });

  it("no tag (All): no contains filter, as before", async () => {
    const db = fakeDb({
      profiles,
      repair_templates: library(),
      repair_templates_catalog: catalog(),
    });
    const rows = await call<Row[]>(listRepairTemplates, {}, db, TECH);
    expect(db.filters.filter((f) => f.op === "contains")).toEqual([]);
    expect(rows).toHaveLength(3);
  });

  it("refuses a tag the chips do not offer (a label, or a stray value)", async () => {
    const db = fakeDb({
      profiles,
      repair_templates: library(),
      repair_templates_catalog: catalog(),
    });
    // The stand-in validates synchronously (as the real validator does before the handler).
    const attempt = (tag: string) =>
      Promise.resolve().then(() => call(listRepairTemplates, { tag }, db, TECH));
    await expect(attempt("Sheet Metal")).rejects.toThrow(/tag/);
    await expect(attempt("TPO")).rejects.toThrow(/tag/);
    expect(db.reads).toEqual([]);
  });
});

describe("the close-out picker", () => {
  const src = read("src/components/service/closeout.tsx");
  it("shows the chip row, refetches with the chip, remembers it, and hides recent chips outside the tag", () => {
    expect(src).toContain("REPAIR_TAGS");
    expect(src).toMatch(/templatesFn\(\{ data: \{ limit: 24, tag: tag \?\? undefined \} \}\)/);
    expect(src).toMatch(/templatesFn\(\{ data: \{ q, limit: 30, tag: tag \?\? undefined \} \}\)/);
    expect(src).toMatch(/queryKey: \["repair-templates", "top", tag\]/);
    expect(src).toMatch(/queryKey: \["repair-templates", "q", q, tag\]/);
    expect(src).toContain("readRepairTag()");
    expect(src).toContain("writeRepairTag(");
    expect(src).toMatch(
      /recentRows = \(recent\.data \?\? \[\]\)\.filter\(\(t\) => repairMatchesTag\(t\.tags, tag\)\)/,
    );
  });
});
