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
  KIND_LABELS,
  OFFICE_PAGES,
  PAGES,
  TECHNICIAN_PAGES,
  USER_KINDS,
  kindOf,
  shapeForKind,
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

describe("the four kinds of people (owner, Oct 8)", () => {
  it("Owner, Manager, Office, Technician — one picker, no page ticks", () => {
    expect(USER_KINDS).toEqual(["owner", "manager", "office", "technician"]);
    expect(Object.values(KIND_LABELS)).toEqual(["Owner", "Manager", "Office", "Technician"]);
  });
  it("Office = every page (Project Bids, Estimate Pricing, Invoices included); Technician = Service + the tick", () => {
    expect(OFFICE_PAGES).toEqual([
      "estimate",
      "pricing",
      "customers",
      "service",
      "invoices",
      "prospect",
      "takeoff",
    ]);
    expect(TECHNICIAN_PAGES).toEqual(["service"]);
    expect(shapeForKind("owner", false)).toEqual({ role: "admin", access: [], technician: false });
    expect(shapeForKind("manager", true)).toEqual({
      role: "manager",
      access: [],
      technician: true,
    });
    expect(shapeForKind("office", false)).toEqual({
      role: "user",
      access: [...OFFICE_PAGES],
      technician: false,
    });
    expect(shapeForKind("office", true).technician).toBe(true);
    // A technician is always ticked Technician, whatever is passed.
    expect(shapeForKind("technician", false)).toEqual({
      role: "user",
      access: ["service"],
      technician: true,
    });
  });
  it("a technician sees Inventory and (their own) tickets and no price page; office sees everything, runs no ticket money", () => {
    const tech = shapeForKind("technician", true);
    expect(canAccess(tech, "inventory")).toBe(true);
    expect(canAccess(tech, "service")).toBe(true);
    for (const page of ["pricing", "estimate", "invoices", "customers"] as const)
      expect(canAccess(tech, page)).toBe(false);
    expect(seesInvoices(tech)).toBe(false);
    expect(technicianNeedsService(tech)).toBe(false);
    const office = shapeForKind("office", false);
    for (const page of PAGES) expect(canAccess(office, page)).toBe(true);
    expect(seesInvoices(office)).toBe(true);
  });
  it("reads a stored profile back as its kind; Inventory in the list does not matter; odd rows are Custom", () => {
    expect(kindOf({ role: "admin", access: [] })).toBe("owner");
    expect(kindOf({ role: "manager", access: [], technician: true })).toBe("manager");
    expect(
      kindOf({ role: "user", access: [...OFFICE_PAGES, "inventory"], technician: false }),
    ).toBe("office");
    expect(kindOf({ role: "user", access: [...OFFICE_PAGES], technician: true })).toBe("office");
    expect(kindOf({ role: "user", access: ["service", "inventory"], technician: true })).toBe(
      "technician",
    );
    // The old per-page rows on the owner's screen (Oct 8): Custom until a kind is picked.
    expect(kindOf({ role: "user", access: ["estimate", "inventory"], technician: true })).toBe(
      "custom",
    );
    expect(kindOf({ role: "user", access: ["prospect"], technician: true })).toBe("custom");
    expect(kindOf({ role: "user", access: ["service"], technician: false })).toBe("custom");
    expect(kindOf(null)).toBe("custom");
    // Round trip.
    for (const k of USER_KINDS) expect(kindOf(shapeForKind(k, false))).toBe(k);
  });
  it("Admin › Users saves through shapeForKind and starts a new user as a technician", () => {
    const src = read("src/routes/admin.users.tsx").replace(/\s+/g, " ");
    expect(src).toContain("const shape = shapeForKind(k, technician);");
    expect(src).toContain("props.onChange(shape.role, shape.access, shape.technician);");
    expect(src).toContain('useState<Role>(shapeForKind("technician", true).role)');
    expect(src).toContain("{USER_KINDS.map((k) => (");
    expect(src).not.toContain("PAGES.map((p) => (");
    expect(src).not.toContain("ACCESS_PRESETS");
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
