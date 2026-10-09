/**
 * Owner, Oct 1: "only the managers / admins can see and edit the prices on invoices / repairs /
 * inspections etc."; "The manager creates the tickets; reps do not create tickets"; "the
 * per-technician charge is separate from estimate pricing and can be edited per job".
 * `managesTickets` (admin or manager) decides every ticket price and deleting; since Oct 9
 * creating and dispatching (the technician, the date, the Board) are `dispatchesTickets` — the
 * office too, logged (office-dispatch.test.ts) — while `isOffice` decides only who sees what.
 * Unit tests of the pure rules plus source checks of the components, server functions and the
 * migration.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { isOffice, managesTickets, pageForPath, seesEveryone } from "@/lib/access";
import { confirmedCrew, type CrewRow } from "@/lib/service-crew";
import { crewRowWriteAllowed, templatesForViewer } from "@/lib/ticket-money";

const read = (p: string) => readFileSync(p, "utf8");
/** The source of one `export const name = createServerFn(...)` up to the next export. */
function serverFn(src: string, name: string): string {
  const start = src.indexOf(`export const ${name} = createServerFn`);
  expect(start, `${name} not found`).toBeGreaterThanOrEqual(0);
  const next = src.indexOf("\nexport ", start + 1);
  return src.slice(start, next < 0 ? undefined : next);
}
/** Every trimmed line of `src` that contains `needle`. */
const linesWith = (src: string, needle: string) =>
  src
    .split("\n")
    .filter((l) => l.includes(needle))
    .map((l) => l.trim());

const admin = { role: "admin", access: [] };
const adminTech = { role: "admin", access: [], technician: true };
const manager = { role: "manager", access: [] };
const managerTech = { role: "manager", access: [], technician: true };
const office = { role: "user", access: ["service", "customers", "pricing"], technician: false };
const tech = { role: "user", access: ["service"], technician: true };

describe("managesTickets: admins and managers only", () => {
  it("is true for admins and managers (also ticked Technician)", () => {
    for (const p of [admin, adminTech, manager, managerTech]) expect(managesTickets(p)).toBe(true);
  });
  it("is false for an office user (even with Estimate Pricing), a technician and nobody", () => {
    expect(managesTickets(office)).toBe(false);
    expect(managesTickets(tech)).toBe(false);
    expect(managesTickets(null)).toBe(false);
    expect(managesTickets(undefined)).toBe(false);
  });
  it("is seesEveryone; isOffice (visibility) is wider and unchanged", () => {
    for (const p of [admin, manager, office, tech, null])
      expect(managesTickets(p)).toBe(seesEveryone(p));
    expect(isOffice(office)).toBe(true);
    expect(isOffice(tech)).toBe(false);
  });
  it("its doc comment quotes the rule", () => {
    const src = read("src/lib/access.ts");
    const at = src.indexOf("export const managesTickets");
    const doc = src.slice(src.lastIndexOf("/**", at), at).replace(/\s*\n\s*\*\s*/g, " ");
    expect(doc).toContain("The manager creates the tickets; reps do not create tickets");
    expect(doc).toContain("only the managers / admins can see and edit the prices");
  });
});

describe("the gate and the Admin group", () => {
  it('/setup (and its old address /admin/service-rates) is a "manager" page; Users and Reminders stay admin', () => {
    expect(pageForPath("/setup")).toBe("manager");
    expect(pageForPath("/admin/service-rates")).toBe("manager");
    expect(pageForPath("/admin/users")).toBe("admin");
    expect(pageForPath("/admin/reminders")).toBe("admin");
    expect(pageForPath("/admin/settings")).toBe("pricing");
  });
  it('the auth gate lets "manager" pages through on managesTickets', () => {
    const gate = read("src/components/auth-gate.tsx");
    expect(gate).toMatch(/page === "manager"\s*\?\s*!managesTickets\(profile\)/);
  });
  it("the sidebar: Setup (managers and admins) under Opportunities; the Admin group admins only", () => {
    // Owner, Oct 5: Service Rates became Setup, under Opportunities in the Customers group; with
    // it gone the Admin group holds only admin pages (setup-page.test.ts has the detail).
    const nav = read("src/components/app-sidebar.tsx");
    expect(nav).toMatch(/\{role === "admin" && \(\s*<NavGroup label="Admin"/);
    expect(nav).toMatch(
      /title: "Users & access", url: "\/admin\/users", icon: Users, adminOnly: true/,
    );
    expect(nav).toMatch(
      /title: "Reminders", url: "\/admin\/reminders", icon: BellRing, adminOnly: true/,
    );
    expect(nav).not.toContain("/admin/service-rates");
    expect(nav).toMatch(
      /title: "Setup", url: "\/setup", icon: Settings2, page: null, visible: managesTickets/,
    );
  });
});

describe("isOffice is left only where it decides visibility or own-ticket editing", () => {
  // Every remaining `isOffice(` line, file by file. Anything else (money, creating, dispatch)
  // goes through managesTickets.
  const allowed: Record<string, string[]> = {
    // Who sees every ticket, and whether a technician edits only their own.
    "src/lib/service.functions.ts": ["if (!isOffice(p) && cur.technician_id !== context.userId)"],
    // The stage rule: a technician sets Open / Scheduled / Done (Invoiced / Closed: managesTickets).
    // canCloseOut: the lead technician closes out until the office invoices (an office lead
    // at any stage).
    "src/lib/ticket-stage.ts": [
      "if (!isOffice(p)) return TECH_STAGES.includes(stage) ? null : TECH_STAGE_MESSAGE;",
      "return isOffice(p) || TECH_STAGES.includes(job.stage as ServiceStage);",
    ],
    // myDay lists the caller's own tickets for everyone since Oct 9 (my-tickets-page.test.ts),
    // so only the own-ticket editing check remains here.
    "src/lib/service-field.functions.ts": ["if (!isOffice(p) && job.technician_id !== ctx.userId)"],
    "src/lib/service-aerial.functions.ts": [
      "if (!isOffice(p) && job.technician_id !== context.userId)",
    ],
    // saveTicketInspection: a technician saves only their own inspection.
    "src/lib/service-inspection.functions.ts": [
      "const isTech = (p: { technician: boolean; role: string }) => !isOffice(p);",
    ],
    "src/lib/invoices.functions.ts": [],
    // The list's stage chips and Mine filter; the editor's canEdit, stage options and layout.
    "src/components/service-page.tsx": [
      "const isTech = !isOffice(profile);",
      "const isTech = !isOffice(profile);",
    ],
    "src/components/service/closeout.tsx": ["const isTech = !isOffice(profile);"],
    "src/components/service/ticket-extras.tsx": ["const officeOrAdmin = isOffice(profile);"],
    // Today first and no Board items for a technician.
    "src/components/app-sidebar.tsx": ["const isTech = !!profile && !isOffice(profile);"],
    "src/components/service/invoice-block.tsx": [],
    "src/components/service/invoice-editor.tsx": [],
    "src/components/service/invoices-page.tsx": [],
    "src/components/service/board-page.tsx": [],
    "src/components/service/service-tabs.tsx": [],
    "src/components/service/ticket-field-sections.tsx": [],
    "src/components/service/materials-section.tsx": [],
    "src/components/customers-page.tsx": [],
  };
  for (const [file, lines] of Object.entries(allowed))
    it(file, () => {
      expect(linesWith(read(file), "isOffice(")).toEqual(lines);
    });

  it("the ticket editor keeps officeOrAdmin for canEdit, Job #, layout and Time only", () => {
    const src = read("src/components/service-page.tsx");
    expect(
      linesWith(src, "officeOrAdmin").filter((l) => !l.startsWith("*") && !l.startsWith("//")),
    ).toEqual([
      "const officeOrAdmin = !isTech;",
      "const canEdit = !job || officeOrAdmin || (job.technician_id === profile?.id && !officeStage);",
      "...(officeOrAdmin ? { job_number: draft.job_number.trim() || null } : {}),",
      "{officeOrAdmin && (",
      "const twoPane = officeOrAdmin && !!job;",
      "<InspectionSection job={job} canEdit={canEdit} officeOrAdmin={officeOrAdmin} />",
      "<TicketFieldSections job={job} officeOrAdmin={officeOrAdmin} repairs={false} />",
      "<TicketFieldSections job={job} officeOrAdmin={officeOrAdmin} />",
    ]);
  });
});

describe("creating tickets is the office's and a manager's (dispatchesTickets since Oct 9); Delete a manager's", () => {
  const page = read("src/components/service-page.tsx");
  it("the list's New ticket and first-ticket buttons render under dispatchesTickets", () => {
    expect(page).toMatch(/const manager = managesTickets\(profile\);/);
    expect(page).toMatch(/const dispatcher = dispatchesTickets\(profile\);/);
    expect(page).toMatch(
      /\{dispatcher && \(\s*<Button size="lg" className="text-base font-semibold" onClick=\{newTicket\}>\s*<Plus className="mr-2 h-5 w-5" \/> New ticket/,
    );
    expect(page).toMatch(
      /\{dispatcher && \(\s*<Button variant="outline" className="mt-4" onClick=\{newTicket\}>/,
    );
  });
  it("?new=1 sends a technician-only user away", () => {
    expect(page).toMatch(
      /if \(isNew\) \{[\s\S]*?if \(!dispatchesTickets\(profile\)\) return <OfficeCreatesTickets \/>;[\s\S]*?<NewFromTicket/,
    );
  });
  it("Repeat (New ticket for this site) is a dispatcher's; Delete a manager's", () => {
    expect(page).toMatch(/\{dispatcher && repeatable && \(/);
    expect(page).toMatch(
      /\{manager && \(\s*<Button\s+variant="outline"\s+className="text-destructive/,
    );
    expect(page).toMatch(/onDelete=\{manager \? \(\) => setToDelete\(j\) : undefined\}/);
  });
  it("the Customers page's New ticket buttons too", () => {
    const cust = read("src/components/customers-page.tsx");
    // A deleted customer (read-only, audit Oct 2) offers no New ticket either.
    expect(linesWith(cust, "const canNewTicket = ")).toEqual([
      'const canNewTicket = can("service") && managesTickets(profile) && !props.readOnly;',
      'const canNewTicket = can("service") && managesTickets(profile) && !readOnly;',
    ]);
    expect(cust).toMatch(
      /\{canNewTicket && \(\s*<Button asChild size="sm">\s*<Link to="\/service" search=\{\{ new: 1, account: a\.id \}\}>/,
    );
    expect(cust).toMatch(
      /\{canNewTicket && \(\s*<Button[\s\S]{0,120}title="New service ticket at this property"/,
    );
  });
  it("the server refuses a technician-only user's create (the office creates since Oct 9) and a non-manager's repair ticket", () => {
    const svc = serverFn(read("src/lib/service.functions.ts"), "saveServiceJob");
    expect(svc).toMatch(
      /const manager = managesTickets\(p\);\s*const dispatcher = dispatchesTickets\(p\);\s*if \(!data\.id && !dispatcher\) throw new Error\("Only the office or a manager creates tickets"\);/,
    );
    const ins = serverFn(
      read("src/lib/service-inspection.functions.ts"),
      "createRepairFromInspection",
    );
    expect(ins).toMatch(
      /!managesTickets\(p\)\)\s*throw new Error\("Only a manager creates a repair ticket"\)/,
    );
  });
  it("the inspection's Create repair ticket shows only to a manager; Create bid stays Estimate's", () => {
    const src = read("src/components/service/inspection-section.tsx");
    expect(src).toMatch(/const manager = managesTickets\(profile\);/);
    const at = src.indexOf("{manager && (");
    expect(at).toBeGreaterThan(0);
    expect(src.indexOf("Create repair ticket", at)).toBeGreaterThan(at);
    expect(src).toMatch(/\{can\("estimate"\) &&/);
  });
});

describe("dispatch is the office's and a manager's (dispatchesTickets, Oct 9); its money a manager's", () => {
  it("assignServiceJob and the Board page", () => {
    const fn = serverFn(read("src/lib/service.functions.ts"), "assignServiceJob");
    expect(fn).toContain(
      'if (!dispatchesTickets(p)) throw new Error("Only the office or a manager dispatches tickets");',
    );
    // Owner, Oct 9: everyone opens on the board (service-board-everyone.test.ts); dispatch on
    // it — drag, drop, the "+" and New ticket — is under dispatchesTickets.
    const board = read("src/components/service/board-page.tsx");
    expect(board).toContain("const dispatch = dispatchesTickets(profile);");
    expect(board).not.toMatch(/if \(!dispatchesTickets\(profile\)\)\s*return \(/);
    // Owner, Oct 5: the board is the Tech Board tab (service-board-tab.test.ts); the list page
    // no longer embeds it.
    const tabs = read("src/components/service/service-tabs.tsx");
    expect(tabs).toMatch(
      /\{ title: "Tech Board", to: "\/service\/board", icon: CalendarDays, show: everyone \}/,
    );
    expect(read("src/components/service-page.tsx")).not.toContain("EmbeddedBoard");
  });
  it("the form's technician select is a dispatcher's; the crew and $ / hour boxes stay under managesTickets", () => {
    const page = read("src/components/service-page.tsx");
    const at = page.indexOf("{dispatcher ? (\n");
    expect(at).toBeGreaterThan(0);
    const branch = page.slice(at, page.indexOf(") : (", at));
    expect(branch).toContain('{manager ? techRow : techSelect("h-9")}');
    expect(branch).toContain("{manager && crewRows}");
    // A technician-only user reads the names.
    const other = page.slice(
      page.indexOf(") : (", at),
      page.indexOf("Change it on the close-out.", at),
    );
    expect(other).not.toContain("techSelect(");
    expect(other).not.toContain("<RateBox");
    expect(page).toMatch(/const sendCrew = manager && !!crew/);
    expect(page).toMatch(/enabled: !!session && manager,/);
    expect(page).toMatch(
      /\.\.\.\(manager \? \{ labor_rate_kind: draft\.labor_rate_kind \} : \{\}\)/,
    );
  });
  it("saveServiceJob keeps the technician on a technician's save, the crew and labor rate on anyone but a manager's", () => {
    const svc = serverFn(read("src/lib/service.functions.ts"), "saveServiceJob");
    expect(svc).toContain("const crew = manager ? fields.crew : undefined;");
    expect(svc).toContain("if (!dispatcher) patch.technician_id = cur.technician_id;");
    expect(svc).toContain("fields.labor_rate_kind && manager ?");
    expect(svc).toContain("const saved = manager ? await saveCrew(sb, row, crew) : row;");
  });
  it("setJobCrew: the lead technician or a manager", () => {
    const fn = serverFn(read("src/lib/service-field.functions.ts"), "setJobCrew");
    expect(fn).toMatch(/if \(!managesTickets\(p\) && job\.technician_id !== context\.userId\)/);
  });
});

describe("ticket money is a manager's", () => {
  const svc = read("src/lib/service.functions.ts");
  it("listJobCrew blanks rates and getCrewRateDefaults refuses anyone else", () => {
    expect(serverFn(svc, "listJobCrew")).toContain("const noMoney = !managesTickets(p);");
    expect(serverFn(svc, "getCrewRateDefaults")).toContain(
      `if (!managesTickets(p)) throw new Error("Rates are a manager's");`,
    );
  });
  // Owner, Oct 1 (later): sales / project managers see and edit invoices too, every change
  // logged — the invoice gates are `seesInvoices` now (sales-invoices-audit.test.ts).
  it("invoices: the server, the block on the ticket, the Invoices page and tab", () => {
    const inv = read("src/lib/invoices.functions.ts");
    expect(inv).toContain(
      `if (!seesInvoices(data)) throw new Error("Invoices are a manager's or sales'");`,
    );
    expect(inv).not.toContain("Invoices are the office's");
    const block = read("src/components/service/invoice-block.tsx");
    expect(block).toMatch(
      /export function InvoiceBlock[\s\S]*?if \(!profile \|\| !seesInvoices\(profile\)\) return null;/,
    );
    const page = read("src/components/service/invoices-page.tsx");
    expect(page).toMatch(
      /export function InvoicesPage[\s\S]*?if \(!seesInvoices\(profile\)\)\s*return \(/,
    );
    const tabs = read("src/components/service/service-tabs.tsx");
    expect(tabs).toMatch(
      /\{ title: "Invoices", to: "\/service\/invoices", icon: Receipt, show: seesInvoices \}/,
    );
  });
  it("Service Rates: read and saved by admins and managers only", () => {
    const inv = read("src/lib/invoices.functions.ts");
    expect(serverFn(inv, "getServiceRates")).toContain("await ratesManager(context);");
    expect(serverFn(inv, "setServiceRates")).toContain("await ratesManager(context);");
    expect(inv).toMatch(
      /async function ratesManager[\s\S]*?if \(!managesTickets\(data\)\) throw new Error\("Service rates are a manager's"\);/,
    );
  });
  it("repair templates: listed without prices for a rep; edited by a manager", () => {
    const field = read("src/lib/service-field.functions.ts");
    // A rep reads the price-free catalog view since 20261002160000 (tech-price-free-reads.test.ts);
    // both lists still pass through templatesForViewer.
    for (const name of ["listRepairTemplates", "recentRepairsForJob"]) {
      const fn = serverFn(field, name);
      expect(fn, name).toContain("const manager = managesTickets(p);");
      expect(fn, name).toMatch(/return templatesForViewer\((rows|sorted), manager\);/);
    }
    expect(serverFn(field, "saveRepairTemplate")).toContain(
      'if (!managesTickets(p)) throw new Error("Only a manager edits repair templates");',
    );
  });
  it("no repairs UI shows a template price", () => {
    for (const f of [
      "src/components/service/closeout.tsx",
      "src/components/service/ticket-field-sections.tsx",
      "src/components/service-page.tsx",
    ])
      expect(read(f), f).not.toContain("unit_price");
  });
});

describe("templatesForViewer (pure)", () => {
  const rows = [
    { id: "a", name: "Clogged drain", unit: "EA", unit_price: 250 },
    { id: "b", name: "Membrane holes", unit: "EA", unit_price: null },
  ];
  it("a manager gets the prices", () => {
    expect(templatesForViewer(rows, true)).toEqual(rows);
  });
  it("anyone else gets every template, names and units kept, prices blank", () => {
    const out = templatesForViewer(rows, false);
    expect(out).toEqual([
      { id: "a", name: "Clogged drain", unit: "EA", unit_price: null },
      { id: "b", name: "Membrane holes", unit: "EA", unit_price: null },
    ]);
    expect(rows[0]!.unit_price).toBe(250); // the input is not mutated
  });
});

describe("crewRowWriteAllowed (pure twin of service_job_techs_rate_guard)", () => {
  const job = "job-1";
  const row = (technician_id: string, bill_rate: number | null) => ({
    service_job_id: job,
    technician_id,
    bill_rate,
  });
  it("a manager writes any rate", () => {
    expect(
      crewRowWriteAllowed({ manager: true, op: "insert", next: row("t1", 95), existing: null }),
    ).toBe(true);
    expect(
      crewRowWriteAllowed({
        manager: true,
        op: "update",
        next: row("t1", 80),
        existing: row("t1", 95),
      }),
    ).toBe(true);
  });
  it("anyone else adds a member only without a rate", () => {
    expect(
      crewRowWriteAllowed({ manager: false, op: "insert", next: row("t2", null), existing: null }),
    ).toBe(true);
    expect(
      crewRowWriteAllowed({ manager: false, op: "insert", next: row("t2", 50), existing: null }),
    ).toBe(false);
  });
  it("keeps a member at the rate the manager set, never changes or moves it", () => {
    const set = row("t1", 95);
    expect(
      crewRowWriteAllowed({ manager: false, op: "insert", next: row("t1", 95), existing: set }),
    ).toBe(true);
    expect(
      crewRowWriteAllowed({ manager: false, op: "update", next: row("t1", 95), existing: set }),
    ).toBe(true);
    expect(
      crewRowWriteAllowed({ manager: false, op: "update", next: row("t1", 120), existing: set }),
    ).toBe(false);
    expect(
      crewRowWriteAllowed({ manager: false, op: "update", next: row("t1", null), existing: set }),
    ).toBe(false);
    expect(
      crewRowWriteAllowed({ manager: false, op: "insert", next: row("t1", 120), existing: set }),
    ).toBe(false);
    expect(
      crewRowWriteAllowed({ manager: false, op: "update", next: row("t9", 95), existing: set }),
    ).toBe(false);
  });
  it("setJobCrew's rows (confirmedCrew over the stored crew) always pass for the lead", () => {
    const stored: CrewRow[] = [
      { technician_id: "lead", sort: 0, bill_rate: 110 },
      { technician_id: "t1", sort: 1, bill_rate: 95 },
      { technician_id: "t2", sort: 2, bill_rate: null },
    ];
    // The lead keeps t1 (rate the manager set), drops t2 and adds t3.
    const next = confirmedCrew(stored, "lead", ["t3", "t1"]);
    for (const r of next) {
      const existing = stored.find((s) => s.technician_id === r.technician_id);
      const ok = crewRowWriteAllowed({
        manager: false,
        op: "insert",
        next: { service_job_id: job, technician_id: r.technician_id, bill_rate: r.bill_rate },
        existing: existing
          ? {
              service_job_id: job,
              technician_id: existing.technician_id,
              bill_rate: existing.bill_rate,
            }
          : null,
      });
      expect(ok, r.technician_id).toBe(true);
    }
    expect(next.find((r) => r.technician_id === "t3")!.bill_rate).toBeNull();
    expect(next.find((r) => r.technician_id === "t1")!.bill_rate).toBe(95);
  });
});

describe("migration 20261001050000_ticket_money_managers.sql", () => {
  const sql = read("supabase/migrations/20261001050000_ticket_money_managers.sql");
  const flat = sql.replace(/--[^\n]*/g, "").replace(/\s+/g, " ");
  it("service_jobs_insert: Service and admin or manager", () => {
    expect(flat).toContain(
      "create policy service_jobs_insert on public.service_jobs for insert to authenticated with check (public.has_access('service') and (public.is_admin() or public.is_manager()));",
    );
    expect(flat).not.toMatch(/create policy service_jobs_(read|update)/);
  });
  it("invoices and invoice lines: admin or manager only", () => {
    for (const t of [
      "invoices_office on public.invoices",
      "invoice_lines_office on public.invoice_lines",
    ])
      expect(flat).toContain(
        `create policy ${t} for all to authenticated using (public.is_admin() or public.is_manager()) with check (public.is_admin() or public.is_manager());`,
      );
    expect(flat).not.toContain("not public.is_technician()");
  });
  it("service rates: read by admins, managers and the service role; written by admins and managers", () => {
    expect(flat).toContain(
      "create policy service_rates_read on public.service_rates for select to authenticated using (public.is_admin() or public.is_manager() or auth.role() = 'service_role');",
    );
    expect(flat).toContain(
      "create policy service_rates_write on public.service_rates for all to authenticated using (public.is_admin() or public.is_manager()) with check (public.is_admin() or public.is_manager());",
    );
    expect(flat).not.toContain("has_access('pricing')");
  });
  it("repair templates: written by admins and managers; read unchanged (the comment says why)", () => {
    expect(flat).toContain(
      "create policy repair_templates_write on public.repair_templates for all to authenticated using (public.is_admin() or public.is_manager()) with check (public.is_admin() or public.is_manager());",
    );
    expect(flat).not.toContain("create policy repair_templates_read");
    expect(sql).toMatch(/RLS cannot hide one column/);
  });
  it("technician_bill_rates(): admins and managers only, same signature", () => {
    expect(flat).toMatch(
      /create or replace function public\.technician_bill_rates\(\) returns table \(id uuid, default_bill_rate numeric\)[^$]*\$\$ select p\.id, p\.default_bill_rate from public\.profiles p where \(public\.is_admin\(\) or public\.is_manager\(\)\) and p\.default_bill_rate is not null; \$\$;/,
    );
  });
  it("service_job_techs: managers write; the lead writes own rows; the trigger guards bill_rate", () => {
    expect(flat).toContain(
      "create policy service_job_techs_write on public.service_job_techs for all to authenticated using (public.has_access('service') and (public.is_admin() or public.is_manager())) with check (public.has_access('service') and (public.is_admin() or public.is_manager()));",
    );
    expect(flat).toContain(
      "create policy service_job_techs_lead on public.service_job_techs for all to authenticated using (public.has_access('service') and public.leads_job(service_job_id)) with check (public.has_access('service') and public.leads_job(service_job_id));",
    );
    expect(flat).toContain(
      "create trigger service_job_techs_rate_guard before insert or update on public.service_job_techs for each row execute function public.service_job_techs_rate_guard();",
    );
    expect(flat).toContain(
      "if auth.uid() is null or public.is_admin() or public.is_manager() then return new;",
    );
  });
  it("is idempotent: every policy and trigger is dropped first", () => {
    for (const m of flat.matchAll(/create policy (\w+) on ([\w.]+)/g))
      expect(flat).toContain(`drop policy if exists ${m[1]} on ${m[2]};`);
    for (const m of flat.matchAll(/create trigger (\w+) /g))
      expect(flat).toContain(`drop trigger if exists ${m[1]} on`);
    expect(flat).not.toMatch(/create function /);
  });
});
