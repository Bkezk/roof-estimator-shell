/**
 * Audit, Oct 2, item 1: every site save set crm_sites.notes to NULL — the site form sent no
 * `notes` and the server's optText turned a missing key into null. Now the form carries Notes and
 * saveSite / saveContact / saveAccount treat a key left out as "unchanged" (missing ≠ null);
 * "" clears.
 *
 * The real server functions run against the in-memory Supabase stand-in (src/test/fake-supabase.ts).
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));

import { saveAccount, saveContact, saveSite } from "@/lib/crm.functions";
import * as crmAccount from "@/lib/crm-account";
import { fakeSupabase } from "@/test/fake-supabase";

type Row = Record<string, unknown>;
const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ACC = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const S1 = "11111111-1111-4111-8111-111111111111";
const C1 = "33333333-3333-4333-8333-333333333333";

let env: ReturnType<typeof fakeSupabase>;
beforeEach(() => {
  env = fakeSupabase(
    {
      profiles: [
        { id: ME, role: "user", access: ["customers"], full_name: "Pat", email: "p@x.co" },
      ],
      crm_accounts: [
        {
          id: ACC,
          name: "Acme",
          phone: "555",
          notes: "Account notes",
          billing_instructions: "PO first",
          external_id: "123456",
          deleted_at: null,
        },
      ],
      crm_sites: [
        {
          id: S1,
          account_id: ACC,
          name: "Main",
          address1: "1 Main St",
          city: "Pineville",
          state: "KY",
          notes: "Gate code 1234",
          technician_instructions: "Roof hatch in the boiler room",
          deleted_at: null,
        },
      ],
      crm_contacts: [
        { id: C1, account_id: ACC, name: "Al", notes: "Text first", deleted_at: null },
      ],
    },
    // The contact save is one rpc now (item 7); this stand-in only records what it was sent.
    { rpcs: { save_contact_with_sites: (a) => ({ ...(a["p_contact"] as Row), site_ids: [] }) } },
  );
});
const call = (fn: unknown, data: Row) =>
  (fn as (a: { data: Row; context: unknown }) => Promise<Row>)({
    data,
    context: { supabase: env.db, userId: ME },
  });
const site = () => env.tables["crm_sites"]!.find((r) => r["id"] === S1)!;
const account = () => env.tables["crm_accounts"]!.find((r) => r["id"] === ACC)!;

describe("saveSite: a key left out is unchanged; '' clears", () => {
  it("a patch without notes leaves the notes (and every other unsent column) as they are", async () => {
    await call(saveSite, { id: S1, account_id: ACC, name: "Main renamed" });
    expect(site()["name"]).toBe("Main renamed");
    expect(site()["notes"]).toBe("Gate code 1234");
    expect(site()["technician_instructions"]).toBe("Roof hatch in the boiler room");
    expect(site()["address1"]).toBe("1 Main St");
    expect(site()["state"]).toBe("KY");
    const w = env.writes.find((x) => x.table === "crm_sites")!;
    expect(w.payload).not.toHaveProperty("notes");
  });
  it('notes: "" clears them; a value replaces them', async () => {
    await call(saveSite, { id: S1, account_id: ACC, name: "Main", notes: "" });
    expect(site()["notes"]).toBeNull();
    await call(saveSite, { id: S1, account_id: ACC, name: "Main", notes: "  New gate code  " });
    expect(site()["notes"]).toBe("New gate code");
  });
});

describe("saveAccount: the same rule for every optional text column", () => {
  it("an update without notes / billing instructions / customer # / address keeps them", async () => {
    await call(saveAccount, { id: ACC, name: "Acme Inc", phone: "555" });
    expect(account()["name"]).toBe("Acme Inc");
    expect(account()["notes"]).toBe("Account notes");
    expect(account()["billing_instructions"]).toBe("PO first");
    expect(account()["external_id"]).toBe("123456");
  });
  it('"" clears', async () => {
    await call(saveAccount, { id: ACC, name: "Acme", phone: "555", notes: "" });
    expect(account()["notes"]).toBeNull();
  });
});

describe("saveContact: what it sends leaves unsent columns out", () => {
  it("no notes key → none sent (unchanged); notes '' → null (cleared)", async () => {
    await call(saveContact, { id: C1, account_id: ACC, name: "Al Smith" });
    const sent = (n: number) => env.rpcCalls[n]!.args["p_contact"] as Row;
    expect(sent(0)).toEqual({ id: C1, account_id: ACC, name: "Al Smith" });
    expect(sent(0)).not.toHaveProperty("notes");
    expect(sent(0)).not.toHaveProperty("is_billing");
    await call(saveContact, { id: C1, account_id: ACC, name: "Al", notes: "" });
    expect(sent(1)).toMatchObject({ notes: null });
  });
});

describe("the site form carries Notes", () => {
  // Moved out of customers-page.tsx (Oct 2): the opportunity's "Add site" uses it too.
  const page = readFileSync("src/components/crm/site-form.tsx", "utf8");
  const form = page.slice(page.indexOf("export function SiteForm("));
  it("a Notes textarea bound to the site's notes", () => {
    expect(form).toContain("<Label htmlFor={`site-${idp}-notes`}>Notes</Label>");
    expect(form).toMatch(/id=\{`site-\$\{idp\}-notes`\}[\s\S]*?value=\{f\.notes\}/);
    expect(page).toContain('notes: s?.notes ?? "",');
  });
  it("sends what sitePayload builds (notes included)", () => {
    expect(form).toContain(
      "saveFn({ data: sitePayload(props.accountId, props.site?.id ?? null, f) })",
    );
    const out = crmAccount.sitePayload(ACC, S1, {
      name: "Main",
      address1: "1 Main St",
      address2: "",
      city: "Pineville",
      state: "KY",
      zip: "",
      technician_instructions: "",
      notes: "Gate code 1234",
      county_code_id: null,
    });
    expect(out).toMatchObject({ id: S1, account_id: ACC, notes: "Gate code 1234", state: "KY" });
  });
});
