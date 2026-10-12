/**
 * The audit log (owner, Oct 1: "whatever is changed needs to be logged somewhere showing what
 * they did, when, and who"; "it's essential we record all actions accurately and durably").
 * Every insert, update and delete on invoices, invoice lines, customers, sites and contacts (and
 * a contact's site links) — by anyone, through the app or straight to the database — leaves a
 * row in `public.audit_log`, written by the database itself: the row trigger `public.audit_row()`
 * (migration 20261001080000_audit_triggers_stage_rule.sql). A ticket's purchase orders too
 * (entity 'purchase_order', entity_id = the PO's id: "PO 'Jbk24-0255' approved no → yes";
 * 20261001100000_ticket_purchase_orders.sql), and vendors (entity 'vendor': "Vendor 'ABC Supply'
 * terms 'Net 30' → 'Net 45'"; 20261001110000_vendors.sql), tickets and tasks, and since Oct 12
 * opportunities and bids (entity 'opportunity' / 'bid': "Opportunity 'Reroof gym' status open →
 * quoted", "Bid 'Gym reroof' status draft → submitted"; 20261012100000_bid_drives_opportunity.sql).
 * No server function writes it. Admins and managers read it: the History folds on the invoice,
 * the customer profile, the vendor, the ticket, the task, the opportunity and the bid (the
 * estimator), and the Owner view's "last activity".
 *
 * Row shape: at, by_user (auth.uid(); null for the service role / SQL editor), by_name (the
 * profile's name, or 'system'), by_role ('admin' | 'manager' | 'sales' | 'technician' | 'user';
 * null for 'system'), entity (AUDIT_ENTITIES), entity_id (the row's uuid; for an invoice line,
 * its invoice's id — invoice_lines.id is an integer), action (AUDIT_ACTIONS), summary (one line
 * in words, built in SQL: "Invoice 6012 line 'Labor' rate 85 → 95") and changes
 * ({ column: { from, to } }, only the columns that changed).
 *
 * Pure: no database, no server imports (unit tested in sales-invoices-audit.test.ts).
 */
import type { Json } from "@/integrations/supabase/types";

/** The audit_log.entity check constraint. */
export const AUDIT_ENTITIES = [
  "invoice",
  "invoice_line",
  "account",
  "site",
  "contact",
  "purchase_order",
  "vendor",
  // A ticket and its time entries (entity_id = the ticket; 20261005130000_ticket_audit.sql).
  "ticket",
  "ticket_time",
  // A task (entity_id = the task; 20261009100000_tasks_tracking.sql, owner Oct 9: tasks behave
  // like tickets, History included).
  "task",
  // An opportunity and a bid (entity_id = the row; 20261012100000_bid_drives_opportunity.sql,
  // owner Oct 12, item 12).
  "opportunity",
  "bid",
] as const;
export type AuditEntity = (typeof AUDIT_ENTITIES)[number];
/** The audit_log.action check constraint. */
export const AUDIT_ACTIONS = [
  "create",
  "update",
  "delete",
  "finalize",
  "send",
  "paid",
  "void",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/**
 * Readable names for the columns a History line may mention (the summary is built in SQL from
 * audit_col_name(): "expected close", "est value", "bid", "lead source"…; these are the app's
 * twin, for anything that renders `changes` by field). Only the two Oct 12 entities are listed.
 */
export const AUDIT_FIELD_LABELS: Record<"opportunity" | "bid", Readonly<Record<string, string>>> = {
  opportunity: {
    title: "title",
    status: "status",
    assignee_id: "assignee",
    expected_close: "expected close",
    est_value: "est value",
    lead_source: "lead source",
    account_id: "customer",
    site_id: "site",
    bid_id: "bid link",
    description: "description",
    notes: "notes",
    contacted_at: "contacted at",
    deleted_at: "deleted",
  },
  bid: {
    name: "name",
    status: "status",
    grand_total: "grand total",
    submitted_at: "submitted at",
    lost_reason: "lost reason",
    account_id: "account",
    site_id: "site",
    opportunity_id: "opportunity",
    deleted_at: "deleted",
  },
};

/** The readable name of a changed field, for an entity ("expected close"); the column otherwise. */
export const auditFieldLabel = (entity: string, column: string): string =>
  (entity === "opportunity" || entity === "bid" ? AUDIT_FIELD_LABELS[entity][column] : undefined) ??
  column.replace(/_id$/, "").replace(/_/g, " ");

/** A logged row as the History folds read it. */
export interface AuditRow {
  id: number;
  at: string;
  by_user: string | null;
  by_name: string | null;
  by_role: string | null;
  entity: string;
  entity_id: string | null;
  action: string;
  summary: string | null;
  changes: Json | null;
}

/** "Oct 1, 9:14 AM · RoAnna Sims (sales) · Invoice 6012 line 'Labor' rate 85 → 95". */
export function auditLine(
  r: Pick<AuditRow, "at" | "by_name" | "by_role" | "summary">,
  timeZone?: string,
): string {
  const when = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    ...(timeZone ? { timeZone } : {}),
  })
    .format(new Date(r.at))
    .replace(/\s/g, " ");
  const who = `${r.by_name ?? "Someone"}${r.by_role ? ` (${r.by_role})` : ""}`;
  return `${when} · ${who} · ${r.summary ?? ""}`;
}
