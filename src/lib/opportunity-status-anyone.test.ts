/**
 * Owner decision, Oct 12: anyone who may edit an opportunity sets any status — Won, Lost and No
 * response included (people close opportunities to clear their board); it just needs to be
 * recorded, and the status log (crm_opportunity_events, written by the database) says who and
 * when. The Oct 2 manager-only rule goes from all three layers: the form (opportunity-form.ts
 * canSetOppStatus / oppStatusProblem, the disabled options and the hint on the page), the server
 * (saveOpportunity / setOpportunityStatus) and the database (20261012100000 drops the trigger
 * crm_opportunities_closing_rule). The status strip under the title now says who set each status.
 */
import { existsSync, readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));
vi.mock("@/lib/notify.server", () => ({
  serverClient: async (fallback: unknown) => fallback,
  notify: vi.fn(async () => 0),
}));

import { saveOpportunity, setOpportunityStatus } from "@/lib/opportunities.functions";
import * as form from "@/lib/opportunity-form";
import { oppStatusStrip, statusActors } from "@/lib/stage-dates";
import { fakeSupabase } from "@/test/fake-supabase";

type Row = Record<string, unknown>;
const read = (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : "");
const src = (p: string) => read(p).replace(/\s+/g, " ");
const flatSql = (p: string) =>
  read(p)
    .replace(/--[^\n]*/g, "")
    .replace(/\s+/g, " ");

const REP = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"; // Customers access, not a manager
const OWN = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"; // no page grants: edits only their own
const OPP = "11111111-1111-4111-8111-111111111111";
const ACC = "55555555-5555-4555-8555-555555555555";
const SITE = "66666666-6666-4666-8666-666666666666";

const rep = {
  id: REP,
  role: "user",
  access: ["customers"],
  technician: false,
  full_name: "Rae Rep",
  email: "rae@example.com",
};
const own = { ...rep, id: OWN, access: [], full_name: "Olly Own", email: "olly@example.com" };

let env: ReturnType<typeof fakeSupabase>;
beforeEach(() => {
  env = fakeSupabase({
    profiles: [rep, own],
    crm_opportunities: [
      {
        id: OPP,
        title: "Reroof gym",
        account_id: ACC,
        site_id: SITE,
        bid_id: null,
        assignee_id: OWN,
        status: "quoted",
        expected_close: "2026-10-20",
        deleted_at: null,
      },
    ],
    crm_followups: [],
    crm_contact_log: [],
    crm_accounts: [{ id: ACC, name: "Bell County Schools", phone: "606-555-0100" }],
    crm_sites: [{ id: SITE, account_id: ACC, name: "Gym", deleted_at: null }],
    crm_settings: [
      { id: 1, opportunity_close_days: 30, opportunity_first_days: 3, opportunity_every_days: 7 },
    ],
  });
});
const call = <T = void>(fn: unknown, data: Row, userId: string) =>
  (fn as (a: { data: Row; context: unknown }) => Promise<T>)({
    data,
    context: { supabase: env.db, userId },
  });
const oppRow = () => env.tables["crm_opportunities"]!.find((r) => r["id"] === OPP)!;

describe("the server: any status is the editor's", () => {
  it("a rep sets Won / Lost / No response through setOpportunityStatus", async () => {
    for (const status of ["won", "lost", "no_response"]) {
      await call(setOpportunityStatus, { id: OPP, status }, REP);
      expect(oppRow()["status"]).toBe(status);
    }
  });
  it("the assignee without any page grant does too (their own opportunity)", async () => {
    await call(setOpportunityStatus, { id: OPP, status: "no_response" }, OWN);
    expect(oppRow()["status"]).toBe("no_response");
  });
  it("a rep saves one as Won, and creates one at Lost", async () => {
    await call(
      saveOpportunity,
      { id: OPP, title: "Reroof gym", account_id: ACC, assignee_id: OWN, status: "won" },
      REP,
    );
    expect(oppRow()["status"]).toBe("won");
    const created = await call<Row>(
      saveOpportunity,
      { title: "Walk-in", account_id: ACC, assignee_id: REP, status: "lost" },
      REP,
    );
    expect(created["status"]).toBe("lost");
    expect(env.tables["crm_opportunities"]!.find((r) => r["id"] === created["id"])!["status"]).toBe(
      "lost",
    );
  });
  it("the Oct 2 refusal is gone from the code", () => {
    const fns = src("src/lib/opportunities.functions.ts");
    expect(fns).not.toContain("oppStatusProblem");
    expect(fns).not.toContain("OPP_STATUS_MANAGER_ONLY");
  });
});

describe("the form and the page", () => {
  it("opportunity-form.ts no longer exports the rule; the closing statuses stay listed for the reminder hint", () => {
    const f = form as Record<string, unknown>;
    expect(f["canSetOppStatus"]).toBeUndefined();
    expect(f["oppStatusProblem"]).toBeUndefined();
    expect(f["OPP_STATUS_MANAGER_ONLY"]).toBeUndefined();
    expect(f["OPP_STATUS_REP_HINT"]).toBeUndefined();
    expect(form.OPP_CLOSING_STATUSES).toEqual(["won", "lost", "no_response"]);
    expect(form.createReminderHint({ status: "won", assignee_id: REP })).toBe(
      "Created at this status, it starts no follow-up reminders.",
    );
  });
  it("the status select has every status enabled, no hint, no manager marker", () => {
    const page = read("src/components/opportunities-page.tsx");
    expect(page).not.toContain("canSetOppStatus");
    expect(page).not.toContain("OPP_STATUS_REP_HINT");
    expect(page).not.toContain("data-manager-only");
    expect(page).not.toContain("repLimited");
    expect(page).not.toContain("Won, Lost and No response are set by a manager");
    expect(page.replace(/\s+/g, " ")).toContain(
      "{OPP_STATUSES.map((s) => ( <SelectItem key={s} value={s}> {OPP_STATUS_LABELS[s]} </SelectItem> ))}",
    );
  });
});

describe("the database: 20261012100000 drops crm_opportunities_closing_rule", () => {
  const flat = flatSql("supabase/migrations/20261012100000_bid_drives_opportunity.sql");
  it("trigger and function, replayable", () => {
    expect(flat).toContain(
      "drop trigger if exists crm_opportunities_closing_rule on public.crm_opportunities; drop function if exists public.crm_opportunities_closing_rule();",
    );
    expect(flat).not.toContain("create or replace function public.crm_opportunities_closing_rule");
    expect(flat).not.toContain("Only a manager can mark an opportunity");
  });
  it("leaves the follow-up rules (crm_followups_manager_only) and the write policy alone", () => {
    expect(flat).not.toContain("crm_followups_manager_only");
    expect(flat).not.toContain("crm_opportunities_write");
  });
});

describe("the status strip says who set each status", () => {
  const events = [
    { kind: "created", status: "open", at: "2026-09-20T12:00:00Z", by_name: "Pat Office" },
    { kind: "status", status: "contacted", at: "2026-09-22T12:00:00Z", by_name: "Rae Rep" },
    { kind: "status", status: "quoted", at: "2026-09-25T12:00:00Z", by_name: "Rae Rep" },
    { kind: "status", status: "contacted", at: "2026-09-26T12:00:00Z", by_name: "Mo Manager" },
    { kind: "status", status: "lost", at: "2026-09-30T12:00:00Z", by_name: "Rae Rep" },
  ];
  it("statusActors: who LAST set each status", () => {
    expect(statusActors(events)).toEqual({
      open: "Pat Office",
      contacted: "Mo Manager",
      quoted: "Rae Rep",
      lost: "Rae Rep",
    });
  });
  it("oppStatusStrip carries it per cell (the outcome too); a cell without a known name has none", () => {
    const cells = oppStatusStrip("lost", events);
    expect(cells.map((c) => c.by)).toEqual(["Pat Office", "Mo Manager", "Rae Rep", "Rae Rep"]);
    const bare = oppStatusStrip("open", [
      { kind: "created", status: "open", at: "2026-09-20T12:00:00Z" },
    ]);
    expect(bare[0]).toEqual({
      key: "open",
      label: "Open",
      at: "2026-09-20T12:00:00Z",
      current: true,
    });
    expect("by" in bare[0]!).toBe(false);
  });
  it("StageStrip renders 'by <name>' under the date; the log rows carry by_name (the trigger writes it)", () => {
    expect(src("src/components/stage-strip.tsx")).toContain(
      '{c.by && ( <span className="truncate text-muted-foreground" data-by> by {c.by} </span> )}',
    );
    expect(flatSql("supabase/migrations/20261001130000_opened_and_stage_dates.sql")).toContain(
      "insert into public.crm_opportunity_events (opportunity_id, kind, status, by_user, by_name) values (new.id, 'status', new.status, v_uid, v_name);",
    );
    // The page reads the whole log row (select *), so by_name reaches the strip.
    expect(src("src/lib/opportunities.functions.ts")).toContain(
      '.from("crm_opportunity_events") .select("*")',
    );
  });
});
