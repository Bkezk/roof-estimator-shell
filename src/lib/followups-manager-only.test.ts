/**
 * Owner, Oct 1: the Follow-ups page folds into My Work; follow-ups and due dates are
 * management's. Source checks for what lives in components, routes, server functions and SQL.
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { contactMethodLabel, LOG_NOTE_METHOD } from "@/lib/contact-log.functions";

const read = (p: string) => readFileSync(p, "utf8");
/** The source of one `export const name = createServerFn(...)` up to the next export. */
function serverFn(src: string, name: string): string {
  const start = src.indexOf(`export const ${name} = createServerFn`);
  expect(start, `${name} not found`).toBeGreaterThanOrEqual(0);
  const next = src.indexOf("\nexport ", start + 1);
  return src.slice(start, next < 0 ? undefined : next);
}

describe("1. The Follow-ups page is folded into My Work", () => {
  it("the sidebar has no Follow-ups item (Admin › Reminders stays)", () => {
    const nav = read("src/components/app-sidebar.tsx");
    expect(nav).not.toMatch(/title:\s*"Follow-ups"/);
    expect(nav).not.toMatch(/url:\s*"\/followups"/);
    expect(nav).toMatch(/url:\s*"\/admin\/reminders"/);
  });
  it("/followups redirects to /my-work (emails and push link there)", () => {
    const route = read("src/routes/followups.tsx");
    expect(route).toContain('createFileRoute("/followups")');
    expect(route).toMatch(/throw redirect\(\{ to: "\/my-work"/);
    expect(route).not.toMatch(/component:/);
    expect(route).not.toContain("followups-page");
  });
  it("the page is gone; the snooze menu and close dialog live in followup-controls", () => {
    expect(existsSync("src/components/followups-page.tsx")).toBe(false);
    const controls = read("src/components/followup-controls.tsx");
    expect(controls).toMatch(/export function SnoozeMenu/);
    expect(controls).toMatch(/export function CloseFollowupDialog/);
    for (const page of ["opportunities-page", "my-work-page"]) {
      const src = read(`src/components/${page}.tsx`);
      expect(src, page).not.toContain("@/components/followups-page");
      expect(src, page).toContain('from "@/components/followup-controls"');
    }
  });
});

describe("2. My Work shows the follow-up state; controls only under seesEveryone", () => {
  const page = read("src/components/my-work-page.tsx");
  it("renders the state on rows", () => {
    expect(page).toContain("followupStateText(");
  });
  it("Snooze / Close are built only when seesEveryone(profile)", () => {
    expect(page).toMatch(/const canManage = seesEveryone\(profile\);/);
    expect(page).toMatch(/const manage: ManageFollowup \| null = canManage\s*\?/);
    // The only SnoozeMenu / Close button is inside `manage`, and the dialog under canManage.
    const manageStart = page.indexOf("const manage: ManageFollowup | null = canManage");
    const manageEnd = page.indexOf(": null;", manageStart);
    expect(manageStart).toBeGreaterThan(0);
    const snoozeAt = page.indexOf("<SnoozeMenu");
    expect(snoozeAt).toBeGreaterThan(manageStart);
    expect(snoozeAt).toBeLessThan(manageEnd);
    expect(page.indexOf("<SnoozeMenu", manageEnd)).toBe(-1);
    expect(page).toMatch(/\{canManage && \(\s*<CloseFollowupDialog/);
  });
  it("plain users get one muted line instead", () => {
    expect(page).toMatch(
      /\{!canManage && hasFollowups[^}]*\(\s*<p className="text-xs text-muted-foreground">Follow-ups are managed by your manager\.<\/p>/,
    );
  });
  it("the opportunity strip shows Snooze / Close only to a manager too", () => {
    const opp = read("src/components/opportunities-page.tsx");
    expect(opp).toMatch(/const canManage = canManageFollowup\(profile\);/);
    expect(opp).toMatch(/\{canManage && \(\s*<>\s*<SnoozeMenu/);
  });
});

describe("3. Server: snooze and close are a manager's", () => {
  const src = read("src/lib/followups.functions.ts");
  for (const name of ["closeFollowup", "snoozeFollowup"]) {
    it(`${name} checks canManageFollowup before writing`, () => {
      const fn = serverFn(src, name);
      const check = fn.indexOf(
        "if (!canManageFollowup(p)) throw new Error(FOLLOWUP_MANAGER_ONLY);",
      );
      expect(check).toBeGreaterThan(0);
      expect(check).toBeLessThan(fn.indexOf('.from("crm_followups")'));
    });
  }
  it("no other server function reopens or completes a follow-up", () => {
    expect(src).not.toMatch(/export const (reopen|complete)Followup/);
  });
});

describe("4. Database: the manager-only trigger", () => {
  const sql = read("supabase/migrations/20261001030000_followups_manager_only.sql");
  it("adds the columns idempotently", () => {
    expect(sql).toMatch(
      /alter table public\.crm_followups add column if not exists snoozed_until timestamptz;/,
    );
    expect(sql).toMatch(
      /alter table public\.crm_followups add column if not exists closed_by_sync boolean not null default false;/,
    );
  });
  it("raises the owner's message for a non-manager's snooze, manual close or delete", () => {
    expect(sql).toContain("create or replace function public.crm_followups_manager_only()");
    expect(sql).toContain("coalesce(auth.role(), '') = 'service_role'");
    expect(sql).toContain("public.is_admin() or public.is_manager()");
    expect(sql).toContain("new.status = 'snoozed'");
    expect(sql).toContain("new.snoozed_until is distinct from old.snoozed_until");
    expect(sql).toMatch(/new\.status = 'closed'[\s\S]*not coalesce\(new\.closed_by_sync, false\)/);
    expect(
      sql.match(/raise exception 'Only a manager can snooze or close a follow-up'/g),
    ).toHaveLength(3);
    expect(sql).toContain(
      "drop trigger if exists crm_followups_manager_only on public.crm_followups;",
    );
    expect(sql).toMatch(
      /create trigger crm_followups_manager_only before update on public\.crm_followups\s+for each row execute function public\.crm_followups_manager_only\(\);/,
    );
    expect(sql).toMatch(/create trigger crm_followups_manager_only_delete before delete/);
  });
  it("a contact-log note does not count as a contact", () => {
    expect(sql).toContain(
      "check (method in ('called','texted','emailed','visited','other','note'))",
    );
    expect(sql).toMatch(/if new\.method = 'note' then\s+return new;/);
  });
  it("types.ts knows the new columns", () => {
    const types = read("src/integrations/supabase/types.ts");
    const block = types.slice(
      types.indexOf("crm_followups: {"),
      types.indexOf("Relationships", types.indexOf("crm_followups: {")),
    );
    expect(block).toContain("snoozed_until: string | null;");
    expect(block).toContain("closed_by_sync: boolean;");
  });
});

describe("5. Dates: managers move them; every move is logged", () => {
  const service = read("src/lib/service.functions.ts");
  const opps = read("src/lib/opportunities.functions.ts");
  it("saveServiceJob and assignServiceJob refuse a plain user's move and log every move", () => {
    for (const name of ["saveServiceJob", "assignServiceJob"]) {
      const fn = serverFn(service, name);
      const check = fn.indexOf("dateMoveProblem({");
      expect(check, name).toBeGreaterThan(0);
      expect(check, name).toBeLessThan(fn.indexOf(".update("));
      expect(fn, name).toContain("if (moveProblem) throw new Error(moveProblem);");
      expect(fn, name).toContain("await logTicketDateMove(");
    }
    expect(service).toMatch(/dateMoveNote\("Date", oldYmd, newYmd\)/);
    expect(service).toMatch(/kind: "note",\s+note,/);
  });
  it("an update that leaves the ticket date out keeps it (never cleared)", () => {
    expect(service).not.toMatch(/^\s+scheduled_date: fields\.scheduled_date \?\? null,$/m);
  });
  it("saveOpportunity refuses a plain user's move and logs it in the contact log", () => {
    const fn = serverFn(opps, "saveOpportunity");
    const check = fn.indexOf("dateMoveProblem({");
    expect(check).toBeGreaterThan(0);
    expect(check).toBeLessThan(fn.indexOf(".update(patch)"));
    expect(fn).toContain('dateMoveNote("Expected close", oldClose, row.expected_close)');
    expect(fn).toMatch(/from\("crm_contact_log"\)\.insert\(\{[\s\S]*method: LOG_NOTE_METHOD/);
    // An update that leaves the date out keeps it.
    expect(fn).toContain(
      "...(id && fields.expected_close === undefined ? {} : { expected_close: expected })",
    );
  });
  it("the forms lock a stored date with a hint: a ticket's for a technician (the office moves it since Oct 9), an opportunity's for non-managers", () => {
    const ticket = read("src/components/service-page.tsx");
    expect(ticket).toMatch(
      /const dateLocked = !!job\?\.scheduled_date && !dispatchesTickets\(profile\);/,
    );
    expect(ticket).toContain("The office moves dates");
    const opp = read("src/components/opportunities-page.tsx");
    expect(opp).toMatch(/const closeLocked = !!opp\?\.expected_close && !seesEveryone\(profile\);/);
    expect(opp).toContain("Managers move dates");
  });
  it("a logged note shows as Note in the contact log", () => {
    expect(LOG_NOTE_METHOD).toBe("note");
    expect(contactMethodLabel("note")).toBe("Note");
    expect(contactMethodLabel("called")).toBe("Called");
    expect(contactMethodLabel("weird")).toBe("Other");
  });
});

describe("6. The counts strip and the Overdue filters are unchanged", () => {
  it("work-counts.ts does not know about follow-up snoozes", () => {
    const counts = read("src/lib/work-counts.ts");
    expect(counts).not.toMatch(/snooz|closed_by_sync/);
  });
});
