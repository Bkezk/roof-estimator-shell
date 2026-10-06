/**
 * The header search box (owner, Oct 6: "On CenterPoint there's a search bar where you can search
 * anything — job number, name, customers, etc."). One box, Ctrl/⌘ K, over every kind of record
 * the signed-in user may open: tickets (#, Job #, PO #, customer, property, address,
 * description, CenterPoint #), customers, properties, contacts, opportunities, project bids,
 * invoices and vendors. Pure: the filters, the result rows' routes and the ranking. The server
 * function (global-search.functions.ts) runs the queries with the caller's own client, so row
 * security decides what each role sees — a technician finds their own tickets and nothing else.
 */
import { ilikePattern, orIlike } from "@/lib/account-search";

/** Fewer characters than this: nothing is searched. */
export const SEARCH_MIN = 2;
/** Rows per kind. */
export const SEARCH_LIMIT = 6;
export const SEARCH_MAX_LEN = 80;

export const SEARCH_KINDS = [
  "ticket",
  "customer",
  "property",
  "contact",
  "opportunity",
  "bid",
  "invoice",
  "vendor",
] as const;
export type SearchKind = (typeof SEARCH_KINDS)[number];

/** One row's kind, shown as a tag on every result (owner, Oct 6: "it needs to show what it is"). */
export const SEARCH_KIND_ONE: Record<SearchKind, string> = {
  ticket: "Ticket",
  customer: "Customer",
  property: "Property",
  contact: "Contact",
  opportunity: "Opportunity",
  bid: "Project Bid",
  invoice: "Invoice",
  vendor: "Vendor",
};

export const SEARCH_KIND_LABELS: Record<SearchKind, string> = {
  ticket: "Tickets",
  customer: "Customers",
  property: "Properties",
  contact: "Contacts",
  opportunity: "Opportunities",
  bid: "Project Bids",
  invoice: "Invoices",
  vendor: "Vendors",
};

export interface SearchHit {
  kind: SearchKind;
  id: string;
  title: string;
  subtitle: string;
  /** Where the row opens: a path and its search params. */
  to: string;
  search: Record<string, string>;
}

export interface ParsedQuery {
  text: string;
  /** The ilike pattern for every text column (reserved characters neutralised). */
  like: string;
  /** "6008" or "#6008": a ticket / invoice number — matched exactly and as a prefix (60 → 6000–6999). */
  number: number | null;
  /** The digits as typed (for the prefix ranges). */
  digits: string | null;
  tooShort: boolean;
}

export function parseGlobalQuery(raw: string): ParsedQuery {
  const text = raw.replace(/\s+/g, " ").trim();
  const m = /^#?\s*(\d{1,9})$/.exec(text);
  const number = m ? Number(m[1]) : null;
  return {
    text,
    like: ilikePattern(text.replace(/^#\s*/, "")),
    number,
    digits: m ? m[1]! : null,
    tooShort: text.replace(/^#\s*/, "").length < SEARCH_MIN,
  };
}

/** The columns each kind is searched on (ilike), in the order they are shown in a subtitle. */
export const SEARCH_COLUMNS: Record<SearchKind, readonly string[]> = {
  ticket: [
    "job_number",
    "po_number",
    "customer_name",
    "site_name",
    "site_address",
    "location_name",
    "description",
    "centerpoint_ticket",
    "centerpoint_invoice",
  ],
  customer: ["name", "contact_name", "phone", "email", "city"],
  property: ["name", "address1", "city"],
  contact: ["name", "email", "mobile", "office_phone"],
  opportunity: ["title", "description"],
  bid: ["name"],
  // bill_to and property are jsonb on invoices: their name key (a plain ilike on jsonb fails
  // with "operator does not exist: jsonb ~~* unknown" — owner's phone, Oct 6).
  invoice: ["display_number", "bill_to->>name", "property->>name", "po_number", "job_code"],
  vendor: ["name", "contact_name", "city"],
};

/**
 * The integer `number` column matched by the digits typed, as a prefix: "60" → 60, 600–609,
 * 6000–6099 … every number that starts with 60 (ticket and invoice numbers cannot be ilike'd).
 * PostgREST or() terms.
 */
export function numberPrefixFilter(digits: string, maxDigits = 9): string {
  const terms = [`number.eq.${Number(digits)}`];
  for (let k = 1; digits.length + k <= maxDigits; k++) {
    const lo = Number(digits + "0".repeat(k));
    const hi = Number(digits + "9".repeat(k));
    terms.push(`and(number.gte.${lo},number.lte.${hi})`);
  }
  return terms.join(",");
}

/** The .or() filter for a kind: its text columns, plus the number (exact and prefix) for tickets / invoices. */
export function searchFilter(kind: SearchKind, q: ParsedQuery): string {
  const text = orIlike(SEARCH_COLUMNS[kind], q.like);
  if (q.digits !== null && (kind === "ticket" || kind === "invoice"))
    return `${numberPrefixFilter(q.digits)},${text}`;
  return text;
}

/** Where a hit opens. Properties and contacts open their customer (the Customers page shows both). */
export function hitRoute(
  kind: SearchKind,
  row: { id: string; account_id?: string | null },
): { to: string; search: Record<string, string> } {
  switch (kind) {
    case "ticket":
      return { to: "/service", search: { id: row.id } };
    case "customer":
      return { to: "/customers", search: { id: row.id } };
    case "property":
    case "contact":
      return row.account_id
        ? { to: "/customers", search: { id: row.account_id } }
        : { to: "/customers", search: {} };
    case "opportunity":
      return { to: "/opportunities", search: { id: row.id } };
    case "bid":
      return { to: "/estimate", search: { bid: row.id } };
    case "invoice":
      return { to: "/service/invoices", search: { id: row.id } };
    case "vendor":
      return { to: "/customers", search: { tab: "vendors" } };
  }
}

/** The hit's href, for the router. */
export function hitHref(hit: Pick<SearchHit, "to" | "search">): string {
  const qs = new URLSearchParams(hit.search).toString();
  return qs ? `${hit.to}?${qs}` : hit.to;
}

/**
 * Best first: an exact ticket / invoice number, then a title that starts with the text, then a
 * title that contains it, then everything else (matched on a subtitle column); ties keep the
 * kinds' order and then the title A–Z.
 */
export function rankHits(hits: readonly SearchHit[], q: ParsedQuery): SearchHit[] {
  const t = q.text.replace(/^#\s*/, "").toLowerCase();
  const score = (h: SearchHit) => {
    const title = h.title.toLowerCase();
    if (q.number !== null && /^(ticket|invoice)$/.test(h.kind) && h.title.includes(`#${q.number} `))
      return 0;
    if (q.number !== null && h.kind === "invoice" && title === `invoice ${q.number}`) return 0;
    if (title.startsWith(t)) return 1;
    if (title.includes(t)) return 2;
    return 3;
  };
  return [...hits].sort((a, b) => {
    const d = score(a) - score(b);
    if (d) return d;
    const k = SEARCH_KINDS.indexOf(a.kind) - SEARCH_KINDS.indexOf(b.kind);
    if (k) return k;
    return a.title.localeCompare(b.title);
  });
}

/** Hits grouped by kind, in the kinds' order, each group already ranked. */
export function groupHits(
  hits: readonly SearchHit[],
): Array<{ kind: SearchKind; hits: SearchHit[] }> {
  return SEARCH_KINDS.map((kind) => ({ kind, hits: hits.filter((h) => h.kind === kind) })).filter(
    (g) => g.hits.length > 0,
  );
}
