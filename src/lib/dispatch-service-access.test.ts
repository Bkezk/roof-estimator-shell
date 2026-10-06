/**
 * The dispatch picker lists only technicians who can see tickets, and Admin › Users warns about
 * the rest (owner, Oct 6). Proven live: technician_options() listed every profile with the
 * Technician tick, but service_jobs_read needs has_access('service'), so John (access: Estimate,
 * Inventory) was assigned 2 tickets and saw 0.
 *
 * technicianNeedsService / withService (dispatch-access.ts), the Users page's amber warning with
 * its "Give Service access" button, and the migration 20261006191000_dispatch_service_access.sql.
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { TECH_NEEDS_SERVICE, technicianNeedsService, withService } from "@/lib/dispatch-access";

const read = (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : "");
const flat = (s: string) =>
  s
    .replace(/--[^\n]*/g, "")
    .replace(/\s+/g, " ")
    .trim();

describe("technicianNeedsService (pure)", () => {
  it("John: ticked Technician, access Estimate + Inventory, no Service — needs it", () => {
    expect(
      technicianNeedsService({ role: "user", access: ["estimate", "inventory"], technician: true }),
    ).toBe(true);
    expect(technicianNeedsService({ role: "user", access: [], technician: true })).toBe(true);
  });
  it("a technician with Service, or an admin / manager ticked Technician, is fine", () => {
    expect(technicianNeedsService({ role: "user", access: ["service"], technician: true })).toBe(
      false,
    );
    expect(technicianNeedsService({ role: "manager", access: [], technician: true })).toBe(false);
    expect(technicianNeedsService({ role: "admin", access: [], technician: true })).toBe(false);
  });
  it("someone not ticked Technician is never warned about, Service or not", () => {
    expect(technicianNeedsService({ role: "user", access: ["estimate"], technician: false })).toBe(
      false,
    );
    expect(technicianNeedsService({ role: "user", access: ["estimate"] })).toBe(false);
    expect(technicianNeedsService(null)).toBe(false);
  });
  it("withService adds Service once and keeps the other pages", () => {
    expect(withService(["estimate", "inventory"])).toEqual(["estimate", "inventory", "service"]);
    expect(withService(["service", "customers"])).toEqual(["service", "customers"]);
    expect(withService([])).toEqual(["service"]);
  });
  it("the warning says what is wrong", () => {
    expect(TECH_NEEDS_SERVICE).toBe("Technician without Service access — cannot see tickets");
  });
});

describe("Admin › Users warns on each such row and offers the fix", () => {
  const src = read("src/routes/admin.users.tsx");
  it("imports the helper and shows the amber warning for a row that needs it", () => {
    expect(src).toContain(
      'import { TECH_NEEDS_SERVICE, technicianNeedsService, withService } from "@/lib/dispatch-access";',
    );
    expect(src).toContain("{technicianNeedsService(u) && (");
    expect(src).toContain("{TECH_NEEDS_SERVICE}");
    expect(src).toMatch(/className="[^"]*border-amber-300[^"]*bg-amber-50[^"]*"/);
  });
  it("Give Service access reuses the access mutation with 'service' added, nothing else changed", () => {
    expect(src).toMatch(
      /accessMut\.mutate\(\{\s*id: u\.id,\s*role: u\.role,\s*access: withService\(u\.access\),\s*technician: u\.technician,\s*\}\)/,
    );
    expect(src).toContain("Give Service access");
  });
});

describe("migration 20261006191000_dispatch_service_access.sql", () => {
  const raw = read("supabase/migrations/20261006191000_dispatch_service_access.sql");
  const sql = flat(raw);
  it("exists and says why", () => {
    expect(raw.startsWith("-- ")).toBe(true);
    expect(raw.slice(0, 500)).toContain("(owner, Oct 6)");
  });
  it("technician_options() lists only people who can read tickets, keeping the caller rule and the order", () => {
    expect(sql).toContain(
      "create or replace function public.technician_options() returns table (id uuid, full_name text, email text, technician boolean) language sql stable security definer set search_path = public as $$",
    );
    // The caller rule of 20261002090000_service_role_helpers.sql, unchanged.
    expect(sql).toContain(
      "where (coalesce(auth.role(), '') = 'service_role' or (auth.uid() is null and coalesce(auth.role(), '') not in ('anon', 'authenticated')) or public.has_access('service'))",
    );
    // The filter: a technician without Service cannot see tickets (service_jobs_read).
    expect(sql).toContain("and (p.role in ('admin','manager') or 'service' = any(p.access))");
    expect(sql).not.toContain("p.technician or p.role in");
    expect(sql).toContain(
      "order by p.technician desc, coalesce(nullif(trim(p.full_name), ''), p.email);",
    );
  });
  it("the grants are as before: authenticated and the service role, never anon", () => {
    expect(sql).toContain("revoke all on function public.technician_options() from public;");
    expect(sql).toContain("revoke all on function public.technician_options() from anon;");
    expect(sql).toContain(
      "grant execute on function public.technician_options() to authenticated, service_role;",
    );
  });
});
