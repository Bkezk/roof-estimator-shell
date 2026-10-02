/**
 * Audit, Oct 2, item 3: "New customer" saved a customer whose only address was "KY" (the state
 * box starts at KY and was sent as-is); the site form did the same. The state is sent only when
 * line 1, line 2, the city or the zip is filled in (addressPayload), and the server drops a
 * state-only address on every save path (normalizeAddress).
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));

import { quickCreateAccount, saveAccount, saveSite } from "@/lib/crm.functions";
import * as crmAccount from "@/lib/crm-account";
import { fakeSupabase } from "@/test/fake-supabase";

type Row = Record<string, unknown>;
const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ACC = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const S1 = "11111111-1111-4111-8111-111111111111";
const blank = { address1: "", address2: "", city: "", state: "KY", zip: "" };

let env: ReturnType<typeof fakeSupabase>;
beforeEach(() => {
  env = fakeSupabase({
    profiles: [{ id: ME, role: "user", access: ["customers"], full_name: "Pat", email: "p@x" }],
    crm_accounts: [{ id: ACC, name: "Acme", phone: "555", state: "KY", deleted_at: null }],
    crm_sites: [
      {
        id: S1,
        account_id: ACC,
        name: "Main",
        address1: "1 Main St",
        state: "KY",
        deleted_at: null,
      },
    ],
  });
});
const call = (fn: unknown, data: Row) =>
  (fn as (a: { data: Row; context: unknown }) => Promise<Row>)({
    data,
    context: { supabase: env.db, userId: ME },
  });
const last = (table: string) => env.tables[table]!.at(-1)!;

describe("addressPayload (the forms)", () => {
  it("only a state → every part null", () => {
    expect(crmAccount.addressPayload(blank)).toEqual({
      address1: null,
      address2: null,
      city: null,
      state: null,
      zip: null,
    });
  });
  it("any other part filled → the state is kept (trimmed)", () => {
    expect(crmAccount.addressPayload({ ...blank, city: " Pineville " })).toEqual({
      address1: null,
      address2: null,
      city: "Pineville",
      state: "KY",
      zip: null,
    });
    expect(crmAccount.addressPayload({ ...blank, zip: "40977" }).state).toBe("KY");
    expect(crmAccount.addressPayload({ ...blank, address2: "Suite 2" }).state).toBe("KY");
  });
  it("the mailing address under its own keys", () => {
    expect(crmAccount.mailingPayload(blank)).toEqual({
      mailing_address1: null,
      mailing_address2: null,
      mailing_city: null,
      mailing_state: null,
      mailing_zip: null,
    });
  });
});

describe("the server stores no state-only address", () => {
  it("quickCreateAccount with the dialog's untouched address (state KY) stores state null", async () => {
    await call(quickCreateAccount, { name: "Bell County BOE", phone: "606", ...blank });
    expect(last("crm_accounts")["name"]).toBe("Bell County BOE");
    expect(last("crm_accounts")["state"] ?? null).toBeNull();
  });
  it("a separate mailing address that is only a state is dropped too", async () => {
    await call(quickCreateAccount, {
      name: "B",
      phone: "1",
      mailing_same: false,
      mailing_address1: "",
      mailing_address2: "",
      mailing_city: "",
      mailing_state: "TN",
      mailing_zip: "",
    });
    expect(last("crm_accounts")["mailing_state"] ?? null).toBeNull();
  });
  it("a new site with only the state stores state null; with a city it keeps it", async () => {
    await call(saveSite, { account_id: ACC, name: "Annex", ...blank });
    expect(last("crm_sites")["state"] ?? null).toBeNull();
    await call(saveSite, { account_id: ACC, name: "Annex 2", ...blank, city: "Pineville" });
    expect(last("crm_sites")["state"]).toBe("KY");
  });
  it("an update that leaves the street out keeps the state (the stored street is still there)", async () => {
    await call(saveSite, { id: S1, account_id: ACC, name: "Main", state: "KY" });
    expect(env.tables["crm_sites"]!.find((r) => r["id"] === S1)!["state"]).toBe("KY");
  });
  it("saveAccount (the Edit form) clears a state-only address", async () => {
    await call(saveAccount, { id: ACC, name: "Acme", phone: "555", ...blank });
    expect(env.tables["crm_accounts"]!.find((r) => r["id"] === ACC)!["state"]).toBeNull();
  });
  it("normalizeAddress itself", () => {
    expect(crmAccount.normalizeAddress({ ...blank })).toMatchObject({ state: null });
    expect(crmAccount.normalizeAddress({ state: "KY" })).toEqual({ state: "KY" });
    expect(crmAccount.normalizeAddress({ ...blank, city: "X" })).toMatchObject({ state: "KY" });
  });
});

describe("the forms send addressPayload", () => {
  it("quick add (account-picker.tsx) and the site form (sitePayload)", () => {
    const picker = readFileSync("src/components/crm/account-picker.tsx", "utf8");
    expect(picker).toContain("...addressPayload(physical),");
    expect(picker).toContain("...(mailingSame ? {} : mailingPayload(mailing)),");
    expect(picker).not.toMatch(/^\s*\.\.\.physical,$/m);
    const page = readFileSync("src/components/customers-page.tsx", "utf8");
    expect(page).toContain(
      "saveFn({ data: sitePayload(props.accountId, props.site?.id ?? null, f) })",
    );
    expect(
      crmAccount.sitePayload(ACC, null, {
        ...blank,
        name: "X",
        technician_instructions: "",
        notes: "",
        county_code_id: null,
      }),
    ).toMatchObject({ state: null });
  });
});
