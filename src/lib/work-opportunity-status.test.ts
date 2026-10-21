/**
 * Work Overview, owner Oct 12: an assigned opportunity's row always read "Open" (the row is built
 * from the opportunity's follow-up, which knows nothing of the opportunity's status), while an
 * Unassigned opportunity row showed the real one. Now the server looks the status up (the way it
 * looks up the account name) and the row reads Open / Contacted / Quoted — the Opportunities
 * page's labels. No new statuses; a follow-up's own row is still "Open".
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));

import {
  AUTHORIZE_FOLLOWUP_STATUS,
  followupItem,
  mergeWork,
  opportunityItem,
  type FollowupIn,
} from "@/lib/my-work";
import { listMyWork, type MyWorkResult } from "@/lib/my-work.functions";
import { fakeSupabase } from "@/test/fake-supabase";

type Row = Record<string, unknown>;
const utcDay = (iso: string) => iso.slice(0, 10);

const followup = (over: Partial<FollowupIn> = {}): FollowupIn => ({
  id: "f1",
  title: "Corbin middle — re-roof",
  url: "/opportunities?id=o1",
  due_at: "2026-10-14T12:00:00Z",
  status: "open",
  kind: "opportunity",
  item_id: "o1",
  assignee_id: "pat",
  account_name: "Corbin ISD",
  ...over,
});

describe("the pure rule: an opportunity row's status", () => {
  it("a Quoted opportunity reads Quoted; Contacted, Open likewise — the labels the Unassigned rows use", () => {
    expect(followupItem(followup({ opportunity_status: "quoted" }), {}, utcDay)).toMatchObject({
      kind: "opportunity",
      status: "Quoted",
    });
    expect(followupItem(followup({ opportunity_status: "contacted" })).status).toBe("Contacted");
    expect(followupItem(followup({ opportunity_status: "open" })).status).toBe("Open");
    expect(
      opportunityItem({ id: "o1", title: "x", status: "quoted", expected_close: null }).status,
    ).toBe("Quoted");
  });
  it("unknown status: the row reads Open as before; a status outside the map shows as sent", () => {
    expect(followupItem(followup()).status).toBe("Open");
    expect(followupItem(followup({ opportunity_status: null })).status).toBe("Open");
    expect(followupItem(followup({ opportunity_status: "won" })).status).toBe("won");
  });
  it("a ticket's follow-up row is still Open, whatever is sent; the office's Authorize row says Done — to authorize (Oct 15)", () => {
    expect(followupItem(followup({ kind: "ticket", opportunity_status: "quoted" })).status).toBe(
      "Open",
    );
    expect(followupItem(followup({ kind: "invoice", opportunity_status: "quoted" })).status).toBe(
      AUTHORIZE_FOLLOWUP_STATUS,
    );
    expect(AUTHORIZE_FOLLOWUP_STATUS).toBe("Done — to authorize");
  });
});

describe("listMyWork, through the fake client", () => {
  const PAT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const MANAGER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  let tables: Record<string, Row[]>;
  beforeEach(() => {
    tables = {
      profiles: [
        {
          id: PAT,
          role: "user",
          access: ["customers"],
          technician: false,
          full_name: "Pat",
          email: "p@x",
        },
        {
          id: MANAGER,
          role: "manager",
          access: [],
          technician: false,
          full_name: "Mo",
          email: "m@x",
        },
      ],
      service_jobs: [],
      tasks: [],
      crm_followups: [
        {
          id: "f-quoted",
          title: "Corbin middle — re-roof",
          url: "/opportunities?id=o-quoted",
          due_at: "2026-10-14T12:00:00Z",
          status: "open",
          kind: "opportunity",
          item_id: "o-quoted",
          assignee_id: PAT,
          account_id: "acct-1",
          every_days: 7,
          snoozed_until: null,
        },
        {
          id: "f-contacted",
          title: "Bell County — gym",
          url: "/opportunities?id=o-contacted",
          due_at: "2026-10-15T12:00:00Z",
          status: "open",
          kind: "opportunity",
          item_id: "o-contacted",
          assignee_id: PAT,
          account_id: null,
          every_days: 7,
          snoozed_until: null,
        },
        {
          id: "f-ticket",
          title: "Follow up Ticket #6012",
          url: "/service?id=j1",
          due_at: "2026-10-15T12:00:00Z",
          status: "open",
          kind: "ticket",
          item_id: "j1",
          assignee_id: PAT,
          account_id: null,
          every_days: 3,
          snoozed_until: null,
        },
      ],
      crm_opportunities: [
        {
          id: "o-quoted",
          title: "Corbin middle — re-roof",
          status: "quoted",
          expected_close: "2026-10-30",
          account_id: "acct-1",
          assignee_id: PAT,
          deleted_at: null,
          created_at: "2026-10-01T12:00:00Z",
        },
        {
          id: "o-contacted",
          title: "Bell County — gym",
          status: "contacted",
          expected_close: "2026-10-30",
          account_id: null,
          assignee_id: PAT,
          deleted_at: null,
          created_at: "2026-10-01T12:00:00Z",
        },
      ],
      crm_accounts: [{ id: "acct-1", name: "Corbin ISD" }],
      crm_settings: [{ id: 1, unassigned_overdue_days: 1 }],
    };
  });
  const run = (userId: string, who?: string) =>
    (listMyWork as unknown as (a: { data: Row; context: unknown }) => Promise<MyWorkResult>)({
      data: who ? { who } : {},
      context: {
        supabase: fakeSupabase(tables, { rpcs: { ticket_authorizers: () => [MANAGER] } }).db,
        userId,
      },
    });

  it("the rep's own rows carry the opportunity's status, and read Quoted / Contacted on the list", async () => {
    const r = await run(PAT);
    expect(r.followups.map((f) => [f.id, f.opportunity_status ?? null])).toEqual([
      ["f-quoted", "quoted"],
      ["f-contacted", "contacted"],
      ["f-ticket", null],
    ]);
    const items = mergeWork(r, utcDay);
    const status = Object.fromEntries(items.map((i) => [i.key, i.status]));
    expect(status).toEqual({
      "followup:f-quoted": "Quoted",
      "followup:f-contacted": "Contacted",
      "followup:f-ticket": "Open",
    });
    expect(items.find((i) => i.key === "followup:f-quoted")).toMatchObject({
      kind: "opportunity",
      where: "Corbin ISD",
    });
  });
  it("Everyone (a manager): the same", async () => {
    const r = await run(MANAGER, "all");
    const items = mergeWork(r, utcDay);
    expect(items.find((i) => i.key === "followup:f-quoted")!.status).toBe("Quoted");
  });
  it("an opportunity the caller may not read (or that is gone): Open, as before", async () => {
    tables["crm_opportunities"] = [];
    const r = await run(PAT);
    expect(r.followups.find((f) => f.id === "f-quoted")!.opportunity_status).toBeNull();
    expect(mergeWork(r, utcDay).find((i) => i.key === "followup:f-quoted")!.status).toBe("Open");
  });
  it("the lookup, pinned: id and status of the opportunity follow-ups' items, beside the account names", () => {
    const fn = readFileSync("src/lib/my-work.functions.ts", "utf8");
    expect(fn).toContain(
      '(followups.data ?? []).filter((f) => f.kind === "opportunity").map((f) => f.item_id),',
    );
    // Oct 21, seventh audit: the ids go 100 at a time (lib/chunk-ids.ts readInChunks).
    expect(fn).toContain("readInChunks(oppIds, (ids) =>");
    expect(fn).toContain('sb.from("crm_opportunities").select("id, status").in("id", ids)');
    expect(fn).toContain('f.kind === "opportunity" ? (oppStatus.get(f.item_id) ?? null) : null,');
    const lib = readFileSync("src/lib/my-work.ts", "utf8");
    expect(lib).toMatch(
      /status:\s*f\.kind === "opportunity"\s*\? oppStatusLabel\(f\.opportunity_status\)\s*: f\.kind === "invoice"\s*\? AUTHORIZE_FOLLOWUP_STATUS\s*: "Open",/,
    );
  });
});
