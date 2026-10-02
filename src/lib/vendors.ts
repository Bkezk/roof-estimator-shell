/**
 * Vendors (owner, Oct 1: "Sometimes invoices go to vendors. We need somewhere to add vendor info
 * like name, address etc, then we can select them as a recipient." "It's typically a supplier.
 * Sometimes it's both a customer and a vendor, so we could make two invoices for that if
 * needed."). A vendor is a supplier: the crews buy material from it on a purchase order (the
 * PO's Vendor), and a billable one may be an invoice's Bill To instead of the ticket's customer
 * account (`invoices.bill_to_vendor_id`; the printed Send To is the `bill_to` snapshot, taken
 * from the vendor by `vendorBillTo`).
 *
 * Kept in public.vendors (migration 20261001110000_vendors.sql): read by anyone with Service,
 * Customers or Inventory; added, changed and archived by admins and managers (`canEditVendors`,
 * the twin of RLS `is_admin() or is_manager()`). Archived vendors leave the pickers but keep
 * their invoices and POs. The screen is the Vendors tab on the Customers page.
 *
 * Pure: no database, no server imports (unit tested in vendors.test.ts).
 */
import { seesEveryone, type AccessLike } from "@/lib/access";

export const VENDOR_NAME_MAX = 120;

/** The fields a vendor carries (a row of public.vendors, as far as these helpers need it). */
export interface VendorLike {
  name: string;
  address1?: string | null;
  address2?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  contact_name?: string | null;
  phone?: string | null;
  email?: string | null;
  terms?: string | null;
  account_number?: string | null;
  billable?: boolean | null;
  archived_at?: string | null;
}

/** The invoice's `bill_to` snapshot (invoices.bill_to), the same shape for an account or a vendor. */
export interface BillToSnapshot {
  name: string;
  address1: string;
  address2: string;
  city: string;
  state: string;
  zip: string;
  instructions: string;
  external_id: string;
}

/** Admins and managers add, change and archive vendors; everyone else reads them. */
export const canEditVendors = (p: AccessLike | null | undefined): boolean => seesEveryone(p);

/** A typed name as stored: trimmed, inner runs of spaces made one. */
export const cleanVendorName = (s: string) => s.trim().replace(/\s+/g, " ");

const t = (s: string | null | undefined) => (s ?? "").trim();

/** "Pineville, KY 40977" (whatever of city, state and zip there is). */
export function vendorCityLine(v: Pick<VendorLike, "city" | "state" | "zip">): string {
  return [t(v.city), [t(v.state), t(v.zip)].filter(Boolean).join(" ")].filter(Boolean).join(", ");
}

/** "Pineville, KY" for the list (no zip). */
export function vendorCityState(v: Pick<VendorLike, "city" | "state">): string {
  return [t(v.city), t(v.state)].filter(Boolean).join(", ");
}

/** The address on one line: "1 Main St, Suite 2, Pineville, KY 40977"; "" when there is none. */
export function vendorAddressLine(v: VendorLike): string {
  return [t(v.address1), t(v.address2), vendorCityLine(v)].filter(Boolean).join(", ");
}

/**
 * The invoice's Bill To taken from a vendor: the same shape as from the customer account. A
 * vendor has no Sage customer # (external_id) and no billing instructions of ours, so both are
 * blank.
 */
export function vendorBillTo(v: VendorLike): BillToSnapshot {
  return {
    name: cleanVendorName(v.name),
    address1: t(v.address1),
    address2: t(v.address2),
    city: t(v.city),
    state: t(v.state),
    zip: t(v.zip),
    instructions: "",
    external_id: "",
  };
}

/** The account fields the Bill To snapshot reads (crm_accounts). */
export interface BillToAccount {
  name: string;
  address1: string | null;
  address2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  billing_instructions: string | null;
  external_id: string | null;
}

/**
 * The invoice's Bill To taken from the ticket's customer account (as invoices always did); with
 * no account, the ticket's customer name.
 */
export function accountBillTo(
  account: BillToAccount | null | undefined,
  customerName: string | null | undefined,
): BillToSnapshot {
  return {
    name: account?.name ?? customerName ?? "",
    address1: account?.address1 ?? "",
    address2: account?.address2 ?? "",
    city: account?.city ?? "",
    state: account?.state ?? "",
    zip: account?.zip ?? "",
    instructions: account?.billing_instructions ?? "",
    external_id: account?.external_id ?? "",
  };
}

/** Whom the invoice is billed to: the vendor when one is picked, else the customer account. */
export function billToFor(
  vendor: VendorLike | null | undefined,
  account: BillToAccount | null | undefined,
  customerName: string | null | undefined,
): BillToSnapshot {
  return vendor ? vendorBillTo(vendor) : accountBillTo(account, customerName);
}

/** Why this vendor cannot be an invoice's Bill To, or null when it can. */
export function vendorBillProblem(
  v: Pick<VendorLike, "name" | "billable" | "archived_at"> | null | undefined,
): string | null {
  if (!v) return "That vendor was not found";
  if (v.archived_at) return `${v.name} is archived; restore it on the Vendors tab first`;
  if (!v.billable) return `${v.name} is not billable; tick Billable on the Vendors tab first`;
  return null;
}

/** The badge on an invoice billed to a vendor. */
export const vendorBilledLabel = (name: string | null | undefined) =>
  `Billed to vendor: ${t(name) || "—"}`;

// ---- The form ---------------------------------------------------------------------------------

export interface VendorDraft {
  name: string;
  address1: string;
  address2: string;
  city: string;
  state: string;
  zip: string;
  contact_name: string;
  phone: string;
  email: string;
  terms: string;
  account_number: string;
  notes: string;
  billable: boolean;
}

/** The form's starting values: the vendor's, or blank (billable) for a new one. */
export function vendorDraftOf(v?: (VendorLike & { notes?: string | null }) | null): VendorDraft {
  return {
    name: v?.name ?? "",
    address1: v?.address1 ?? "",
    address2: v?.address2 ?? "",
    city: v?.city ?? "",
    state: v?.state ?? "",
    zip: v?.zip ?? "",
    contact_name: v?.contact_name ?? "",
    phone: v?.phone ?? "",
    email: v?.email ?? "",
    terms: v?.terms ?? "",
    account_number: v?.account_number ?? "",
    notes: v?.notes ?? "",
    billable: v?.billable ?? true,
  };
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** What is wrong with the form (the first thing), or null when it may be saved. */
export function vendorFormProblem(d: VendorDraft): string | null {
  const name = cleanVendorName(d.name);
  if (!name) return "Enter the vendor's name";
  if (name.length > VENDOR_NAME_MAX) return `The name is at most ${VENDOR_NAME_MAX} characters`;
  const email = d.email.trim();
  if (email && !EMAIL.test(email)) return `Not an email address: ${email}`;
  const state = d.state.trim();
  if (state && !/^[A-Za-z]{2}$/.test(state)) return "The state is two letters, like KY";
  return null;
}

// ---- Search -----------------------------------------------------------------------------------

const same = (a: string, b: string) =>
  cleanVendorName(a).toLowerCase() === cleanVendorName(b).toLowerCase();

/** The vendor with this name in any case and spacing, or undefined (names are unique). */
export function findVendorByName<T extends Pick<VendorLike, "name">>(
  list: readonly T[],
  name: string,
): T | undefined {
  return cleanVendorName(name) ? list.find((v) => same(v.name, name)) : undefined;
}

/**
 * Why a vendor may not take this name, or null (audit, Oct 2: "X is already a vendor" pointed at
 * an archived vendor the list hides). Another vendor with the name in any case and spacing: an
 * archived one is named as such, so the Vendors tab offers to restore it instead.
 */
export function vendorNameClash<
  T extends Pick<VendorLike, "name" | "archived_at"> & { id: string },
>(list: readonly T[], name: string, selfId?: string | null): { vendor: T; message: string } | null {
  const clash = cleanVendorName(name)
    ? list.find((v) => v.id !== selfId && same(v.name, name))
    : undefined;
  if (!clash) return null;
  return {
    vendor: clash,
    message: clash.archived_at
      ? archivedVendorMessage(clash.name)
      : `${clash.name} is already a vendor`,
  };
}

/** The clash with an archived vendor, in words. */
export const archivedVendorMessage = (name: string) =>
  `${name} is an archived vendor — restore it instead of adding a new one`;

/** By name, any case. */
export const compareVendors = (a: Pick<VendorLike, "name">, b: Pick<VendorLike, "name">) =>
  a.name.localeCompare(b.name, "en", { sensitivity: "base" });

/**
 * The pickers' and the list's search: each word typed must start a word of the name ("abc" →
 * ABC Supply, "sup" → ABC Supply, "84 lum" → 84 Lumber), any case, "&" and punctuation
 * ignored. Empty = every vendor. Always by name.
 */
export function filterVendors<T extends Pick<VendorLike, "name">>(
  list: readonly T[],
  query: string,
): T[] {
  const words = (s: string) =>
    s
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean);
  const tokens = words(query);
  const hit = (v: T) => {
    const w = words(v.name);
    return tokens.every((tok) => w.some((x) => x.startsWith(tok)));
  };
  return (tokens.length ? list.filter(hit) : [...list]).sort(compareVendors);
}

/**
 * The list's search (the Vendors tab): the name as in `filterVendors`, or the query found in
 * the city, state, phone, email, contact, terms or our account #.
 */
export function searchVendors<T extends VendorLike>(list: readonly T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...list].sort(compareVendors);
  const byName = new Set(filterVendors(list, q));
  return list
    .filter(
      (v) =>
        byName.has(v) ||
        [v.city, v.state, v.phone, v.email, v.contact_name, v.terms, v.account_number]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(q),
    )
    .sort(compareVendors);
}
