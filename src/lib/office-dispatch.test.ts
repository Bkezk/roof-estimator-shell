/**
 * Owner, Oct 9: "lets make office users able to create, dispatch, and move a tickets date but
 * make that activity logged". `dispatchesTickets` (access.ts) = managesTickets, or the office
 * (not technician-only) with Service. It gates creating, the technician select / date / arrival
 * window, Repeat, the Board's dispatch and the two server functions; every money gate stays
 * `managesTickets`. The database widens service_jobs_insert and set_job_crew for the office
 * (20261009120000_office_dispatch.sql); the logging is the existing audit trigger (History) and
 * the Timeline's "Date moved" row, verified here by reading the migrations.
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));
vi.mock("@/lib/notify.server", () => ({
  serverClient: async (fallback: unknown) => fallback,
  notify: vi.fn(async () => 0),
}));
vi.mock("@/lib/ticket-events.server", () => ({ afterTicketStage: vi.fn(async () => {}) }));
vi.mock("@/lib/service-crew.server", () => ({
  syncCrewLead: vi.fn(async () => {}),
  writeCrew: vi.fn(async () => 0),
  readCrew: vi.fn(async () => []),
}));

import {
  dispatchesTickets,
  isOffice,
  managesTickets,
  OFFICE_PAGES,
  shapeForKind,
} from "@/lib/access";
import {
  DATE_MOVE_MANAGER_ONLY,
  DATE_MOVE_OFFICE_ONLY,
  dateMoveProblem,
} from "@/lib/followup-rules";
import { assignServiceJob, saveServiceJob } from "@/lib/service.functions";
import { stageProblem } from "@/lib/ticket-stage";
import { fakeSupabase } from "@/test/fake-supabase";

type Row = Record<string, unknown>;
const read = (p: string) => readFileSync(p, "utf8");
const flat = (s: string) =>
  s
    .replace(/--[^\n]*/g, "")
    .replace(/\s+/g, " ")
    .trim();
/** The source of one `export const name = createServerFn(...)` up to the next export. */
function serverFn(src: string, name: string): string {
  const start = src.indexOf(`export const ${name} = createServerFn`);
  expect(start, `${name} not found`).toBeGreaterThanOrEqual(0);
  const next = src.indexOf("\nexport ", start + 1);
  return src.slice(start, next < 0 ? undefined : next);
}

const owner = shapeForKind("owner", false);
const manager = shapeForKind("manager", false);
const office = shapeForKind("office", false);
const officeTech = shapeForKind("office", true);
const techOnly = shapeForKind("technician", true);
const noService = { role: "user", access: ["estimate", "customers"], technician: false };
const customTech = { role: "user", access: ["estimate"], technician: true };

describe("dispatchesTickets", () => {
  it("is true for an owner, a manager and the office (ticked Technician or not)", () => {
    for (const p of [owner, manager, office, officeTech]) expect(dispatchesTickets(p)).toBe(true);
  });
  it("is false for a technician-only user, for a plain user without Service, and for nobody", () => {
    expect(dispatchesTickets(techOnly)).toBe(false);
    expect(
      dispatchesTickets({ role: "user", access: ["service", "inventory"], technician: true }),
    ).toBe(false);
    expect(dispatchesTickets(noService)).toBe(false);
    expect(dispatchesTickets(null)).toBe(false);
    expect(dispatchesTickets(undefined)).toBe(false);
  });
  it("a technician with another page (an old per-page row) is office, so they dispatch once they have Service", () => {
    expect(isOffice(customTech)).toBe(true);
    expect(dispatchesTickets(customTech)).toBe(false); // no Service
    expect(dispatchesTickets({ ...customTech, access: ["estimate", "service"] })).toBe(true);
  });
  it("is wider than managesTickets, which stays the money gate", () => {
    expect(managesTickets(office)).toBe(false);
    expect(dispatchesTickets(office)).toBe(true);
    for (const p of [owner, manager, office, officeTech, techOnly, null])
      if (managesTickets(p)) expect(dispatchesTickets(p)).toBe(true);
    const src = read("src/lib/access.ts");
    expect(src).toContain(
      'export const dispatchesTickets = (p: AccessLike | null | undefined): boolean =>\n  managesTickets(p) || (isOffice(p) && canAccess(p, "service"));',
    );
    expect(OFFICE_PAGES).toContain("service");
  });
  it("the office may set a new ticket Scheduled (its technician and day), never an office stage", () => {
    expect(stageProblem(office, "scheduled")).toBeNull();
    expect(stageProblem(office, "open")).toBeNull();
    expect(stageProblem(office, "scheduled", "open")).toBeNull();
    expect(stageProblem(office, "authorized", "done")).not.toBeNull();
  });
});

describe("a ticket's date: the office moves it, logged; an opportunity's close keeps the Oct 1 rule", () => {
  const move = { oldYmd: "2026-10-03", newYmd: "2026-10-10" };
  it("kind ticket: office and managers allowed, a technician-only user refused with the office message", () => {
    for (const profile of [owner, manager, office, officeTech])
      expect(dateMoveProblem({ profile, ...move, kind: "ticket" })).toBeNull();
    expect(dateMoveProblem({ profile: techOnly, ...move, kind: "ticket" })).toBe(
      DATE_MOVE_OFFICE_ONLY,
    );
    expect(dateMoveProblem({ profile: null, ...move, kind: "ticket" })).toBe(DATE_MOVE_OFFICE_ONLY);
    expect(DATE_MOVE_OFFICE_ONLY).toBe("Only the office or a manager can move the date");
  });
  it("without kind (an opportunity's expected close): managers only, as before", () => {
    expect(dateMoveProblem({ profile: office, ...move })).toBe(DATE_MOVE_MANAGER_ONLY);
    expect(dateMoveProblem({ profile: office, ...move, kind: "opportunity" })).toBe(
      DATE_MOVE_MANAGER_ONLY,
    );
    expect(dateMoveProblem({ profile: manager, ...move })).toBeNull();
  });
  it("the same day, no stored day or nothing sent: allowed for the office too", () => {
    expect(
      dateMoveProblem({
        profile: techOnly,
        oldYmd: "2026-10-03",
        newYmd: "2026-10-03",
        kind: "ticket",
      }),
    ).toBeNull();
    expect(
      dateMoveProblem({ profile: techOnly, oldYmd: null, newYmd: "2026-10-03", kind: "ticket" }),
    ).toBeNull();
    expect(
      dateMoveProblem({
        profile: techOnly,
        oldYmd: "2026-10-03",
        newYmd: undefined,
        kind: "ticket",
      }),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
// The server functions, run against the fake client as an office user and a technician.
const OFFICE = "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f";
const TECH = "7e7e7e7e-7e7e-47e7-87e7-7e7e7e7e7e7e";
const TECH2 = "7f7f7f7f-7f7f-47f7-87f7-7f7f7f7f7f7f";
const ACC = "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1";
const SITE = "51515151-5151-4515-8515-515151515151";
const JOB = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

let env: ReturnType<typeof fakeSupabase>;
beforeEach(() => {
  env = fakeSupabase({
    profiles: [
      { id: OFFICE, ...office, full_name: "Olive Office", email: "olive@example.com" },
      { id: TECH, ...techOnly, full_name: "Ted Tech", email: "ted@example.com" },
      { id: TECH2, ...techOnly, full_name: "Tia Tech", email: "tia@example.com" },
    ],
    crm_accounts: [
      { id: ACC, name: "Bell County Schools", phone: "606-555-0100", deleted_at: null },
    ],
    crm_sites: [{ id: SITE, account_id: ACC, name: "Yellow Creek gym", deleted_at: null }],
    service_jobs: [
      {
        id: JOB,
        number: 6010,
        account_id: ACC,
        site_id: SITE,
        customer_name: "Bell County Schools",
        description: "Leak over the gym",
        service_type: "leak",
        stage: "scheduled",
        technician_id: TECH,
        scheduled_date: "2026-10-12",
        helper_count: 0,
        deleted_at: null,
        created_at: "2026-10-01T12:00:00Z",
        updated_at: "2026-10-01T12:00:00Z",
      },
    ],
    service_job_events: [],
    crm_followups: [],
    crm_settings: [{ id: 1, ticket_first_days: 1, ticket_every_days: 3 }],
  });
});
const callAs = <T = unknown>(fn: unknown, userId: string, data: Row) =>
  (fn as (a: { data: Row; context: unknown }) => Promise<T>)({
    data,
    context: { supabase: env.db, userId },
  });
const jobWrites = () => env.writes.filter((w) => w.table === "service_jobs");
const events = () => env.tables["service_job_events"] ?? [];

describe("saveServiceJob as the office", () => {
  it("creates a ticket (it used to refuse: 'Only a manager creates tickets') with the technician and day → Scheduled", async () => {
    const row = await callAs<Row>(saveServiceJob, OFFICE, {
      account_id: ACC,
      site_id: SITE,
      description: "New leak",
      service_type: "leak",
      technician_id: TECH2,
      scheduled_date: "2026-10-20",
    });
    expect(row["stage"]).toBe("scheduled");
    expect(row["technician_id"]).toBe(TECH2);
    expect(row["created_by"]).toBe(OFFICE);
    expect(jobWrites().some((w) => w.op === "insert")).toBe(true);
  });
  it("re-dispatches and moves the date of an existing ticket; the move is logged on the Timeline", async () => {
    const row = await callAs<Row>(saveServiceJob, OFFICE, {
      id: JOB,
      account_id: ACC,
      site_id: SITE,
      description: "Leak over the gym",
      service_type: "leak",
      technician_id: TECH2,
      scheduled_date: "2026-10-19",
    });
    expect(row["technician_id"]).toBe(TECH2);
    expect(row["scheduled_date"]).toBe("2026-10-19");
    expect(row["stage"]).toBe("scheduled");
    const note = events().find((e) => e["kind"] === "note");
    expect(note?.["note"]).toBe("Date moved from Oct 12, 2026 to Oct 19, 2026");
    expect(note?.["by_user"]).toBe(OFFICE);
    expect(note?.["by_name"]).toBe("Olive Office");
  });
  it("a technician-only user still cannot create, nor move their own ticket's date or technician", async () => {
    await expect(
      callAs(saveServiceJob, TECH, {
        account_id: ACC,
        site_id: SITE,
        description: "x",
        service_type: "leak",
        scheduled_date: "2026-10-20",
      }),
    ).rejects.toThrow("Only the office or a manager creates tickets");
    await expect(
      callAs(saveServiceJob, TECH, {
        id: JOB,
        account_id: ACC,
        site_id: SITE,
        description: "x",
        service_type: "leak",
        technician_id: TECH,
        scheduled_date: "2026-10-19",
      }),
    ).rejects.toThrow(DATE_MOVE_OFFICE_ONLY);
    // Their save keeps the technician even if the form sent another.
    const row = await callAs<Row>(saveServiceJob, TECH, {
      id: JOB,
      account_id: ACC,
      site_id: SITE,
      description: "x",
      service_type: "leak",
      technician_id: TECH2,
    });
    expect(row["technician_id"]).toBe(TECH);
  });
});

describe("assignServiceJob (the Board) as the office", () => {
  it("moves a Scheduled ticket a week in one write: stage stays Scheduled, 'Date moved' logged", async () => {
    const row = await callAs<Row>(assignServiceJob, OFFICE, {
      id: JOB,
      technician_id: TECH,
      scheduled_date: "2026-10-19",
    });
    expect(row["stage"]).toBe("scheduled");
    expect(row["scheduled_date"]).toBe("2026-10-19");
    const updates = jobWrites().filter((w) => w.op === "update");
    expect(updates).toHaveLength(1);
    expect(updates[0]!.payload).toMatchObject({ stage: "scheduled", technician_id: TECH });
    expect(events().map((e) => e["note"])).toEqual([
      "Date moved from Oct 12, 2026 to Oct 19, 2026",
    ]);
  });
  it("hands the ticket to another technician on another day", async () => {
    const row = await callAs<Row>(assignServiceJob, OFFICE, {
      id: JOB,
      technician_id: TECH2,
      scheduled_date: "2026-10-13",
    });
    expect(row["technician_id"]).toBe(TECH2);
    expect(row["stage"]).toBe("scheduled");
  });
  it("a technician-only user is refused", async () => {
    await expect(
      callAs(assignServiceJob, TECH, {
        id: JOB,
        technician_id: TECH,
        scheduled_date: "2026-10-19",
      }),
    ).rejects.toThrow("Only the office or a manager dispatches tickets");
    expect(jobWrites()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------------------------
describe("every gate switched to dispatchesTickets; every money gate kept", () => {
  const page = read("src/components/service-page.tsx");
  const board = read("src/components/service/board-page.tsx");
  const svc = read("src/lib/service.functions.ts");
  it("the ticket page: ?new=1, New ticket, Repeat, the technician select, the date and the arrival window", () => {
    expect(page).toMatch(
      /if \(isNew\) \{[\s\S]*?if \(!dispatchesTickets\(profile\)\) return <OfficeCreatesTickets \/>;/,
    );
    expect(page).toContain("The office creates tickets.");
    expect(page).not.toContain("ManagersCreateTickets");
    expect(page).toContain("const dispatcher = dispatchesTickets(profile);");
    expect(page).toMatch(
      /\{dispatcher && \(\s*<Button size="lg" className="text-base font-semibold" onClick=\{newTicket\}>/,
    );
    expect(page).toMatch(
      /\{dispatcher && \(\s*<Button variant="outline" className="mt-4" onClick=\{newTicket\}>/,
    );
    expect(page).toContain("{dispatcher && repeatable && (");
    expect(page).toContain(
      "const dateLocked = !!job?.scheduled_date && !dispatchesTickets(profile);",
    );
    expect(page).toContain("The office moves dates");
    expect(page).not.toContain("Managers move dates");
    expect(page).toContain("disabled={ro || dateLocked}");
    // The select for a dispatcher; the crew rows and $ / hour only for a manager.
    const at = page.indexOf("{dispatcher ? (\n");
    expect(at).toBeGreaterThan(0);
    const branch = page.slice(at, page.indexOf(") : (", at));
    expect(branch).toContain('{manager ? techRow : techSelect("h-9")}');
    expect(branch).toContain("{manager && crewRows}");
    expect(branch).toContain("{manager && showRate && (");
    const other = page.slice(page.indexOf(") : (", at), page.indexOf("CenterPoint numbers", at));
    expect(other).not.toContain("techSelect(");
    expect(other).toContain("The office dispatches the ticket.");
  });
  it("money stays managesTickets on the page: crew, rates, labor rate, Delete, Restore", () => {
    expect(page).toContain("const manager = managesTickets(profile);");
    expect(page).toMatch(/const sendCrew = manager && !!crew/);
    expect(page).toMatch(/enabled: !!session && manager,/);
    expect(page).toMatch(
      /\.\.\.\(manager \? \{ labor_rate_kind: draft\.labor_rate_kind \} : \{\}\)/,
    );
    expect(page).toContain("onDelete={manager ? () => setToDelete(j) : undefined}");
    expect(page).toMatch(
      /\{manager && \(\s*<Button\s+variant="outline"\s+className="text-destructive/,
    );
  });
  it("the Board's dispatch flag", () => {
    expect(board).toContain("const dispatch = dispatchesTickets(profile);");
    expect(board).not.toContain("managesTickets");
  });
  it("the server: create and dispatch are the office's; money and delete a manager's", () => {
    const save = serverFn(svc, "saveServiceJob");
    expect(save).toContain("const manager = managesTickets(p);");
    expect(save).toContain("const dispatcher = dispatchesTickets(p);");
    expect(save).toContain(
      'if (!data.id && !dispatcher) throw new Error("Only the office or a manager creates tickets");',
    );
    expect(save).toContain("if (!dispatcher) patch.technician_id = cur.technician_id;");
    expect(save).toMatch(
      /dateMoveProblem\(\{\s*profile: p,\s*oldYmd: cur\.scheduled_date,\s*newYmd: fields\.scheduled_date,\s*kind: "ticket",/,
    );
    expect(save).toContain("const crew = manager ? fields.crew : undefined;");
    expect(save).toContain("const saved = manager ? await saveCrew(sb, row, crew) : row;");
    const assign = serverFn(svc, "assignServiceJob");
    expect(assign).toContain(
      'if (!dispatchesTickets(p)) throw new Error("Only the office or a manager dispatches tickets");',
    );
    expect(assign).toMatch(/dateMoveProblem\(\{[\s\S]*?kind: "ticket",/);
    expect(serverFn(svc, "deleteServiceJob")).toContain("if (!managesTickets(p))");
    expect(serverFn(svc, "listJobCrew")).toContain("const noMoney = !managesTickets(p);");
    expect(serverFn(svc, "getCrewRateDefaults")).toContain("if (!managesTickets(p))");
    // The opportunity's expected close keeps the Oct 1 rule (no kind).
    expect(serverFn(read("src/lib/opportunities.functions.ts"), "saveOpportunity")).not.toContain(
      'kind: "ticket"',
    );
  });
});

describe("migration 20261009120000_office_dispatch.sql", () => {
  const sql = read("supabase/migrations/20261009120000_office_dispatch.sql");
  const f = flat(sql);
  it("service_jobs_insert: Service, and admin / manager / not technician-only", () => {
    expect(f).toContain(
      "create policy service_jobs_insert on public.service_jobs for insert to authenticated with check ( public.has_access('service') and (public.is_admin() or public.is_manager() or not public.is_technician()) );",
    );
    expect(f).toContain("drop policy if exists service_jobs_insert on public.service_jobs;");
  });
  it("set_job_crew lets the office say who is on the job; the rate branch is unchanged", () => {
    expect(f).toContain(
      "if not (public.has_access('service') and (v_manager or public.leads_job(p_job) or not public.is_technician())) then",
    );
    expect(f).toContain(
      "if v_rate is not null and (v_had is null or v_old is distinct from v_rate) then raise exception 'Only a manager sets a technician''s rate on a ticket' using errcode = '42501'; end if; v_rate := v_old;",
    );
    expect(f).toContain(
      "grant execute on function public.set_job_crew(uuid, jsonb) to authenticated;",
    );
  });
  it("touches no money policy, no stage rule, no audit function", () => {
    expect(f).not.toMatch(
      /create policy (invoices|invoice_lines|service_rates|repair_templates|service_job_techs)/,
    );
    expect(f).not.toContain("service_jobs_stage_rule()");
    expect(f).not.toContain("function public.audit_row");
    expect(f).not.toContain("create policy service_jobs_update");
    expect(f).not.toContain("create policy service_jobs_delete");
  });
  it("is idempotent", () => {
    for (const m of f.matchAll(/create policy (\w+) on ([\w.]+)/g))
      expect(f).toContain(`drop policy if exists ${m[1]} on ${m[2]};`);
    expect(f).not.toMatch(/create function /);
  });
  it("says what blocked office dispatch and what logs it", () => {
    expect(sql).toContain("set_job_crew");
    expect(sql).toContain("service_jobs_audit");
    expect(sql).toContain("logTicketDateMove");
  });
});

describe("the logging the owner asked for already exists (verified by reading the migrations)", () => {
  it("every service_jobs insert / update / delete is written to audit_log by trigger, with by_name and by_role", () => {
    const audit = flat(read("supabase/migrations/20261005130000_ticket_audit.sql"));
    expect(audit).toContain(
      "create trigger service_jobs_audit after insert or update or delete on public.service_jobs for each row execute function public.audit_row();",
    );
    expect(audit).toContain("when 'service_jobs' then v_entity := 'ticket';");
    expect(audit).toContain(
      "insert into public.audit_log (by_user, by_name, by_role, entity, entity_id, action, summary, changes)",
    );
    // No later migration drops the trigger.
    for (const later of [
      "20261006200000_audit_ticket_readable.sql",
      "20261009100000_tasks_tracking.sql",
    ])
      expect(read(`supabase/migrations/${later}`)).not.toMatch(
        /drop trigger if exists service_jobs_audit on public\.service_jobs;(?![\s\S]*create trigger service_jobs_audit)/,
      );
  });
  it("the latest audit_row() role branch knows admin / manager / sales / technician / user — an office user reads as 'sales' (Invoices tick) or 'user'; left as is", () => {
    const latest = flat(read("supabase/migrations/20261009100000_tasks_tracking.sql"));
    expect(latest).toContain(
      "case when p.role = 'admin' then 'admin' when p.role = 'manager' then 'manager' when public.is_sales_pm() then 'sales' when coalesce(p.technician, false) then 'technician' else 'user' end",
    );
    expect(latest).not.toContain("'office'");
  });
  it("the ticket's History fold shows it to admins and managers; a date move also lands on the Timeline", () => {
    expect(read("src/components/service/ticket-field-sections.tsx")).toContain(
      '<AuditHistory entity="ticket" entityId={job.id}',
    );
    expect(read("src/components/audit-history.tsx")).toContain(
      "if (!seesEveryone(profile)) return null;",
    );
    const svc = read("src/lib/service.functions.ts");
    for (const name of ["saveServiceJob", "assignServiceJob"])
      expect(serverFn(svc, name)).toContain("await logTicketDateMove(");
    expect(svc).toMatch(/dateMoveNote\("Date", oldYmd, newYmd\)/);
  });
});

describe("the office's New ticket / Start a ticket on the Customers and Opportunities pages (Oct 9 follow-up)", () => {
  it("both pages gate on dispatchesTickets, not managesTickets", () => {
    const cust = readFileSync("src/components/customers-page.tsx", "utf8");
    expect(cust).toContain(
      'const canNewTicket = can("service") && dispatchesTickets(profile) && !props.readOnly;',
    );
    expect(cust).toContain(
      'const canNewTicket = can("service") && dispatchesTickets(profile) && !readOnly;',
    );
    expect(cust).not.toContain("managesTickets(profile)");
    const opp = readFileSync("src/components/opportunities-page.tsx", "utf8");
    expect(opp).toMatch(/\{opp && !deleted && dispatchesTickets\(profile\) && \(/);
  });
});
