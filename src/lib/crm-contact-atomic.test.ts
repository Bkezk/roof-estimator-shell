/**
 * Audit, Oct 2, item 7: saveContact inserted the contact, then its site links, as separate
 * requests; a failed link left the contact saved and a retry made a duplicate. It now makes one
 * call, save_contact_with_sites (SECURITY INVOKER, migration 20261002130000_audit_readable.sql;
 * its SQL is pinned in audit-readable.test.ts and was run in PGlite), and writes nothing itself.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));

import { saveContact } from "@/lib/crm.functions";
import { fakeSupabase } from "@/test/fake-supabase";

type Row = Record<string, unknown>;
const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ACC = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const S1 = "11111111-1111-4111-8111-111111111111";
const S2 = "22222222-2222-4222-8222-222222222222";
const C1 = "33333333-3333-4333-8333-333333333333";

let env: ReturnType<typeof fakeSupabase>;
let fail = false;
beforeEach(() => {
  fail = false;
  env = fakeSupabase(
    {
      profiles: [{ id: ME, role: "user", access: ["service"], full_name: "P", email: "p@x" }],
      crm_accounts: [{ id: ACC, name: "Acme", deleted_at: null }],
      crm_contacts: [],
      crm_site_contacts: [],
    },
    {
      rpcs: {
        save_contact_with_sites: (a) => {
          if (fail)
            throw new Error(
              'new row violates row-level security policy for table "crm_site_contacts"',
            );
          return { id: C1, ...(a["p_contact"] as Row), site_ids: a["p_site_ids"] ?? [] };
        },
      },
    },
  );
});
const call = (data: Row) =>
  (saveContact as unknown as (a: { data: Row; context: unknown }) => Promise<Row>)({
    data,
    context: { supabase: env.db, userId: ME },
  });

describe("saveContact: one rpc, nothing written outside it", () => {
  it("a new contact with sites: save_contact_with_sites(p_contact, p_site_ids)", async () => {
    const out = await call({
      account_id: ACC,
      name: " Pat Miller ",
      email: "",
      is_billing: true,
      site_ids: [S1, S2, S1],
    });
    expect(env.rpcCalls).toEqual([
      {
        fn: "save_contact_with_sites",
        args: {
          p_contact: { account_id: ACC, name: "Pat Miller", email: null, is_billing: true },
          p_site_ids: [S1, S2],
        },
      },
    ]);
    expect(env.writes).toEqual([]); // no insert / update / delete outside the transaction
    expect(out).toMatchObject({ id: C1, name: "Pat Miller", site_ids: [S1, S2] });
  });
  it("an edit without site_ids keeps the links (p_site_ids null) and sends only what was given", async () => {
    await call({ id: C1, account_id: ACC, name: "Pat" });
    expect(env.rpcCalls[0]!.args).toEqual({
      p_contact: { id: C1, account_id: ACC, name: "Pat" },
      p_site_ids: null,
    });
  });
  it("site_ids: [] = the whole account (every link removed)", async () => {
    await call({ id: C1, account_id: ACC, name: "Pat", site_ids: [] });
    expect(env.rpcCalls[0]!.args["p_site_ids"]).toEqual([]);
  });
  it("a failure inside the call is the toast's message, and nothing is left behind", async () => {
    fail = true;
    await expect(call({ account_id: ACC, name: "Bo", site_ids: [S1] })).rejects.toThrow(
      'new row violates row-level security policy for table "crm_site_contacts"',
    );
    expect(env.writes).toEqual([]);
    expect(env.tables["crm_contacts"]).toEqual([]);
  });
});
