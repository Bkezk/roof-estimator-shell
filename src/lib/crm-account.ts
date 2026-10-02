/**
 * The customer account's input rules, shared by the server functions (crm.functions.ts) and the
 * Customers screens (owner, Sep 30):
 *  - a customer cannot be created or saved without an email, a cell phone or an office phone
 *    (the database's crm_accounts_contact_required check says the same);
 *  - the mailing address is its own set of fields unless "Same as physical" is on, in which case
 *    it is stored as NULLs with mailing_same = true;
 *  - an account manager (a user) can be set; the Customers list filters by it.
 *
 * Pure (zod only), so the rules are unit-tested without a server.
 */
import { z } from "zod";

/** The one message for a customer with no way to reach them (form, toast and server). */
export const CONTACT_REQUIRED = "Add an email or a phone number";

const filled = (v: string | null | undefined) => !!v && v.trim() !== "";

/** True when at least one of email, cell phone (mobile) or office phone (phone) is filled in. */
export function hasContactMethod(a: {
  email?: string | null | undefined;
  phone?: string | null | undefined;
  mobile?: string | null | undefined;
}): boolean {
  return filled(a.email) || filled(a.phone) || filled(a.mobile);
}

/** The warning on a customer saved before the rule (no email or phone on file). */
export const NO_CONTACT_ON_FILE = `${CONTACT_REQUIRED}: this customer has no email or phone on file. Edit to add one.`;

/** The one message for a customer whose address must be complete (an opportunity's quick add). */
export const ADDRESS_REQUIRED = "Add the street address, city, state and ZIP";

/**
 * ADDRESS_REQUIRED unless line 1, the city, the state and the zip are all filled in (line 2
 * stays optional). The forms start the state at "KY", so a state alone is no address.
 */
export function addressProblem(a: {
  address1: string;
  address2?: string | undefined;
  city: string;
  state: string;
  zip: string;
}): string | null {
  return filled(a.address1) && filled(a.city) && filled(a.state) && filled(a.zip)
    ? null
    : ADDRESS_REQUIRED;
}

/** Optional text: missing, null or blank all become null (the DB column's "not set"). */
export const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v == null || v === "" ? null : v));

/**
 * Optional text for columns added after the first callers were written: missing stays
 * undefined ("leave the column as it is"), null or blank becomes null. So a caller that does
 * not know the column (the bid's "Update profile") never wipes it.
 */
export const keepText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v === undefined ? undefined : v === null || v === "" ? null : v));

const MAILING = [
  "mailing_address1",
  "mailing_address2",
  "mailing_city",
  "mailing_state",
  "mailing_zip",
] as const;

/** "Same as physical" stores no mailing address of its own: the mailing fields become null. */
export function normalizeMailing<
  T extends { mailing_same?: boolean | undefined } & Partial<
    Record<(typeof MAILING)[number], string | null | undefined>
  >,
>(a: T): T {
  if (a.mailing_same !== true) return a;
  const out = { ...a };
  for (const k of MAILING) (out as Record<string, unknown>)[k] = null;
  return out;
}

/** "Same as physical" first, then no state-only physical or mailing address. */
function normalizeAccountAddresses<T extends Parameters<typeof normalizeMailing>[0]>(a: T): T {
  return normalizeAddress(normalizeAddress(normalizeMailing(a)), "mailing_");
}

const contactCheck = (a: Parameters<typeof hasContactMethod>[0], ctx: z.RefinementCtx) => {
  if (!hasContactMethod(a))
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["email"], message: CONTACT_REQUIRED });
};

/**
 * The longest text each customer, site and contact field takes: the zod schemas here and in
 * crm.functions.ts, and the inputs' maxLength on the Customers screens (audit, Oct 2: a field
 * without one let a paste through that the server then refused).
 */
export const CRM_MAX = {
  name: 200,
  contact_name: 200,
  phone: 60,
  mobile: 60,
  email: 200,
  address1: 200,
  address2: 200,
  city: 120,
  state: 20,
  zip: 20,
  billing_instructions: 2000,
  external_id: 40,
  notes: 5000,
  technician_instructions: 2000,
  position: 200,
  office_phone: 60,
  contact_notes: 2000,
} as const;

/**
 * Optional address text, missing = unchanged (keepText): an update that leaves a part out keeps
 * the stored one (audit, Oct 2: every site save wiped the site's notes the same way).
 */
const addressFields = {
  address1: keepText(CRM_MAX.address1),
  address2: keepText(CRM_MAX.address2),
  city: keepText(CRM_MAX.city),
  state: keepText(CRM_MAX.state),
  zip: keepText(CRM_MAX.zip),
};

// ---- A state on its own is no address (audit, Oct 2) ----------------------------------------

const ADDRESS_PARTS = ["address1", "address2", "city", "zip"] as const;

export interface AddressPayload {
  address1: string | null;
  address2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
}

/**
 * The form's address as sent: blanks become null, and the state (the forms start it at "KY")
 * is sent only when line 1, line 2, the city or the zip is filled in; otherwise every part is
 * null. So a "New customer" or a site with no address saves none, not an address that is "KY".
 */
export function addressPayload(a: {
  address1: string;
  address2: string;
  city: string;
  state: string;
  zip: string;
}): AddressPayload {
  const t = (v: string) => (v.trim() === "" ? null : v.trim());
  const parts = {
    address1: t(a.address1),
    address2: t(a.address2),
    city: t(a.city),
    zip: t(a.zip),
  };
  const any = Object.values(parts).some((v) => v !== null);
  return { ...parts, state: any ? t(a.state) : null };
}

/** The site form's fields (Customers › a customer › Sites). */
export interface SiteDraft {
  name: string;
  address1: string;
  address2: string;
  city: string;
  state: string;
  zip: string;
  technician_instructions: string;
  notes: string;
  county_code_id: string | null;
}

/**
 * What the site form sends: every field — Notes too (audit, Oct 2: the form had no Notes and
 * every save set the site's notes to NULL) — and the address by addressPayload's rule (the state
 * box starts at "KY"; with no street, city or zip no address is sent).
 */
export function sitePayload(accountId: string, siteId: string | null, f: SiteDraft) {
  return {
    ...(siteId ? { id: siteId } : {}),
    account_id: accountId,
    name: f.name,
    ...addressPayload(f),
    technician_instructions: f.technician_instructions,
    notes: f.notes,
    county_code_id: f.county_code_id,
  };
}

/** A separate mailing address as sent (addressPayload's rule, under the mailing_ keys). */
export function mailingPayload(a: Parameters<typeof addressPayload>[0]) {
  const p = addressPayload(a);
  return {
    mailing_address1: p.address1,
    mailing_address2: p.address2,
    mailing_city: p.city,
    mailing_state: p.state,
    mailing_zip: p.zip,
  };
}

/**
 * The server's twin of addressPayload, on every save path (a customer's physical and mailing
 * address, a site's): a state sent with every other part blank is stored as null. A part left
 * out (undefined = unchanged) leaves the state alone, since the stored street may be there.
 * `prefix` picks the mailing set ("mailing_").
 */
export function normalizeAddress<T extends object>(a: T, prefix = ""): T {
  const v = a as Record<string, unknown>;
  const state = v[`${prefix}state`];
  if (typeof state !== "string" || state.trim() === "") return a;
  const others = ADDRESS_PARTS.map((k) => v[`${prefix}${k}`]);
  if (others.some((x) => x === undefined)) return a;
  if (others.some((x) => typeof x === "string" && x.trim() !== "")) return a;
  return { ...a, [`${prefix}state`]: null };
}
const newFields = {
  /** Cell phone. `phone` is the office phone. */
  mobile: keepText(CRM_MAX.mobile),
  mailing_same: z.boolean().optional(),
  mailing_address1: keepText(CRM_MAX.address1),
  mailing_address2: keepText(CRM_MAX.address2),
  mailing_city: keepText(CRM_MAX.city),
  mailing_state: keepText(CRM_MAX.state),
  mailing_zip: keepText(CRM_MAX.zip),
  /** A user (profiles.id); null = unassigned, missing = unchanged. */
  account_manager_id: z.string().uuid().nullable().optional(),
};

/** Create (no id) or update an account (saveAccount). */
export const accountSchema = z
  .object({
    id: z.string().uuid().optional(),
    name: z.string().trim().min(1, "Name is required").max(CRM_MAX.name),
    kind: z.enum(["company", "individual"]).default("company"),
    contact_name: keepText(CRM_MAX.contact_name),
    phone: keepText(CRM_MAX.phone),
    email: keepText(CRM_MAX.email),
    ...addressFields,
    billing_instructions: keepText(CRM_MAX.billing_instructions),
    external_id: keepText(CRM_MAX.external_id),
    notes: keepText(CRM_MAX.notes),
    source: z.enum(["manual", "prospect", "import"]).optional(),
    ...newFields,
  })
  .superRefine(contactCheck)
  .transform(normalizeAccountAddresses);
export type AccountInput = z.input<typeof accountSchema>;

/**
 * The one-step "new customer" (Customers page, and the customer search on a ticket, a bid or a
 * takeoff): the account only. Sites are added on the account afterwards (owner, Sep 30).
 */
export const quickAccountSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(CRM_MAX.name),
    kind: z.enum(["company", "individual"]).default("company"),
    contact_name: keepText(CRM_MAX.contact_name),
    phone: keepText(CRM_MAX.phone),
    email: keepText(CRM_MAX.email),
    ...addressFields,
    source: z.enum(["manual", "prospect", "import"]).optional(),
    ...newFields,
  })
  .superRefine(contactCheck)
  .transform(normalizeAccountAddresses);
export type QuickAccountInput = z.input<typeof quickAccountSchema>;

/** How a field is named in a message ("Email looks wrong"); other keys are put in words. */
const FIELD_LABELS: Record<string, string> = {
  q: "The search",
  id: "The record",
  account_id: "The customer",
  site_id: "The site",
  bid_id: "The bid",
  county_code_id: "The county code",
  account_manager_id: "The account manager",
  site_ids: "Sites",
  mobile: "Cell phone",
  office_phone: "Office phone",
  address1: "Address line 1",
  address2: "Address line 2",
  mailing_address1: "Mailing address line 1",
  mailing_address2: "Mailing address line 2",
  contact_name: "Contact",
  external_id: "Customer #",
  account_number: "Account #",
};

/** The field an issue is about, in words: ["email"] → "Email", ["site_ids", 3] → "Sites". */
export function fieldLabel(path: readonly (string | number)[]): string {
  const key = [...path].reverse().find((p): p is string => typeof p === "string");
  if (!key) return "A value";
  const known = FIELD_LABELS[key];
  if (known) return known;
  const words = key.replace(/_/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Zod's issues as one plain sentence each ("Email looks wrong", "Name is too long (200 max)",
 * "Name is required"). A message written on the schema itself ("Add an email or a phone
 * number") wins over this map (zod's precedence).
 */
const plainErrors: z.ZodErrorMap = (issue) => {
  const label = fieldLabel(issue.path);
  switch (issue.code) {
    case z.ZodIssueCode.too_big:
      return {
        message:
          issue.type === "array"
            ? `${label}: too many (${String(issue.maximum)} max)`
            : `${label} is too long (${String(issue.maximum)} max)`,
      };
    case z.ZodIssueCode.too_small:
      return {
        message:
          issue.type === "string" && Number(issue.minimum) <= 1
            ? `${label} is required`
            : `${label} is too short (${String(issue.minimum)} min)`,
      };
    case z.ZodIssueCode.invalid_type:
      return {
        message: issue.received === "undefined" ? `${label} is required` : `${label} looks wrong`,
      };
    default:
      return { message: `${label} looks wrong` };
  }
};

/**
 * Parse server-function input, throwing a plain Error whose message is the first rule that
 * failed, in words ("Add an email or a phone number", "Email looks wrong", "Name is too long
 * (200 max)") — never zod's JSON dump — so the toast reads cleanly. Every validator in
 * crm.functions.ts and vendors.functions.ts goes through it.
 */
export function parseInput<S extends z.ZodTypeAny>(schema: S, d: unknown): z.output<S> {
  const r = schema.safeParse(d, { errorMap: plainErrors });
  if (r.success) return r.data;
  throw new Error(r.error.issues[0]?.message ?? "The input looks wrong");
}

// ---- Account manager filter (Customers list) ------------------------------------------------

/** "all", "unassigned", or a user id. */
export type ManagerFilter = "all" | "unassigned" | (string & {});

export function matchesManager(
  a: { account_manager_id: string | null },
  filter: ManagerFilter,
): boolean {
  if (filter === "all") return true;
  if (filter === "unassigned") return !a.account_manager_id;
  return a.account_manager_id === filter;
}

// ---- Display -----------------------------------------------------------------------------------

type AddressLike = {
  address1: string | null;
  address2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
};

/** An address as two display lines (street; city, ST zip), blanks dropped. */
export function addressLines(a: AddressLike): string[] {
  const street = [a.address1, a.address2].filter(filled).join(", ");
  const cityLine = [a.city, [a.state, a.zip].filter(filled).join(" ")].filter(filled).join(", ");
  return [street, cityLine].filter(Boolean);
}

/** The mailing address's display lines: the physical address's when "Same as physical". */
export function mailingLines(
  a: AddressLike & {
    mailing_same: boolean;
    mailing_address1: string | null;
    mailing_address2: string | null;
    mailing_city: string | null;
    mailing_state: string | null;
    mailing_zip: string | null;
  },
): string[] {
  if (a.mailing_same) return addressLines(a);
  return addressLines({
    address1: a.mailing_address1,
    address2: a.mailing_address2,
    city: a.mailing_city,
    state: a.mailing_state,
    zip: a.mailing_zip,
  });
}

// ---- deleting a customer (audit, Oct 2) ---------------------------------------------------

/** A second Delete on a customer already deleted: nothing is written. */
export const ACCOUNT_ALREADY_DELETED = "This customer was already deleted";
/** Any change to a deleted customer, its sites or its contacts. */
export const ACCOUNT_DELETED = "This customer was deleted; an admin or a manager can restore it";
/** Ticket stages that keep a customer from being deleted (the open work). */
export const OPEN_TICKET_STAGES = ["open", "scheduled", "done"] as const;
/** Opportunity statuses that keep a customer from being deleted. */
export const OPEN_OPPORTUNITY_STATUSES = ["open", "contacted", "quoted"] as const;

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Why a customer may not be deleted yet, or null: "This customer has 2 open tickets and 1 open
 * opportunity; close or move them first".
 */
export function deleteBlockedMessage(openTickets: number, openOpps: number): string | null {
  const parts = [
    openTickets > 0 ? count(openTickets, "open ticket", "open tickets") : null,
    openOpps > 0 ? count(openOpps, "open opportunity", "open opportunities") : null,
  ].filter(Boolean);
  if (!parts.length) return null;
  return `This customer has ${parts.join(" and ")}; close or move them first`;
}

/**
 * The banner on a deleted customer: "Deleted on Oct 2, 2026 by Pat Sales" — the date alone when
 * who is unknown (the audit log is an admin's or a manager's to read).
 */
export function deletedLine(deletedAt: string, byName: string | null | undefined): string {
  const d = new Date(deletedAt);
  const date = Number.isNaN(d.getTime())
    ? deletedAt
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const who = (byName ?? "").trim();
  return `Deleted on ${date}${who ? ` by ${who}` : ""}`;
}
