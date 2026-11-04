/**
 * Owner, Nov 4, the Opportunities review ("go on 1 … go on 3 … agreed with the removal of
 * notes. move delete just for the phone view. include opportunites in the global search box"):
 *  1. "Add … as a new customer" with a physical address makes the customer's first property at
 *     that address (named after the customer) and the hit carries it, so the opportunity (or a
 *     ticket) made at the same time has its site without a second popup.
 *  3. Leaving the opportunity page with unsaved changes asks (Stay / Leave without saving / Save
 *     and leave); the Assignee box on a saved opportunity saves at change (setOpportunityAssignee).
 *  - The Notes box is gone; Save leaves stored notes alone (left out = kept).
 *  - Delete is in the header on sm and up, at the foot of the page on a phone.
 *  - The search box names opportunities.
 * Fails on the old code.
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));
vi.mock("@/lib/notify.server", () => ({
  serverClient: async (fallback: unknown) => fallback,
  notify: vi.fn(async () => 0),
}));

import { firstSiteFromAccount, quickCreateAccount } from "@/lib/crm.functions";
import {
  OPP_DELETED,
  saveOpportunity,
  setOpportunityAssignee,
} from "@/lib/opportunities.functions";
import { fakeSupabase } from "@/test/fake-supabase";

type Row = Record<string, unknown>;
type Fn = (a: { data: unknown; context: unknown }) => Promise<unknown>;
const call = <T = unknown>(fn: unknown, data: unknown, db: unknown, userId: string) =>
  (fn as Fn)({ data, context: { supabase: db, userId } }) as Promise<T>;

const OFFICE = "00000000-0000-4000-8000-00000000000d";
const REP = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OPP = "11111111-1111-4111-8111-111111111111";
const ACC = "55555555-5555-4555-8555-555555555555";
const SITE = "66666666-6666-4666-8666-666666666666";

const office = {
  id: OFFICE,
  role: "user",
  access: ["customers", "service"],
  technician: false,
  full_name: "Olive",
  email: "o@x",
};
const rep = { ...office, id: REP, full_name: "Rae Rep", email: "rae@x" };

describe("1. the New customer popup with an address makes the first property", () => {
  const world = () => fakeSupabase({ profiles: [office], crm_accounts: [], crm_sites: [] });
  const typed = {
    name: "New Roof Co",
    kind: "company",
    phone: "606-555-0100",
    address1: "1 Temp Way",
    city: "Pineville",
    state: "KY",
    zip: "40977",
  };
  it("the customer, its contact row, then a property at the address named after the customer; the hit picks it", async () => {
    const env = world();
    const hit = await call<Row>(quickCreateAccount, typed, env.db, OFFICE);
    expect(env.writes.map((w) => [w.table, w.op])).toEqual([
      ["crm_accounts", "insert"],
      ["crm_contacts", "insert"],
      ["crm_sites", "insert"],
    ]);
    const site = env.tables["crm_sites"]![0]!;
    expect(site["account_id"]).toBe(hit["account_id"]);
    expect(site["name"]).toBe("New Roof Co");
    expect([site["address1"], site["city"], site["state"], site["zip"]]).toEqual([
      "1 Temp Way",
      "Pineville",
      "KY",
      "40977",
    ]);
    expect(hit["site_id"]).toBe(site["id"]);
    expect(hit["site_name"]).toBe("New Roof Co");
    expect(hit["site_address"]).toBe("1 Temp Way, Pineville, KY 40977");
    expect(hit["site_count"]).toBe(1);
  });
  it("no address typed: the customer and its contact only, no property (the ticket's plain popup)", async () => {
    const env = world();
    const hit = await call<Row>(
      quickCreateAccount,
      { name: "Plain Co", phone: "1" },
      env.db,
      OFFICE,
    );
    expect(env.writes.map((w) => w.table)).toEqual(["crm_accounts", "crm_contacts"]);
    expect(hit["site_id"]).toBeNull();
    expect(hit["site_count"]).toBe(0);
  });
  it("firstSiteFromAccount: a street, a city or a zip makes one; a state alone does not", () => {
    const base = {
      id: ACC,
      name: "X",
      address1: null,
      address2: null,
      city: null,
      state: null,
      zip: null,
    };
    expect(firstSiteFromAccount(base)).toBeNull();
    expect(firstSiteFromAccount({ ...base, state: "KY" })).toBeNull();
    expect(firstSiteFromAccount({ ...base, zip: "40977" })).toMatchObject({
      name: "X",
      zip: "40977",
    });
    expect(firstSiteFromAccount({ ...base, city: "Pineville" })).toMatchObject({
      city: "Pineville",
    });
  });
  it("the popup says so", () => {
    const picker = readFileSync("src/components/crm/account-picker.tsx", "utf8");
    expect(picker).toContain("and the physical\n            address its first property.");
    expect(picker).not.toContain("Properties are added");
  });
});

describe("3. the Assignee box saves at change (setOpportunityAssignee)", () => {
  let env: ReturnType<typeof fakeSupabase>;
  const setup = (opp: Row = {}) => {
    env = fakeSupabase({
      profiles: [office, rep],
      crm_opportunities: [
        {
          id: OPP,
          title: "Reroof gym",
          account_id: ACC,
          site_id: SITE,
          assignee_id: OFFICE,
          status: "open",
          expected_close: "2026-12-01",
          notes: "keep me",
          deleted_at: null,
          ...opp,
        },
      ],
      crm_followups: [],
    });
  };
  beforeEach(() => setup());
  const opp = () => env.tables["crm_opportunities"]![0]!;
  it("hands the opportunity over: assignee and 'updated by' move, the rest stays", async () => {
    const r = await call<Row>(
      setOpportunityAssignee,
      { id: OPP, assignee_id: REP },
      env.db,
      OFFICE,
    );
    expect(r).toEqual({ id: OPP, assignee_id: REP });
    expect(opp()["assignee_id"]).toBe(REP);
    expect(opp()["updated_by_name"]).toBe("Olive");
    expect(opp()["status"]).toBe("open");
    expect(opp()["notes"]).toBe("keep me");
    expect(env.writes[0]).toMatchObject({ table: "crm_opportunities", op: "update" });
  });
  it("a deleted opportunity is refused before any write", async () => {
    setup({ deleted_at: "2026-11-01T00:00:00Z" });
    await expect(
      call(setOpportunityAssignee, { id: OPP, assignee_id: REP }, env.db, OFFICE),
    ).rejects.toThrow(OPP_DELETED);
    expect(env.writes).toEqual([]);
  });
  it("Save without notes keeps the stored notes (the box is gone)", async () => {
    env = fakeSupabase({
      profiles: [office],
      crm_accounts: [{ id: ACC, name: "Gym", email: "g@x", phone: null, mobile: null }],
      crm_sites: [{ id: SITE, account_id: ACC, name: "Gym", deleted_at: null }],
      crm_opportunities: [
        {
          id: OPP,
          title: "Reroof gym",
          account_id: ACC,
          site_id: SITE,
          assignee_id: OFFICE,
          status: "open",
          expected_close: "2026-12-01",
          notes: "keep me",
          deleted_at: null,
        },
      ],
      crm_followups: [],
      crm_contact_log: [],
    });
    await call(
      saveOpportunity,
      {
        id: OPP,
        title: "Reroof gym",
        account_id: ACC,
        site_id: SITE,
        expected_close: "2026-12-01",
      },
      env.db,
      OFFICE,
    );
    expect(opp()["notes"]).toBe("keep me");
    // Sent as null (an older form), it clears as before.
    await call(
      saveOpportunity,
      {
        id: OPP,
        title: "Reroof gym",
        account_id: ACC,
        site_id: SITE,
        expected_close: "2026-12-01",
        notes: null,
      },
      env.db,
      OFFICE,
    );
    expect(opp()["notes"]).toBeNull();
  });
});

describe("the page (src/components/opportunities-page.tsx)", () => {
  const page = readFileSync("src/components/opportunities-page.tsx", "utf8");
  it("leaving with unsaved changes asks: the blocker, the dialog, Save and leave / Create and leave", () => {
    expect(page).toMatch(
      /const blocker = useBlocker\(\{\s*shouldBlockFn: \(\) => dirtyRef\.current,\s*withResolver: true,\s*enableBeforeUnload: \(\) => dirtyRef\.current,\s*\}\);/,
    );
    const start = page.indexOf('data-dialog="leave-opportunity"');
    expect(start).toBeGreaterThan(0);
    const dialog = page.slice(start, page.indexOf("</AlertDialog>", start));
    expect(dialog).toContain("Save changes to this opportunity?");
    expect(dialog).toContain("<AlertDialogCancel onClick={stayHere}>Stay</AlertDialogCancel>");
    expect(dialog).toContain("Leave without saving");
    expect(dialog).toContain('{opp ? "Save and leave" : "Create and leave"}');
    expect(page).toContain('open={blocker.status === "blocked" && !leaving}');
    // Save and leave: the save's own answer decides; a form refused on the spot stays.
    expect(page).toMatch(
      /const saveAndLeave = \(\) => \{\s*setLeaving\(true\);\s*if \(!submit\(\)\) stayHere\(\);\s*\};/,
    );
    expect(page).toMatch(
      /if \(leavingRef\.current\) \{\s*\/\/[^\n]*\n\s*setLeaving\(false\);\s*if \(blocker\.status === "blocked"\) blocker\.proceed\(\);/,
    );
    expect(page).toContain("if (leavingRef.current) stayHere();");
    // The page's own navigations (created → its id, deleted → the list) are not blocked.
    expect(page.match(/dirtyRef\.current = false;/g)?.length).toBe(2);
  });
  it("the Assignee box saves at change on a saved opportunity and is left out of Save's baseline", () => {
    expect(page).toContain("const assigneeFn = useServerFn(setOpportunityAssignee);");
    expect(page).toMatch(
      /const changeAssignee = \(v: string\) => \{\s*if \(!v \|\| v === draft\.assignee_id\) return;\s*if \(opp && !deleted\) assigneeMut\.mutate\(\{ assignee_id: v, before: draft\.assignee_id \}\);\s*else set\("assignee_id", v\);\s*\};/,
    );
    expect(page).toContain("onValueChange={changeAssignee}");
    expect(page).toContain('onMutate: (v) => set("assignee_id", v.assignee_id),');
    expect(page).toContain('set("assignee_id", v.before);');
    expect(page).toContain("assignee_id: saved ? null : d.assignee_id,");
    expect(page).toContain("const dirty = draftKey(draft, !!opp) !== savedKey;");
  });
  it("no Notes box; Delete in the header on sm+, at the foot on a phone", () => {
    expect(page).not.toContain('id="opp-notes"');
    expect(page).not.toContain("MentionTextarea");
    expect(page).not.toContain("notes: draft.notes");
    expect(page).toMatch(
      /className="hidden text-destructive hover:text-destructive sm:inline-flex"\s*data-delete="header"/,
    );
    expect(page).toContain('<div className="border-t pt-4 sm:hidden" data-delete="phone">');
    expect(page).toContain("Delete this opportunity");
  });
  it("the search box names opportunities", () => {
    const search = readFileSync("src/components/global-search.tsx", "utf8");
    expect(search).toContain("Search tickets, customers, opportunities, bids…");
  });
});
