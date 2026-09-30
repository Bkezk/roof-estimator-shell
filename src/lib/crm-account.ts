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

const contactCheck = (a: Parameters<typeof hasContactMethod>[0], ctx: z.RefinementCtx) => {
  if (!hasContactMethod(a))
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["email"], message: CONTACT_REQUIRED });
};

const addressFields = {
  address1: optText(200),
  address2: optText(200),
  city: optText(120),
  state: optText(20),
  zip: optText(20),
};
const newFields = {
  /** Cell phone. `phone` is the office phone. */
  mobile: keepText(60),
  mailing_same: z.boolean().optional(),
  mailing_address1: keepText(200),
  mailing_address2: keepText(200),
  mailing_city: keepText(120),
  mailing_state: keepText(20),
  mailing_zip: keepText(20),
  /** A user (profiles.id); null = unassigned, missing = unchanged. */
  account_manager_id: z.string().uuid().nullable().optional(),
};

/** Create (no id) or update an account (saveAccount). */
export const accountSchema = z
  .object({
    id: z.string().uuid().optional(),
    name: z.string().trim().min(1, "Name is required").max(200),
    kind: z.enum(["company", "individual"]).default("company"),
    contact_name: optText(200),
    phone: optText(60),
    email: optText(200),
    ...addressFields,
    billing_instructions: optText(2000),
    external_id: optText(40),
    notes: optText(5000),
    source: z.enum(["manual", "prospect", "import"]).optional(),
    ...newFields,
  })
  .superRefine(contactCheck)
  .transform(normalizeMailing);
export type AccountInput = z.input<typeof accountSchema>;

/**
 * The one-step "new customer" (Customers page, and the customer search on a ticket, a bid or a
 * takeoff): the account only. Sites are added on the account afterwards (owner, Sep 30).
 */
export const quickAccountSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(200),
    kind: z.enum(["company", "individual"]).default("company"),
    contact_name: optText(200),
    phone: optText(60),
    email: optText(200),
    ...addressFields,
    source: z.enum(["manual", "prospect", "import"]).optional(),
    ...newFields,
  })
  .superRefine(contactCheck)
  .transform(normalizeMailing);
export type QuickAccountInput = z.input<typeof quickAccountSchema>;

/**
 * Parse server-function input, throwing a plain Error whose message is the rule that failed
 * ("Add an email or a phone number"), not zod's JSON dump, so the toast reads cleanly.
 */
export function parseInput<S extends z.ZodTypeAny>(schema: S, d: unknown): z.output<S> {
  const r = schema.safeParse(d);
  if (r.success) return r.data;
  const msgs = [...new Set(r.error.issues.map((i) => i.message))];
  throw new Error(msgs.join("; "));
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
