/**
 * Vendors and billing an invoice to a vendor (owner, Oct 1: "Sometimes invoices go to vendors.
 * We need somewhere to add vendor info like name, address etc, then we can select them as a
 * recipient." "It's typically a supplier. Sometimes it's both a customer and a vendor, so we
 * could make two invoices for that if needed."). The pure helpers (vendors.ts), the migration
 * 20261001110000_vendors.sql, the generated types, the server functions (vendors.functions.ts,
 * invoices.functions.ts, service-pos.functions.ts, audit.functions.ts), and the screens: the
 * Vendors tab on the Customers page, the invoice's Bill to, the ticket's invoice card, the
 * Invoices list and the PO form.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { AUDIT_ENTITIES } from "@/lib/audit";
import {
  VENDOR_NAME_MAX,
  accountBillTo,
  billToFor,
  canEditVendors,
  cleanVendorName,
  filterVendors,
  findVendorByName,
  searchVendors,
  vendorAddressLine,
  vendorBillProblem,
  vendorBillTo,
  vendorBilledLabel,
  vendorCityLine,
  vendorCityState,
  vendorDraftOf,
  vendorFormProblem,
} from "@/lib/vendors";

const read = (p: string) => readFileSync(p, "utf8");
const flatSql = (p: string) =>
  read(p)
    .replace(/--[^\n]*/g, "")
    .replace(/\s+/g, " ");
function serverFn(src: string, name: string): string {
  const start = src.indexOf(`export const ${name} = createServerFn`);
  expect(start, `${name} not found`).toBeGreaterThanOrEqual(0);
  const next = src.indexOf("\nexport ", start + 1);
  return src.slice(start, next < 0 ? undefined : next);
}
/** The text from `from` up to `to`; "" when either is missing (the assertions then fail). */
const between = (src: string, from: string, to: string) => {
  const a = src.indexOf(from);
  const b = a < 0 ? -1 : src.indexOf(to, a + from.length);
  return a < 0 || b < 0 ? "" : src.slice(a, b);
};

const abc = {
  name: "  ABC   Supply ",
  address1: "1 Main St ",
  address2: "Suite 2",
  city: "Pineville",
  state: "KY",
  zip: "40977",
  contact_name: "Dana",
  phone: "606-555-0100",
  email: "ar@abcsupply.com",
  terms: "Net 30",
  account_number: "JBK-1",
  billable: true,
  archived_at: null,
};
const account = {
  name: "Bell County BOE",
  address1: "PO Box 340",
  address2: null,
  city: "Pineville",
  state: "KY",
  zip: "40977",
  billing_instructions: "Mail to the finance office",
  external_id: "508373",
};

// ---------------------------------------------------------------------------------------------

describe("addresses", () => {
  it("vendorAddressLine: what there is, on one line", () => {
    expect(vendorAddressLine(abc)).toBe("1 Main St, Suite 2, Pineville, KY 40977");
    expect(vendorAddressLine({ name: "X", city: "Pineville", state: "KY" })).toBe("Pineville, KY");
    expect(vendorAddressLine({ name: "X", zip: "40977" })).toBe("40977");
    expect(vendorAddressLine({ name: "X" })).toBe("");
    expect(vendorAddressLine({ name: "X", address1: "  ", city: null })).toBe("");
  });
  it("vendorCityLine / vendorCityState", () => {
    expect(vendorCityLine(abc)).toBe("Pineville, KY 40977");
    expect(vendorCityState(abc)).toBe("Pineville, KY");
    expect(vendorCityState({ city: null, state: "TN" })).toBe("TN");
    expect(vendorCityState({ city: null, state: null })).toBe("");
  });
});

describe("the Bill To snapshot (invoices.bill_to): the same shape for an account or a vendor", () => {
  const KEYS = [
    "address1",
    "address2",
    "city",
    "external_id",
    "instructions",
    "name",
    "state",
    "zip",
  ];
  it("vendorBillTo: the vendor's name and address; no Sage # and no instructions", () => {
    expect(vendorBillTo(abc)).toEqual({
      name: "ABC Supply",
      address1: "1 Main St",
      address2: "Suite 2",
      city: "Pineville",
      state: "KY",
      zip: "40977",
      instructions: "",
      external_id: "",
    });
    expect(Object.keys(vendorBillTo({ name: "X" })).sort()).toEqual(KEYS);
    expect(vendorBillTo({ name: "X" })).toMatchObject({ address1: "", city: "", zip: "" });
  });
  it("accountBillTo: exactly what createInvoiceFor always took from the account", () => {
    expect(accountBillTo(account, "Bell County Schools")).toEqual({
      name: "Bell County BOE",
      address1: "PO Box 340",
      address2: "",
      city: "Pineville",
      state: "KY",
      zip: "40977",
      instructions: "Mail to the finance office",
      external_id: "508373",
    });
    // No account: the ticket's customer name, the rest blank.
    expect(accountBillTo(null, "Walk-in")).toEqual({
      name: "Walk-in",
      address1: "",
      address2: "",
      city: "",
      state: "",
      zip: "",
      instructions: "",
      external_id: "",
    });
    expect(Object.keys(accountBillTo(account, "")).sort()).toEqual(KEYS);
  });
  it("billToFor: the vendor when one is picked, else the account", () => {
    expect(billToFor(abc, account, "Bell")).toEqual(vendorBillTo(abc));
    expect(billToFor(null, account, "Bell")).toEqual(accountBillTo(account, "Bell"));
    expect(billToFor(undefined, null, "Walk-in").name).toBe("Walk-in");
  });
  it("vendorBillProblem: found, not archived, billable", () => {
    expect(vendorBillProblem(abc)).toBeNull();
    expect(vendorBillProblem(null)).toBe("That vendor was not found");
    expect(vendorBillProblem({ ...abc, name: "ABC", archived_at: "2026-10-01T00:00:00Z" })).toMatch(
      /^ABC is archived/,
    );
    expect(vendorBillProblem({ ...abc, name: "ABC", billable: false })).toMatch(
      /^ABC is not billable/,
    );
  });
  it('the badge: "Billed to vendor: <name>"', () => {
    expect(vendorBilledLabel("ABC Supply")).toBe("Billed to vendor: ABC Supply");
    expect(vendorBilledLabel(null)).toBe("Billed to vendor: —");
  });
});

describe("who edits: admins and managers (the RLS twin)", () => {
  it("canEditVendors", () => {
    expect(canEditVendors({ role: "admin" })).toBe(true);
    expect(canEditVendors({ role: "manager", technician: true })).toBe(true);
    expect(canEditVendors({ role: "user", access: ["customers", "service", "inventory"] })).toBe(
      false,
    );
    expect(canEditVendors(null)).toBe(false);
  });
});

describe("the form", () => {
  const ok = vendorDraftOf({ name: "ABC Supply" });
  it("a new vendor starts blank and billable; an existing one with its values", () => {
    expect(vendorDraftOf()).toMatchObject({ name: "", email: "", billable: true });
    expect(vendorDraftOf({ ...abc, billable: false, notes: "Yard closes at 3" })).toMatchObject({
      name: abc.name,
      terms: "Net 30",
      account_number: "JBK-1",
      notes: "Yard closes at 3",
      billable: false,
    });
  });
  it("vendorFormProblem names the first thing wrong", () => {
    expect(vendorFormProblem(ok)).toBeNull();
    expect(vendorFormProblem({ ...ok, name: "   " })).toBe("Enter the vendor's name");
    expect(vendorFormProblem({ ...ok, name: "x".repeat(VENDOR_NAME_MAX + 1) })).toMatch(
      /at most 120/,
    );
    expect(vendorFormProblem({ ...ok, name: "x".repeat(VENDOR_NAME_MAX) })).toBeNull();
    expect(vendorFormProblem({ ...ok, email: "ar@abc" })).toMatch(/Not an email address/);
    expect(vendorFormProblem({ ...ok, email: " ar@abcsupply.com " })).toBeNull();
    expect(vendorFormProblem({ ...ok, state: "Kentucky" })).toMatch(/two letters/);
    expect(vendorFormProblem({ ...ok, state: "ky" })).toBeNull();
  });
  it("cleanVendorName: trimmed, inner spaces made one", () => {
    expect(cleanVendorName("  ABC   Supply ")).toBe("ABC Supply");
  });
});

describe("search", () => {
  const list = [
    { name: "ABC Supply", city: "Pineville", state: "KY", phone: "606-555-0100" },
    { name: "84 Lumber", city: "London", state: "KY", terms: "Net 45" },
    { name: "Lowe's Home Improvement", city: "Middlesboro", state: "KY" },
    { name: "Beacon Roofing Supply", city: "Knoxville", state: "TN", email: "ap@becn.com" },
  ];
  it("filterVendors: each word typed starts a word of the name, any case; by name", () => {
    expect(filterVendors(list, "").map((v) => v.name)).toEqual([
      "84 Lumber",
      "ABC Supply",
      "Beacon Roofing Supply",
      "Lowe's Home Improvement",
    ]);
    expect(filterVendors(list, "sup").map((v) => v.name)).toEqual([
      "ABC Supply",
      "Beacon Roofing Supply",
    ]);
    expect(filterVendors(list, "BEA sup").map((v) => v.name)).toEqual(["Beacon Roofing Supply"]);
    expect(filterVendors(list, "84 lum").map((v) => v.name)).toEqual(["84 Lumber"]);
    expect(filterVendors(list, "lowe").map((v) => v.name)).toEqual(["Lowe's Home Improvement"]);
    expect(filterVendors(list, "upply")).toEqual([]); // a word's start, not anywhere
  });
  it("searchVendors (the tab): the name, or the city, state, phone, email or terms", () => {
    expect(searchVendors(list, "knox").map((v) => v.name)).toEqual(["Beacon Roofing Supply"]);
    expect(searchVendors(list, "tn").map((v) => v.name)).toEqual(["Beacon Roofing Supply"]);
    expect(searchVendors(list, "net 45").map((v) => v.name)).toEqual(["84 Lumber"]);
    expect(searchVendors(list, "555-0100").map((v) => v.name)).toEqual(["ABC Supply"]);
    expect(searchVendors(list, "becn").map((v) => v.name)).toEqual(["Beacon Roofing Supply"]);
    expect(searchVendors(list, " ")).toHaveLength(4);
  });
  it("findVendorByName: any case and spacing (names are unique so)", () => {
    expect(findVendorByName(list, " abc  SUPPLY ")?.name).toBe("ABC Supply");
    expect(findVendorByName(list, "ABC")).toBeUndefined();
    expect(findVendorByName(list, "  ")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------------------------

describe("migration 20261001110000_vendors.sql", () => {
  const path = "supabase/migrations/20261001110000_vendors.sql";
  const flat = flatSql(path);
  it("the table: exactly the agreed columns; the name unique in any case, 1..120", () => {
    expect(flat).toContain(
      "create table if not exists public.vendors ( id uuid primary key default gen_random_uuid(), name text not null check (length(btrim(name)) between 1 and 120), address1 text, address2 text, city text, state text, zip text, contact_name text, phone text, email text, terms text, account_number text, notes text, billable boolean not null default true, archived_at timestamptz, created_by uuid default auth.uid(), created_at timestamptz not null default now(), updated_at timestamptz not null default now() );",
    );
    expect(flat).toContain(
      "create unique index if not exists vendors_name_key on public.vendors (lower(btrim(name)));",
    );
    expect(flat).toContain(
      "drop trigger if exists vendors_updated_at on public.vendors; create trigger vendors_updated_at before update on public.vendors for each row execute function public.update_updated_at_column();",
    );
  });
  it("RLS: read with Service, Customers or Inventory; write admins and managers", () => {
    const boss = "public.is_admin() or public.is_manager()";
    expect(flat).toContain("alter table public.vendors enable row level security;");
    expect(flat).toContain(
      "create policy vendors_read on public.vendors for select to authenticated using ( public.has_access('service') or public.has_access('customers') or public.has_access('inventory') );",
    );
    expect(flat).toContain(
      `create policy vendors_insert on public.vendors for insert to authenticated with check (${boss});`,
    );
    expect(flat).toContain(
      `create policy vendors_update on public.vendors for update to authenticated using (${boss}) with check (${boss});`,
    );
    expect(flat).toContain(
      `create policy vendors_delete on public.vendors for delete to authenticated using (${boss});`,
    );
    expect(flat).not.toMatch(/on public\.vendors for all/);
    for (const [, name] of flat.matchAll(/create policy (\w+) on/g))
      expect(flat).toContain(`drop policy if exists ${name} on public.vendors;`);
  });
  it("the two columns: invoices.bill_to_vendor_id and the PO's vendor_id (on delete set null)", () => {
    expect(flat).toContain(
      "alter table public.invoices add column if not exists bill_to_vendor_id uuid references public.vendors(id) on delete set null;",
    );
    expect(flat).toContain(
      "alter table public.service_job_purchase_orders add column if not exists vendor_id uuid references public.vendors(id) on delete set null;",
    );
    expect(flat).toContain(
      "create index if not exists invoices_bill_to_vendor_idx on public.invoices (bill_to_vendor_id);",
    );
    expect(flat).toContain(
      "create index if not exists service_job_purchase_orders_vendor_idx on public.service_job_purchase_orders (vendor_id);",
    );
  });
  it("audit: 'vendor' in the entity check (= AUDIT_ENTITIES), its branch and its trigger", () => {
    expect(flat).toContain(
      "alter table public.audit_log drop constraint if exists audit_log_entity_check; alter table public.audit_log add constraint audit_log_entity_check check (entity in ('invoice', 'invoice_line', 'account', 'site', 'contact', 'purchase_order', 'vendor'));",
    );
    const listed = /check \(entity in \(([^)]*)\)\)/.exec(flat)![1]!;
    expect(listed.split(",").map((x) => x.trim().replace(/'/g, ""))).toEqual([...AUDIT_ENTITIES]);
    expect(flat).toContain(
      "when 'vendors' then v_entity := 'vendor'; v_entity_id := (v_row ->> 'id')::uuid; v_label := 'Vendor ''' || coalesce(v_old ->> 'name', v_new ->> 'name', '') || '''';",
    );
    expect(flat).toContain(
      "drop trigger if exists vendors_audit on public.vendors; create trigger vendors_audit after insert or update or delete on public.vendors for each row execute function public.audit_row();",
    );
  });
  it("audit_row is 20261001100000's exactly, plus only the vendors branch", () => {
    const fn = (sql: string) =>
      sql.slice(
        sql.indexOf("create or replace function public.audit_row()"),
        sql.indexOf("revoke all on function public.audit_row() from public;"),
      );
    const before = fn(flatSql("supabase/migrations/20261001100000_ticket_purchase_orders.sql"));
    const after = fn(flat);
    const branch =
      "when 'vendors' then v_entity := 'vendor'; v_entity_id := (v_row ->> 'id')::uuid; v_label := 'Vendor ''' || coalesce(v_old ->> 'name', v_new ->> 'name', '') || ''''; ";
    expect(before.length).toBeGreaterThan(3000);
    expect(after).toContain(branch);
    expect(after.replace(branch, "")).toBe(before);
    expect(flat).toContain("revoke all on function public.audit_row() from public;");
  });
  it("is idempotent (if not exists / drop … if exists everywhere)", () => {
    expect(flat).not.toMatch(/create table public\./);
    expect(flat).not.toMatch(/create index (?!if not exists)/);
    expect(flat).not.toMatch(/add column (?!if not exists)/);
    for (const [, name, table] of flat.matchAll(/create trigger (\w+) \w+ [^;]*? on ([\w.]+)/g))
      expect(flat).toContain(`drop trigger if exists ${name} on ${table};`);
  });
});

describe("generated types", () => {
  const types = read("src/integrations/supabase/types.ts");
  const block = between(types, "      vendors: {\n", "      warranties: {\n");
  it("vendors: Row, Insert, Update in the table's shape, between vehicle_drivers and warranties", () => {
    expect(types.indexOf("      vehicle_drivers: {")).toBeLessThan(
      types.indexOf("      vendors: {"),
    );
    expect(block).toContain(
      "Row: {\n          account_number: string | null;\n          address1: string | null;\n          address2: string | null;\n          archived_at: string | null;\n          billable: boolean;\n          city: string | null;\n          contact_name: string | null;\n          created_at: string;\n          created_by: string | null;\n          email: string | null;\n          id: string;\n          name: string;\n          notes: string | null;\n          phone: string | null;\n          state: string | null;\n          terms: string | null;\n          updated_at: string;\n          zip: string | null;\n        };",
    );
    const insert = between(block, "Insert: {", "Update: {");
    expect(insert).toContain("          name: string;\n");
    expect(insert.match(/^\s+\w+: /gm)).toHaveLength(1); // only the name is required
    const update = between(block, "Update: {", "Relationships:");
    expect(update).not.toMatch(/^\s+\w+: /m);
  });
  it("invoices.bill_to_vendor_id and the PO's vendor_id, with their foreign keys", () => {
    const inv = between(types, "      invoices: {\n", "      inspection_checklist_items: {\n");
    expect(inv).toContain(
      "          bill_to: Json;\n          bill_to_vendor_id: string | null;\n",
    );
    expect(inv.match(/bill_to_vendor_id\?: string \| null;/g)).toHaveLength(2);
    expect(inv).toContain('foreignKeyName: "invoices_bill_to_vendor_id_fkey";');
    const po = between(
      types,
      "      service_job_purchase_orders: {\n",
      "      service_job_repairs: {\n",
    );
    expect(po).toContain("          vendor_id: string | null;\n        };");
    expect(po.match(/vendor_id\?: string \| null;/g)).toHaveLength(2);
    expect(po).toContain('foreignKeyName: "service_job_purchase_orders_vendor_id_fkey";');
  });
});

// ---------------------------------------------------------------------------------------------

describe("audit: the vendor entity and its History", () => {
  it("AUDIT_ENTITIES ends with 'vendor'", () => {
    expect(AUDIT_ENTITIES.at(-1)).toBe("vendor");
  });
  it("listAudit reads a vendor's own rows; the fold takes 'vendor'", () => {
    const fn = serverFn(read("src/lib/audit.functions.ts"), "listAudit");
    expect(fn).toContain('entity: z.enum(["invoice", "account", "vendor"]),');
    expect(fn).toMatch(
      /if \(data\.entity === "vendor"\) \{[\s\S]*?\.eq\("entity", "vendor"\)\s*\.eq\("entity_id", data\.entity_id\)/,
    );
    expect(read("src/components/audit-history.tsx")).toContain(
      'export type AuditFold = "invoice" | "account" | "vendor";',
    );
  });
});

describe("server functions (vendors.functions.ts)", () => {
  const src = read("src/lib/vendors.functions.ts");
  it("list, save, archive, restore: signed in, validated with zod", () => {
    for (const name of ["listVendors", "saveVendor", "archiveVendor", "restoreVendor"]) {
      const fn = serverFn(src, name);
      expect(fn).toContain(".middleware([requireSupabaseAuth])");
      expect(fn).toMatch(/\.validator\(\(d: unknown\) =>/);
    }
  });
  it("list: readers with Service, Customers or Inventory; archived only when asked; q filters", () => {
    expect(src).toContain(
      '!(canAccess(p, "service") || canAccess(p, "customers") || canAccess(p, "inventory"))',
    );
    const fn = serverFn(src, "listVendors");
    expect(fn).toContain("await reader(context);");
    expect(fn).toContain('if (!data.includeArchived) q = q.is("archived_at", null);');
    expect(fn).toContain("data.q ? searchVendors(all, data.q)");
  });
  it("save / archive / restore: admins and managers only; a duplicate name is refused", () => {
    expect(src).toContain(
      'if (!canEditVendors(p)) throw new Error("Vendors are changed by a manager or an admin");',
    );
    expect(serverFn(src, "saveVendor")).toContain("await editor(context);");
    expect(src).toMatch(/async function setArchived[\s\S]*?await editor\(ctx\);/);
    // An archived vendor's name is named as archived (audit, Oct 2; vendor-archived-clash.test.ts).
    expect(serverFn(src, "saveVendor")).toContain(
      "const clash = vendorNameClash(all ?? [], data.name, data.id);\n    if (clash) throw new Error(clash.message);",
    );
    expect(src).toContain("archived_at: archived ? new Date().toISOString() : null");
  });
  it("errors are plain messages (the screens toast them)", () => {
    expect(src).not.toMatch(/console\.(log|error)/);
    expect(src.match(/throw new Error\(/g)!.length).toBeGreaterThanOrEqual(8);
  });
});

describe("invoices.functions.ts: billing a vendor", () => {
  const src = read("src/lib/invoices.functions.ts");
  const create = between(src, "async function createInvoiceFor(", "\nexport const getInvoice");
  it("createInvoiceFor: bill_to from the vendor when one is given, the column stored", () => {
    expect(create).toContain("billToVendorId: string | null = null,");
    expect(create).toContain(
      "const vendor = billToVendorId ? await billableVendor(sb, billToVendorId) : null;",
    );
    expect(create).toContain("const bill_to = billToFor(vendor, account, job.customer_name);");
    expect(create).toContain("bill_to_vendor_id: vendor?.id ?? null,");
    // The account's own snapshot moved to accountBillTo (vendors.ts), not copied here.
    expect(create).not.toContain("account?.billing_instructions");
    // The customer's tax exemption does not carry to the vendor's invoice.
    expect(create).toContain(
      "const taxRate = !vendor && account?.tax_exempt ? 0 : Number(settings.tax_rate);",
    );
  });
  it("billableVendor refuses a missing, archived or non-billable vendor (vendorBillProblem)", () => {
    const fn = between(src, "async function billableVendor(", "\n}\n");
    expect(fn).toContain("const problem = vendorBillProblem(vendor);");
    expect(fn).toContain('if (problem || !vendor) throw new Error(problem ?? "That vendor');
  });
  it("createAnotherInvoice takes the vendor up front; getOrCreateInvoice stays the account", () => {
    const fn = serverFn(src, "createAnotherInvoice");
    expect(fn).toContain("bill_to_vendor_id: z.string().uuid().nullable().optional(),");
    expect(fn).toContain("data.bill_to_vendor_id ?? null,");
    expect(serverFn(src, "getOrCreateInvoice")).toContain(
      "return createInvoiceFor(sb, data.job_id, { id: context.userId, name: nameOf(p) }, true);",
    );
  });
  it("saveInvoice: a draft's Bill To may change and is snapshotted again; a final one is locked", () => {
    expect(src).toContain("bill_to_vendor_id: z.string().uuid().nullable().optional(),\n  lines:");
    const fn = serverFn(src, "saveInvoice");
    const locked = fn.indexOf(
      'if (inv.status !== "draft") throw new Error("This invoice is final; void it to change it");',
    );
    const change = fn.indexOf("data.bill_to_vendor_id !== (inv.bill_to_vendor_id ?? null)");
    expect(locked).toBeGreaterThan(0);
    expect(change).toBeGreaterThan(locked); // nothing about Bill To runs for a final invoice
    const block = fn.slice(change, fn.indexOf("const { data: updated, error: uErr }", change));
    expect(block).toContain("patch.bill_to_vendor_id = data.bill_to_vendor_id;");
    expect(block).toContain("const vendor = await billableVendor(sb, data.bill_to_vendor_id);");
    expect(block).toContain("patch.bill_to = billToFor(vendor, null, null) as unknown as Json;");
    expect(block).toContain(
      "patch.bill_to = accountBillTo(account, job.customer_name) as unknown as Json;",
    );
    // Final invoices never change it: no other function writes the column.
    for (const name of ["finalizeInvoice", "sendInvoice", "markInvoicePaid", "voidInvoice"])
      expect(serverFn(src, name)).not.toContain("bill_to");
  });
});

describe("purchase orders: the Vendor (service-pos.functions.ts)", () => {
  const src = read("src/lib/service-pos.functions.ts");
  it("save takes vendor_id (undefined keeps it); a new pick must not be archived", () => {
    expect(src).toContain("vendor_id: z.string().uuid().nullable().optional(),");
    const fn = serverFn(src, "savePurchaseOrder");
    expect(fn).toContain("...(data.vendor_id === undefined ? {} : { vendor_id: data.vendor_id }),");
    expect(fn).toContain("if (data.vendor_id) await pickableVendor(context, data.vendor_id);");
    expect(fn).toContain("if (data.vendor_id && data.vendor_id !== prev.vendor_id)");
    expect(src).toContain(
      "if (v.archived_at) throw new Error(`${v.name} is archived; pick another vendor`);",
    );
  });
  it("the list carries the vendor's name", () => {
    expect(src).toContain("vendor_name: string | null;");
    expect(src).toContain("vendor_name: r.vendor_id ? (vendors.get(r.vendor_id) ?? null) : null,");
  });
});

// ---------------------------------------------------------------------------------------------

describe("the invoice editor's Bill to (invoice-editor.tsx)", () => {
  const ed = read("src/components/service/invoice-editor.tsx");
  const billTo = between(ed, "function BillTo({", "\nconst INTERNAL_OPEN_KEY");
  it("the draft carries bill_to_vendor_id in its header state and its save", () => {
    expect(ed).toContain("  bill_to_vendor_id: string | null;\n}");
    expect(ed).toContain("  bill_to_vendor_id: inv.bill_to_vendor_id ?? null,\n});");
    expect(ed).toContain("      bill_to_vendor_id: head.bill_to_vendor_id,\n      lines:");
  });
  it("the draft's Bill To: the choice (customer or a billable vendor) and a preview until saved", () => {
    expect(ed).toMatch(
      /<BillTo\s+inv=\{inv\}\s+draft=\{\{\s+vendorId: head\.bill_to_vendor_id,\s+onChange: \(v\) => setH\("bill_to_vendor_id", v\),\s+preview: billPreview,/,
    );
    expect(ed).toContain("? pickedVendor && vendorBillTo(pickedVendor)");
    expect(ed).toContain(": accountBillTo(account, job.customer_name);");
    expect(billTo).toContain("<BillToChoice");
    expect(billTo).toContain("const b = (draft?.preview ?? inv.bill_to ?? {})");
  });
  it('the final invoice (no draft): "Billed to vendor: <name>"', () => {
    expect(billTo).toContain(
      "const toVendor = draft ? !!draft.vendorId : !!inv.bill_to_vendor_id;",
    );
    expect(billTo).toMatch(/\{toVendor && \([\s\S]*?<VendorBilledBadge name=\{b\["name"\]\} \/>/);
    const final = between(ed, "function FinalInvoice(", "// ---- Dialogs");
    expect(final).toContain("<BillTo inv={inv} />");
  });
  it("Send defaults to the vendor's email when billed to a vendor", () => {
    const send = between(ed, "function SendDialog(", "function PaidDialog(");
    expect(send).toContain("vendorId?: string | null;");
    expect(send).toMatch(
      /\} else if \(vendorId\) \{\s*setPicked\(\[\]\);\s*setExtra\(isEmail\(vendorEmail\) \? vendorEmail : ""\);/,
    );
    expect(send).toContain("if (vendorId && !vendorsQ.data && !vendorsQ.error) return;");
    expect(ed).toContain("vendorId={head.bill_to_vendor_id}");
    expect(ed).toContain("vendorId={inv.bill_to_vendor_id}");
  });
});

describe("the Bill to picker (bill-to-picker.tsx) and the vendor box (vendor-picker.tsx)", () => {
  const bt = read("src/components/service/bill-to-picker.tsx");
  const vp = read("src/components/crm/vendor-picker.tsx");
  it("Bill to: the customer by default, or a billable vendor typed by name", () => {
    expect(bt).toMatch(/<VendorPicker[\s\S]*?billableOnly[\s\S]*?\/>/);
    expect(bt).toContain("{vendorBilledLabel(name)}");
    expect(bt).toContain('Customer{props.customerName ? `: ${props.customerName}` : ""}');
  });
  it("the box filters as you type (filterVendors), billable only when asked, Enter never submits", () => {
    expect(vp).toContain('const rows = filterVendors(all, text ?? "");');
    expect(vp).toContain("(vendors.data ?? []).filter((v) => !props.billableOnly || v.billable)");
    expect(vp).toContain("// Never submit the surrounding form from this box.");
    expect(vp).toContain('role="combobox"');
  });
});

describe("the ticket's invoice card (invoice-block.tsx)", () => {
  const src = read("src/components/service/invoice-block.tsx");
  it('"Another invoice" asks whom to bill first, then makes it for the vendor or the customer', () => {
    expect(src).toContain("onClick={() => setAskAnother(true)}");
    expect(src).toMatch(/<AnotherInvoiceDialog\s+open=\{askAnother\}/);
    expect(src).toContain("onMake={(vendorId) => another.mutate(vendorId)}");
    expect(src).toContain("anotherFn({ data: { job_id: job.id, bill_to_vendor_id: vendorId } })");
  });
  it("the badge on an invoice billed to a vendor", () => {
    expect(src).toMatch(
      /\{inv\?\.bill_to_vendor_id && \(\s*<VendorBilledBadge name=\{\(inv\.bill_to as \{ name\?: string \} \| null\)\?\.name\} \/>/,
    );
  });
});

describe("the Invoices list (invoices-page.tsx)", () => {
  it("the Customer column shows the badge for an invoice billed to a vendor", () => {
    const src = read("src/components/service/invoices-page.tsx");
    expect(src).toMatch(
      /\{r\.bill_to_vendor_id \? \(\s*<VendorBilledBadge name=\{r\.customer_name\} \/>\s*\) : \(\s*r\.customer_name \|\| "—"\s*\)\}/,
    );
  });
});

describe("the Vendors tab on the Customers page", () => {
  const page = read("src/components/customers-page.tsx");
  const route = read("src/routes/customers.tsx");
  const tab = read("src/components/crm/vendors-section.tsx");
  it("?tab=vendors on /customers; no new sidebar entry", () => {
    expect(route).toContain('if (s["tab"] === "vendors") out.tab = "vendors";');
    expect(route).toContain("return <CustomersPage id={id} tab={tab} />;");
    expect(page).toContain('{ tab: "vendors", title: "Vendors", icon: Truck },');
    expect(page).toMatch(
      /if \(tab === "vendors"\)[\s\S]*?<CustomersTabs tab=\{tab\} \/>\s*<VendorsSection \/>/,
    );
    expect(read("src/components/app-sidebar.tsx")).not.toMatch(/vendor/i);
  });
  it("the list: search, Show archived (off), name / city-state / phone / email / terms / billable", () => {
    expect(tab).toContain("const [showArchived, setShowArchived] = useState(false);");
    expect(tab).toContain("const list = useVendors(showArchived);");
    expect(tab).toContain("const rows = searchVendors(all, search);");
    expect(tab).toContain("Show archived");
    for (const th of ["Name", "City / State", "Phone", "Email", "Terms", "Billable"])
      expect(tab).toContain(`<th className="px-3 py-2 font-medium">${th}</th>`);
    expect(tab).toContain("Archived");
  });
  it("managers and admins edit (New vendor, Save, Archive / Restore); everyone else reads", () => {
    expect(tab).toContain("const canEdit = canEditVendors(profile);");
    expect(tab).toMatch(/\{canEdit && \(\s*<Button[^>]*onClick=\{\(\) => setOpen\("new"\)\}/);
    expect(tab).toContain("const readOnly = !canEdit;");
    expect(tab).toContain("readOnly={readOnly}");
    expect(tab).toMatch(/\{!readOnly && \(\s*<Button type="submit"/);
    expect(tab).toContain('{vendor.archived_at ? "Restore" : "Archive"}');
  });
  it("every field in the form; errors are loud toasts with the server's message", () => {
    for (const k of [
      "name",
      "address1",
      "address2",
      "city",
      "state",
      "zip",
      "contact_name",
      "phone",
      "email",
      "terms",
      "account_number",
    ])
      expect(tab).toContain(`{ key: "${k}", label: `);
    expect(tab).toContain('id="vendor-notes"');
    expect(tab).toContain('aria-label="Billable"');
    expect(tab).toContain("const problem = vendorFormProblem(draft);");
    expect(tab).toContain('loudError("Could not change the vendor", e)');
  });
  it("the History fold on a vendor (admins and managers: the fold hides itself otherwise)", () => {
    expect(tab).toContain('{vendor && <AuditHistory entity="vendor" entityId={vendor.id} />}');
  });
});

describe("the PO form's Vendor (purchase-orders-section.tsx)", () => {
  const src = read("src/components/service/purchase-orders-section.tsx");
  it("an optional Vendor box (every vendor not archived), saved with the PO", () => {
    const form = src.slice(src.indexOf("function PoForm("));
    expect(form).toContain(
      "const [vendorId, setVendorId] = useState<string | null>(po?.vendor_id ?? null);",
    );
    expect(form).toMatch(/<Label htmlFor=\{`\$\{idp\}-vendor`\}>Vendor<\/Label>\s*<VendorPicker/);
    const picker = form.slice(
      form.indexOf("<VendorPicker"),
      form.indexOf("/>", form.indexOf("<VendorPicker")),
    );
    expect(picker).not.toContain("billableOnly");
    expect(form).toContain("vendor_id: vendorId,");
    // After Price, before Notes (CenterPoint's order is kept).
    expect(form.indexOf(">Vendor</Label>")).toBeGreaterThan(form.indexOf(">Price *</Label>"));
    expect(form.indexOf(">Vendor</Label>")).toBeLessThan(form.indexOf(">Notes</Label>"));
  });
  it("the row shows whom it was bought from", () => {
    const row = src.slice(src.indexOf("function PoRow("), src.indexOf("const draftOf"));
    expect(row).toContain("{po.vendor_name ? (");
    expect(row).toContain("· from {po.vendor_name}");
  });
});
