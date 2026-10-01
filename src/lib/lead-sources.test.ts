import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  LEAD_SOURCE_SEED,
  cleanLeadSourceName,
  filterLeadSources,
  findLeadSource,
  leadSourceInUseMessage,
  leadSourceSeedTuple,
  leadSourceToAdd,
  nextLeadSourceSort,
} from "./lead-sources";
import { leadSourceSchema } from "./lead-sources.functions";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const MIGRATION = read(
  "../../supabase/migrations/20261001020000_opportunity_site_lead_sources.sql",
);

const LIST = LEAD_SOURCE_SEED.map(([name, sort], i) => ({ id: `id${i}`, name, sort }));
const names = (rows: { name: string }[]) => rows.map((r) => r.name);

describe("the starting list", () => {
  it("is the owner's six, in order", () => {
    expect(LEAD_SOURCE_SEED).toEqual([
      ["Referral", 10],
      ["Website", 20],
      ["Cold call", 30],
      ["Storm", 40],
      ["Bid board", 50],
      ["Existing customer", 60],
    ]);
  });

  it("the migration seeds exactly that list, idempotently", () => {
    for (const [name, sort] of LEAD_SOURCE_SEED)
      expect(MIGRATION).toContain(leadSourceSeedTuple(name, sort));
    expect(leadSourceSeedTuple("Bid board", 50)).toBe("('Bid board', 50)");
    expect(MIGRATION).toMatch(/insert into public\.lead_sources \(name, sort\)/);
    expect(MIGRATION).toContain("on conflict (name) do nothing");
  });

  it("the migration: the table, RLS, the count, the site column", () => {
    expect(MIGRATION).toContain("create table if not exists public.lead_sources");
    expect(MIGRATION).toMatch(/name text not null unique/);
    expect(MIGRATION).toMatch(/sort integer not null default 0/);
    expect(MIGRATION).toMatch(/for select to authenticated\s+using \(true\)/);
    expect(MIGRATION).toContain("public.is_admin() or public.has_access('pricing')");
    expect(MIGRATION).toMatch(
      /for insert to authenticated\s+with check \(public\.has_access\('customers'\)\)/,
    );
    expect(MIGRATION).toMatch(
      /create or replace function public\.lead_source_use_count\(p_name text\)\s+returns integer language sql stable security definer/,
    );
    expect(MIGRATION).toMatch(
      /add column if not exists site_id uuid references public\.crm_sites\(id\) on delete set null/,
    );
    expect(MIGRATION).toContain(
      "create index if not exists crm_opportunities_site_idx on public.crm_opportunities (site_id)",
    );
    // No foreign key from the opportunity's text to the list.
    expect(MIGRATION).not.toMatch(/lead_source\w* uuid references/);
  });

  it("types.ts knows the table, the column and the functions", () => {
    const types = read("../integrations/supabase/types.ts");
    expect(types).toMatch(/lead_sources: \{\s*Row: \{/);
    expect(types).toContain('foreignKeyName: "crm_opportunities_site_id_fkey"');
    expect(types).toContain("lead_source_use_count: { Args: { p_name: string }; Returns: number }");
    expect(types).toContain(
      "rename_lead_source: { Args: { p_id: string; p_name: string }; Returns: number }",
    );
  });
});

describe("filterLeadSources", () => {
  it("empty = every row, in list order", () => {
    expect(names(filterLeadSources([...LIST].reverse(), " "))).toEqual(
      LEAD_SOURCE_SEED.map(([n]) => n),
    );
  });
  it("each word typed starts a word of the name, any case", () => {
    expect(names(filterLeadSources(LIST, "call"))).toEqual(["Cold call"]);
    expect(names(filterLeadSources(LIST, "ex cu"))).toEqual(["Existing customer"]);
    expect(names(filterLeadSources(LIST, "B"))).toEqual(["Bid board"]);
    expect(names(filterLeadSources(LIST, "WEB"))).toEqual(["Website"]);
    expect(filterLeadSources(LIST, "site")).toEqual([]);
    expect(filterLeadSources(LIST, "door")).toEqual([]);
  });
});

describe("type-to-add", () => {
  it("offers the typed name, cleaned, when it is not on the list", () => {
    expect(leadSourceToAdd(LIST, "  Door   hanger ")).toBe("Door hanger");
    expect(leadSourceToAdd(LIST, "referral")).toBeNull();
    expect(leadSourceToAdd(LIST, "   ")).toBeNull();
    expect(findLeadSource(LIST, "cold CALL")?.name).toBe("Cold call");
    expect(cleanLeadSourceName(" a  b ")).toBe("a b");
  });
  it("a new one goes last", () => {
    expect(nextLeadSourceSort(LIST)).toBe(70);
    expect(nextLeadSourceSort([])).toBe(10);
  });
  it("the server input trims and needs a name", () => {
    expect(leadSourceSchema.parse({ name: "  Door  hanger " })).toEqual({ name: "Door hanger" });
    expect(() => leadSourceSchema.parse({ name: "   " })).toThrow();
    expect(() => leadSourceSchema.parse({ name: "x".repeat(121) })).toThrow();
  });
  it("adding needs the access that saves an opportunity", () => {
    const fns = read("./lead-sources.functions.ts");
    expect(fns).toContain('!canAccess(p, "customers") && !canAccess(p, "pricing")');
    expect(fns).toContain("Forbidden: Customers access required");
  });
});

describe("delete refuses a name in use", () => {
  it("with the count", () => {
    expect(leadSourceInUseMessage(0)).toBeNull();
    expect(leadSourceInUseMessage(1)).toBe(
      "In use on 1 opportunity — change those first, or rename it",
    );
    expect(leadSourceInUseMessage(4)).toBe(
      "In use on 4 opportunities — change those first, or rename it",
    );
    const fns = read("./lead-sources.functions.ts");
    expect(fns).toContain('sb.rpc("lead_source_use_count"');
  });
});

describe("where the list shows", () => {
  it("Settings › General has a Lead sources tab; the opportunity picks from it", () => {
    const settings = read("../routes/admin.settings.tsx");
    expect(settings).toContain('<TabsTrigger value="leadsources">Lead sources</TabsTrigger>');
    expect(settings).toContain("<LeadSourcesSettings />");
    const page = read("../components/opportunities-page.tsx");
    expect(page).toContain("<LeadSourcePicker");
    expect(page).not.toContain('placeholder="e.g. Referral, website, cold call"');
    const picker = read("../components/crm/lead-source-picker.tsx");
    expect(picker).toContain("{`Add '${r.name}'`}");
  });
});
