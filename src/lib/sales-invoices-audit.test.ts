/**
 * Owner, Oct 1: "Sales and PMs should be able to see customers and invoices. However whatever is
 * changed needs to be logged somewhere showing what they did, when, and who."
 *
 * Owner, Oct 1 (later): "it's essential we record all actions accurately and durably." The log
 * is written by database triggers (migration 20261001080000_audit_triggers_stage_rule.sql), so a
 * direct database write is logged too; no server function writes it any more.
 *
 * `isSalesPm` / `seesInvoices` (access.ts), the History line (audit.ts), source checks that
 * invoice gates use `seesInvoices` while ticket creation / dispatch / rates keep `managesTickets`,
 * that no server code calls `logAudit` (the database logs), the History folds, the migration
 * 20261001070000_sales_invoices_audit.sql and the triggers in 20261001080000.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { isSalesPm, managesTickets, seesEveryone, seesInvoices } from "@/lib/access";
import { AUDIT_ACTIONS, AUDIT_ENTITIES, auditLine } from "@/lib/audit";

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

describe("auditLine (pure)", () => {
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
    expect([...AUDIT_ENTITIES]).toEqual([
      "invoice",
      "invoice_line",
      "account",
      "site",
      "contact",
      "purchase_order",
      "vendor",
    ]);
    expect([...AUDIT_ACTIONS]).toEqual([
      "create",
      "update",
      "delete",
      "finalize",
      "send",
      "paid",
      "void",
    ]);
  });
  it("a row written by the system (no signed-in user) reads 'system'", () => {
    expect(
      auditLine(
        {
          at: "2026-10-01T14:14:00Z",
          by_name: "system",
          by_role: null,
          summary: "Customer 'Acme' phone '555' → '556'",
        },
        "America/Chicago",
      ),
    ).toBe("Oct 1, 9:14 AM · system · Customer 'Acme' phone '555' → '556'");
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
      /\{ title: "Invoices", to: "\/service\/invoices", icon: Receipt, show: seesInvoices \}/,
    );
    expect(read("src/components/service-page.tsx")).toContain(
      "<ServiceTabs toInvoice={seesInvoices(profile) ? toInvoiceCount : 0} />",
    );
  });
  it("the send dialog reads Service Rates (the default message) only for a manager", () => {
    expect(read("src/components/service/invoice-editor.tsx")).toMatch(
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

/** Every non-test .ts / .tsx file under a directory. */
function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sources(p));
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

describe("the database logs: no server code calls logAudit", () => {
  it("audit.server.ts (logAudit) is gone", () => {
    expect(existsSync("src/lib/audit.server.ts")).toBe(false);
  });
  it("no source file calls logAudit, imports audit.server or writes audit_log", () => {
    for (const f of sources("src")) {
      const src = read(f);
      expect(src, f).not.toContain("logAudit(");
      expect(src, f).not.toContain("audit.server");
      expect(src, f).not.toMatch(/\.from\("audit_log"\)\s*\.(insert|update|delete|upsert)\(/);
    }
  });
  it("the invoice and customer functions no longer build audit entries", () => {
    for (const f of ["src/lib/invoices.functions.ts", "src/lib/crm.functions.ts"]) {
      const src = read(f);
      for (const word of ["auditActor", "diffForAudit", "diffInvoiceLines", "AuditEntry"])
        expect(src, `${f} ${word}`).not.toContain(word);
    }
  });
  it("a saved invoice keeps its lines' ids (edited in place), so the line log is per change", () => {
    const fn = serverFn(read("src/lib/invoices.functions.ts"), "saveInvoice");
    expect(fn).toMatch(/\.from\("invoice_lines"\)\s*\.update\(/);
    expect(fn).toMatch(/\.from\("invoice_lines"\)\s*\.delete\(\)\s*\.in\("id", removed\)/);
    expect(fn).not.toMatch(/\.from\("invoice_lines"\)\.delete\(\)\.eq\("invoice_id", inv\.id\)/);
  });
  it("a saved contact links and unlinks only the sites that changed", () => {
    // Since Oct 2 in one transaction: save_contact_with_sites (20261002130000_audit_readable.sql)
    // deletes only the links no longer wanted and inserts only the new ones.
    const fn = serverFn(read("src/lib/crm.functions.ts"), "saveContact");
    expect(fn).toContain('sb.rpc("save_contact_with_sites", saveContactArgs(data))');
    expect(fn).not.toContain('.from("crm_site_contacts")');
    const sql = read("supabase/migrations/20261002130000_audit_readable.sql")
      .replace(/--[^\n]*/g, "")
      .replace(/\s+/g, " ");
    expect(sql).toContain(
      "delete from public.crm_site_contacts sc where sc.contact_id = v_row.id and not (sc.site_id = any (p_site_ids));",
    );
    expect(sql).toContain("on conflict (site_id, contact_id) do nothing;");
    expect(sql).not.toMatch(
      /delete from public\.crm_site_contacts sc where sc\.contact_id = v_row\.id;/,
    );
  });
});

describe("migration 20261001080000: audit triggers", () => {
  const sql = read("supabase/migrations/20261001080000_audit_triggers_stage_rule.sql");
  const flat = sql.replace(/--[^\n]*/g, "").replace(/\s+/g, " ");
  it("a row trigger on each of the five tables (and the contact ↔ site links)", () => {
    for (const t of ["invoices", "invoice_lines", "crm_accounts", "crm_sites", "crm_contacts"])
      expect(flat, t).toContain(
        `drop trigger if exists ${t}_audit on public.${t}; create trigger ${t}_audit after insert or update or delete on public.${t} for each row execute function public.audit_row();`,
      );
    expect(flat).toContain(
      "drop trigger if exists crm_site_contacts_audit on public.crm_site_contacts; create trigger crm_site_contacts_audit after insert or delete on public.crm_site_contacts for each row execute function public.audit_row();",
    );
  });
  it("audit_row is security definer with a fixed search_path", () => {
    expect(flat).toContain(
      "create or replace function public.audit_row() returns trigger language plpgsql security definer set search_path = public as $$",
    );
    expect(flat).toContain("revoke all on function public.audit_row() from public;");
  });
  it("entity per table; an invoice line is logged on its invoice", () => {
    for (const [t, e] of [
      ["invoices", "invoice"],
      ["invoice_lines", "invoice_line"],
      ["crm_accounts", "account"],
      ["crm_sites", "site"],
      ["crm_contacts", "contact"],
    ])
      expect(flat, t).toContain(`when '${t}' then v_entity := '${e}';`);
    expect(flat).toContain("v_entity_id := (v_row ->> 'invoice_id')::uuid;");
  });
  it("detects finalize / send / paid / void from the invoice's transition", () => {
    expect(flat).toContain(
      "if v_new ->> 'status' = 'void' and v_old ->> 'status' is distinct from 'void' then v_action := 'void';",
    );
    expect(flat).toContain(
      "elsif (v_old ->> 'paid_on' is null and v_new ->> 'paid_on' is not null) or (v_new ->> 'status' = 'paid' and v_old ->> 'status' is distinct from 'paid') then v_action := 'paid';",
    );
    expect(flat).toContain(
      "elsif v_new ->> 'sent_at' is not null and v_new ->> 'sent_at' is distinct from v_old ->> 'sent_at' then v_action := 'send';",
    );
    expect(flat).toContain(
      "elsif v_old ->> 'status' = 'draft' and v_new ->> 'status' = 'final' then v_action := 'finalize';",
    );
  });
  it("a soft delete is a delete; a restore an update 'restored'", () => {
    expect(flat).toContain(
      "elsif v_old ? 'deleted_at' and v_old ->> 'deleted_at' is null and v_new ->> 'deleted_at' is not null then v_action := 'delete';",
    );
    expect(flat).toContain(
      "elsif v_old ? 'deleted_at' and v_old ->> 'deleted_at' is not null and v_new ->> 'deleted_at' is null then v_action := 'update'; v_restored := true;",
    );
    expect(flat).toContain("v_summary := v_label || ' restored';");
  });
  it("leaves the bookkeeping columns out of the diff", () => {
    expect(flat).toContain(
      "v_skip constant text[] := array['id', 'created_at', 'created_by', 'updated_at', 'updated_by_name', 'pdf_path', 'sage_exported_at', 'sort'];",
    );
  });
  it("who: the signed-in user from profiles (sales for a sales / PM), else 'system'", () => {
    expect(flat).toContain("if v_uid is null then v_name := 'system'; v_role := null;");
    expect(flat).toContain("when public.is_sales_pm() then 'sales'");
    expect(flat).toContain(
      "insert into public.audit_log (by_user, by_name, by_role, entity, entity_id, action, summary, changes) values (v_uid, v_name, v_role, v_entity, v_entity_id, v_action, v_summary, v_changes);",
    );
  });
  it("append-only: no app insert policy, no update / delete policy, writes revoked", () => {
    expect(flat).toContain("drop policy if exists audit_log_insert on public.audit_log;");
    expect(flat).not.toContain("create policy audit_log_insert");
    expect(flat).not.toMatch(/on public\.audit_log for (insert|update|delete|all)/);
    expect(flat).toContain(
      "revoke insert, update, delete, truncate on public.audit_log from anon, authenticated, service_role;",
    );
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
  it("is on the invoice page (invoice-editor.tsx, moved from the ticket block) and the customer profile", () => {
    expect(read("src/components/service/invoice-editor.tsx")).toMatch(
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
