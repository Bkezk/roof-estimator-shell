/**
 * Owner, Oct 9: "i just made a ticket with the site 2 property and the drive time wasnt auto
 * added to the close out." company_settings' main address is the invoice header's
 * "PO Box 466, Corbin, KY 40702": no house number, so the close-out's travel estimate never
 * geocoded the office and was null for every ticket. The fix keeps the PO box (the invoice prints
 * it) and adds the shop's street — where the trucks leave from — as four columns, a group on
 * Settings › General › Contractor Information, and travel-estimate.ts travelOrigin picks the
 * origin. The arithmetic and the server function are covered in travel-estimate.test.ts; here:
 * the migration, the save path, the settings page and the generated types.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { parseStreetAddress } from "@/lib/aerial-address";

const read = (p: string) => readFileSync(p, "utf8");

describe("why: the live main address has no street to geocode", () => {
  it("'PO Box 466, Corbin, KY 40702' parses to null; the site's street parses", () => {
    expect(parseStreetAddress("PO Box 466, Corbin, KY 40702")).toBeNull();
    expect(parseStreetAddress("251 Marengo Drive, Richmond, KY 40475")).toMatchObject({
      house: "251",
      street: "MARENGO DR",
    });
  });
});

describe("the migration: company_settings.shop_address / shop_city / shop_state / shop_zip", () => {
  const sql = read("supabase/migrations/20261009160000_shop_address.sql");
  it("adds the four text columns, replayable, nullable", () => {
    for (const col of ["shop_address", "shop_city", "shop_state", "shop_zip"]) {
      expect(sql).toContain(
        `alter table public.company_settings add column if not exists ${col} text;`,
      );
      expect(sql).toMatch(
        new RegExp(
          `comment on column public\\.company_settings\\.${col} is\\s*'Where the trucks leave from: the street address the close-out''s drive-time estimate starts at; the main address may be a PO box \\(owner, Oct 9\\)';`,
        ),
      );
    }
    expect(sql).not.toMatch(/not null/i);
    expect(sql).not.toMatch(/^\s*(create|drop) policy/im);
    expect(sql).not.toMatch(/^\s*grant /im);
  });
  it("the save path it rides on is the one from 20260831225744: policy company_settings_write (is_admin()), the same for every column", () => {
    const base = read("supabase/migrations/20260831225744_admin_general.sql");
    expect(base).toContain(
      "execute format('create policy %I on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin());', t||'_write', t);",
    );
    expect(base).toMatch(/'company_settings','shipping_steps','markup_options'/);
    expect(sql).toContain("company_settings_write");
  });
});

describe("the save path: admin-settings.functions.ts saveCompanySettings upserts the row, shop columns included", () => {
  const fns = read("src/lib/admin-settings.functions.ts");
  it("the zod schema takes the four shop columns (optional, nullable) and the upsert writes the whole row as id 1", () => {
    for (const col of ["shop_address", "shop_city", "shop_state", "shop_zip"])
      expect(fns).toContain(`${col}: z.string().nullable().optional(),`);
    expect(fns).toMatch(
      /saveCompanySettings = createServerFn\(\{ method: "POST" \}\)\s*\.middleware\(\[requireSupabaseAuth\]\)\s*\.validator\(\(d\) => companySchema\.parse\(d\)\)\s*\.handler\(async \(\{ data, context \}\) => \{\s*await assertAdmin\(context\.supabase, context\.userId\);/,
    );
    // The whole row as id 1; a shop column the sender left out is not written (an older bundle).
    expect(fns).toMatch(/const row = \{\s*id: 1,\s*\.\.\.rest,/);
    for (const col of ["shop_address", "shop_city", "shop_state", "shop_zip"])
      expect(fns).toContain(`...(${col} !== undefined ? { ${col} } : {}),`);
    expect(fns).toContain('await context.supabase.from("company_settings").upsert(row);');
    // The read is select("*"): the new columns come back to the page with the rest.
    expect(fns).toContain('sb.from("company_settings").select("*").eq("id", 1).maybeSingle()');
  });
  it("the generated types carry the columns on Row, Insert and Update", () => {
    const types = read("src/integrations/supabase/types.ts");
    const block = types.slice(
      types.indexOf("      company_settings: {"),
      types.indexOf("      county_codes: {"),
    );
    for (const col of ["shop_address", "shop_city", "shop_state", "shop_zip"]) {
      expect(block).toContain(`          ${col}: string | null;`);
      expect(block.match(new RegExp(`          ${col}\\?: string \\| null;`, "g"))).toHaveLength(2);
    }
  });
});

describe("Settings › General › Contractor Information: the 'Drive time starts from' group", () => {
  const page = read("src/routes/admin.settings.tsx");
  const contractor = page.slice(
    page.indexOf("function ContractorTab("),
    page.indexOf("function SalesTaxTab("),
  );
  it("a group under the main address with Street / City / State / Zip boxes and the helper text", () => {
    expect(contractor).toContain("Drive time starts from");
    expect(contractor).toMatch(
      /The close-out's travel estimate starts here\. A PO box cannot be used — give the\s+street the trucks leave from\. Leave blank when the main address above is already a\s+street\./,
    );
    for (const [label, col] of [
      ["Street", "shop_address"],
      ["City", "shop_city"],
      ["State", "shop_state"],
      ["Zip", "shop_zip"],
    ] as const) {
      expect(contractor).toMatch(
        new RegExp(
          `<Field label="${label}">\\s*<Input\\s*value=\\{c\\.${col} \\?\\? ""\\}\\s*onChange=\\{\\(e\\) => set\\("${col}", e\\.target\\.value\\)\\}\\s*/>`,
        ),
      );
    }
    // Under the main address (the ZIP box), before the Master / Elite switch.
    const zip = contractor.indexOf('onChange={(e) => set("zip", e.target.value)}');
    const group = contractor.indexOf("Drive time starts from");
    const elite = contractor.indexOf('id="master_elite"');
    expect(zip).toBeGreaterThan(-1);
    expect(group).toBeGreaterThan(zip);
    expect(elite).toBeGreaterThan(group);
  });
  it("the amber line when the SAVED main address is a PO box (parseStreetAddress === null) and no shop street is saved", () => {
    expect(page).toContain('import { parseStreetAddress } from "@/lib/aerial-address";');
    expect(page).toMatch(
      /function driveTimeOff\(saved: CompanySettings \| null\): boolean \{\s*if \(!saved\) return false;\s*const main = officeAddressLine\(saved\);\s*return !!main && parseStreetAddress\(main\) === null && !\(saved\.shop_address \?\? ""\)\.trim\(\);\s*\}/,
    );
    expect(contractor).toMatch(
      /\{driveTimeOff\(initial\) && \(\s*<p className="text-xs text-amber-700 dark:text-amber-400">\s*Drive time is off: the main address is a PO box and no street is set here\.\s*<\/p>\s*\)\}/,
    );
  });
  it("saved with the rest of the form: both company saves send the four columns; the blank row has them", () => {
    const sends = page.match(/shop_address: (c|company)\.shop_address,/g) ?? [];
    expect(sends).toHaveLength(2);
    for (const col of ["shop_city", "shop_state", "shop_zip"]) {
      expect(page).toContain(`${col}: c.${col},`);
      expect(page).toContain(`${col}: company.${col},`);
    }
    expect(page).toMatch(
      /shop_address: "",\s*shop_city: "",\s*shop_state: "",\s*shop_zip: "",\s*updated_at: new Date\(\)\.toISOString\(\),/,
    );
  });
});
