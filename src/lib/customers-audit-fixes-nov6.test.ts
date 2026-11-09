/**
 * Customers audit, Nov 6 (docs/qa/customers-audit-2026-11-06.md; owner: "fix all please"):
 * 1. editing a customer saves again (the contact rule checks a new customer, and an update only
 *    when a contact field is sent);
 * 2. the no-contact line points at Contacts, where the email or phone is added;
 * 3. a customer deleted and restored keeps its primary contact (the trigger no longer clears
 *    the flag on a soft-deleted row);
 * 4. a merged customer records where it went and is not restored;
 * 5. one tab is current at a time;
 * 6. the Customers screens word a failure in plain English;
 * 7. saveAccount's create path refuses a technician-only user, as quickCreateAccount does.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { readGeneratedTypes } from "@/test/generated-types";

import {
  ACCOUNT_MERGED,
  CONTACT_REQUIRED,
  NO_CONTACT_ON_FILE,
  accountSchema,
  contactFieldsSent,
  parseInput,
  quickAccountSchema,
} from "@/lib/crm-account";
import { plainErrText } from "@/lib/plain-error";

const read = (p: string) => readFileSync(p, "utf8");
const page = read("src/components/customers-page.tsx");
const server = read("src/lib/crm.functions.ts");
const migration = read("supabase/migrations/20261106230000_customers_audit_fixes.sql");
const ID = "1a6e7f28-d28c-48c6-a4ca-8fe4781a921d";

describe("1. editing a customer saves again", () => {
  /** What the Edit form sends: everything but the four contact fields (the primary contact's). */
  const edit = {
    id: ID,
    name: "A customer",
    kind: "company",
    billing_instructions: "Need a PO on the invoice",
    notes: "n",
    address1: "10 Audit St",
    address2: "",
    city: "Corbin",
    state: "KY",
    zip: "40701",
    mailing_same: true,
    mailing_address1: "",
    mailing_address2: "",
    mailing_city: "",
    mailing_state: "",
    mailing_zip: "",
    account_manager_id: null,
    external_id: "",
  };
  it("the Edit payload (no contact fields) passes, and keeps them out of the output", () => {
    const out = parseInput(accountSchema, edit);
    expect(out.billing_instructions).toBe("Need a PO on the invoice");
    expect(out.email).toBeUndefined();
    expect(out.phone).toBeUndefined();
    expect(out.mobile).toBeUndefined();
  });
  it("a new customer still needs an email or a phone; so does an update that clears them", () => {
    expect(() => parseInput(accountSchema, { name: "A" })).toThrow(CONTACT_REQUIRED);
    expect(() =>
      parseInput(accountSchema, { id: ID, name: "A", email: "", phone: "", mobile: "" }),
    ).toThrow(CONTACT_REQUIRED);
    expect(() => parseInput(accountSchema, { id: ID, name: "A", email: null })).toThrow(
      CONTACT_REQUIRED,
    );
    expect(parseInput(accountSchema, { id: ID, name: "A", mobile: "606-555-0100" }).mobile).toBe(
      "606-555-0100",
    );
    expect(() => parseInput(quickAccountSchema, { name: "A" })).toThrow(CONTACT_REQUIRED);
  });
  it("contactFieldsSent: null (cleared) counts, missing does not", () => {
    expect(contactFieldsSent({})).toBe(false);
    expect(contactFieldsSent({ email: undefined })).toBe(false);
    expect(contactFieldsSent({ email: null })).toBe(true);
    expect(contactFieldsSent({ phone: "1" })).toBe(true);
  });
  it("the Edit form still leaves the four fields out (they are changed under Contacts)", () => {
    expect(page).toContain(
      "const { contact_name: _cn, phone: _ph, mobile: _mo, email: _em, ...rest } = f;",
    );
  });
});

describe("2. the no-contact line points at Contacts", () => {
  it("says where the email or phone is added", () => {
    expect(NO_CONTACT_ON_FILE).toBe(
      "Add an email or a phone number: this customer has no email or phone on file. Add a contact under Contacts and mark it primary.",
    );
    expect(NO_CONTACT_ON_FILE).not.toContain("Edit to add one");
  });
});

describe("3. a restore keeps the primary contact", () => {
  const fn = migration.slice(
    migration.indexOf("create or replace function public.crm_contact_primary_before()"),
    migration.indexOf("revoke all on function public.crm_contact_primary_before()"),
  );
  it("the before-trigger no longer clears is_primary on a deleted row", () => {
    expect(fn).not.toContain("new.deleted_at is not null");
    expect(fn).not.toContain("new.is_primary := false");
    // The rest of the rule stays: a reachable primary, one primary per customer.
    expect(fn).toContain("raise exception 'The primary contact needs an email or a phone number';");
    expect(fn).toContain("update public.crm_contacts c set is_primary = false");
  });
  it("the mirror and the one-primary index ignore deleted rows (the Nov 2 migration)", () => {
    const nov2 = read("supabase/migrations/20261102190000_primary_contact_and_merge.sql");
    expect(nov2).toContain(
      "on public.crm_contacts (account_id) where is_primary and deleted_at is null;",
    );
    expect(nov2).toContain("if new.is_primary and new.deleted_at is null then");
  });
});

describe("4. a merged customer is not restored", () => {
  it("merge_accounts records where the merged customer went", () => {
    expect(migration).toContain(
      "add column if not exists merged_into uuid references public.crm_accounts(id) on delete set null;",
    );
    expect(migration).toMatch(/deleted_at = now\(\),\s*merged_into = p_keep,/);
  });
  it("restoreAccount refuses it, in words", () => {
    expect(ACCOUNT_MERGED).toBe("This customer was merged into another one and cannot be restored");
    expect(server).toContain('.select("id, deleted_at, merged_into")');
    expect(server).toContain("if (account.merged_into) throw new Error(ACCOUNT_MERGED);");
  });
  it("the page offers no Restore and points at the kept customer", () => {
    expect(page).toContain("const canRestore = seesEveryone(profile) && !mergedInto;");
    expect(page).toContain('data-link="merged-into"');
  });
  it("the types know the column", () => {
    const types = readGeneratedTypes();
    const crm = types.slice(types.indexOf("      crm_accounts: {"));
    expect(crm.slice(0, crm.indexOf("Relationships:"))).toContain("merged_into: string | null;");
  });
});

describe("5. one current tab", () => {
  it("the tab links match the search exactly", () => {
    expect(page).toContain("activeOptions={{ exact: true }}");
  });
});

describe("6. plain words for a failure on the Customers screens", () => {
  it.each([
    "src/components/customers-page.tsx",
    "src/components/crm/site-form.tsx",
    "src/components/crm/account-picker.tsx",
    "src/components/crm/property-sites.tsx",
    "src/components/crm/link-bids-dialog.tsx",
  ])("%s uses plainErrText", (file) => {
    const src = read(file);
    expect(src).toContain('import { plainErrText } from "@/lib/plain-error";');
    expect(src).toContain("const errText = plainErrText;");
    expect(src).not.toContain("e instanceof Error ? e.message : String(e)");
  });
  it("a lost connection reads as such", () => {
    expect(plainErrText(new Error("Failed to fetch"))).toBe(
      "No signal. Check your connection and try again.",
    );
  });
});

describe("7. the office adds customers, on every path", () => {
  it("saveAccount's create path refuses a technician-only user before any write", () => {
    const fn = server.slice(
      server.indexOf("export const saveAccount"),
      server.indexOf("export const siteSchema"),
    );
    expect(fn).toContain("if (!data.id && isFieldOnly(p)) throw new Error(OFFICE_ADDS_CUSTOMERS);");
    expect(fn.indexOf("isFieldOnly(p)")).toBeLessThan(fn.indexOf('.from("crm_accounts")'));
  });
});
