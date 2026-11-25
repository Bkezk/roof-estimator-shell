/**
 * The hand-back, the screens' one answer, and the Owner view's trade bid (the audit of Nov 25,
 * finding 24; owner: "go on ... 21, 22, 23, 24").
 *
 * Before:
 *   - the hand-back moved the opportunity's follow-up day, and the database ends a hold
 *     whenever that day moves: an opportunity on hold until Dec 15 at the customer's asking
 *     lost its hold with no word when its inspection was marked Done on Dec 1;
 *   - only a ticket marked Done handed the opportunity back. A ticket sent straight to
 *     Authorized, Invoiced or Closed, and a deleted ticket or bid, said nothing;
 *   - a bid's outcome was always said "submitted", even when it was marked Won or Lost;
 *   - when the other steps could not be read the hand-back said "done: follow up" anyway;
 *   - an opportunity with nobody on it and an open step was "waiting" on some screens and
 *     "Nobody is on it" on others;
 *   - the Owner view named a trade bid "Bid" in the roofing bid's orange.
 *
 * Dec 1, 2026 is a Tuesday. Every name, title and number here is made up.
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const sent = vi.hoisted(
  () => [] as { to: string[]; title: string; body: string; url: string; kind: string }[],
);
vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));
vi.mock("@/lib/notify.server", () => ({
  serverClient: async (sb: unknown) => sb,
  hasServiceRole: () => false,
  notify: async (to: string[], n: { kind: string; title: string; body: string; url: string }) => {
    sent.push({ to, kind: n.kind, title: n.title, body: n.body, url: n.url });
    return to.length;
  },
}));
vi.mock("@/lib/followups.server", () => ({ syncFollowup: vi.fn(async () => "unchanged") }));
vi.mock("@/lib/work-steps.server", () => ({ tellStep: vi.fn(async () => []) }));

import { deleteBid, setBidStatus } from "@/lib/bids.functions";
import { syncFollowup } from "@/lib/followups.server";
import {
  bidOutcome,
  holdOutlasts,
  stepDoneLogLine,
  stepDoneNotice,
  stepOutcomeWords,
  ticketLeftOpen,
  ticketOutcome,
} from "@/lib/job-steps";
import { afterStepDone } from "@/lib/job-steps.server";
import { kindLabel, mergeWork, workTone } from "@/lib/my-work";
import type { Client } from "@/lib/notify.server";
import { detailGroups, detailLabel, detailTone } from "@/lib/owner-view";
import { afterTicketStage } from "@/lib/ticket-events.server";
import { fakeSupabase } from "@/test/fake-supabase";

const src = (p: string) => readFileSync(p, "utf8");
const flat = (s: string) => s.replace(/\s+/g, " ");

const OPP = "0bb00000-0000-4000-8000-000000000001";
const BID = "b1d00000-0000-4000-8000-000000000001";
const GARRY = "user-garry";
const RO = "user-ro";
const ACME = "acct-acme";
const OTHER = "acct-other";
const DEC1 = new Date("2026-12-01T15:00:00Z");

type Row = Record<string, unknown>;
const opportunity = (over: Row = {}): Row => ({
  id: OPP,
  title: "Leak at the dock",
  status: "contacted",
  assignee_id: RO,
  account_id: ACME,
  expected_close: "2026-11-12",
  deleted_at: null,
  ...over,
});
const job = (over: Row = {}): Row => ({
  id: "t1",
  number: 7090,
  customer_name: "Acme",
  description: "",
  service_type: "inspection",
  stage: "done",
  scheduled_date: "2026-12-01",
  technician_id: GARRY,
  from_opportunity_id: OPP,
  from_job_id: null,
  deleted_at: null,
  account_id: ACME,
  created_by: null,
  created_at: "2026-11-20T15:00:00Z",
  ...over,
});
const draft = (over: Row = {}): Row => ({
  id: BID,
  name: "Dock re-roof",
  kind: "roof",
  status: "draft",
  due_date: "2026-12-10",
  created_by: RO,
  opportunity_id: OPP,
  from_job_id: null,
  deleted_at: null,
  account_id: ACME,
  created_at: "2026-11-20T15:00:00Z",
  updated_by_name: null,
  submitted_at: null,
  won_on: null,
  status_changed_at: null,
  lost_reason: null,
  ...over,
});
const hold = (until: string): Row => ({
  id: "fu-1",
  kind: "opportunity",
  item_id: OPP,
  status: "open",
  assignee_id: RO,
  snoozed_until: until,
  hold_reason: "The customer asked us to wait",
});
const world = (tables: Record<string, Row[]> = {}) =>
  fakeSupabase({
    profiles: [
      {
        id: RO,
        role: "manager",
        access: ["estimate", "service"],
        full_name: "Ro Santos",
        email: "ro@example.test",
        technician: false,
      },
      {
        id: GARRY,
        role: "user",
        access: ["service"],
        full_name: "Garry Peters",
        email: "g@example.test",
        technician: true,
      },
    ],
    crm_opportunities: [opportunity()],
    service_jobs: [job()],
    bids: [],
    crm_followups: [],
    crm_contact_log: [],
    ...tables,
  });
const ticketStep = {
  kind: "ticket" as const,
  label: "inspection #7090",
  from_opportunity_id: OPP,
  from_job_id: null,
};
const garry = { id: GARRY, name: "Garry Peters" };

beforeEach(() => {
  sent.length = 0;
  vi.mocked(syncFollowup).mockClear();
});

describe("the hand-back leaves a running hold alone", () => {
  it("the rule: a hold that ends after the two working days outlasts them", () => {
    expect(holdOutlasts("2026-12-15", "2026-12-03")).toBe(true);
    expect(holdOutlasts("2026-12-03", "2026-12-03")).toBe(false);
    expect(holdOutlasts("2026-12-02", "2026-12-03")).toBe(false);
    expect(holdOutlasts(null, "2026-12-03")).toBe(false);
  });

  it("on hold until Dec 15, inspection done on Dec 1: the day and the hold stay, and the notice says so", async () => {
    const env = world({ crm_followups: [hold("2026-12-15T13:00:00Z")] });
    const out = await afterStepDone(env.db, ticketStep, garry, DEC1);
    expect(out).toBe("told");
    // Before: the follow-up day became Dec 3, and that move ended the hold.
    expect(env.tables["crm_opportunities"]![0]!["expected_close"]).toBe("2026-11-12");
    expect(vi.mocked(syncFollowup)).not.toHaveBeenCalled();
    expect(env.tables["crm_followups"]![0]!["snoozed_until"]).toBe("2026-12-15T13:00:00Z");
    expect(sent).toEqual([
      {
        to: [RO],
        kind: "followup",
        title: "Inspection #7090 is done: follow up on Leak at the dock",
        body: "Your opportunity was waiting on it. It is on hold until Tuesday 12/15/2026, so its follow-up day was not changed.",
        url: `/opportunities?id=${OPP}`,
      },
    ]);
    expect(env.tables["crm_contact_log"]![0]!["note"]).toBe(
      "Inspection #7090 is done. On hold until Tuesday 12/15/2026: the follow-up day was not changed.",
    );
  });

  it("a hold that ends within the two working days, or has already ended, moves as before", async () => {
    for (const until of ["2026-12-02T13:00:00Z", "2026-11-20T13:00:00Z"]) {
      sent.length = 0;
      vi.mocked(syncFollowup).mockClear();
      const env = world({ crm_followups: [hold(until)] });
      await afterStepDone(env.db, ticketStep, garry, DEC1);
      expect(env.tables["crm_opportunities"]![0]!["expected_close"]).toBe("2026-12-03");
      expect(vi.mocked(syncFollowup)).toHaveBeenCalledTimes(1);
      expect(sent[0]?.body).toBe(
        "Your opportunity was waiting on it. Follow up by Thursday 12/3/2026.",
      );
    }
  });

  it("no hold at all: two working days, as before", async () => {
    const env = world();
    await afterStepDone(env.db, ticketStep, garry, DEC1);
    expect(env.tables["crm_opportunities"]![0]!["expected_close"]).toBe("2026-12-03");
  });
});

describe("the outcome is said as it was", () => {
  it("the words", () => {
    expect(stepOutcomeWords("done")).toBe("is done");
    expect(stepOutcomeWords("submitted")).toBe("is submitted");
    expect(stepOutcomeWords("won")).toBe("is marked Won");
    expect(stepOutcomeWords("lost")).toBe("is marked Lost");
    expect(stepOutcomeWords("deleted")).toBe("was deleted");
    expect(stepOutcomeWords("authorized")).toBe("is authorized");
    expect(bidOutcome("won")).toBe("won");
    expect(bidOutcome("lost")).toBe("lost");
    expect(bidOutcome("submitted")).toBe("submitted");
    expect(ticketOutcome("done")).toBe("done");
    expect(ticketOutcome("closed")).toBe("closed");
  });

  it("the notice and the log line use them", () => {
    expect(
      stepDoneNotice({
        label: "bid Dock re-roof (copy)",
        outcome: "lost",
        opportunity: "Leak at the dock",
        by: "Thursday 12/3/2026",
      }).title,
    ).toBe("Bid Dock re-roof (copy) is marked Lost: follow up on Leak at the dock");
    expect(
      stepDoneLogLine({ label: "repair #7091", outcome: "deleted", by: "Thursday 12/3/2026" }),
    ).toBe("Repair #7091 was deleted. Follow up by Thursday 12/3/2026.");
  });

  it("a second bid of the job marked Lost: the person is told Lost, not submitted", async () => {
    // The copy does not drive the opportunity (it is not its bid), so the opportunity is open.
    const env = world({
      service_jobs: [],
      bids: [draft({ status: "draft" })],
      crm_opportunities: [opportunity({ bid_id: "another-bid" })],
    });
    await setBidStatus({
      data: { id: BID, status: "lost", lostReason: "Price" },
      context: { supabase: env.db, userId: RO },
    } as never);
    expect(sent.map((n) => n.title)).toContain(
      "Bid Dock re-roof is marked Lost: follow up on Leak at the dock",
    );
    expect(sent.map((n) => n.title).join(" ")).not.toContain("is submitted");
  });

  it("a bid set to Submitted still says submitted", async () => {
    const env = world({ service_jobs: [], bids: [draft()] });
    await setBidStatus({
      data: { id: BID, status: "submitted" },
      context: { supabase: env.db, userId: RO },
    } as never);
    expect(sent.map((n) => n.title)).toContain(
      "Bid Dock re-roof is submitted: follow up on Leak at the dock",
    );
  });
});

describe("every way a step ends hands the opportunity back", () => {
  it("the rule: a ticket that leaves Open or Scheduled for any later stage", () => {
    for (const from of ["open", "scheduled"])
      for (const to of ["done", "authorized", "invoiced", "closed"])
        expect(ticketLeftOpen(from, to)).toBe(true);
    expect(ticketLeftOpen("open", "scheduled")).toBe(false);
    expect(ticketLeftOpen("done", "authorized")).toBe(false);
    expect(ticketLeftOpen(null, "authorized")).toBe(false);
  });

  const stage = async (row: Row, prev: string | null, opts: { deleted?: boolean } = {}) => {
    const env = world({ service_jobs: [row] });
    await afterTicketStage(
      row as never,
      prev,
      { id: RO, name: "Ro Santos" },
      env.db as unknown as Client,
      opts,
    );
    return sent.filter((n) => n.url === `/opportunities?id=${OPP}`).map((n) => n.title);
  };

  it("a manager sends it straight from Scheduled to Authorized, Invoiced or Closed: told, with that word", async () => {
    for (const to of ["authorized", "invoiced", "closed"]) {
      sent.length = 0;
      expect(await stage(job({ stage: to }), "scheduled")).toEqual([
        `Inspection #7090 is ${to}: follow up on Leak at the dock`,
      ]);
    }
  });

  it("Done still says done, once", async () => {
    expect(await stage(job({ stage: "done" }), "scheduled")).toEqual([
      "Inspection #7090 is done: follow up on Leak at the dock",
    ]);
  });

  it("Done and then Authorized is told at Done only", async () => {
    expect(await stage(job({ stage: "authorized" }), "done")).toEqual([]);
  });

  it("a ticket deleted while it was still to be done, with somebody on it: told it was deleted", async () => {
    expect(
      await stage(job({ stage: "scheduled", deleted_at: "2026-12-01T15:00:00Z" }), "scheduled", {
        deleted: true,
      }),
    ).toEqual(["Inspection #7090 was deleted: follow up on Leak at the dock"]);
  });

  it("a deleted ticket the opportunity was not waiting on says nothing", async () => {
    const gone = { deleted_at: "2026-12-01T15:00:00Z" };
    expect(
      await stage(job({ stage: "scheduled", technician_id: null, ...gone }), "scheduled", {
        deleted: true,
      }),
    ).toEqual([]);
    expect(await stage(job({ stage: "done", ...gone }), "done", { deleted: true })).toEqual([]);
  });

  it("a move inside the working stages, and a technician taken off, say nothing", async () => {
    expect(await stage(job({ stage: "scheduled" }), "open")).toEqual([]);
    const s = src("src/lib/ticket-events.server.ts");
    expect(s).toContain(
      "A technician taken off frees the opportunity at once and needs no notice.",
    );
  });

  it("a draft bid that is deleted: told it was deleted; a submitted one says nothing", async () => {
    const env = world({ service_jobs: [], bids: [draft()] });
    await deleteBid({ data: { id: BID }, context: { supabase: env.db, userId: RO } } as never);
    expect(sent.map((n) => n.title)).toEqual([
      "Bid Dock re-roof was deleted: follow up on Leak at the dock",
    ]);
    sent.length = 0;
    const other = world({ service_jobs: [], bids: [draft({ status: "submitted" })] });
    await deleteBid({ data: { id: BID }, context: { supabase: other.db, userId: RO } } as never);
    expect(sent).toEqual([]);
  });

  it("another step of the job still open: nobody is told yet, whatever ended", async () => {
    const env = world({ service_jobs: [], bids: [draft(), draft({ id: "b2", name: "Option B" })] });
    await deleteBid({ data: { id: BID }, context: { supabase: env.db, userId: RO } } as never);
    expect(sent).toEqual([]);
  });

  it("a copy made for another customer that leaves Draft does not hand back the first one's opportunity", async () => {
    const env = world({ service_jobs: [job()] });
    const out = await afterStepDone(
      env.db,
      {
        kind: "bid",
        label: "bid Dock re-roof (copy)",
        outcome: "submitted",
        from_opportunity_id: null,
        from_job_id: "t1",
        account_id: OTHER,
      },
      garry,
      DEC1,
    );
    expect(out).toBe("none");
    expect(sent).toEqual([]);
  });
});

describe("when the other steps cannot be read, nothing is said", () => {
  it("a failed read is not taken for nothing is open", async () => {
    const env = world();
    const broken = {
      ...(env.db as object),
      from: (t: string) =>
        t === "bids"
          ? {
              select: () => ({
                in: () => ({
                  order: () => ({
                    limit: async () => ({ data: null, error: { message: "bids are down" } }),
                  }),
                }),
              }),
            }
          : (env.db as unknown as { from: (t: string) => unknown }).from(t),
    } as unknown as Client;
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const out = await afterStepDone(broken, ticketStep, garry, DEC1);
    quiet.mockRestore();
    // Before: the failed part read as no rows, and the person was told "done: follow up"
    // while a bid could still be open.
    expect(out).toBe("none");
    expect(sent).toEqual([]);
    expect(env.tables["crm_opportunities"]![0]!["expected_close"]).toBe("2026-11-12");
    expect(env.tables["crm_contact_log"]).toEqual([]);
  });

  it("the person is still told when they made the press themselves", async () => {
    const env = world();
    await afterStepDone(env.db, ticketStep, { id: RO, name: "Ro Santos" }, DEC1);
    expect(sent[0]?.to).toEqual([RO]);
  });
});

describe("nobody on it and an open step: one answer on every screen", () => {
  it("Work Overview asks the rule for the opportunities nobody is on, and leaves a waiting one out", () => {
    const s = flat(src("src/lib/my-work.functions.ts"));
    expect(s).toContain(
      "const waiting = await openStepsFor(sb, [...oppIds, ...(unOpps.data ?? []).map((o) => o.id)]);",
    );
    expect(s).toContain(
      "opportunities: (unOpps.data ?? []) .filter((o) => !waiting.has(o.id)) .map(",
    );
  });
  it("Needs attention does the same", () => {
    const s = flat(src("src/lib/owner-attention.functions.ts"));
    expect(s).toContain("...oppRows.map((o) => o.id), ]);");
    expect(s).toContain("opps: oppRows.filter((o) => !waitingOpps.has(o.id)),");
  });
  it("the reminder run does the same before it alerts", () => {
    const s = flat(src("src/lib/notify.server.ts"));
    const step = s.slice(s.indexOf("async function alertUnassigned("));
    expect(step).toContain("const waitingOpps = await openStepsFor( admin,");
    expect(step).toContain("if (waitingOpps.has(o.id)) continue;");
  });
  it("the tile and the Opportunities page already asked it", () => {
    expect(src("src/lib/work-counts.functions.ts")).toContain("!waiting.has(o.id)");
    expect(src("src/components/opportunities-page.tsx")).toContain("!!o.waiting_on");
  });
});

describe("the Owner view names and colours a trade bid as Work Overview does", () => {
  const bids = [
    {
      id: "b-roof",
      kind: "roof",
      name: "Dock re-roof",
      status: "draft",
      due_date: "2026-11-20",
      account_name: "Acme",
      created_by: RO,
    },
    {
      id: "b-trade",
      kind: "trade",
      name: "Gutters",
      status: "draft",
      due_date: "2026-11-20",
      account_name: "Acme",
      created_by: RO,
    },
  ];
  const items = mergeWork({ tickets: [], tasks: [], followups: [], bids } as never, (iso) =>
    iso.slice(0, 10),
  );

  it("a person's overdue list: the trade bid says Trade bid in its own colour, the roofing bid Bid", () => {
    const overdue = detailGroups(RO, items, [], "2026-12-01").overdue;
    const by = (id: string) => overdue.find((i) => i.key === `bid:${id}`)!;
    expect(detailLabel(by("b-trade"))).toBe("Trade bid");
    expect(detailTone(by("b-trade"))).toBe("trade_bid");
    expect(detailLabel(by("b-roof"))).toBe("Bid");
    expect(detailTone(by("b-roof"))).toBe("bid");
  });

  it("the two answers are Work Overview's own, for every kind", () => {
    for (const i of items) {
      expect(detailLabel(i)).toBe(kindLabel(i));
      expect(detailTone(i)).toBe(workTone(i));
    }
    const lib = src("src/lib/owner-view.ts");
    expect(lib).toContain(
      'export const detailLabel = (i: Pick<WorkItem, "kind" | "trade">): string => kindLabel(i);',
    );
    expect(lib).toContain(
      'export const detailTone = (i: Pick<WorkItem, "kind" | "trade">): DetailTone => workTone(i);',
    );
  });

  it("the page asks them, and no longer names or colours a line by its kind alone", () => {
    const page = src("src/components/owner-view.tsx");
    expect(page).toContain("DETAIL_KIND_CLASS[detailTone(l)]");
    expect(page).toContain("{detailLabel(l)}");
    expect(page).not.toContain("DETAIL_KIND_CLASS[l.kind]");
    expect(page).not.toContain("DETAIL_KIND_LABELS[l.kind]");
    // Lime, as on Work Overview, and still not a size container.
    const lime = /trade_bid:\s+"([^"]+)"/.exec(page)?.[1] ?? "";
    expect(lime).toContain("bg-lime-50");
    expect(src("src/components/my-work-page.tsx")).toContain(lime);
    expect(page).not.toContain("@container");
  });
});
