/**
 * Audit, Oct 2 — the opportunity page for reps and the office:
 *
 *  3. The assignee box (and Admin › Reminders' "Also escalate to") read technician_options, the
 *     Service roster, which answers only Service users: a Customers-only user got an empty box
 *     and nameless rows. Now crm_user_options (every user, for anyone who may assign).
 *  6. Won / Lost / No response end the reminders, so they are a manager's (owner decision);
 *     a rep moves Open → Contacted → Quoted.
 * 11. A rep without Customers access was bounced from their own opportunity (/opportunities
 *     needed Customers); the server already lists such a user only their own.
 * 12. "Creating it starts … reminders" showed for a new opportunity created as Won.
 * 13. Start a bid never linked back: crm_opportunities.bid_id was never written.
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

import {
  getOpportunity,
  linkBid,
  listAssigneeOptions,
  saveOpportunity,
  setOpportunityStatus,
} from "@/lib/opportunities.functions";
import { listFollowups } from "@/lib/followups.functions";
import {
  bidPrefillFromOpportunity,
  canSetOppStatus,
  createReminderHint,
  OPP_STATUS_MANAGER_ONLY,
  oppStatusProblem,
} from "@/lib/opportunity-form";
import { parseEstimateSearch } from "@/lib/estimate-search";
import { canAccess, pageForPath, seesOpportunitiesList } from "@/lib/access";
import { fakeSupabase } from "@/test/fake-supabase";

type Row = Record<string, unknown>;
const read = (p: string) => readFileSync(p, "utf8");

const CUST = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"; // Customers only (no Service)
const MGR = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const REP = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"; // no page grants at all
const OPP = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const BID = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const BID2 = "99999999-9999-4999-8999-999999999999";

const cust = {
  id: CUST,
  role: "user",
  access: ["customers"],
  technician: false,
  full_name: "Cass Customers",
  email: "cass@example.com",
};
const mgr = { ...cust, id: MGR, role: "manager", access: [], full_name: "Mo Manager" };
const repUser = { ...cust, id: REP, access: [], full_name: "Rae Rep", email: "rae@example.com" };

const opportunity = (over: Row = {}): Row => ({
  id: OPP,
  title: "Reroof gym",
  account_id: null,
  site_id: null,
  bid_id: null,
  assignee_id: REP,
  status: "open",
  expected_close: "2026-10-20",
  deleted_at: null,
  ...over,
});

let env: ReturnType<typeof fakeSupabase>;
function setup(opts: { opp?: Row; followups?: Row[] } = {}) {
  env = fakeSupabase(
    {
      profiles: [cust, mgr, repUser],
      crm_opportunities: [opportunity(opts.opp)],
      crm_followups: opts.followups ?? [],
      crm_contact_log: [],
      crm_sites: [],
      bids: [
        { id: BID, name: "Gym reroof bid" },
        { id: BID2, name: "Other bid" },
      ],
      crm_settings: [
        { id: 1, opportunity_close_days: 30, opportunity_first_days: 3, opportunity_every_days: 7 },
      ],
    },
    {
      // Under a Customers-only login technician_options answers nothing (it needs Service).
      rpc: (fn) => (fn === "technician_options" ? { data: [], error: null } : undefined),
    },
  );
}
const call = <T = void>(fn: unknown, data: Row, userId: string) =>
  (fn as (a: { data: Row; context: unknown }) => Promise<T>)({
    data,
    context: { supabase: env.db, userId },
  });
const oppRow = () => env.tables["crm_opportunities"]!.find((r) => r["id"] === OPP)!;

beforeEach(() => setup());

describe("item 3 — every user in the assignee box, and names on the rows", () => {
  it("a Customers-only user gets the assignee's name (technician_options answers nothing for them)", async () => {
    const o = await call<Row>(getOpportunity, { id: OPP }, CUST);
    expect(o["assignee_name"]).toBe("Rae Rep");
  });
  it("the follow-up list names the assignee the same way", async () => {
    setup({
      followups: [
        {
          id: "f1",
          kind: "opportunity",
          item_id: OPP,
          assignee_id: REP,
          status: "open",
          due_at: "2026-10-20T12:00:00Z",
        },
      ],
    });
    const rows = await call<Row[]>(listFollowups, {}, CUST);
    expect(rows[0]!["assignee_name"]).toBe("Rae Rep");
  });
  it("listAssigneeOptions returns every user, by name", async () => {
    const list = await call<{ id: string; name: string }[]>(listAssigneeOptions, {}, CUST);
    expect(list.map((u) => u.name)).toEqual(["Cass Customers", "Mo Manager", "Rae Rep"]);
  });
  it("the opportunity page's assignee box and Admin › Reminders' picker use it", () => {
    const page = read("src/components/opportunities-page.tsx");
    expect(page).toContain("useServerFn(listAssigneeOptions)");
    expect(page).not.toContain("listTechnicians");
    const reminders = read("src/components/reminders-settings.tsx");
    expect(reminders).toContain("useServerFn(listAssigneeOptions)");
    expect(reminders).not.toContain("listTechnicians");
    const fns = read("src/lib/opportunities.functions.ts");
    expect(fns).not.toContain('rpc("technician_options")');
    expect(fns).toContain('sb.rpc("crm_user_options")');
  });
  it("crm_user_options answers everyone who may assign (Customers, Service or Estimate) with every profile", () => {
    const sql = read("supabase/migrations/20260930090000_customer_manager_mailing.sql");
    const fn = sql.slice(sql.indexOf("create or replace function public.crm_user_options()"));
    expect(fn).toMatch(
      /from public\.profiles p\s+where public\.has_access\('customers'\) or public\.has_access\('service'\)\s+or public\.has_access\('estimate'\)/,
    );
  });
});

describe("item 6 — Won / Lost / No response are a manager's", () => {
  it("a rep's setOpportunityStatus to Lost / No response / Won is refused; nothing written", async () => {
    for (const status of ["lost", "no_response", "won"]) {
      await expect(call(setOpportunityStatus, { id: OPP, status }, CUST)).rejects.toThrow(
        OPP_STATUS_MANAGER_ONLY,
      );
    }
    expect(env.writes).toEqual([]);
    expect(oppRow()["status"]).toBe("open");
  });
  it("a rep moves Open → Contacted → Quoted", async () => {
    await call(setOpportunityStatus, { id: OPP, status: "contacted" }, CUST);
    await call(setOpportunityStatus, { id: OPP, status: "quoted" }, CUST);
    expect(oppRow()["status"]).toBe("quoted");
  });
  it("a manager sets Lost", async () => {
    await call(setOpportunityStatus, { id: OPP, status: "lost" }, MGR);
    expect(oppRow()["status"]).toBe("lost");
  });
  it("a rep cannot create one at Won either", async () => {
    await expect(
      call(saveOpportunity, { title: "New", assignee_id: CUST, status: "won" }, CUST),
    ).rejects.toThrow(OPP_STATUS_MANAGER_ONLY);
  });
  it("the rule", () => {
    expect(canSetOppStatus(cust, "quoted")).toBe(true);
    expect(canSetOppStatus(cust, "no_response")).toBe(false);
    expect(canSetOppStatus(mgr, "no_response")).toBe(true);
    expect(canSetOppStatus({ role: "admin" }, "won")).toBe(true);
    // Keeping the status it already has is never refused.
    expect(oppStatusProblem({ profile: cust, from: "won", to: "won" })).toBeNull();
  });
  it("the status select shows them disabled with a hint for reps", () => {
    const page = read("src/components/opportunities-page.tsx");
    expect(page).toContain("disabled={s !== status && !canSetOppStatus(profile, s)}");
    expect(page).toContain("{OPP_STATUS_REP_HINT}");
    expect(page).toContain("title={repLimited ? OPP_STATUS_REP_HINT : undefined}");
  });
  it("the database says the same (crm_opportunities_closing_rule)", () => {
    const mig = read("supabase/migrations/20261002140000_followup_guard.sql");
    expect(mig).toMatch(
      /if new\.status in \('won', 'lost', 'no_response'\)\s+and \(tg_op = 'INSERT' or new\.status is distinct from old\.status\)\s+and not \(public\.followup_is_system\(\) or public\.is_admin\(\) or public\.is_manager\(\)\)/,
    );
    expect(mig).toContain("before insert or update of status\n  on public.crm_opportunities");
  });
});

describe("item 11 — a rep opens their own opportunities", () => {
  const plain = { role: "user", access: [] as string[] };
  /** The central gate's test (components/auth-gate.tsx). */
  const blocked = (p: typeof plain, path: string) => {
    const page = pageForPath(path);
    return page !== null && page !== "admin" && page !== "manager" && !canAccess(p, page);
  };
  it("a user with neither Customers nor Estimate is not bounced from /opportunities", () => {
    expect(blocked(plain, "/opportunities")).toBe(false);
    expect(blocked(plain, "/opportunities?id=x")).toBe(false);
    expect(pageForPath("/opportunities")).toBeNull();
    // Customers stays Customers.
    expect(blocked(plain, "/customers")).toBe(true);
  });
  it("the server lists them only their assignments (RLS), and the sidebar / New stay the office's", () => {
    const base = read("supabase/migrations/20260927100000_crm_followups.sql");
    expect(base).toMatch(
      /create policy crm_opportunities_read on public\.crm_opportunities for select to authenticated\s+using \(public\.has_access\('customers'\) or public\.has_access\('estimate'\) or assignee_id = auth\.uid\(\)\);/,
    );
    expect(seesOpportunitiesList(plain)).toBe(false);
    expect(seesOpportunitiesList({ role: "user", access: ["estimate"] })).toBe(true);
    expect(seesOpportunitiesList(cust)).toBe(true);
    expect(read("src/components/app-sidebar.tsx")).toContain("visible: seesOpportunitiesList,");
    expect(read("src/components/opportunities-page.tsx")).toContain(
      "const canCreate = seesOpportunitiesList(profile);",
    );
  });
  it("such a rep sees their own assignee name on the row (their own profile row)", async () => {
    setup();
    // crm_user_options answers nothing without a page grant.
    env = fakeSupabase(
      { ...env.tables },
      {
        rpc: (fn) =>
          fn === "crm_user_options" || fn === "technician_options"
            ? { data: [], error: null }
            : undefined,
      },
    );
    const o = await call<Row>(getOpportunity, { id: OPP }, REP);
    expect(o["assignee_name"]).toBe("Rae Rep");
  });
});

describe("item 12 — the create hint at a closing status", () => {
  it("Won / Lost / No response: no 'starts reminders' promise", () => {
    for (const status of ["won", "lost", "no_response"])
      expect(createReminderHint({ status, assignee_id: REP })).not.toMatch(/starts the assignee/);
    expect(createReminderHint({ status: "open", assignee_id: REP })).toBe(
      "Creating it starts the assignee's follow-up reminders.",
    );
    expect(createReminderHint({ status: "open", assignee_id: "" })).toBeNull();
  });
  it("the page shows the helper's text", () => {
    const page = read("src/components/opportunities-page.tsx");
    expect(page).toContain(
      "const createHint = createReminderHint({ status: draft.status, assignee_id: draft.assignee_id });",
    );
    expect(page).not.toContain("Creating it starts the assignee&apos;s follow-up reminders.");
  });
});

describe("item 13 — Start a bid links back", () => {
  it("the link carries ?opportunity=<id>, and /estimate keeps it", () => {
    const pf = bidPrefillFromOpportunity({
      id: OPP,
      title: "Reroof gym",
      account_id: null,
      account_name: null,
      site_id: null,
      description: null,
    });
    expect(pf.opportunity).toBe(OPP);
    expect(parseEstimateSearch({ ...pf }).opportunity).toBe(OPP);
    expect(parseEstimateSearch({ opportunity: "not-a-uuid" }).opportunity).toBeUndefined();
  });
  it("linkBid writes bid_id on the opportunity", async () => {
    await expect(call(linkBid, { opportunityId: OPP, bidId: BID }, CUST)).resolves.toEqual({
      linked: true,
    });
    expect(oppRow()["bid_id"]).toBe(BID);
    // The page then shows "Bid: <name>".
    const o = await call<Row>(getOpportunity, { id: OPP }, CUST);
    expect(o["bid_name"]).toBe("Gym reroof bid");
    expect(read("src/components/opportunities-page.tsx")).toContain(
      'Bid: {opp.bid_name ?? "open it"}',
    );
  });
  it("an opportunity already linked to another bid keeps it", async () => {
    setup({ opp: { bid_id: BID2 } });
    await expect(call(linkBid, { opportunityId: OPP, bidId: BID }, CUST)).rejects.toThrow(
      "This opportunity is already linked to another bid",
    );
    expect(oppRow()["bid_id"]).toBe(BID2);
  });
  it("a save from a form opened before the link does not clear it", async () => {
    setup({ opp: { bid_id: BID } });
    await call(saveOpportunity, { id: OPP, title: "Reroof gym", assignee_id: REP }, MGR);
    expect(oppRow()["bid_id"]).toBe(BID);
  });
  it("/estimate links it right after the bid is first created (the smallest hook)", () => {
    const est = read("src/routes/estimate.tsx");
    expect(est).toContain('import { linkBid } from "@/lib/opportunities.functions";');
    expect(est).toMatch(
      /if \(row && !bidId\) \{\s+setBidId\(row\.id\);\s+hydratedFor\.current = row\.id;\s+if \(search\.opportunity\) linkOpportunity\(search\.opportunity, row\.id\);/,
    );
  });
});
