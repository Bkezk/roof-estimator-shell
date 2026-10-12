/**
 * The Owner view honours holds (owner, Oct 12, item 7). A follow-up snoozed past today sits under
 * Waiting on Work Overview (my-work.ts isHeldOn / bucketOf), so it is neither Due today nor
 * Overdue there — but owner-view.functions.ts mapped the follow-up rows without snoozed_until, so
 * the Owner view counted a held follow-up due yesterday as Overdue (and listed it in the person's
 * detail). Now the mapping carries the hold (snoozed_until, hold_reason and the rest, as Work
 * Overview reads them) and the counts skip a held item; on the hold's day it counts again.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));

import { followupItem, mergeWork, type FollowupIn } from "@/lib/my-work";
import { bucketCounts, detailGroups } from "@/lib/owner-view";
import {
  getOwnerPersonDetail,
  listOwnerView,
  type OwnerPersonDetail,
  type OwnerViewResult,
} from "@/lib/owner-view.functions";
import { fakeSupabase } from "@/test/fake-supabase";

type Row = Record<string, unknown>;
const TODAY = "2026-10-12";
const YESTERDAY = "2026-10-11";
const ANN = "22222222-2222-4222-8222-222222222222";
const toYmd = (iso: string) => new Date(iso).toISOString().slice(0, 10);

const followup = (over: Partial<FollowupIn> = {}): FollowupIn => ({
  id: "f1",
  title: "Call about the gym roof",
  url: "/opportunities?id=o1",
  due_at: `${YESTERDAY}T15:00:00Z`,
  status: "open",
  kind: "opportunity",
  item_id: "o1",
  assignee_id: ANN,
  ...over,
});

describe("the pure counts", () => {
  it("a held follow-up due yesterday counts 0 overdue; after the hold's day it counts 1", () => {
    const held = followupItem(followup({ snoozed_until: "2026-10-13T12:00:00Z" }), {}, toYmd);
    expect(bucketCounts([held], TODAY)[ANN]).toBeUndefined();
    expect(detailGroups(ANN, [held], [], TODAY)).toEqual({ today: [], overdue: [] });
    // The hold's own day: it is back (the morning reminder fires that day).
    const back = followupItem(followup({ snoozed_until: `${TODAY}T12:00:00Z` }), {}, toYmd);
    expect(bucketCounts([back], TODAY)[ANN]?.overdue).toBe(1);
    expect(detailGroups(ANN, [back], [], TODAY).overdue.map((i) => i.key)).toEqual(["followup:f1"]);
    const past = followupItem(followup({ snoozed_until: "2026-10-05T12:00:00Z" }), {}, toYmd);
    expect(bucketCounts([past], TODAY)[ANN]?.overdue).toBe(1);
  });
  it("a ticket's own held timer keeps the ticket out too (mergeWork rides it on the ticket row)", () => {
    const items = mergeWork(
      {
        tickets: [
          {
            id: "t1",
            number: 1,
            customer_name: "Acme",
            site_name: null,
            site_address: null,
            description: "Leak",
            service_type: "leak",
            stage: "scheduled",
            scheduled_date: YESTERDAY,
            technician_id: ANN,
          },
        ],
        tasks: [],
        followups: [
          followup({
            kind: "ticket",
            item_id: "t1",
            url: "/service?id=t1",
            snoozed_until: "2026-10-13T12:00:00Z",
          }),
        ],
      },
      toYmd,
    );
    expect(bucketCounts(items, TODAY)[ANN]).toBeUndefined();
  });
});

describe("listOwnerView / getOwnerPersonDetail carry the hold (the real functions, fake client)", () => {
  beforeAll(() => vi.useFakeTimers({ now: new Date(`${TODAY}T15:00:00Z`), toFake: ["Date"] }));
  afterAll(() => vi.useRealTimers());
  const tables = (snoozedUntil: string | null): Record<string, Row[]> => ({
    profiles: [
      {
        id: ANN,
        role: "admin",
        access: [],
        technician: false,
        full_name: "Ann Admin",
        email: "a@x",
      },
    ],
    crm_accounts: [],
    bids: [],
    service_jobs: [],
    tasks: [],
    crm_followups: [
      {
        ...followup(),
        account_id: null,
        every_days: 3,
        snoozed_until: snoozedUntil,
        hold_reason: snoozedUntil ? "Waiting on parts" : null,
        held_by_name: snoozedUntil ? "Ann Admin" : null,
        hold_count: snoozedUntil ? 1 : 0,
      },
    ],
    crm_opportunities: [],
    service_job_events: [],
    crm_contact_log: [],
    service_time_entries: [],
    audit_log: [],
  });
  const run = <T>(fn: unknown, data: Row, snoozedUntil: string | null) =>
    (fn as (a: { data: Row; context: unknown }) => Promise<T>)({
      data,
      context: { supabase: fakeSupabase(tables(snoozedUntil)).db, userId: ANN },
    });
  it("held until tomorrow: Ann's Overdue is 0 and her detail lists nothing; no hold: 1", async () => {
    const held = await run<OwnerViewResult>(
      listOwnerView,
      { today: TODAY },
      "2026-10-13T12:00:00Z",
    );
    expect(held.rows.find((r) => r.id === ANN)!.overdue).toBe(0);
    const open = await run<OwnerViewResult>(listOwnerView, { today: TODAY }, null);
    expect(open.rows.find((r) => r.id === ANN)!.overdue).toBe(1);
    // The hold ended yesterday: it counts again.
    const ended = await run<OwnerViewResult>(
      listOwnerView,
      { today: TODAY },
      `${YESTERDAY}T12:00:00Z`,
    );
    expect(ended.rows.find((r) => r.id === ANN)!.overdue).toBe(1);

    const detailHeld = await run<OwnerPersonDetail>(
      getOwnerPersonDetail,
      { userId: ANN, today: TODAY },
      "2026-10-13T12:00:00Z",
    );
    expect(detailHeld.today).toEqual([]);
    expect(detailHeld.overdue).toEqual([]);
    const detailOpen = await run<OwnerPersonDetail>(
      getOwnerPersonDetail,
      { userId: ANN, today: TODAY },
      `${YESTERDAY}T12:00:00Z`,
    );
    expect(detailOpen.overdue.map((i) => i.key)).toEqual(["followup:f1"]);
    // The row carries the hold's record, as Work Overview's does.
    expect(detailOpen.overdue[0]!.followup).toMatchObject({
      snoozed_until: `${YESTERDAY}T12:00:00Z`,
      hold_reason: "Waiting on parts",
      held_by_name: "Ann Admin",
      hold_count: 1,
      every_days: 3,
    });
  });
});
