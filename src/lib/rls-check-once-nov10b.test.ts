/**
 * Row security checks the person once per query (owner, Nov 10: speed pass findings 1, 2, 10).
 * Roofs & Storms took 20 to 28 seconds because `buildings_read` ran has_access() for each of
 * 270,291 rows. 20261110210000 wraps every person-helper call of every policy in a select.
 * Pinned here: the migration's rule, its TypeScript twin, and that no later migration brings a
 * bare call back.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  RLS_ONCE_AUTH,
  RLS_ONCE_HELPERS,
  RLS_WRAP_SQL_PATTERN,
  bareHelperCalls,
  policyStatements,
  wrapPolicyExpr,
} from "@/lib/rls-check-once";

const DIR = "supabase/migrations";
const FILE = "20261110210000_rls_check_once_per_query.sql";
const read = (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : "");
const sql = read(`${DIR}/${FILE}`);

describe("20261110210000: every policy checks the person once", () => {
  it("exists and rewrites with ALTER POLICY in one block (nothing is dropped)", () => {
    expect(sql).not.toBe("");
    expect(sql).toMatch(/^do \$\$/m);
    expect(sql).toContain("alter policy %I on %I.%I");
    expect(sql).not.toMatch(/drop policy/i);
    expect(sql).toContain("where schemaname = 'public'");
  });
  it("uses the pattern the twin is built from: the seven helpers and auth.uid / auth.role", () => {
    // In the .sql file the pattern sits in a string literal, so its quotes are doubled once more.
    expect(sql).toContain(`'${RLS_WRAP_SQL_PATTERN}'`);
    expect([...RLS_ONCE_HELPERS]).toEqual([
      "has_access",
      "is_admin",
      "is_manager",
      "documents_access",
      "is_technician",
      "is_sales_pm",
      "can_claim",
    ]);
    expect([...RLS_ONCE_AUTH]).toEqual(["uid", "role"]);
    expect(sql).toContain("'( SELECT \\1(\\2))'");
  });
  it("is safe to run again: a call that already follows SELECT is skipped", () => {
    expect(RLS_WRAP_SQL_PATTERN.startsWith("(?<!SELECT )")).toBe(true);
    expect(sql).toContain(
      "if nq is not distinct from p.qual and nc is not distinct from p.with_check then",
    );
  });
});

describe("wrapPolicyExpr (the migration's rule, in TypeScript)", () => {
  it("wraps the buildings policy that cost 8 seconds", () => {
    expect(wrapPolicyExpr("(has_access('prospect'::text) OR has_access('estimate'::text))")).toBe(
      "(( SELECT has_access('prospect'::text)) OR ( SELECT has_access('estimate'::text)))",
    );
  });
  it("wraps is_admin, is_manager, documents_access, is_technician, is_sales_pm, can_claim, auth.uid, auth.role", () => {
    expect(wrapPolicyExpr("(is_admin() OR is_manager())")).toBe(
      "(( SELECT is_admin()) OR ( SELECT is_manager()))",
    );
    expect(wrapPolicyExpr("documents_access()")).toBe("( SELECT documents_access())");
    expect(wrapPolicyExpr("(NOT is_technician())")).toBe("(NOT ( SELECT is_technician()))");
    expect(wrapPolicyExpr("(is_sales_pm() AND can_claim())")).toBe(
      "(( SELECT is_sales_pm()) AND ( SELECT can_claim()))",
    );
    expect(wrapPolicyExpr("(user_id = auth.uid())")).toBe("(user_id = ( SELECT auth.uid()))");
    expect(wrapPolicyExpr("(auth.role() = 'authenticated'::text)")).toBe(
      "(( SELECT auth.role()) = 'authenticated'::text)",
    );
  });
  it("leaves a helper that takes a column alone: that one is a per-row question", () => {
    const perRow =
      "(works_on_ticket(service_job_id) AND ticket_open_for_tech(service_job_id) AND tech_sees_account(id))";
    expect(wrapPolicyExpr(perRow)).toBe(perRow);
    expect(wrapPolicyExpr("(is_on_crew(j.id) OR (j.technician_id = auth.uid()))")).toBe(
      "(is_on_crew(j.id) OR (j.technician_id = ( SELECT auth.uid())))",
    );
  });
  it("does not wrap twice", () => {
    const once = wrapPolicyExpr("(has_access('service'::text) AND (NOT is_technician()))");
    expect(wrapPolicyExpr(once)).toBe(once);
    expect(
      wrapPolicyExpr("(( SELECT is_admin() AS is_admin) OR ( SELECT is_manager() AS is_manager))"),
    ).toBe("(( SELECT is_admin() AS is_admin) OR ( SELECT is_manager() AS is_manager))");
    expect(wrapPolicyExpr("((select public.documents_access()))")).toBe(
      "((select public.documents_access()))",
    );
  });
  it("does not mistake documents_access for has_access, or a longer name for a helper", () => {
    expect(bareHelperCalls("documents_access()")).toEqual(["documents_access()"]);
    expect(bareHelperCalls("my_has_access('x')")).toEqual([]);
    expect(bareHelperCalls("public.has_access('pricing')")).toEqual([
      "public.has_access('pricing')",
    ]);
  });
});

describe("no later migration brings a bare call back", () => {
  const later = readdirSync(DIR)
    .filter((f) => f.endsWith(".sql") && f > FILE)
    .sort();
  it("there are later migrations to check (the four of Nov 10 at least)", () => {
    expect(later.length).toBeGreaterThanOrEqual(4);
  });
  it.each(later)("%s: every policy it writes wraps its person checks", (file) => {
    const statements = policyStatements(read(`${DIR}/${file}`));
    for (const s of statements)
      expect({ file, s, bare: bareHelperCalls(s) }).toMatchObject({ bare: [] });
  });
  it("the check itself catches a bare call", () => {
    const bad =
      "create policy x on public.t for select to authenticated using (public.has_access('service') or public.is_admin());";
    expect(policyStatements(bad)).toHaveLength(1);
    expect(bareHelperCalls(policyStatements(bad)[0]!)).toEqual([
      "public.has_access('service')",
      "public.is_admin()",
    ]);
    expect(
      bareHelperCalls(
        "create policy x on public.t for select to authenticated using ((select public.has_access('service')));",
      ),
    ).toEqual([]);
  });
});
