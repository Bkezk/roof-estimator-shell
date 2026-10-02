import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  COUNTY_CODE_SEED,
  countyCodeLabel,
  countyCodeSeedRows,
  countyCodeSeedTuple,
  filterCountyCodes,
  titleCaseCounty,
  type CountyCodeRow,
} from "@/lib/county-codes";
import { countyCodeInUseMessage, countyCodeSchema } from "@/lib/county-codes.functions";
import { siteSchema } from "@/lib/crm.functions";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const MIGRATION = read("../../supabase/migrations/20261001010000_county_codes.sql");

const LIST: CountyCodeRow[] = countyCodeSeedRows().map((r, i) => ({ id: `id-${i}`, ...r }));
const labels = (rows: CountyCodeRow[]) => rows.map(countyCodeLabel);

describe("titleCaseCounty", () => {
  it("keeps the owner's spelling, Title Case, Mc names", () => {
    expect(titleCaseCounty("McMINN")).toBe("McMinn");
    expect(titleCaseCounty("McCREARY")).toBe("McCreary");
    expect(titleCaseCounty("Larue")).toBe("Larue");
    expect(titleCaseCounty("ROCKCASTLE")).toBe("Rockcastle");
    expect(titleCaseCounty("Rutherford")).toBe("Rutherford");
    expect(titleCaseCounty("  PUTMAN ")).toBe("Putman");
  });
});

describe("countyCodeLabel", () => {
  it("reads code · County, ST", () => {
    expect(countyCodeLabel({ code: "0022", county: "Anderson", state: "TN" })).toBe(
      "0022 · Anderson, TN",
    );
  });
});

describe("the owner's list", () => {
  it("has every row as given: 43 TN, 90 KY, 0108 in both states, spelling kept", () => {
    const rows = countyCodeSeedRows();
    expect(rows).toHaveLength(133);
    expect(COUNTY_CODE_SEED).toHaveLength(133);
    expect(rows.filter((r) => r.state === "TN")).toHaveLength(43);
    expect(rows.filter((r) => r.state === "KY")).toHaveLength(90);
    expect(rows.filter((r) => r.code === "0108").map(countyCodeLabel)).toEqual([
      "0108 · Putman, TN",
      "0108 · Kenton, KY",
    ]);
    expect(rows.filter((r) => r.code === "0106").map(countyCodeLabel)).toEqual([
      "0106 · Cumberland, TN",
    ]);
    const names = rows.map((r) => `${r.county} ${r.state}`);
    for (const n of [
      "Putman TN",
      "Penleton KY",
      "Elliot KY",
      "McMinn TN",
      "McCreary KY",
      "Larue KY",
      "Rutherford TN",
      "Simpson KY",
      "Putnam KY",
    ])
      expect(names).toContain(n);
    // Every code is four digits, every county trimmed.
    for (const r of rows) {
      expect(r.code).toMatch(/^\d{4}$/);
      expect(r.county).toBe(r.county.trim());
    }
  });

  it("the migration seeds exactly that list", () => {
    for (const r of countyCodeSeedRows()) expect(MIGRATION).toContain(countyCodeSeedTuple(r));
    const tuples = MIGRATION.match(/^\s*\('\d{4}', '[^']+', '(KY|TN)'\),?$/gm) ?? [];
    expect(tuples).toHaveLength(133);
    expect(countyCodeSeedTuple({ code: "0046", county: "McMinn", state: "TN" })).toBe(
      "('0046', 'McMinn', 'TN')",
    );
  });

  it("the migration: uuid key, code not unique, RLS read for all, write for admin / Pricing", () => {
    expect(MIGRATION).toContain("create table if not exists public.county_codes");
    expect(MIGRATION).toMatch(/id uuid primary key default gen_random_uuid\(\)/);
    expect(MIGRATION).not.toMatch(/code text[^,\n]*primary key/);
    expect(MIGRATION).not.toMatch(/unique[^\n]*\(code\)/i);
    expect(MIGRATION).toMatch(/check \(state in \('KY', 'TN'\)\)/);
    expect(MIGRATION).toMatch(/for select to authenticated\s+using \(true\)/);
    expect(MIGRATION).toContain("public.is_admin() or public.has_access('pricing')");
    expect(MIGRATION).toMatch(
      /add column if not exists county_code_id uuid references public\.county_codes\(id\) on delete set null/,
    );
    expect(MIGRATION).toContain("where not exists (select 1 from public.county_codes c");
  });
});

describe("filterCountyCodes", () => {
  it("empty = every row, state then county", () => {
    const all = filterCountyCodes(LIST, "  ");
    expect(all).toHaveLength(133);
    expect(labels(all.slice(0, 2))).toEqual(["0060 · Adair, KY", "0056 · Anderson, KY"]);
    expect(countyCodeLabel(all[90]!)).toBe("0022 · Anderson, TN");
    expect(countyCodeLabel(all[132]!)).toBe("0042 · Washington, TN");
    expect(LIST[0]!.state).toBe("TN"); // the input order is left alone
  });

  it("prefix on the code", () => {
    expect(labels(filterCountyCodes(LIST, "0022"))).toEqual(["0022 · Anderson, TN"]);
    expect(labels(filterCountyCodes(LIST, "0106"))).toEqual(["0106 · Cumberland, TN"]);
    expect(labels(filterCountyCodes(LIST, "0108"))).toEqual([
      "0108 · Kenton, KY",
      "0108 · Putman, TN",
    ]);
    expect(filterCountyCodes(LIST, "000")).toHaveLength(9);
  });

  it("word prefix on the county, any case; not the middle of a word", () => {
    expect(labels(filterCountyCodes(LIST, "and"))).toEqual([
      "0056 · Anderson, KY",
      "0022 · Anderson, TN",
    ]);
    expect(labels(filterCountyCodes(LIST, "MC"))).toEqual([
      "0069 · McCreary, KY",
      "0046 · McMinn, TN",
    ]);
    expect(filterCountyCodes(LIST, "erson")).toEqual([]);
  });

  it("the state, and several words narrow", () => {
    expect(filterCountyCodes(LIST, "tn")).toHaveLength(43);
    expect(filterCountyCodes(LIST, "KY")).toHaveLength(90);
    expect(labels(filterCountyCodes(LIST, "anderson tn"))).toEqual(["0022 · Anderson, TN"]);
    expect(labels(filterCountyCodes(LIST, "0022 · Anderson, TN"))).toEqual(["0022 · Anderson, TN"]);
    expect(filterCountyCodes(LIST, "zzz")).toEqual([]);
  });
});

describe("county code server input", () => {
  it("a site takes a county code id, null clears it, left out stays out", () => {
    const base = { account_id: "6f1c1d2e-8a4b-4c3d-9e2f-1a2b3c4d5e6f", name: "Main" };
    const id = "0b9a8c7d-6e5f-4a3b-8c2d-1e0f9a8b7c6d";
    expect(siteSchema.parse({ ...base, county_code_id: id }).county_code_id).toBe(id);
    expect(siteSchema.parse({ ...base, county_code_id: null }).county_code_id).toBeNull();
    expect("county_code_id" in siteSchema.parse(base)).toBe(false);
    expect(() => siteSchema.parse({ ...base, county_code_id: "0022" })).toThrow();
  });

  it("a code needs the code, the county and KY or TN", () => {
    expect(countyCodeSchema.parse({ code: " 0135 ", county: " Allen ", state: "KY" })).toEqual({
      code: "0135",
      county: "Allen",
      state: "KY",
    });
    expect(() => countyCodeSchema.parse({ code: "", county: "Allen", state: "KY" })).toThrow();
    expect(() => countyCodeSchema.parse({ code: "0135", county: " ", state: "KY" })).toThrow();
    expect(() => countyCodeSchema.parse({ code: "0135", county: "Allen", state: "OH" })).toThrow();
  });

  it("a code a site uses is not deleted, with the count", () => {
    expect(countyCodeInUseMessage(0)).toBeNull();
    expect(countyCodeInUseMessage(1)).toBe("In use on 1 site — change those sites first");
    expect(countyCodeInUseMessage(3)).toBe("In use on 3 sites — change those sites first");
  });
});

describe("where the county code shows", () => {
  it("the site form picks it, the site card and the ticket show it, Settings edits it", () => {
    const customers = read("../components/customers-page.tsx");
    // The site form moved to its own module (Oct 2), shared with the opportunity's "Add site".
    const siteForm = read("../components/crm/site-form.tsx");
    expect(siteForm).toMatch(/>County code<\/Label>\s*<CountyCodePicker/);
    expect(siteForm).toContain("county_code_id: s?.county_code_id ?? null");
    expect(customers).toContain("<CountyCodeLine id={s.county_code_id}");
    const ticket = read("../components/service-page.tsx");
    expect(ticket).toContain("<CountyCodeLine id={site?.county_code_id}");
    const settings = read("../routes/admin.settings.tsx");
    expect(settings).toContain('<TabsTrigger value="countycodes">County codes</TabsTrigger>');
    expect(settings).toContain("<CountyCodesSettings />");
    const siteSelect = read("../components/crm/site-select.tsx");
    // "0108 Kenton, KY", not the bare code (audit, Oct 2; site-select-county.test.ts).
    expect(siteSelect).toContain(
      "siteOptionLabel(s.name, siteAddressLine(s), codeOf(s.county_code_id))",
    );
  });
});
