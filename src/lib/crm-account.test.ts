import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  CONTACT_REQUIRED,
  accountSchema,
  addressLines,
  hasContactMethod,
  mailingLines,
  matchesManager,
  parseInput,
  quickAccountSchema,
} from "@/lib/crm-account";

const ID = "00000000-0000-4000-8000-000000000001";
const MGR = "00000000-0000-4000-8000-0000000000aa";

describe("a customer needs an email, a cell phone or an office phone", () => {
  it("hasContactMethod: any one filled counts; blanks and spaces do not", () => {
    expect(hasContactMethod({})).toBe(false);
    expect(hasContactMethod({ email: " ", phone: "", mobile: null })).toBe(false);
    expect(hasContactMethod({ email: "pat@bell.kyschools.us" })).toBe(true);
    expect(hasContactMethod({ phone: "606-555-0100" })).toBe(true);
    expect(hasContactMethod({ mobile: "606-555-0199" })).toBe(true);
  });

  it("saveAccount's schema refuses a customer with none, with the plain message", () => {
    expect(() => parseInput(accountSchema, { name: "Bell County BOE" })).toThrow(
      new Error(CONTACT_REQUIRED),
    );
    expect(() =>
      parseInput(accountSchema, { id: ID, name: "Bell", email: "  ", phone: "", mobile: "" }),
    ).toThrow(CONTACT_REQUIRED);
    expect(CONTACT_REQUIRED).toBe("Add an email or a phone number");
  });

  it("the new-customer schema refuses one too, and accepts any one of the three", () => {
    expect(() => parseInput(quickAccountSchema, { name: "Pat Miller" })).toThrow(CONTACT_REQUIRED);
    expect(parseInput(quickAccountSchema, { name: "A", email: "a@b.co" }).email).toBe("a@b.co");
    expect(parseInput(quickAccountSchema, { name: "A", mobile: "606-555-0199" }).mobile).toBe(
      "606-555-0199",
    );
    expect(parseInput(quickAccountSchema, { name: "A", phone: "606-555-0100" }).phone).toBe(
      "606-555-0100",
    );
  });

  it("a missing name is still reported by name", () => {
    expect(() => parseInput(quickAccountSchema, { name: " ", email: "a@b.co" })).toThrow(
      "Name is required",
    );
  });
});

describe("new customer: the account only, no site", () => {
  it("site fields are not part of the new-customer input", () => {
    const out = parseInput(quickAccountSchema, {
      name: "Bell County BOE",
      phone: "606-555-0100",
      site_name: "Yellow Creek Elementary",
      address1: "PO Box 340",
    }) as Record<string, unknown>;
    expect(out).not.toHaveProperty("site_name");
    expect(out["address1"]).toBe("PO Box 340");
  });

  it("carries the account manager, and null means unassigned", () => {
    const base = { name: "A", email: "a@b.co" };
    expect(parseInput(quickAccountSchema, { ...base, account_manager_id: MGR })).toMatchObject({
      account_manager_id: MGR,
    });
    expect(parseInput(quickAccountSchema, { ...base, account_manager_id: null })).toMatchObject({
      account_manager_id: null,
    });
    expect(() => parseInput(quickAccountSchema, { ...base, account_manager_id: "x" })).toThrow();
  });
});

describe("mailing address", () => {
  const base = { name: "A", email: "a@b.co" };
  const mail = {
    mailing_address1: "PO Box 9",
    mailing_address2: "",
    mailing_city: "Pineville",
    mailing_state: "KY",
    mailing_zip: "40977",
  };

  it("Same as physical stores NULL mailing fields", () => {
    const out = parseInput(accountSchema, { ...base, mailing_same: true, ...mail });
    expect(out).toMatchObject({
      mailing_same: true,
      mailing_address1: null,
      mailing_address2: null,
      mailing_city: null,
      mailing_state: null,
      mailing_zip: null,
    });
  });

  it("a separate mailing address is kept (blank parts become null)", () => {
    const out = parseInput(accountSchema, { ...base, mailing_same: false, ...mail });
    expect(out).toMatchObject({
      mailing_same: false,
      mailing_address1: "PO Box 9",
      mailing_address2: null,
      mailing_city: "Pineville",
      mailing_zip: "40977",
    });
  });

  it("an update that leaves the new columns out does not wipe them", () => {
    // The bid's "Update profile" sends only the fields it knows (bid-account-link.ts).
    const out = parseInput(accountSchema, { id: ID, name: "A", phone: "606-555-0100" });
    for (const k of [
      "mobile",
      "mailing_same",
      "mailing_address1",
      "mailing_city",
      "account_manager_id",
    ])
      expect(out[k as keyof typeof out]).toBeUndefined();
  });

  it("mailingLines shows the physical address when Same as physical", () => {
    const a = {
      address1: "4840 West Cumberland Avenue",
      address2: null,
      city: "Middlesboro",
      state: "KY",
      zip: "40965",
      mailing_address1: "PO Box 9",
      mailing_address2: null,
      mailing_city: "Pineville",
      mailing_state: "KY",
      mailing_zip: "40977",
    };
    expect(addressLines(a)).toEqual(["4840 West Cumberland Avenue", "Middlesboro, KY 40965"]);
    expect(mailingLines({ ...a, mailing_same: true })).toEqual(addressLines(a));
    expect(mailingLines({ ...a, mailing_same: false })).toEqual([
      "PO Box 9",
      "Pineville, KY 40977",
    ]);
  });
});

describe("Customers list: filter by account manager", () => {
  const rows = [
    { name: "a", account_manager_id: MGR },
    { name: "b", account_manager_id: null },
    { name: "c", account_manager_id: ID },
  ];
  const names = (f: string) =>
    rows
      .filter((r) => matchesManager(r, f))
      .map((r) => r.name)
      .join("");
  it("all, unassigned, or one manager", () => {
    expect(names("all")).toBe("abc");
    expect(names("unassigned")).toBe("b");
    expect(names(MGR)).toBe("a");
    expect(names(ID)).toBe("c");
  });
});

describe("migration 20260930090000_customer_manager_mailing.sql", () => {
  const sql = readFileSync(
    fileURLToPath(
      new URL(
        "../../supabase/migrations/20260930090000_customer_manager_mailing.sql",
        import.meta.url,
      ),
    ),
    "utf8",
  ).toLowerCase();

  it("adds the columns idempotently", () => {
    for (const col of [
      "account_manager_id uuid references public.profiles(id) on delete set null",
      "mobile text",
      "mailing_same boolean not null default true",
      "mailing_address1 text",
      "mailing_address2 text",
      "mailing_city text",
      "mailing_state text",
      "mailing_zip text",
    ])
      expect(sql).toContain(`add column if not exists ${col}`);
  });

  it("the database also refuses a live customer with no email or phone", () => {
    expect(sql).toContain("drop constraint if exists crm_accounts_contact_required");
    const add = sql.slice(sql.indexOf("add constraint crm_accounts_contact_required"));
    expect(add).toMatch(/nullif\(btrim\(email\), ''\) is not null/);
    expect(add).toMatch(/nullif\(btrim\(phone\), ''\) is not null/);
    expect(add).toMatch(/nullif\(btrim\(mobile\), ''\) is not null/);
  });
});
