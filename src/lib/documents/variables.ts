/**
 * The merge fields a document can carry (CenterPoint's Variables tab, owner's screenshots, Oct
 * 26): Account (JBK itself), Company (the customer), Property (the site), Opportunity (the bid
 * or ticket), Manager (whoever made the record), Account Manager (the customer's), Purchase
 * Order, Today's Date. The server resolves them from the record (document-variables.server.ts →
 * `resolveVariables` here, pure, from a DocumentSource it loads); the editor lists VARIABLE_DEFS
 * grouped, with the resolved value beside each; the PDF and the on-screen page print the value.
 *
 * Keys are stable text ("company.name"): a template written today must resolve the same way
 * next year, so never rename one — add a new key and keep the old.
 */
import type { DocKind } from "./model";

export interface VariableDef {
  key: string;
  label: string;
  group: VariableGroup;
  /** Shown when the record has nothing (the template preview, an unlinked bid). */
  sample: string;
  /** Bid documents only / ticket documents only; absent = both. */
  kinds?: DocKind[];
}
export type VariableGroup =
  | "General"
  | "Account"
  | "Company"
  | "Property"
  | "Opportunity"
  | "Ticket"
  | "Manager"
  | "Account Manager";

export const VARIABLE_GROUPS: VariableGroup[] = [
  "General",
  "Account",
  "Company",
  "Property",
  "Opportunity",
  "Ticket",
  "Manager",
  "Account Manager",
];

const v = (
  key: string,
  label: string,
  group: VariableGroup,
  sample: string,
  kinds?: DocKind[],
): VariableDef => ({
  key,
  label,
  group,
  sample,
  ...(kinds ? { kinds } : {}),
});

export const VARIABLE_DEFS: VariableDef[] = [
  v("today", "Today's Date", "General", "October 26, 2026"),
  v("today.short", "Today's Date (short)", "General", "10/26/26"),
  v("document.title", "Document Title", "General", "Proposal"),
  // Account = JBK (company_settings).
  v("account.name", "Account Name", "Account", "JBK, Inc. Commercial Roofing"),
  v("account.address1", "Account Address Line 1", "Account", "1486 W Cumberland Gap Pkwy"),
  v("account.address2", "Account Address Line 2", "Account", "Corbin, KY 40702"),
  v("account.address", "Account Address", "Account", "1486 W Cumberland Gap Pkwy"),
  v("account.city", "Account City", "Account", "Corbin"),
  v("account.state", "Account State", "Account", "KY"),
  v("account.zip", "Account Zip", "Account", "40702"),
  v("account.phone", "Account Phone", "Account", "(606) 523-9000"),
  v("account.website", "Account Website", "Account", "www.flatroofonline.com"),
  v("account.email", "Account Email", "Account", "sales@flatroofonline.com"),
  // Company = the customer (crm_accounts).
  v("company.name", "Company Name", "Company", "City of Corbin"),
  v("company.contact", "Company Contact", "Company", "Jason Wilson"),
  v("company.contact.position", "Company Contact Position", "Company", "Jailer"),
  v("company.phone", "Company Phone", "Company", "(606) 549-6013"),
  v("company.email", "Company Email", "Company", "jwilson@corbinky.gov"),
  v("company.address1", "Company Address Line 1", "Company", "128 Civic Center Dr"),
  v("company.address2", "Company Address Line 2", "Company", "Corbin, KY 40701"),
  v("company.city", "Company City", "Company", "Corbin"),
  v("company.state", "Company State", "Company", "KY"),
  v("company.zip", "Company Zip", "Company", "40701"),
  v("company.external_id", "Company External ID", "Company", "C-1086"),
  // Property = the site (crm_sites).
  v("property.name", "Property Name", "Property", "Whitley County Detention Center"),
  v("property.address1", "Property Address Line 1", "Property", "128 Civic Center Dr"),
  v("property.address2", "Property Address Line 2", "Property", "Corbin, KY 40701"),
  v("property.city", "Property City", "Property", "Corbin"),
  v("property.county", "Property County", "Property", "Whitley County"),
  v("property.state", "Property State", "Property", "KY"),
  v("property.zip", "Property Zip", "Property", "40701"),
  v("property.area", "Property Area (SF)", "Property", "18,008"),
  // Opportunity = the bid.
  v("opportunity.name", "Bid Name", "Opportunity", "Whitley County Detention Center", ["bid"]),
  v("opportunity.price", "Total Price", "Opportunity", "$242,879.61", ["bid"]),
  v("opportunity.product", "Roof System", "Opportunity", "Duro-Last 60 mil", ["bid"]),
  v("opportunity.due", "Bid Due Date", "Opportunity", "October 30, 2026", ["bid"]),
  v("opportunity.sections", "Roof Sections", "Opportunity", "2", ["bid"]),
  v("opportunity.sqft", "Bid Square Feet", "Opportunity", "52,500", ["bid"]),
  v("opportunity.warranty", "Warranty", "Opportunity", "20 Yr NDL", ["bid"]),
  // Ticket.
  v("ticket.number", "Ticket Number", "Ticket", "6012", ["ticket"]),
  v("ticket.description", "Ticket Description", "Ticket", "Leak over room 104", ["ticket"]),
  v("ticket.date", "Ticket Date", "Ticket", "October 26, 2026", ["ticket"]),
  v("ticket.po", "Purchase Order", "Ticket", "PO 4471", ["ticket"]),
  v("ticket.type", "Ticket Type", "Ticket", "Repair", ["ticket"]),
  // The inspection (phase 2, owner Oct 26): service_jobs.inspection (src/lib/inspection.ts).
  v("inspection.date", "Property Inspected", "Ticket", "October 20, 2026", ["ticket"]),
  v("inspection.grade", "Property Grade", "Ticket", "D", ["ticket"]),
  v("inspection.summary", "Inspection Summary", "Ticket", "3 issues · 6 OK", ["ticket"]),
  v("inspection.issues", "Issues Found", "Ticket", "Seams; Flashings; Ponding", ["ticket"]),
  v("inspection.recommend", "Recommendation", "Ticket", "Repairs recommended", ["ticket"]),
  v("inspection.technician", "Inspected By", "Ticket", "Braden Keck", ["ticket"]),
  // People.
  v("manager.name", "Manager Name", "Manager", "Brandon Keck"),
  v("manager.email", "Manager Email", "Manager", "brandon@flatroofonline.com"),
  v("manager.phone", "Manager Office", "Manager", "(606) 523-9000"),
  v("account_manager.name", "Account Manager Name", "Account Manager", "RoAnna Sims"),
  v(
    "account_manager.email",
    "Account Manager Email",
    "Account Manager",
    "sales@flatroofonline.com",
  ),
  v("account_manager.phone", "Account Manager Office", "Account Manager", "(606) 523-9000"),
];

const defByKey = new Map(VARIABLE_DEFS.map((d) => [d.key, d]));
export const variableLabel = (key: string): string => defByKey.get(key)?.label ?? key;
export const variableDefs = (kind: DocKind): VariableDef[] =>
  VARIABLE_DEFS.filter((d) => !d.kinds || d.kinds.includes(kind));

/** The sample values (the template editor, a bid with no customer yet). */
export function sampleVariables(kind: DocKind): Record<string, string> {
  const out: Record<string, string> = {};
  for (const d of variableDefs(kind)) out[d.key] = d.sample;
  return out;
}

/**
 * What the server loads for a record, in plain fields; `resolveVariables` turns it into the
 * key → text map (every key of the kind present; a blank where the record has nothing).
 */
export interface DocumentSource {
  kind: DocKind;
  today: Date;
  documentTitle: string;
  account: {
    name: string;
    address: string;
    city: string;
    state: string;
    zip: string;
    phone: string;
    website: string;
    email: string;
  };
  company: {
    name: string;
    contact: string;
    contactPosition: string;
    phone: string;
    email: string;
    address: string;
    city: string;
    state: string;
    zip: string;
    externalId: string;
  } | null;
  property: {
    name: string;
    address: string;
    city: string;
    county: string;
    state: string;
    zip: string;
    areaSqFt: number | null;
  } | null;
  bid: {
    name: string;
    total: number | null;
    system: string;
    dueDate: string | null;
    sections: Array<{ name: string; lengthFt: number; widthFt: number; system: string }>;
    sqFt: number | null;
    warranty: string;
  } | null;
  ticket: {
    number: string;
    description: string;
    date: string | null;
    po: string;
    type: string;
  } | null;
  /** The inspection on an inspection ticket (phase 2), null on any other ticket. */
  inspection?: InspectionSnapshot | null;
  manager: { name: string; email: string; phone: string } | null;
  accountManager: { name: string; email: string; phone: string } | null;
}

const money = (n: number | null | undefined) =>
  n === null || n === undefined || !Number.isFinite(n)
    ? ""
    : n.toLocaleString("en-US", { style: "currency", currency: "USD" });
const int = (n: number | null | undefined) =>
  n === null || n === undefined || !Number.isFinite(n) ? "" : Math.round(n).toLocaleString("en-US");
const longDate = (d: Date) =>
  d.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "America/New_York",
  });
const shortDate = (d: Date) =>
  d.toLocaleDateString("en-US", {
    month: "numeric",
    day: "numeric",
    year: "2-digit",
    timeZone: "America/New_York",
  });
/** A YYYY-MM-DD day as "October 30, 2026" (no time zone shift). */
export const dayText = (day: string | null | undefined): string => {
  if (!day) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return day;
  return new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!)).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
};
const cityLine = (p: { city: string; state: string; zip: string }) =>
  [p.city, [p.state, p.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");

/**
 * The inspection as a document snapshots it (the reserved `__inspection` key, like `__sections`):
 * every visible checklist item with its answer, note and the ids of the ticket photos attached
 * to it (service_job_photos.item_key), plus the findings. Built by the server from
 * service_jobs.inspection (src/lib/inspection.ts) and the ticket's photos.
 */
export interface InspectionSnapshot {
  inspectedOn: string | null;
  grade: string | null;
  technician: string;
  notes: string;
  recommendRepairs: boolean;
  items: Array<{
    id: string;
    label: string;
    /** "ok" | "issue" | "na"; null = never flagged, which reads as OK (owner, Oct 26). */
    status: "ok" | "issue" | "na" | null;
    note: string;
    photoIds: string[];
  }>;
}

const INSPECTION_STATUS_TEXT: Record<"ok" | "issue" | "na", string> = {
  ok: "OK",
  issue: "Issue",
  na: "N/A",
};

/** The Repair List's rows: the issues (or every item), each with its note. */
export function inspectionRows(
  insp: InspectionSnapshot | null,
  allItems: boolean,
): { columns: string[]; rows: string[][]; photoIds: string[][] } {
  const columns = allItems ? ["Item", "Finding", "Note"] : ["Item", "Note"];
  const items = (insp?.items ?? []).filter((i) => allItems || i.status === "issue");
  return {
    columns,
    rows: items.map((i) =>
      allItems ? [i.label, INSPECTION_STATUS_TEXT[i.status ?? "ok"], i.note] : [i.label, i.note],
    ),
    photoIds: items.map((i) => i.photoIds),
  };
}

export function resolveVariables(src: DocumentSource): Record<string, string> {
  const out: Record<string, string> = {};
  for (const d of variableDefs(src.kind)) out[d.key] = "";
  out["today"] = longDate(src.today);
  out["today.short"] = shortDate(src.today);
  out["document.title"] = src.documentTitle;
  const a = src.account;
  out["account.name"] = a.name;
  out["account.address1"] = a.address;
  out["account.address2"] = cityLine(a);
  out["account.address"] = a.address;
  out["account.city"] = a.city;
  out["account.state"] = a.state;
  out["account.zip"] = a.zip;
  out["account.phone"] = a.phone;
  out["account.website"] = a.website;
  out["account.email"] = a.email;
  if (src.company) {
    const c = src.company;
    out["company.name"] = c.name;
    out["company.contact"] = c.contact;
    out["company.contact.position"] = c.contactPosition;
    out["company.phone"] = c.phone;
    out["company.email"] = c.email;
    out["company.address1"] = c.address;
    out["company.address2"] = cityLine(c);
    out["company.city"] = c.city;
    out["company.state"] = c.state;
    out["company.zip"] = c.zip;
    out["company.external_id"] = c.externalId;
  }
  if (src.property) {
    const p = src.property;
    out["property.name"] = p.name;
    out["property.address1"] = p.address;
    out["property.address2"] = cityLine(p);
    out["property.city"] = p.city;
    out["property.county"] = p.county;
    out["property.state"] = p.state;
    out["property.zip"] = p.zip;
    out["property.area"] = int(p.areaSqFt);
  }
  if (src.kind === "bid" && src.bid) {
    const b = src.bid;
    out["opportunity.name"] = b.name;
    out["opportunity.price"] = money(b.total);
    out["opportunity.product"] = b.system;
    out["opportunity.due"] = dayText(b.dueDate);
    out["opportunity.sections"] = String(b.sections.length);
    out["opportunity.sqft"] = int(b.sqFt);
    out["opportunity.warranty"] = b.warranty;
  }
  if (src.kind === "ticket" && src.ticket) {
    const t = src.ticket;
    out["ticket.number"] = t.number;
    out["ticket.description"] = t.description;
    out["ticket.date"] = dayText(t.date);
    out["ticket.po"] = t.po;
    out["ticket.type"] = t.type;
  }
  if (src.kind === "ticket" && src.inspection) {
    const i = src.inspection;
    out["inspection.date"] = dayText(i.inspectedOn);
    out["inspection.grade"] = i.grade ?? "";
    const issues = i.items.filter((x) => x.status === "issue");
    const ok = i.items.filter((x) => x.status === "ok" || x.status === null);
    const na = i.items.filter((x) => x.status === "na");
    out["inspection.summary"] = [
      issues.length ? `${issues.length} ${issues.length === 1 ? "issue" : "issues"}` : null,
      ok.length ? `${ok.length} OK` : null,
      na.length ? `${na.length} N/A` : null,
    ]
      .filter(Boolean)
      .join(" · ");
    out["inspection.issues"] = issues.map((x) => x.label).join("; ");
    out["inspection.recommend"] = i.recommendRepairs
      ? "Repairs recommended"
      : issues.length
        ? "Issues noted; no repairs recommended"
        : "No issues found";
    out["inspection.technician"] = i.technician;
  }
  if (src.manager) {
    out["manager.name"] = src.manager.name;
    out["manager.email"] = src.manager.email;
    out["manager.phone"] = src.manager.phone;
  }
  if (src.accountManager) {
    out["account_manager.name"] = src.accountManager.name;
    out["account_manager.email"] = src.accountManager.email;
    out["account_manager.phone"] = src.accountManager.phone;
  }
  return out;
}

/** The Pricing Table's rows from the record: one per section, then the total (mode "total"). */
export function pricingRows(
  src: Pick<DocumentSource, "bid">,
  mode: "total" | "none",
  showSections: boolean,
): { columns: string[]; rows: string[][] } {
  const b = src.bid;
  const columns = ["Roof section", "Size", "Sq ft", "System"];
  const rows: string[][] = [];
  if (showSections && b)
    for (const s of b.sections)
      rows.push([
        s.name,
        `${trim(s.widthFt)} × ${trim(s.lengthFt)} ft`,
        int(s.widthFt * s.lengthFt),
        s.system,
      ]);
  if (mode === "total") rows.push(["Total", "", "", money(b?.total ?? null)]);
  return { columns, rows };
}
const trim = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
