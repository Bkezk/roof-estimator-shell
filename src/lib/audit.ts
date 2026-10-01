/**
 * The audit log (owner, Oct 1: "whatever is changed needs to be logged somewhere showing what
 * they did, when, and who"). Every write to invoices, invoice lines, customers, sites and
 * contacts — by anyone — leaves a row in `public.audit_log` (migration
 * 20261001070000_sales_invoices_audit.sql) through `logAudit` (audit.server.ts). Admins and
 * managers read it: the History folds on the invoice block and the customer profile, and the
 * Owner view's "last activity".
 *
 * Row shape: at, by_user, by_name, by_role ('admin' | 'manager' | 'sales' | 'technician' |
 * 'user'), entity (AUDIT_ENTITIES), entity_id (the row's uuid; for an invoice line, its
 * invoice's id — invoice_lines.id is an integer), action (AUDIT_ACTIONS), summary (one line in
 * words) and changes ({ field: { from, to } }, only the fields that changed).
 *
 * Pure: no database, no server imports (unit tested in sales-invoices-audit.test.ts).
 */
import type { Json } from "@/integrations/supabase/types";
import { isAdmin, isManager, isSalesPm, type AccessLike } from "@/lib/access";

export const AUDIT_ENTITIES = ["invoice", "invoice_line", "account", "site", "contact"] as const;
export type AuditEntity = (typeof AUDIT_ENTITIES)[number];
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

export interface AuditChange {
  from: unknown;
  to: unknown;
}
export type AuditChanges = Record<string, AuditChange>;

/** One row to log; `summary` defaults to auditSummary(entity, action, changes, label). */
export interface AuditEntry {
  entity: AuditEntity;
  entity_id: string | null;
  action: AuditAction;
  changes?: AuditChanges | null;
  /** How the summary names the row, e.g. "Invoice 6012" or "Customer 'Acme'". */
  label?: string;
  summary?: string;
}

/** Who did it, as stored on the row. */
export interface AuditActor {
  id: string;
  name: string;
  role: string;
}

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

// The fields compared for each entity (money included). Bookkeeping columns (updated_at,
// updated_by_name, created_by, sort, pdf_path) are left out.
export const INVOICE_FIELDS = [
  "invoice_date",
  "due_date",
  "po_number",
  "job_code",
  "description",
  "payment_terms",
  "bill_to",
  "tax_rate",
  "subtotal",
  "tax_amount",
  "total",
  "cost_total",
  "status",
  "paid_on",
  "paid_amount",
  "paid_method",
  "paid_ref",
  "sent_to",
  "sage_exported_at",
] as const;
export const INVOICE_LINE_FIELDS = [
  "kind",
  "description",
  "qty",
  "unit",
  "rate",
  "total",
  "cost_rate",
  "cost_total",
  "on_date",
  "taxable",
  "source",
] as const;
export const ACCOUNT_FIELDS = [
  "name",
  "kind",
  "contact_name",
  "phone",
  "mobile",
  "email",
  "address1",
  "address2",
  "city",
  "state",
  "zip",
  "mailing_same",
  "mailing_address1",
  "mailing_address2",
  "mailing_city",
  "mailing_state",
  "mailing_zip",
  "account_manager_id",
  "billing_instructions",
  "external_id",
  "tax_exempt",
  "notes",
  "source",
  "deleted_at",
] as const;
export const SITE_FIELDS = [
  "name",
  "address1",
  "address2",
  "city",
  "state",
  "zip",
  "technician_instructions",
  "notes",
  "county_code_id",
  "deleted_at",
] as const;
export const CONTACT_FIELDS = [
  "name",
  "position",
  "email",
  "mobile",
  "office_phone",
  "is_billing",
  "notes",
  "site_ids",
  "deleted_at",
] as const;

/** undefined, null, blank text and an empty list are all "nothing". */
function norm(v: unknown): unknown {
  if (v === undefined || v === null) return null;
  if (typeof v === "string" && v.trim() === "") return null;
  if (Array.isArray(v) && v.length === 0) return null;
  return v;
}
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object")
    return `{${Object.keys(v as Record<string, unknown>)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  return JSON.stringify(v);
}
function same(a: unknown, b: unknown): boolean {
  const x = norm(a);
  const y = norm(b);
  if (x === null || y === null) return x === y;
  if (typeof x === "number" || typeof y === "number") {
    const nx = Number(x);
    const ny = Number(y);
    if (Number.isFinite(nx) && Number.isFinite(ny)) return nx === ny;
  }
  if (typeof x === "object" || typeof y === "object") return stable(x) === stable(y);
  return x === y;
}

/**
 * The fields of `fields` whose value differs between `before` and `after`, as { from, to }.
 * `before` null = a create (every set field, from null); `after` null = a delete. Null,
 * undefined and blank text count as the same; "85.00" equals 85; objects compare by value.
 */
export function diffForAudit(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
  fields: readonly string[],
): AuditChanges {
  const out: AuditChanges = {};
  for (const f of fields) {
    const from = before?.[f] ?? null;
    const to = after?.[f] ?? null;
    if (!same(from, to)) out[f] = { from, to };
  }
  return out;
}

const ENTITY_LABEL: Record<AuditEntity, string> = {
  invoice: "Invoice",
  invoice_line: "Invoice line",
  account: "Customer",
  site: "Site",
  contact: "Contact",
};
const MAX_PARTS = 6;

function fmt(v: unknown): string {
  const n = norm(v);
  if (n === null) return "—";
  if (typeof n === "boolean") return n ? "yes" : "no";
  if (typeof n === "number") return String(Math.round(n * 10000) / 10000);
  if (typeof n === "string") return `'${n.length > 60 ? `${n.slice(0, 59)}…` : n}'`;
  if (Array.isArray(n))
    return n.length ? n.map((x) => (typeof x === "string" ? x : fmt(x))).join(", ") : "—";
  const s = stable(n);
  return s.length > 80 ? `${s.slice(0, 79)}…` : s;
}
const fieldName = (f: string) => f.replace(/_/g, " ");

/**
 * One line in words: "Invoice 6012 line 'Labor' rate 85 → 95", "Customer 'Acme' created: name
 * 'Acme'", "Invoice 6012 marked paid: paid amount 0 → 450". `label` names the row; without it,
 * the entity's name. At most six fields are listed.
 */
export function auditSummary(
  entity: AuditEntity,
  action: AuditAction,
  changes: AuditChanges | null | undefined,
  label?: string,
): string {
  const subject = label ?? ENTITY_LABEL[entity];
  const line = entity === "invoice_line";
  const verb: Record<AuditAction, string> = {
    create: line ? "added" : "created",
    update: "",
    delete: line ? "removed" : "deleted",
    finalize: "finalized",
    send: "sent",
    paid: "marked paid",
    void: "voided",
  };
  const entries = action === "delete" ? [] : Object.entries(changes ?? {});
  const parts = entries
    .slice(0, MAX_PARTS)
    .map(([k, c]) =>
      norm(c.from) === null && action !== "update"
        ? `${fieldName(k)} ${fmt(c.to)}`
        : `${fieldName(k)} ${fmt(c.from)} → ${fmt(c.to)}`,
    );
  if (entries.length > MAX_PARTS) parts.push(`+${entries.length - MAX_PARTS} more`);
  const head = verb[action] ? `${subject} ${verb[action]}` : subject;
  if (!parts.length) return action === "update" ? `${subject} saved, nothing changed` : head;
  return `${head}${verb[action] ? ": " : " "}${parts.join("; ")}`;
}

/** The role shown next to the name: admin, manager, sales, technician or user. */
export function auditRole(p: AccessLike | null | undefined): string {
  if (isAdmin(p)) return "admin";
  if (isManager(p)) return "manager";
  if (isSalesPm(p)) return "sales";
  if (p?.technician) return "technician";
  return "user";
}

export function auditActor(
  userId: string,
  p: (AccessLike & { full_name?: string | null; email?: string | null }) | null | undefined,
): AuditActor {
  return {
    id: userId,
    name: (p?.full_name ?? "").trim() || (p?.email ?? "").trim() || "Unknown user",
    role: auditRole(p),
  };
}

/** An invoice line as compared; `id` absent = a new line. */
export type AuditLine = Record<string, unknown> & { id?: number | null; description?: unknown };
export interface LineChange {
  action: "create" | "update" | "delete";
  description: string;
  changes: AuditChanges;
}

/**
 * What a save did to an invoice's lines: the saved lines carry their old id (the editor sends
 * it); a line with a known id is compared field by field, any other line is new, and an old
 * line nobody kept was removed. Unchanged lines are not reported.
 */
export function diffInvoiceLines(before: AuditLine[], after: AuditLine[]): LineChange[] {
  const old = new Map<number, AuditLine>();
  for (const l of before) if (l.id != null) old.set(l.id, l);
  const kept = new Set<number>();
  const out: LineChange[] = [];
  const desc = (l: AuditLine) => String(l.description ?? "");
  for (const l of after) {
    const prev = l.id != null ? old.get(l.id) : undefined;
    if (prev && l.id != null && !kept.has(l.id)) {
      kept.add(l.id);
      const changes = diffForAudit(prev, l, INVOICE_LINE_FIELDS);
      if (Object.keys(changes).length)
        out.push({ action: "update", description: desc(prev), changes });
    } else {
      out.push({
        action: "create",
        description: desc(l),
        changes: diffForAudit(null, l, INVOICE_LINE_FIELDS),
      });
    }
  }
  for (const l of before)
    if (l.id == null || !kept.has(l.id))
      out.push({
        action: "delete",
        description: desc(l),
        changes: diffForAudit(l, null, INVOICE_LINE_FIELDS),
      });
  return out;
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
