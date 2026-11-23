/**
 * The public Roof Care page can work out a price (Nov 23, 2026).
 *
 * The owner pressed Show my price on https://jbkbid.com/care: "That did not go through". The
 * drive from the office to the visitor's building starts with two map lookups in the database,
 * and both let a caller through only when a signed-in person had Service, Customers, Prospecting
 * or Estimate access. On the public page nobody is signed in: the site's own server asks. Both
 * refused it, so no visitor ever got a price.
 */
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const DIR = "supabase/migrations/";
const flat = (s: string) => s.replace(/\s+/g, " ");

/** The newest definition of a function, as the migrations leave it. */
function newest(name: string): string {
  const found = readdirSync(DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((file) => {
      const m = readFileSync(DIR + file, "utf8").match(
        new RegExp(
          `create or replace function public\\.${name}\\([\\s\\S]*?as \\$(\\w*)\\$([\\s\\S]*?)\\$\\1\\$;`,
          "i",
        ),
      );
      return m ? m[2]! : null;
    })
    .filter((x): x is string => x !== null);
  return flat(found[found.length - 1] ?? "");
}

describe("the two map lookups answer the site's own server", () => {
  for (const fn of ["service_aerial_address_candidates", "service_aerial_buildings_near"]) {
    it(`${fn}: the server, or a signed-in person with one of the four kinds of access`, () => {
      const body = newest(fn);
      expect(body).toContain(
        "if coalesce(auth.role(), '') <> 'service_role' and not (public.has_access('service') or public.has_access('customers') or public.has_access('prospect') or public.has_access('estimate')) then raise exception 'Forbidden: Service access required';",
      );
    });
  }

  it("the public quote still finds its addresses through those lookups", () => {
    const aerial = readFileSync("src/lib/service-aerial.functions.ts", "utf8");
    expect(aerial).toContain('sb.rpc("service_aerial_address_candidates"');
    const forms = flat(readFileSync("src/lib/public-forms.functions.ts", "utf8"));
    expect(forms).toContain(
      "drive: async (admin, a) => care.driveTo(admin, await care.officeOrigin(admin), a),",
    );
  });
});
