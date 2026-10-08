/**
 * Owner, Oct 8: "is this the most efficient role setup? we dont really have PM or sales roles …
 * go ahead and do that". The hidden sales / PM rule (a plain user, not a technician, with
 * Estimate = invoices) becomes an "Invoices" tick on Admin › Users; the Add user form gets Office
 * and Technician presets; ticking Technician or Invoices brings Service with it, so the Oct 6
 * "technician without Service" state cannot be saved from the screen.
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ACCESS_PRESETS,
  PAGES,
  PAGE_HELP,
  PAGE_LABELS,
  canAccess,
  impliedAccess,
  isSalesPm,
  normalizeAccess,
  pageForPath,
  seesInvoices,
} from "@/lib/access";
import { technicianNeedsService } from "@/lib/dispatch-access";

const read = (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : "");
const flat = (s: string) =>
  s
    .replace(/--[^\n]*/g, "")
    .replace(/\s+/g, " ")
    .trim();

describe("the Invoices tick", () => {
  it("is a page like the others, last in the list, with a label and help", () => {
    expect(PAGES).toContain("invoices");
    expect(PAGES[PAGES.length - 1]).toBe("invoices");
    expect(PAGE_LABELS.invoices).toBe("Invoices");
    expect(PAGE_HELP.invoices).toMatch(/every change is logged/);
    expect(normalizeAccess(["invoices", "bogus"])).toEqual(["invoices"]);
  });
  it("grants invoices to a plain user; Estimate alone no longer does; a technician with the tick has it", () => {
    expect(seesInvoices({ role: "user", access: ["invoices"] })).toBe(true);
    expect(
      seesInvoices({ role: "user", access: ["estimate", "customers"], technician: false }),
    ).toBe(false);
    expect(seesInvoices({ role: "user", access: ["service", "invoices"], technician: true })).toBe(
      true,
    );
    expect(isSalesPm({ role: "manager", access: [] })).toBe(false);
    expect(seesInvoices({ role: "manager", access: [] })).toBe(true);
    expect(canAccess({ role: "user", access: ["invoices"] }, "invoices")).toBe(true);
    expect(canAccess({ role: "user", access: ["service"] }, "invoices")).toBe(false);
  });
  it("the Invoices tab under Service belongs to the Invoices page; the rest of Service stays Service", () => {
    expect(pageForPath("/service/invoices")).toBe("invoices");
    expect(pageForPath("/service/invoices?id=abc")).toBe("invoices");
    expect(pageForPath("/service")).toBe("service");
    expect(pageForPath("/service/board")).toBe("service");
  });
});

describe("what a tick brings with it", () => {
  it("Technician and Invoices each bring Service, once; nothing else moves", () => {
    expect(impliedAccess(["estimate"], true)).toEqual(["estimate", "service"]);
    expect(impliedAccess(["invoices"], false)).toEqual(["invoices", "service"]);
    expect(impliedAccess(["service", "invoices"], true)).toEqual(["service", "invoices"]);
    expect(impliedAccess(["estimate", "customers"], false)).toEqual(["estimate", "customers"]);
    expect(impliedAccess([], false)).toEqual([]);
  });
  it("so a technician set up from the screen can always see their tickets", () => {
    for (const access of [[], ["estimate"], ["prospect"]] as const) {
      const saved = { role: "user", access: impliedAccess([...access], true), technician: true };
      expect(technicianNeedsService(saved)).toBe(false);
    }
  });
});

describe("the presets", () => {
  it("Office: the day-to-day pages and Invoices, not Estimate Pricing; Technician: Service + the tick", () => {
    const office = ACCESS_PRESETS.find((p) => p.key === "office")!;
    const tech = ACCESS_PRESETS.find((p) => p.key === "technician")!;
    expect(office.access).toEqual([
      "estimate",
      "customers",
      "service",
      "invoices",
      "prospect",
      "takeoff",
    ]);
    expect(office.access).not.toContain("pricing");
    expect(office.technician).toBe(false);
    expect(tech.access).toEqual(["service"]);
    expect(tech.technician).toBe(true);
    expect(seesInvoices({ role: "user", access: [...office.access], technician: false })).toBe(
      true,
    );
    expect(canAccess({ role: "user", access: [...office.access] }, "pricing")).toBe(false);
  });
  it("Admin › Users offers them on the Add user form and routes every change through impliedAccess", () => {
    const src = read("src/routes/admin.users.tsx").replace(/\s+/g, " ");
    expect(src).toContain("{ACCESS_PRESETS.map((ps) => (");
    expect(src).toContain("setAccess(impliedAccess(ps.access, ps.technician));");
    expect(src).toContain("props.onChange(role, impliedAccess(access, technician), technician);");
    expect(src).not.toMatch(/onChange=\{\(e\) => props\.onChange\(/);
  });
});

describe("the migration", () => {
  const sql = flat(read("supabase/migrations/20261008180000_invoices_access.sql"));
  it("lets profiles.access hold 'invoices'", () => {
    expect(sql).toContain(
      "add constraint profiles_access_check check ( access <@ array['estimate', 'pricing', 'inventory', 'prospect', 'takeoff', 'service', 'customers', 'invoices']::text[] )",
    );
  });
  it("gives the tick to everyone the hidden rule covered, so nothing they have changes", () => {
    expect(sql).toContain(
      "update public.profiles set access = array_append(access, 'invoices') where role = 'user' and not coalesce(technician, false) and 'estimate' = any(access) and not ('invoices' = any(access));",
    );
  });
  it("is_sales_pm() keeps its name and now means the tick", () => {
    expect(sql).toContain(
      "create or replace function public.is_sales_pm() returns boolean language sql stable security definer set search_path = public as $$ select exists ( select 1 from public.profiles p where p.id = auth.uid() and p.role = 'user' and 'invoices' = any(p.access) ); $$;",
    );
    expect(sql).toContain("grant execute on function public.is_sales_pm() to authenticated;");
    expect(sql).not.toMatch(/drop function/);
  });
});
