/**
 * Office users may manage templates (owner, Nov 10: "keep technicians off the documents page.
 * Allow office users to have access"). Templates, saved snippets and the PDF library were an
 * admin's or a manager's to change; 20261110212000 opens the three tables' writes to anyone with
 * Documents access. A Service-only technician has none and stays out. Proved live by
 * impersonation, rolled back: an office user with Estimate only inserts, updates and deletes all
 * three; the technician is refused (42501) and reads nothing.
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { bareHelperCalls, policyStatements } from "@/lib/rls-check-once";

const read = (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : "");
const raw = read("supabase/migrations/20261110212000_templates_documents_access.sql");
const statements = policyStatements(raw);
const ONCE = "((select public.documents_access()))";

describe("20261110212000: templates, snippets and the library are Documents access's", () => {
  it("alters the nine write policies and nothing else", () => {
    expect(statements).toHaveLength(9);
    expect(statements.every((s) => s.startsWith("alter policy "))).toBe(true);
    expect(raw).not.toMatch(/drop policy|create policy/i);
  });
  it.each(["document_templates", "document_modules", "document_assets"])(
    "%s: insert, update and delete ask for Documents access only",
    (table) => {
      expect(statements).toContain(
        `alter policy ${table}_insert on public.${table} with check ${ONCE};`,
      );
      expect(statements).toContain(
        `alter policy ${table}_update on public.${table} using ${ONCE} with check ${ONCE};`,
      );
      expect(statements).toContain(
        `alter policy ${table}_delete on public.${table} using ${ONCE};`,
      );
    },
  );
  it("no longer asks for an admin or a manager, and checks the person once", () => {
    for (const s of statements) {
      expect(s).not.toMatch(/is_admin|is_manager/);
      expect(bareHelperCalls(s)).toEqual([]);
    }
  });
  it("Documents access is what it was: admin, manager, Estimate, Invoices or Customers (never Service alone)", () => {
    const def = read("supabase/migrations/20261026150000_documents.sql").replace(/\s+/g, " ");
    expect(def).toContain(
      "create or replace function public.documents_access() returns boolean language sql stable security definer set search_path = public as $$ select public.is_admin() or public.is_manager() or public.has_access('estimate') or public.has_access('invoices') or public.has_access('customers'); $$;",
    );
    // The function is not redefined here: the rule for WHO has Documents access does not change.
    expect(raw).not.toMatch(/create (or replace )?function/i);
  });
});
