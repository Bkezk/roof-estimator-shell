/**
 * Ticket change history (service study M6, owner Oct 5): the database logs every change to a
 * ticket and its time entries, and the ticket page shows it to admins and managers.
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AUDIT_ENTITIES } from "@/lib/audit";
import { activityText } from "@/lib/owner-view";

const read = (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : "");
const flatSql = (p: string) =>
  read(p)
    .replace(/--[^\n]*/g, "")
    .replace(/\s+/g, " ");
const auditRow = (flat: string) => {
  const start = flat.indexOf("create or replace function public.audit_row()");
  return flat.slice(start, flat.indexOf("$$;", start) + 3);
};

const PATH = "supabase/migrations/20261005130000_ticket_audit.sql";
const flat = flatSql(PATH);
/** The live definition: 20261006200000_audit_ticket_readable.sql re-creates audit_row() (owner, Oct 6). */
const LIVE = "supabase/migrations/20261006200000_audit_ticket_readable.sql";

const BRANCHES =
  "when 'service_jobs' then v_entity := 'ticket'; v_entity_id := (v_row ->> 'id')::uuid; v_label := rtrim('Ticket ' || coalesce(v_row ->> 'number', '')); when 'service_time_entries' then v_entity := 'ticket_time'; v_entity_id := (v_row ->> 'service_job_id')::uuid; v_parent := 'service_job_id'; select j.number::text into v_inv from public.service_jobs j where j.id = v_entity_id; if not found then if tg_op = 'DELETE' then return null; end if; v_inv := ''; end if; v_label := rtrim('Ticket ' || v_inv) || ' time ''' || coalesce(v_old ->> 'kind', v_new ->> 'kind', '') || ''''; ";

describe("the migration", () => {
  it("exists", () => expect(existsSync(PATH)).toBe(true));
  it("adds 'ticket' and 'ticket_time' to the entity check, which matches AUDIT_ENTITIES", () => {
    const listed = /check \(entity in \(([^)]*)\)\)/.exec(flat)![1]!;
    expect(listed.split(",").map((x) => x.trim().replace(/'/g, ""))).toEqual([...AUDIT_ENTITIES]);
    expect(AUDIT_ENTITIES).toContain("ticket");
    expect(AUDIT_ENTITIES).toContain("ticket_time");
  });
  it("audit_row is 20261002130000's exactly, plus only the two ticket branches", () => {
    const before = auditRow(flatSql("supabase/migrations/20261002130000_audit_readable.sql"));
    const after = auditRow(flat);
    expect(after).toContain(BRANCHES);
    expect(after.replace(BRANCHES, "")).toBe(before);
    expect(flat).toContain("revoke all on function public.audit_row() from public;");
  });
  it("the live audit_row (20261006200000) keeps both ticket branches: it is 20261005130000's plus only the Oct 6 changes (owner, Oct 6)", () => {
    const live = auditRow(flatSql(LIVE));
    expect(live).toContain(BRANCHES);
    // The Oct 6 changes (audit-ticket-readable.test.ts pins each): stage_changed_at skipped, the
    // Property label, the property_sites and site_warranties branches. Undo them and the body is
    // this migration's.
    const undone = live
      .replace(", 'stage_changed_at'];", "];")
      .replace(
        "v_label := 'Property ''' || coalesce(v_old",
        "v_label := 'Site ''' || coalesce(v_old",
      )
      .replace(/when 'property_sites' then .*?(?=when 'crm_site_contacts')/, "")
      .replace(/when 'site_warranties' then .*?(?=when 'crm_site_contacts')/, "");
    expect(undone).toBe(auditRow(flat));
  });
  it("triggers on tickets and their time entries, replayable", () => {
    expect(flat).toContain(
      "drop trigger if exists service_jobs_audit on public.service_jobs; create trigger service_jobs_audit after insert or update or delete on public.service_jobs for each row execute function public.audit_row();",
    );
    expect(flat).toContain(
      "drop trigger if exists service_time_entries_audit on public.service_time_entries; create trigger service_time_entries_audit after insert or update or delete on public.service_time_entries for each row execute function public.audit_row();",
    );
  });
});

describe("reading it", () => {
  it("listAudit takes a ticket: its own rows and its time entries' rows", () => {
    const fns = read("src/lib/audit.functions.ts");
    expect(fns).toContain('entity: z.enum(["invoice", "account", "vendor", "ticket"])');
    expect(fns).toContain('.in("entity", ["ticket", "ticket_time"])');
  });
  it("the ticket page has the History fold (AuditHistory hides itself from non-managers)", () => {
    const src = read("src/components/service/ticket-field-sections.tsx");
    expect(src).toContain('<AuditHistory entity="ticket" entityId={job.id}');
    expect(read("src/components/audit-history.tsx")).toContain(
      "if (!seesEveryone(profile)) return null;",
    );
  });
  it("the Owner view's activity line links a ticket change to the ticket", () => {
    const a = activityText({
      source: "audit",
      at: "2026-10-05T14:00:00Z",
      entity: "ticket",
      entity_id: "t1",
      action: "update",
      summary: "Ticket 6012 po number — → '218162'",
    } as Parameters<typeof activityText>[0]);
    expect(a).toEqual({
      at: "2026-10-05T14:00:00Z",
      text: "Edited ticket 6012 po number — → '218162'",
      href: "/service?id=t1",
    });
  });
});
