/**
 * Was the Roof Care plan offered? (owner, Nov 19, night: "we also need to track if the care
 * plan was even offered so track the care plan button click on the ticket to ensure it's being
 * offered"; docs/qa/roof-care-offered-2026-11-19.md).
 *
 * Before this nothing was kept when Care Plan was pressed: a technician who never opened it and
 * one who opened it on every roof looked the same.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));

import {
  NO_TECHNICIAN,
  OFFER_DAYS,
  offeredWords,
  offerLine,
  offerReport,
  type OfferTicketIn,
} from "@/lib/care-plan-offers";
import {
  carePlanOffered,
  listCarePlanOffers,
  markCarePlanOffered,
} from "@/lib/care-plan-offers.functions";
import { fakeSupabase } from "@/test/fake-supabase";

const read = (p: string) => readFileSync(p, "utf8");
const flat = (s: string) => s.replace(/\s+/g, " ");
const run = (fn: unknown, db: unknown, data: unknown, userId = "admin") =>
  (fn as (a: unknown) => Promise<unknown>)({ data, context: { supabase: db, userId } });

const TODAY = "2027-06-30";
const ticket = (id: string, over: Partial<OfferTicketIn> = {}): OfferTicketIn => ({
  id,
  number: Number(id.replace(/\D/g, "")) || null,
  site_id: `site-${id}`,
  technician_id: "tyler",
  completed_at: "2027-06-20T15:00:00Z",
  roof_care_visit_id: null,
  ...over,
});
const names = new Map([
  ["tyler", "Tyler M"],
  ["sam", "Sam R"],
]);

describe("the count", () => {
  it("each technician: finished tickets, the ones Care Plan was opened on, and who signed", () => {
    const r = offerReport({
      today: TODAY,
      tickets: [
        ticket("t1"),
        ticket("t2", { completed_at: "2027-06-22T15:00:00Z" }),
        ticket("t3"),
        ticket("s1", { technician_id: "sam" }),
      ],
      offered: new Set(["t1", "s1"]),
      plans: [
        { site_id: "site-t1", signed_on: "2027-06-20", status: "awaiting_payment", ended_on: null },
      ],
      names,
    });
    expect(r.since).toBe("2027-05-31");
    // The one who opens it least comes first.
    expect(r.rows.map((x) => [x.name, x.finished, x.shown, x.signed])).toEqual([
      ["Tyler M", 3, 1, 1],
      ["Sam R", 1, 1, 0],
    ]);
    // The tickets it was not opened on, newest first, to open and ask about.
    expect(r.rows[0]!.missed.map((m) => m.id)).toEqual(["t2", "t3"]);
    expect(r.total).toEqual({ finished: 4, shown: 2, signed: 1 });
    expect(offerLine(r.rows[0]!)).toBe("Opened on 1 of 3 finished tickets. 1 signed up.");
    expect(offerLine({ finished: 1, shown: 1, signed: 0 })).toBe(
      "Opened on 1 of 1 finished ticket.",
    );
  });
  it("leaves out what had no plan to offer", () => {
    const r = offerReport({
      today: TODAY,
      tickets: [
        // a plan's own inspection
        ticket("a", { roof_care_visit_id: "v1" }),
        // no property
        ticket("b", { site_id: null }),
        // not finished
        ticket("c", { completed_at: null }),
        // finished before the 30 days
        ticket("d", { completed_at: "2027-05-30T15:00:00Z" }),
        // the property already had a plan that day
        ticket("e"),
        // its plan had ended before that day: there was one to offer again
        ticket("f"),
      ],
      offered: new Set(),
      plans: [
        { site_id: "site-e", signed_on: "2027-01-10", status: "active", ended_on: null },
        { site_id: "site-f", signed_on: "2026-01-10", status: "ended", ended_on: "2027-01-10" },
      ],
      names,
    });
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]!.missed.map((m) => m.id)).toEqual(["f"]);
    expect(OFFER_DAYS).toBe(30);
  });
  it("the day is the office's day, not the clock in London", () => {
    // 02:30 UTC on May 31 is still May 30 in the office: a day too early to count.
    const r = offerReport({
      today: TODAY,
      tickets: [
        ticket("late", { completed_at: "2027-05-31T02:30:00Z" }),
        ticket("in", { completed_at: "2027-05-31T14:00:00Z" }),
      ],
      offered: new Set(),
      plans: [],
      names,
    });
    expect(r.rows[0]!.missed.map((m) => m.id)).toEqual(["in"]);
  });
  it("a ticket nobody was on, and a technician who has left, still count", () => {
    const r = offerReport({
      today: TODAY,
      tickets: [ticket("n", { technician_id: null }), ticket("g", { technician_id: "gone" })],
      offered: new Set(["n"]),
      plans: [],
      names,
    });
    expect(r.rows.map((x) => x.name).sort()).toEqual([NO_TECHNICIAN, "Someone no longer here"]);
  });
  it("a plan signed on the visit counts as signed, not as a property that already had one", () => {
    const r = offerReport({
      today: TODAY,
      // Signed two days before the ticket was marked finished: the same visit.
      tickets: [ticket("x", { completed_at: "2027-06-22T15:00:00Z" })],
      offered: new Set(["x"]),
      plans: [{ site_id: "site-x", signed_on: "2027-06-20", status: "active", ended_on: null }],
      names,
    });
    expect(r.total).toEqual({ finished: 1, shown: 1, signed: 1 });
  });
});

describe("on the ticket", () => {
  it("says who opened it and when, or that nobody has", () => {
    expect(offeredWords([])).toBe("Care Plan has not been opened on this ticket.");
    expect(offeredWords([{ by_name: "Tyler M", at: "2027-06-20T15:00:00Z" }])).toBe(
      "Care Plan opened on this ticket by Tyler M on Sun, Jun 20.",
    );
    expect(
      offeredWords([
        { by_name: "Tyler M", at: "2027-06-20T15:00:00Z" },
        { by_name: "Sam R", at: "2027-06-21T15:00:00Z" },
      ]),
    ).toBe("Care Plan opened on this ticket by Tyler M on Sun, Jun 20, and by 1 more.");
  });
  it("the button keeps the press on a ticket, and only there", () => {
    const card = flat(read("src/components/roof-care/plan-card.tsx"));
    expect(card).toContain('onClick={() => { setOpen("plan"); if (jobId) mark.mutate(jobId); }}');
    // The three places a ticket shows the button hand it the ticket.
    const page = flat(read("src/components/service-page.tsx"));
    expect(page).toContain(
      "<RoofCareButtons siteId={job.site_id} visitId={job.roof_care_visit_id} jobId={job.id}",
    );
    const flow = flat(read("src/components/service/closeout.tsx"));
    expect(flow.match(/visitId=\{job\.roof_care_visit_id\} jobId=\{job\.id\}/g)).toHaveLength(2);
    // A property's own page has no ticket: nothing is kept there.
    // Nov 21: it also hands on a public Roof Care request (careRequest); still no ticket.
    expect(flat(read("src/components/property-page.tsx"))).toContain(
      '<RoofCareButtons siteId={s.id} careRequest={careRequest} className="justify-end" />',
    );
    // The line is the office's, under the small buttons, where there is a plan to offer.
    expect(card).toContain(
      "const showsOffered = !!jobId && !big && !!profile && !isFieldOnly(profile);",
    );
    expect(card).toContain(
      "{showsOffered && q.data && !active && !waiting && !lapsed && offered.data && (",
    );
  });
});

describe("the server", () => {
  it("the press goes through the database's own check", async () => {
    const calls: Record<string, unknown>[] = [];
    const env = fakeSupabase(
      {},
      {
        rpcs: {
          roof_care_mark_offered: (a: Record<string, unknown>) => {
            calls.push(a);
            return null;
          },
        },
      },
    );
    const id = "7b1e9f0e-6f0c-4a3e-9d5f-2f6c1b9a4e11";
    await run(markCarePlanOffered, env.db, { job_id: id });
    expect(calls).toEqual([{ p_job: id }]);
    expect(() => run(markCarePlanOffered, env.db, { job_id: "nope" })).toThrow();
  });
  it("a ticket's presses are read earliest first", async () => {
    const id = "7b1e9f0e-6f0c-4a3e-9d5f-2f6c1b9a4e11";
    const env = fakeSupabase({
      roof_care_offers: [
        { job_id: id, by_name: "Tyler M", at: "2027-06-20T15:00:00Z" },
        { job_id: "other", by_name: "Sam R", at: "2027-06-19T15:00:00Z" },
      ],
    });
    expect(await run(carePlanOffered, env.db, { job_id: id })).toEqual([
      { by_name: "Tyler M", at: "2027-06-20T15:00:00Z" },
    ]);
  });
  const world = (role: string) =>
    fakeSupabase({
      profiles: [
        { id: "admin", role, full_name: "Dana Office", email: "dana@example.com" },
        { id: "tyler", role: "user", full_name: "Tyler M", email: "t@example.com" },
      ],
      service_jobs: [
        {
          id: "j1",
          number: 7001,
          site_id: "s1",
          technician_id: "tyler",
          completed_at: "2027-06-20T15:00:00Z",
          roof_care_visit_id: null,
          deleted_at: null,
        },
        {
          id: "j2",
          number: 7002,
          site_id: "s2",
          technician_id: "tyler",
          completed_at: "2027-06-21T15:00:00Z",
          roof_care_visit_id: null,
          deleted_at: null,
        },
        {
          id: "j3",
          number: 7003,
          site_id: "s3",
          technician_id: "tyler",
          completed_at: "2027-06-21T15:00:00Z",
          roof_care_visit_id: null,
          deleted_at: "2027-06-22T00:00:00Z",
        },
      ],
      roof_care_offers: [{ job_id: "j1", by_name: "Tyler M", at: "2027-06-20T15:00:00Z" }],
      roof_care_plans: [],
    });
  it("the Owner page's count is the admins' alone", async () => {
    await expect(run(listCarePlanOffers, world("manager").db, { today: TODAY })).rejects.toThrow(
      "Forbidden: admin only",
    );
    const r = (await run(listCarePlanOffers, world("admin").db, { today: TODAY })) as ReturnType<
      typeof offerReport
    >;
    // The deleted ticket is not counted.
    expect(r.rows.map((x) => [x.name, x.finished, x.shown])).toEqual([["Tyler M", 2, 1]]);
    expect(r.rows[0]!.missed).toEqual([{ id: "j2", number: 7002 }]);
  });
  it("the Owner page shows it on the Business tab, the least first, with the tickets missed", () => {
    const biz = flat(read("src/components/owner-business.tsx"));
    expect(biz).toContain("<CarePlanOffered />");
    expect(biz).toContain(
      '<h2 className="text-sm font-semibold">Care Plan offered, last {OFFER_DAYS} days</h2>',
    );
    expect(biz).toContain("href={`/service?id=${m.id}`}");
  });
});

describe("the database", () => {
  const sql = flat(read("supabase/migrations/20261119970000_roof_care_offered.sql"));
  it("one row for each person on each ticket, written only by the function", () => {
    expect(sql).toContain(
      "create unique index if not exists roof_care_offers_one_each on public.roof_care_offers (job_id, by_user);",
    );
    expect(sql).toContain("on conflict (job_id, by_user) do nothing;");
    expect(sql).toContain("revoke all on public.roof_care_offers from anon, authenticated;");
    expect(sql).toContain("grant select on public.roof_care_offers to authenticated;");
    expect(sql).not.toMatch(
      /create policy \w+ on public\.roof_care_offers for (insert|update|delete|all)/,
    );
  });
  it("only someone who may work the ticket can mark it, and a technician reads only their own", () => {
    expect(sql).toContain(
      "raise exception 'That ticket is not yours to open' using errcode = '42501';",
    );
    expect(sql).toContain("or (j.site_id is not null and public.tech_sees_site(j.site_id))");
    expect(sql).toContain("by_user = (select auth.uid()) or (not (select public.is_technician())");
    expect(sql).toContain(
      "revoke all on function public.roof_care_mark_offered(uuid) from public, anon;",
    );
  });
  it("it goes with its ticket when a ticket is removed for good", () => {
    expect(sql).toContain(
      "job_id uuid not null references public.service_jobs (id) on delete cascade,",
    );
  });
});
