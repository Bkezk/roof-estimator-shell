/**
 * Audit, Oct 2: a deleted opportunity could be reopened and revived. Through an old
 * `/opportunities?id=…` link its status could be changed (setOpportunityStatus did not check
 * deleted_at), syncFollowup then started a new follow-up and the assignee got reminders for an
 * opportunity the list hides.
 *
 * The real server functions (opportunities.functions.ts, contact-log.functions.ts,
 * followups.functions.ts and followups.server.ts syncFollowup) run against an in-memory stand-in
 * for the caller's Supabase client (src/test/fake-supabase.ts); only the notifications are
 * stubbed and createServerFn is reduced to "validate, then call the handler". The page is checked
 * from its source.
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));
const notified: unknown[] = [];
vi.mock("@/lib/notify.server", () => ({
  serverClient: async (fallback: unknown) => fallback,
  notify: vi.fn(async (...a: unknown[]) => {
    notified.push(a);
    return 0;
  }),
}));

import {
  deleteOpportunity,
  getOpportunity,
  restoreOpportunity,
  saveOpportunity,
  setOpportunityStatus,
} from "@/lib/opportunities.functions";
import { logContact } from "@/lib/contact-log.functions";
import { closeFollowup, snoozeFollowup } from "@/lib/followups.functions";
import { fakeSupabase } from "@/test/fake-supabase";

type Row = Record<string, unknown>;
const read = (p: string) => readFileSync(p, "utf8");

const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MGR = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const BOB = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OPP = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const FU = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const DELETED_AT = "2026-10-01T15:00:00.000Z";
const DELETED = "This opportunity was deleted";

const sales = {
  id: ME,
  role: "user",
  access: ["customers", "estimate"],
  technician: false,
  full_name: "Pat Sales",
  email: "pat@example.com",
};
const manager = { ...sales, id: MGR, role: "manager", access: [], full_name: "Mo Manager" };
const bob = { ...sales, id: BOB, full_name: "Bob Rep", email: "bob@example.com" };

const opportunity = (over: Row = {}): Row => ({
  id: OPP,
  title: "Reroof — Yellow Creek gym",
  account_id: null,
  site_id: null,
  bid_id: null,
  assignee_id: BOB,
  status: "open",
  expected_close: "2026-10-20",
  description: null,
  notes: null,
  lead_source: null,
  est_value: null,
  updated_at: "2026-09-30T10:00:00Z",
  deleted_at: null,
  ...over,
});
const followup = (over: Row = {}): Row => ({
  id: FU,
  kind: "opportunity",
  item_id: OPP,
  assignee_id: BOB,
  status: "open",
  title: "Reroof — Yellow Creek gym",
  url: `/opportunities?id=${OPP}`,
  due_at: "2026-10-20T12:00:00.000Z",
  next_remind_at: "2026-10-03T12:00:00.000Z",
  reminders_sent: 0,
  ...over,
});

let env: ReturnType<typeof fakeSupabase>;
function setup(opts: { opp?: Row; followups?: Row[] } = {}) {
  notified.length = 0;
  env = fakeSupabase({
    profiles: [sales, manager, bob],
    crm_opportunities: [opportunity(opts.opp)],
    crm_followups: opts.followups ?? [],
    crm_contact_log: [],
    crm_settings: [
      {
        id: 1,
        opportunity_close_days: 30,
        opportunity_first_days: 3,
        opportunity_every_days: 7,
        ticket_first_days: 1,
        ticket_every_days: 3,
      },
    ],
  });
}
const call = <T = void>(fn: unknown, data: Row, userId = ME) =>
  (fn as (a: { data: Row; context: unknown }) => Promise<T>)({
    data,
    context: { supabase: env.db, userId },
  });
const oppRow = () => env.tables["crm_opportunities"]!.find((r) => r["id"] === OPP)!;
const followups = () => env.tables["crm_followups"]!;

describe("a deleted opportunity takes no change (old link)", () => {
  beforeEach(() => setup({ opp: { deleted_at: DELETED_AT } }));
  it("setOpportunityStatus is refused; no write, no new follow-up, no reminder", async () => {
    await expect(call(setOpportunityStatus, { id: OPP, status: "contacted" })).rejects.toThrow(
      DELETED,
    );
    expect(env.writes).toEqual([]);
    expect(oppRow()["status"]).toBe("open");
    expect(followups()).toEqual([]);
    expect(notified).toEqual([]);
  });
  it("saveOpportunity is refused; nothing written", async () => {
    await expect(
      call(saveOpportunity, { id: OPP, title: "Revived", assignee_id: BOB }),
    ).rejects.toThrow(DELETED);
    expect(env.writes).toEqual([]);
    expect(oppRow()["title"]).toBe("Reroof — Yellow Creek gym");
    expect(followups()).toEqual([]);
  });
  it("logging a contact is refused (its trigger would move it Open → Contacted)", async () => {
    await expect(
      call(logContact, { kind: "opportunity", item_id: OPP, method: "called" }),
    ).rejects.toThrow(DELETED);
    expect(env.writes).toEqual([]);
  });
  it("snoozing a (left-over) open follow-up of it is refused; closing it is still allowed", async () => {
    setup({ opp: { deleted_at: DELETED_AT }, followups: [followup()] });
    await expect(call(snoozeFollowup, { id: FU, days: 3 }, MGR)).rejects.toThrow(DELETED);
    expect(env.writes).toEqual([]);
    await call(closeFollowup, { id: FU }, MGR);
    expect(followups()[0]!["status"]).toBe("closed");
  });
  it("a second delete is refused (no re-stamp)", async () => {
    await expect(call(deleteOpportunity, { id: OPP })).rejects.toThrow(DELETED);
    expect(env.writes).toEqual([]);
    expect(oppRow()["deleted_at"]).toBe(DELETED_AT);
  });
  it("getOpportunity still returns it, with deleted_at, so the page can show the banner", async () => {
    const o = await call<Row>(getOpportunity, { id: OPP });
    expect(o["id"]).toBe(OPP);
    expect(o["deleted_at"]).toBe(DELETED_AT);
  });
});

describe("the same calls on a live opportunity still work", () => {
  it("setOpportunityStatus changes it and syncs the follow-up", async () => {
    setup({ followups: [followup()] });
    await call(setOpportunityStatus, { id: OPP, status: "won" });
    expect(oppRow()["status"]).toBe("won");
    expect(followups()[0]!["status"]).toBe("closed");
  });
});

describe("deleteOpportunity closes its open follow-up; restore does not reopen it", () => {
  it("delete: deleted_at stamped and the open follow-up closed ('deleted', by the system)", async () => {
    setup({ followups: [followup()] });
    await call(deleteOpportunity, { id: OPP });
    expect(typeof oppRow()["deleted_at"]).toBe("string");
    expect(followups()[0]).toMatchObject({
      status: "closed",
      closed_reason: "deleted",
      closed_by_sync: true,
    });
  });
  it("restore is an admin's or a manager's", async () => {
    setup({ opp: { deleted_at: DELETED_AT } });
    await expect(call(restoreOpportunity, { id: OPP })).rejects.toThrow(
      "Only an admin or a manager can restore an opportunity",
    );
    expect(env.writes).toEqual([]);
  });
  it("restore clears deleted_at; the closed follow-up stays closed and none is started", async () => {
    setup({ followups: [followup()] });
    await call(deleteOpportunity, { id: OPP });
    await call(restoreOpportunity, { id: OPP }, MGR);
    expect(oppRow()["deleted_at"]).toBeNull();
    expect(followups()).toHaveLength(1);
    expect(followups()[0]!["status"]).toBe("closed");
    expect(notified).toEqual([]);
    // The next status change syncs a fresh follow-up (a new row; the table's default makes it
    // open — the stand-in does not apply column defaults).
    await call(setOpportunityStatus, { id: OPP, status: "contacted" }, MGR);
    expect(followups()).toHaveLength(2);
    expect(followups()[1]).toMatchObject({ kind: "opportunity", item_id: OPP, assignee_id: BOB });
  });
  it("restore refuses an opportunity that is not deleted", async () => {
    setup();
    await expect(call(restoreOpportunity, { id: OPP }, MGR)).rejects.toThrow(
      "This opportunity is not deleted",
    );
  });
});

describe("the Opportunities page on a deleted opportunity (source)", () => {
  const page = read("src/components/opportunities-page.tsx");
  it("shows a 'Deleted on <date>' banner", () => {
    expect(page).toContain("const deleted = !!opp?.deleted_at;");
    expect(page).toContain('data-banner="deleted"');
    expect(page).toContain("Deleted on {when(opp.deleted_at)}.");
  });
  it("makes the form read-only: a disabled fieldset, no Save, no submit", () => {
    expect(page).toMatch(/<fieldset\s+disabled=\{deleted\}/);
    expect(page).toContain("if (!deleted) submit();");
    expect(page).toMatch(
      /\{!deleted && \(\s*<div className="flex flex-wrap items-center gap-3">\s*<Button\s+type="submit"/,
    );
    expect(page).toContain("disabled={statusMut.isPending || deleted}");
  });
  it("hides Start a bid, Delete, the follow-up strip and the contact-log buttons", () => {
    expect(page).toMatch(/\{opp &&\s+!deleted &&[^]*?Start a bid/);
    expect(page).toContain('{opp && !deleted && can("customers") && (');
    expect(page).toContain("{!deleted && <FollowupStrip opp={opp} status={status} />}");
    expect(page).toMatch(/\{!deleted && \(\s*<LogContactButtons/);
  });
  it("offers Restore to admins and managers only", () => {
    expect(page).toContain("const canRestore = seesEveryone(profile);");
    expect(page).toMatch(/\{canRestore && \(\s*<Button[^]*?restore\.mutate\(\)[^]*?Restore/);
    expect(page).toContain("useServerFn(restoreOpportunity)");
  });
});
