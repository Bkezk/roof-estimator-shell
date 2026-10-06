/**
 * Nobody but a manager moves a ticket out of Authorized, Invoiced or Closed, and a technician
 * cannot edit one (owner, Oct 6). Proven live: a technician moved their own Authorized ticket
 * back to Done (and edited its notes) and their Closed ticket back to Open. stageProblem looked
 * only at the stage being set; the database trigger guarded only moves INTO the office stages;
 * a technician's update policy checked the stage of the new row alone.
 *
 * stageProblem / stageChoices / stageLocked (ticket-stage.ts), saveServiceJob, and the migration
 * 20261006190000_stage_backwards_lock.sql (the trigger's OLD.stage clause, the two-sided RLS).
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { SERVICE_STAGES } from "@/lib/service.functions";
import {
  MANAGER_STAGE_MESSAGE,
  OFFICE_STAGES,
  TECH_LOCKED_MESSAGE,
  TECH_STAGES,
  stageChoices,
  stageLocked,
  stageProblem,
} from "@/lib/ticket-stage";

const read = (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : "");
const flat = (s: string) =>
  s
    .replace(/--[^\n]*/g, "")
    .replace(/\s+/g, " ")
    .trim();
function serverFn(src: string, name: string): string {
  const start = src.indexOf(`export const ${name} = createServerFn`);
  expect(start, `${name} not found`).toBeGreaterThanOrEqual(0);
  const next = src.indexOf("\nexport ", start + 1);
  return src.slice(start, next < 0 ? undefined : next);
}

const admin = { role: "admin", access: [], technician: false };
const manager = { role: "manager", access: [], technician: false };
const managerTech = { role: "manager", access: [], technician: true };
const tech = { role: "user", access: ["service"], technician: true };
const office = { role: "user", access: ["service", "customers"], technician: false };
const salesPm = { role: "user", access: ["estimate", "service"], technician: false };

describe("stageProblem from an office stage (pure)", () => {
  it("a technician may not move a ticket out of Authorized, Invoiced or Closed — to any stage", () => {
    for (const from of OFFICE_STAGES)
      for (const to of SERVICE_STAGES) {
        if (to === from) continue;
        expect(stageProblem(tech, to, from), `tech ${from} → ${to}`).toBe(MANAGER_STAGE_MESSAGE);
      }
    // The two live cases.
    expect(stageProblem(tech, "done", "authorized")).toBe(MANAGER_STAGE_MESSAGE);
    expect(stageProblem(tech, "open", "closed")).toBe(MANAGER_STAGE_MESSAGE);
  });
  it("an office user or a sales / project manager: the same", () => {
    for (const p of [office, salesPm])
      for (const from of OFFICE_STAGES)
        for (const to of TECH_STAGES)
          expect(stageProblem(p, to, from), `${p.access} ${from} → ${to}`).toBe(
            MANAGER_STAGE_MESSAGE,
          );
    expect(stageProblem(salesPm, "authorized", "invoiced")).toBe(MANAGER_STAGE_MESSAGE);
  });
  it("an admin or a manager (ticked Technician too) moves it anywhere", () => {
    for (const p of [admin, manager, managerTech])
      for (const from of OFFICE_STAGES)
        for (const to of SERVICE_STAGES)
          expect(stageProblem(p, to, from), `${p.role} ${from} → ${to}`).toBeNull();
  });
  it("keeping the stage is never refused; the forward rule is as before", () => {
    for (const p of [tech, office, salesPm])
      for (const s of OFFICE_STAGES) expect(stageProblem(p, s, s)).toBeNull();
    expect(stageProblem(tech, "done", "scheduled")).toBeNull();
    expect(stageProblem(office, "open", "done")).toBeNull();
    expect(stageProblem(office, "authorized", "done")).toBe(MANAGER_STAGE_MESSAGE);
  });
});

describe("the picker follows", () => {
  it("a non-manager on an Authorized / Invoiced / Closed ticket is offered that stage alone, locked", () => {
    for (const p of [tech, office, salesPm])
      for (const s of OFFICE_STAGES) {
        expect(stageChoices(p, s), `${p.access} at ${s}`).toEqual([s]);
        expect(stageLocked(p, s)).toBe(true);
      }
    expect(stageChoices(tech, "done")).toEqual(["open", "scheduled", "done"]);
    expect(stageChoices(manager, "closed")).toEqual([...SERVICE_STAGES]);
  });
});

describe("the server", () => {
  const svc = read("src/lib/service.functions.ts");
  it("setServiceStage asks stageProblem with the ticket's current stage", () => {
    expect(serverFn(svc, "setServiceStage")).toMatch(
      /const problem = stageProblem\(p, data\.stage, prev\?\.stage\);\s*if \(problem\) throw new Error\(problem\);/,
    );
  });
  it("saveServiceJob refuses a technician's edit of an Authorized / Invoiced / Closed ticket", () => {
    expect(TECH_LOCKED_MESSAGE).toBe(
      "A technician cannot change a ticket once it is Authorized, Invoiced or Closed",
    );
    const fn = serverFn(svc, "saveServiceJob");
    expect(fn).toMatch(
      /if \(!isOffice\(p\) && OFFICE_STAGES\.includes\(cur\.stage as ServiceStage\)\)\s*throw new Error\(TECH_LOCKED_MESSAGE\);/,
    );
    // Before the save itself (nothing is written first).
    expect(fn.indexOf("TECH_LOCKED_MESSAGE")).toBeLessThan(fn.indexOf(".update(scheduledNow"));
  });
});

describe("migration 20261006190000_stage_backwards_lock.sql", () => {
  const sql = flat(read("supabase/migrations/20261006190000_stage_backwards_lock.sql"));
  it("exists and says why", () => {
    expect(sql.length).toBeGreaterThan(0);
    const head = read("supabase/migrations/20261006190000_stage_backwards_lock.sql").slice(0, 400);
    expect(head.startsWith("-- ")).toBe(true);
    expect(head).toContain("(owner, Oct 6)");
  });
  it("the stage rule refuses a non-manager's move OUT of Authorized / Invoiced / Closed", () => {
    expect(sql).toContain(
      "create or replace function public.service_jobs_stage_rule() returns trigger language plpgsql security definer set search_path = public as $$",
    );
    // The same exemptions as the forward rule: the service role, no user, the invoice path.
    expect(sql).toContain(
      "v_exempt := auth.uid() is null or coalesce(auth.role(), '') = 'service_role' or public.is_admin() or public.is_manager() or coalesce(current_setting('jbk.stage_from_invoice', true), '') = 'on';",
    );
    expect(sql).toContain(
      "if new.stage in ('authorized', 'invoiced', 'closed') and (tg_op = 'INSERT' or new.stage is distinct from old.stage) then raise exception 'Only a manager authorizes, invoices or closes a ticket' using errcode = '42501'; end if;",
    );
    expect(sql).toContain(
      "if tg_op = 'UPDATE' and old.stage in ('authorized', 'invoiced', 'closed') and new.stage is distinct from old.stage then raise exception 'Only a manager moves a ticket out of Authorized, Invoiced or Closed' using errcode = '42501'; end if;",
    );
    expect(sql).toContain(
      "drop trigger if exists service_jobs_stage_rule on public.service_jobs; create trigger service_jobs_stage_rule before insert or update of stage on public.service_jobs for each row execute function public.service_jobs_stage_rule();",
    );
  });
  it("a technician's update policy checks the stage on both the old row and the new one", () => {
    const tech =
      "public.has_access('service') and (not public.is_technician() or public.is_admin() or public.is_manager() or (technician_id = auth.uid() and stage in ('open', 'scheduled', 'done')))";
    expect(sql).toContain(
      `drop policy if exists service_jobs_update on public.service_jobs; create policy service_jobs_update on public.service_jobs for update to authenticated using ( ${tech} ) with check ( ${tech} );`,
    );
  });
  it("leaves the invoice path alone (set_ticket_stage_from_invoice is 20261005140000's)", () => {
    expect(sql).not.toContain("function public.set_ticket_stage_from_invoice");
  });
});
