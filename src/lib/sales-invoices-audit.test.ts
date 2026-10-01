/**
 * Owner, Oct 1: "Sales and PMs should be able to see customers and invoices. However whatever is
 * changed needs to be logged somewhere showing what they did, when, and who."
 *
 * `isSalesPm` / `seesInvoices` (access.ts), the pure audit helpers (audit.ts), source checks that
 * invoice gates use `seesInvoices` while ticket creation / dispatch / rates keep `managesTickets`,
 * that every invoice and customer write path calls `logAudit`, the History folds, and the
 * migration 20261001070000_sales_invoices_audit.sql.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { isSalesPm, managesTickets, seesEveryone, seesInvoices } from "@/lib/access";
import {
  ACCOUNT_FIELDS,
  AUDIT_ACTIONS,
  AUDIT_ENTITIES,
  INVOICE_LINE_FIELDS,
  auditActor,
  auditLine,
  auditRole,
  auditSummary,
  diffForAudit,
  diffInvoiceLines,
} from "@/lib/audit";

const read = (p: string) => readFileSync(p, "utf8");
function serverFn(src: string, name: string): string {
  const start = src.indexOf(`export const ${name} = createServerFn`);
  expect(start, `${name} not found`).toBeGreaterThanOrEqual(0);
  const next = src.indexOf("\nexport ", start + 1);
  return src.slice(start, next < 0 ? undefined : next);
}

const admin = { role: "admin", access: [] };
const manager = { role: "manager", access: [] };
const managerTech = { role: "manager", access: [], technician: true };
const sales = { role: "user", access: ["estimate", "customers"], technician: false };
const salesOnlyEstimate = { role: "user", access: ["estimate"] };
const techWithEstimate = { role: "user", access: ["estimate", "service"], technician: true };
const office = { role: "user", access: ["service", "customers", "pricing"], technician: false };

describe("isSalesPm / seesInvoices", () => {
  it("a plain user with Estimate who is not a technician is sales / PM", () => {
    expect(isSalesPm(sales)).toBe(true);
    expect(isSalesPm(salesOnlyEstimate)).toBe(true);
  });
  it("a technician with Estimate is NOT sales", () => {
    expect(isSalesPm(techWithEstimate)).toBe(false);
    expect(seesInvoices(techWithEstimate)).toBe(false);
  });
  it("a manager sees invoices but is not sales; an admin likewise", () => {
    for (const p of [manager, managerTech, admin]) {
      expect(isSalesPm(p)).toBe(false);
      expect(seesInvoices(p)).toBe(true);
    }
  });
  it("an office user without Estimate, nobody, and a user with no pages see no invoices", () => {
    expect(isSalesPm(office)).toBe(false);
    expect(seesInvoices(office)).toBe(false);
    expect(seesInvoices(null)).toBe(false);
    expect(seesInvoices(undefined)).toBe(false);
    expect(seesInvoices({ role: "user", access: [] })).toBe(false);
  });
  it("seesInvoices = managesTickets or isSalesPm; managesTickets is unchanged", () => {
    for (const p of [admin, manager, managerTech, sales, techWithEstimate, office, null])
      expect(seesInvoices(p)).toBe(managesTickets(p) || isSalesPm(p));
    expect(managesTickets(sales)).toBe(false);
  });
});

describe("diffForAudit (pure)", () => {
  it("lists only the fields that changed, old → new, money included", () => {
    expect(
      diffForAudit(
        { rate: 85, qty: 2, description: "Labor", total: 170 },
        { rate: 95, qty: 2, description: "Labor", total: 190 },
        ["rate", "qty", "description", "total"],
      ),
    ).toEqual({ rate: { from: 85, to: 95 }, total: { from: 170, to: 190 } });
  });
  it("ignores fields not listed", () => {
    expect(diffForAudit({ a: 1, updated_at: "x" }, { a: 1, updated_at: "y" }, ["a"])).toEqual({});
  });
  it("treats null, undefined and blank text alike; numeric strings equal their numbers", () => {
    expect(
      diffForAudit({ po: null, note: "", rate: "85.00" }, { po: undefined, note: "  ", rate: 85 }, [
        "po",
        "note",
        "rate",
      ]),
    ).toEqual({});
  });
  it("compares objects by value regardless of key order", () => {
    expect(
      diffForAudit({ bill_to: { name: "A", city: "B" } }, { bill_to: { city: "B", name: "A" } }, [
        "bill_to",
      ]),
    ).toEqual({});
    expect(diffForAudit({ ids: ["a"] }, { ids: ["a", "b"] }, ["ids"])).toEqual({
      ids: { from: ["a"], to: ["a", "b"] },
    });
  });
  it("a create (no before) lists the set fields from null; a delete (no after) to null", () => {
    expect(diffForAudit(null, { name: "Acme", phone: null }, ["name", "phone"])).toEqual({
      name: { from: null, to: "Acme" },
    });
    expect(diffForAudit({ name: "Acme" }, null, ["name"])).toEqual({
      name: { from: "Acme", to: null },
    });
  });
  it("an empty list is nothing (a new contact with no sites)", () => {
    expect(diffForAudit(null, { site_ids: [] }, ["site_ids"])).toEqual({});
    expect(diffForAudit({ site_ids: ["s1"] }, { site_ids: [] }, ["site_ids"])).toEqual({
      site_ids: { from: ["s1"], to: [] },
    });
  });
  it("never stores undefined (jsonb-safe)", () => {
    const d = diffForAudit({ a: undefined }, { a: 1 }, ["a"]);
    expect(d).toEqual({ a: { from: null, to: 1 } });
    expect(JSON.parse(JSON.stringify(d))).toEqual(d);
  });
});

describe("auditSummary (pure)", () => {
  it("the owner's example: a line's rate", () => {
    expect(
      auditSummary(
        "invoice_line",
        "update",
        { rate: { from: 85, to: 95 } },
        "Invoice 6012 line 'Labor'",
      ),
    ).toBe("Invoice 6012 line 'Labor' rate 85 → 95");
  });
  it("names fields in words and quotes text; blanks show as —", () => {
    expect(
      auditSummary(
        "account",
        "update",
        { contact_name: { from: null, to: "Ann" }, tax_exempt: { from: false, to: true } },
        "Customer 'Acme'",
      ),
    ).toBe("Customer 'Acme' contact name — → 'Ann'; tax exempt no → yes");
  });
  it("verbs per action; a create lists values, a delete none", () => {
    expect(
      auditSummary("invoice", "create", { total: { from: null, to: 450 } }, "Invoice 6012"),
    ).toBe("Invoice 6012 created: total 450");
    expect(
      auditSummary(
        "invoice_line",
        "create",
        { qty: { from: null, to: 2 } },
        "Invoice 6012 line 'Labor'",
      ),
    ).toBe("Invoice 6012 line 'Labor' added: qty 2");
    expect(
      auditSummary(
        "invoice_line",
        "delete",
        { qty: { from: 2, to: null } },
        "Invoice 6012 line 'Labor'",
      ),
    ).toBe("Invoice 6012 line 'Labor' removed");
    expect(auditSummary("contact", "delete", {}, "Contact 'Bob'")).toBe("Contact 'Bob' deleted");
    expect(auditSummary("invoice", "finalize", {}, "Invoice 6012")).toBe("Invoice 6012 finalized");
    expect(
      auditSummary("invoice", "send", { sent_to: { from: null, to: ["a@b.co"] } }, "Invoice 6012"),
    ).toBe("Invoice 6012 sent: sent to a@b.co");
    expect(
      auditSummary("invoice", "paid", { paid_amount: { from: 0, to: 450.5 } }, "Invoice 6012"),
    ).toBe("Invoice 6012 marked paid: paid amount 0 → 450.5");
    expect(auditSummary("invoice", "void", {}, "Invoice 6012")).toBe("Invoice 6012 voided");
  });
  it("falls back to the entity's name and caps a long list", () => {
    expect(auditSummary("site", "update", { name: { from: "A", to: "B" } })).toBe(
      "Site name 'A' → 'B'",
    );
    const many = Object.fromEntries(
      ["a", "b", "c", "d", "e", "f", "g", "h"].map((k, i) => [k, { from: i, to: i + 1 }]),
    );
    expect(auditSummary("account", "update", many, "Customer 'X'")).toBe(
      "Customer 'X' a 0 → 1; b 1 → 2; c 2 → 3; d 3 → 4; e 4 → 5; f 5 → 6; +2 more",
    );
  });
});

describe("diffInvoiceLines (pure)", () => {
  const line = (id: number, description: string, rate: number, qty = 1) => ({
    id,
    kind: "labor",
    description,
    qty,
    unit: "hr",
    rate,
    total: qty * rate,
    cost_rate: 40,
    cost_total: qty * 40,
    on_date: null,
    taxable: true,
    source: null,
  });
  it("matches kept lines by id; reports added, edited and removed lines", () => {
    const before = [line(1, "Labor", 85, 2), line(2, "Travel", 60), line(3, "Caulk", 10)];
    const { id: _drop, ...fresh } = line(0, "Membrane", 5, 10);
    const after = [{ ...line(1, "Labor", 95, 2) }, line(2, "Travel", 60), fresh];
    const d = diffInvoiceLines(before, after);
    expect(d).toEqual([
      {
        action: "update",
        description: "Labor",
        changes: { rate: { from: 85, to: 95 }, total: { from: 170, to: 190 } },
      },
      {
        action: "create",
        description: "Membrane",
        changes: diffForAudit(null, fresh, INVOICE_LINE_FIELDS),
      },
      {
        action: "delete",
        description: "Caulk",
        changes: diffForAudit(before[2]!, null, INVOICE_LINE_FIELDS),
      },
    ]);
  });
  it("an unchanged line is not reported; an id from another invoice counts as new", () => {
    expect(diffInvoiceLines([line(1, "Labor", 85)], [line(1, "Labor", 85)])).toEqual([]);
    expect(diffInvoiceLines([], [line(9, "X", 1)]).map((x) => x.action)).toEqual(["create"]);
  });
});

describe("auditRole / auditActor / auditLine (pure)", () => {
  it("labels the actor's role", () => {
    expect(auditRole(admin)).toBe("admin");
    expect(auditRole(managerTech)).toBe("manager");
    expect(auditRole(sales)).toBe("sales");
    expect(auditRole(techWithEstimate)).toBe("technician");
    expect(auditRole(office)).toBe("user");
  });
  it("names the actor by full name, else email", () => {
    expect(auditActor("u1", { ...sales, full_name: " RoAnna Sims ", email: "r@jbk.co" })).toEqual({
      id: "u1",
      name: "RoAnna Sims",
      role: "sales",
    });
    expect(auditActor("u2", { ...manager, full_name: null, email: "m@jbk.co" }).name).toBe(
      "m@jbk.co",
    );
  });
  it("one History line: when · who (role) · what", () => {
    expect(
      auditLine(
        {
          at: "2026-10-01T14:14:00Z",
          by_name: "RoAnna Sims",
          by_role: "sales",
          summary: "Invoice 6012 line 'Labor' rate 85 → 95",
        },
        "America/Chicago",
      ),
    ).toBe("Oct 1, 9:14 AM · RoAnna Sims (sales) · Invoice 6012 line 'Labor' rate 85 → 95");
  });
  it("the entity and action values the Owner view relies on", () => {
    expect([...AUDIT_ENTITIES]).toEqual(["invoice", "invoice_line", "account", "site", "contact"]);
    expect([...AUDIT_ACTIONS]).toEqual([
      "create",
      "update",
      "delete",
      "finalize",
      "send",
      "paid",
      "void",
    ]);
    expect(ACCOUNT_FIELDS).toContain("tax_exempt");
  });
});

describe("invoice gates use seesInvoices; creation, dispatch and rates keep managesTickets", () => {
  const inv = read("src/lib/invoices.functions.ts");
  it("the invoice server functions (office) gate on seesInvoices", () => {
    expect(inv).toMatch(
      /async function office[\s\S]*?if \(!seesInvoices\(data\)\) throw new Error\("Invoices are a manager's or sales'"\);/,
    );
    expect(inv).not.toContain(
      `if (!managesTickets(data)) throw new Error("Invoices are a manager's");`,
    );
    for (const fn of [
      "getOrCreateInvoice",
      "createAnotherInvoice",
      "listTicketInvoices",
      "getInvoice",
      "rebuildInvoiceLines",
      "saveInvoice",
      "renderInvoice",
      "finalizeInvoice",
      "sendInvoice",
      "markInvoicePaid",
      "voidInvoice",
      "listInvoices",
      "exportSageCsv",
    ])
      expect(serverFn(inv, fn), fn).toMatch(/await office\(context\)/);
  });
  it("the Service Rates page stays a manager's", () => {
    expect(inv).toMatch(
      /async function ratesManager[\s\S]*?if \(!managesTickets\(data\)\) throw new Error\("Service rates are a manager's"\);/,
    );
    expect(serverFn(inv, "getServiceRates")).toContain("await ratesManager(context);");
    expect(serverFn(inv, "setServiceRates")).toContain("await ratesManager(context);");
  });
  it("the block on the ticket, the Invoices page and the Invoices tab use seesInvoices", () => {
    expect(read("src/components/service/invoice-block.tsx")).toMatch(
      /export function InvoiceBlock[\s\S]*?if \(!profile \|\| !seesInvoices\(profile\)\) return null;/,
    );
    expect(read("src/components/service/invoices-page.tsx")).toMatch(
      /export function InvoicesPage[\s\S]*?if \(!seesInvoices\(profile\)\)\s*return \(/,
    );
    expect(read("src/components/service/service-tabs.tsx")).toMatch(
      /const invoices = seesInvoices\(profile\);\s*const tabs = TABS\.filter\(\(t\) => !t\.office \|\| invoices\);/,
    );
    expect(read("src/components/service-page.tsx")).toContain(
      "<ServiceTabs toInvoice={seesInvoices(profile) ? toInvoiceCount : 0} />",
    );
  });
  it("the send dialog reads Service Rates (the default message) only for a manager", () => {
    expect(read("src/components/service/invoice-block.tsx")).toMatch(
      /queryKey: \["service-rates"\],\s*queryFn: \(\) => ratesFn\(\),(?:\s*\/\/[^\n]*)*\s*enabled: !!session && managesTickets\(profile\),/,
    );
  });
  it("ticket creation, dispatch, crew rates and repair prices still use managesTickets", () => {
    const svc = read("src/lib/service.functions.ts");
    expect(serverFn(svc, "saveServiceJob")).toMatch(/const manager = managesTickets\(p\);/);
    expect(svc).toContain(
      'if (!managesTickets(p)) throw new Error("Only a manager dispatches tickets");',
    );
    expect(serverFn(svc, "listJobCrew")).toContain("const noMoney = !managesTickets(p);");
    expect(serverFn(svc, "getCrewRateDefaults")).toContain(
      `if (!managesTickets(p)) throw new Error("Rates are a manager's");`,
    );
    const field = read("src/lib/service-field.functions.ts");
    expect(serverFn(field, "saveRepairTemplate")).toContain(
      'if (!managesTickets(p)) throw new Error("Only a manager edits repair templates");',
    );
    for (const f of [
      "src/lib/service.functions.ts",
      "src/lib/service-field.functions.ts",
      "src/components/service/board-page.tsx",
    ])
      expect(read(f), f).not.toContain("seesInvoices");
  });
});

/**
 * Every function in a file that writes (insert / update / delete / upsert) one of the audited
 * tables must call logAudit after its last such write.
 */
const AUDITED = ["invoices", "invoice_lines", "crm_accounts", "crm_sites", "crm_contacts"];
function chunks(src: string): { name: string; body: string }[] {
  const re = /\n(?:export const (\w+) = createServerFn|async function (\w+)\()/g;
  const starts: { name: string; at: number }[] = [];
  for (let m = re.exec(src); m; m = re.exec(src)) starts.push({ name: m[1] ?? m[2]!, at: m.index });
  return starts.map((s, i) => ({
    name: s.name,
    body: src.slice(s.at, starts[i + 1]?.at ?? src.length),
  }));
}
function lastWrite(body: string): number {
  let last = -1;
  const re = /\.from\("(\w+)"\)\s*\.(insert|update|delete|upsert)\(/g;
  for (let m = re.exec(body); m; m = re.exec(body)) if (AUDITED.includes(m[1]!)) last = m.index;
  return last;
}

describe("every invoice and customer write calls logAudit", () => {
  const expected: Record<string, string[]> = {
    "src/lib/invoices.functions.ts": [
      "createInvoiceFor",
      "rebuildInvoiceLines",
      "saveInvoice",
      "finalizeInvoice",
      "sendInvoice",
      "markInvoicePaid",
      "voidInvoice",
      "exportSageCsv",
    ],
    "src/lib/crm.functions.ts": [
      "saveAccount",
      "saveSite",
      "quickCreateAccount",
      "deleteAccount",
      "deleteSite",
      "saveContact",
      "deleteContact",
    ],
  };
  for (const [file, names] of Object.entries(expected)) {
    const src = read(file);
    const writers = chunks(src).filter((c) => lastWrite(c.body) >= 0);
    it(`${file}: the writers are exactly the expected ones`, () => {
      expect(writers.map((c) => c.name).sort()).toEqual([...names].sort());
    });
    for (const c of writers)
      it(`${file} ${c.name} logs after its last write`, () => {
        expect(c.body.indexOf("logAudit(", lastWrite(c.body)), c.name).toBeGreaterThan(0);
      });
  }
  it("no other server code writes those tables", () => {
    for (const f of [
      "src/lib/service.functions.ts",
      "src/lib/service-field.functions.ts",
      "src/lib/opportunities.functions.ts",
      "src/lib/takeoff.functions.ts",
      "src/lib/invoices.server.ts",
    ])
      expect(lastWrite(read(f)), f).toBe(-1);
  });
  it("logAudit never throws: it catches and console-logs", () => {
    const src = read("src/lib/audit.server.ts");
    expect(src).toMatch(
      /export async function logAudit\([\s\S]*?try \{[\s\S]*?\} catch \(e\) \{\s*console\.error\(/,
    );
    expect(src).toMatch(/if \(error\)\s*console\.error\(/);
  });
});

describe("History folds and listAudit: admins and managers only", () => {
  it("listAudit refuses anyone but an admin or a manager", () => {
    const src = read("src/lib/audit.functions.ts");
    expect(serverFn(src, "listAudit")).toMatch(
      /if \(!seesEveryone\(p\)\) throw new Error\("The history is for admins and managers"\);/,
    );
  });
  it("the fold renders nothing for anyone else (a sales user does not see it)", () => {
    const src = read("src/components/audit-history.tsx");
    expect(src).toMatch(/if \(!seesEveryone\(profile\)\) return null;/);
    expect(seesEveryone(sales)).toBe(false);
    expect(seesEveryone(manager)).toBe(true);
  });
  it("is on the invoice block and the customer profile", () => {
    expect(read("src/components/service/invoice-block.tsx")).toMatch(
      /<AuditHistory entity="invoice" entityId=\{data\.invoice\.id\}/,
    );
    expect(read("src/components/customers-page.tsx")).toMatch(
      /<AuditHistory entity="account" entityId=\{id\}/,
    );
  });
});

describe("migration 20261001070000_sales_invoices_audit.sql", () => {
  const sql = read("supabase/migrations/20261001070000_sales_invoices_audit.sql");
  const flat = sql.replace(/--[^\n]*/g, "").replace(/\s+/g, " ");
  const three = "public.is_admin() or public.is_manager() or public.is_sales_pm()";
  it("is_sales_pm(): security definer; role user, not technician, Estimate", () => {
    expect(flat).toMatch(
      /create or replace function public\.is_sales_pm\(\) returns boolean language sql stable security definer set search_path = public as \$\$ select exists \( select 1 from public\.profiles p where p\.id = auth\.uid\(\) and p\.role = 'user' and not coalesce\(p\.technician, false\) and 'estimate' = any\(p\.access\) \); \$\$;/,
    );
    expect(flat).toContain("grant execute on function public.is_sales_pm() to authenticated;");
  });
  it("invoices, invoice lines and invoice PDFs: admin, manager or sales / PM", () => {
    for (const t of [
      "invoices_office on public.invoices",
      "invoice_lines_office on public.invoice_lines",
    ])
      expect(flat).toContain(
        `create policy ${t} for all to authenticated using (${three}) with check (${three});`,
      );
    expect(flat).toContain(
      "(name not like 'invoices/%' or public.is_admin() or public.is_manager() or public.is_sales_pm())",
    );
  });
  it("the audit_log table has exactly the agreed shape", () => {
    expect(flat).toContain(
      "create table if not exists public.audit_log ( id bigserial primary key, at timestamptz not null default now(), by_user uuid default auth.uid(), by_name text, by_role text, entity text not null, entity_id uuid, action text not null, summary text, changes jsonb );",
    );
    expect(flat).toContain(
      "check (entity in ('invoice', 'invoice_line', 'account', 'site', 'contact'))",
    );
    expect(flat).toContain(
      "check (action in ('create', 'update', 'delete', 'finalize', 'send', 'paid', 'void'))",
    );
  });
  it("audit_log: insert by the signed-in user as themselves; read by admins and managers", () => {
    expect(flat).toContain("alter table public.audit_log enable row level security;");
    expect(flat).toContain(
      "create policy audit_log_insert on public.audit_log for insert to authenticated with check (by_user = auth.uid());",
    );
    expect(flat).toContain(
      "create policy audit_log_read on public.audit_log for select to authenticated using (public.is_admin() or public.is_manager());",
    );
    expect(flat).not.toMatch(/on public\.audit_log for (update|delete|all)/);
  });
  it("is idempotent (drop … if exists before every create policy)", () => {
    const creates = [...flat.matchAll(/create policy (\w+) on ([\w.]+)/g)];
    for (const [, name, table] of creates)
      expect(flat).toContain(`drop policy if exists ${name} on ${table};`);
  });
  it("types.ts knows audit_log and is_sales_pm", () => {
    const types = read("src/integrations/supabase/types.ts");
    expect(types).toMatch(
      /audit_log: \{\s*Row: \{\s*action: string;\s*at: string;\s*by_name: string \| null;\s*by_role: string \| null;\s*by_user: string \| null;\s*changes: Json \| null;\s*entity: string;\s*entity_id: string \| null;\s*id: number;\s*summary: string \| null;/,
    );
    expect(types).toContain("is_sales_pm: { Args: never; Returns: boolean };");
  });
});
