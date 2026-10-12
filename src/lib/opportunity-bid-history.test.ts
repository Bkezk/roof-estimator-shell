/**
 * Owner item 12 (Oct 12): History for opportunities and bids. Entity 'opportunity' and 'bid'
 * join the audit_log entity check; audit_row() is 20261009100000_tasks_tracking.sql's exactly
 * plus the two branches and two skips (status_changed_at, data — the bid's whole estimator
 * payload); audit_col_name() / audit_label() are 20261006200000's exactly plus bid_id and
 * opportunity_id; the triggers fire on crm_opportunities and bids. Reading stays admins and
 * managers (audit_log_read, listAudit). The folds: the opportunity page's right column and the
 * foot of the estimator's total panel. Migration 20261012100000_bid_drives_opportunity.sql.
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));

import { AUDIT_ENTITIES, AUDIT_FIELD_LABELS, auditFieldLabel } from "@/lib/audit";
import { listAudit } from "@/lib/audit.functions";
import { fakeSupabase } from "@/test/fake-supabase";

type Row = Record<string, unknown>;
const read = (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : "");
const src = (p: string) => read(p).replace(/\s+/g, " ");
const flatSql = (p: string) =>
  read(p)
    .replace(/--[^\n]*/g, "")
    .replace(/\s+/g, " ");
const fn = (flat: string, name: string) => {
  const start = flat.indexOf(`create or replace function public.${name}(`);
  return start < 0 ? "" : flat.slice(start, flat.indexOf("$$;", start) + 3);
};

const MIGRATION = "supabase/migrations/20261012100000_bid_drives_opportunity.sql";
const TASKS = "supabase/migrations/20261009100000_tasks_tracking.sql";
const OCT6 = "supabase/migrations/20261006200000_audit_ticket_readable.sql";
const flat = flatSql(MIGRATION);
const auditRow = fn(flat, "audit_row");

const OPP_BRANCH =
  "when 'crm_opportunities' then v_entity := 'opportunity'; v_entity_id := (v_row ->> 'id')::uuid; v_label := 'Opportunity ''' || coalesce(v_old ->> 'title', v_new ->> 'title', '') || ''''; ";
const BID_BRANCH =
  "when 'bids' then v_entity := 'bid'; v_entity_id := (v_row ->> 'id')::uuid; v_label := 'Bid ''' || coalesce(v_old ->> 'name', v_new ->> 'name', '') || ''''; ";

describe("the entity check and AUDIT_ENTITIES", () => {
  it("adds 'opportunity' and 'bid', keeping every existing entity (= AUDIT_ENTITIES)", () => {
    expect(existsSync(MIGRATION)).toBe(true);
    expect(flat).toContain(
      "alter table public.audit_log drop constraint if exists audit_log_entity_check;",
    );
    const listed = /check \(entity in \(([^)]*)\)\)/.exec(flat)![1]!;
    expect(listed.split(",").map((x) => x.trim().replace(/'/g, ""))).toEqual([...AUDIT_ENTITIES]);
    expect(AUDIT_ENTITIES.slice(-2)).toEqual(["opportunity", "bid"]);
  });
  it("leaves the read rule alone: audit_log_read (admins and managers, 20261001070000) is not touched", () => {
    expect(flat).not.toContain("audit_log_read");
    expect(flatSql("supabase/migrations/20261001070000_sales_invoices_audit.sql")).toContain(
      "create policy audit_log_read on public.audit_log for select to authenticated using (public.is_admin() or public.is_manager());",
    );
  });
});

describe("audit_row()", () => {
  it("gets the two branches: \"Opportunity 'title'\" and \"Bid 'name'\", entity_id = the row", () => {
    expect(auditRow).toContain(OPP_BRANCH);
    expect(auditRow).toContain(BID_BRANCH);
    expect(flat).toContain("revoke all on function public.audit_row() from public;");
  });
  it("skips status_changed_at (the status says it) and data (the bid's payload), keeping the Oct 9 skips", () => {
    expect(auditRow).toContain(
      "v_skip constant text[] := array['id', 'created_at', 'created_by', 'updated_at', 'updated_by_name', 'pdf_path', 'sage_exported_at', 'sort', 'approved_by', 'approved_at', 'stage_changed_at', 'done_at', 'done_by', 'done_by_name', 'notified_created_at', 'notified_morning_at', 'notified_overdue_at', 'notify_error', 'assignee', 'status_changed_at', 'data'];",
    );
  });
  it("is otherwise 20261009100000's audit_row() exactly", () => {
    const before = fn(flatSql(TASKS), "audit_row");
    expect(before).not.toBe("");
    const stripped = auditRow
      .replace(", 'status_changed_at', 'data'];", "];")
      .replace(OPP_BRANCH, "")
      .replace(BID_BRANCH, "");
    expect(stripped).toBe(before);
  });
  it("fires on crm_opportunities and bids, replayable", () => {
    expect(flat).toContain(
      "drop trigger if exists crm_opportunities_audit on public.crm_opportunities; create trigger crm_opportunities_audit after insert or update or delete on public.crm_opportunities for each row execute function public.audit_row();",
    );
    expect(flat).toContain(
      "drop trigger if exists bids_audit on public.bids; create trigger bids_audit after insert or update or delete on public.bids for each row execute function public.audit_row();",
    );
  });
});

describe("audit_col_name() / audit_label(): bid_id names the bid, opportunity_id the opportunity", () => {
  const oct6 = flatSql(OCT6);
  it("audit_col_name is 20261006200000's plus the two columns", () => {
    const now = fn(flat, "audit_col_name");
    expect(now).toContain(
      "'vendor_id', 'bill_to_vendor_id', 'site_id', 'account_id', 'contact_id', 'location_id', 'bid_id', 'opportunity_id') then left(p_col, -3)",
    );
    expect(now.replace(", 'bid_id', 'opportunity_id') then left", ") then left")).toBe(
      fn(oct6, "audit_col_name"),
    );
  });
  it("audit_label is 20261006200000's plus the two lookups", () => {
    const now = fn(flat, "audit_label");
    expect(now).toContain(
      "'account_id', 'contact_id', 'location_id', 'bid_id', 'opportunity_id') then v_id := v_text::uuid;",
    );
    const added =
      "elsif p_col = 'bid_id' then select b.name into v_out from public.bids b where b.id = v_id; elsif p_col = 'opportunity_id' then select o.title into v_out from public.crm_opportunities o where o.id = v_id; ";
    expect(now).toContain(added);
    expect(
      now.replace(", 'bid_id', 'opportunity_id') then v_id", ") then v_id").replace(added, ""),
    ).toBe(fn(oct6, "audit_label"));
    expect(flat).toContain(
      "revoke all on function public.audit_col_name(text) from public, anon, authenticated; revoke all on function public.audit_label(text, text, jsonb) from public, anon, authenticated;",
    );
  });
});

describe("the app's field labels (audit.ts)", () => {
  it("names the opportunity's and the bid's fields readably", () => {
    expect(AUDIT_FIELD_LABELS.opportunity).toMatchObject({
      title: "title",
      status: "status",
      assignee_id: "assignee",
      expected_close: "expected close",
      est_value: "est value",
      lead_source: "lead source",
      account_id: "customer",
      site_id: "site",
      bid_id: "bid link",
    });
    expect(AUDIT_FIELD_LABELS.bid).toMatchObject({
      name: "name",
      status: "status",
      grand_total: "grand total",
      submitted_at: "submitted at",
      lost_reason: "lost reason",
      account_id: "account",
      site_id: "site",
    });
    expect(auditFieldLabel("opportunity", "expected_close")).toBe("expected close");
    expect(auditFieldLabel("bid", "lost_reason")).toBe("lost reason");
    // An unknown column, or another entity: the column in words.
    expect(auditFieldLabel("bid", "roof_id")).toBe("roof");
    expect(auditFieldLabel("ticket", "stage_changed_at")).toBe("stage changed at");
  });
});

describe("reading it (listAudit)", () => {
  const MGR = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const SALES = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const OPP = "11111111-1111-4111-8111-111111111111";
  const BID = "33333333-3333-4333-8333-333333333333";
  const rows = (): Row[] => [
    {
      id: 1,
      at: "2026-10-12T12:00:00Z",
      entity: "opportunity",
      entity_id: OPP,
      action: "update",
      summary: "Opportunity 'Reroof gym' status open → quoted",
    },
    {
      id: 2,
      at: "2026-10-12T12:01:00Z",
      entity: "bid",
      entity_id: BID,
      action: "update",
      summary: "Bid 'Gym reroof bid' status draft → submitted",
    },
    {
      id: 3,
      at: "2026-10-12T12:02:00Z",
      entity: "ticket",
      entity_id: OPP,
      action: "update",
      summary: "not this",
    },
  ];
  const env = () =>
    fakeSupabase({
      profiles: [
        { id: MGR, role: "manager", access: [], technician: false },
        { id: SALES, role: "user", access: ["customers", "estimate"], technician: false },
      ],
      audit_log: rows(),
    });
  const call = (data: Row, userId: string, db = env().db) =>
    (listAudit as unknown as (a: { data: Row; context: unknown }) => Promise<Row[]>)({
      data,
      context: { supabase: db, userId },
    });
  it("takes an opportunity and a bid: their own rows, newest first", async () => {
    const o = await call({ entity: "opportunity", entity_id: OPP }, MGR);
    expect(o.map((r) => r["id"])).toEqual([1]);
    const b = await call({ entity: "bid", entity_id: BID }, MGR);
    expect(b.map((r) => r["id"])).toEqual([2]);
  });
  it("is still for admins and managers only", async () => {
    await expect(call({ entity: "opportunity", entity_id: OPP }, SALES)).rejects.toThrow(
      "The history is for admins and managers",
    );
  });
  it("the validator and the fold type know both", () => {
    expect(read("src/lib/audit.functions.ts")).toContain(
      'entity: z.enum(["invoice", "account", "vendor", "ticket", "task", "opportunity", "bid"])',
    );
    expect(src("src/components/audit-history.tsx")).toContain(
      'export type AuditFold = "invoice" | "account" | "vendor" | "ticket" | "task" | "opportunity" | "bid";',
    );
  });
});

describe("where the folds sit", () => {
  it("the opportunity page: in the right column under Contact (AuditHistory hides itself from non-managers)", () => {
    const page = src("src/components/opportunities-page.tsx");
    const contact = page.indexOf('<ContactLogList kind="opportunity" itemId={opp.id} />');
    const fold = page.indexOf(
      '<AuditHistory entity="opportunity" entityId={opp.id} className="rounded-lg border px-4 py-3" />',
    );
    expect(contact).toBeGreaterThan(0);
    expect(fold).toBeGreaterThan(contact);
    expect(page).toContain('import { AuditHistory } from "@/components/audit-history";');
  });
  it("the estimator: at the foot of the bid-total panel, only for a saved bid", () => {
    const est = src("src/routes/estimate.tsx");
    expect(est).toContain(
      '{bidId && ( <AuditHistory entity="bid" entityId={bidId} className="rounded-lg border px-4 py-3" /> )}',
    );
    const panel = est.indexOf('<div id="bid-total-panel"');
    const fold = est.indexOf('<AuditHistory entity="bid"');
    const accessories = est.indexOf("<AccessorySummaryCard");
    expect(panel).toBeGreaterThan(0);
    expect(accessories).toBeGreaterThan(panel);
    expect(fold).toBeGreaterThan(accessories);
  });
});
