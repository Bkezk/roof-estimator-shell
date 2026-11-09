/**
 * A bid started from an inspection remembers the ticket (owner, Nov 9: "Can you make it to where
 * there is a stored link to the inspection on the bid?").
 *
 *  - bids.from_job_id (migration 20261109180000) holds the inspection ticket's id.
 *  - "Create bid" on a completed inspection opens the estimator with ?inspection=<ticket id>; the
 *    estimator's first save calls linkBidToInspection, which writes the link and only then records
 *    the inspection's outcome as "bid". The click itself records nothing any more.
 *  - The Bids page row and the estimator's Status column read "From inspection #6058 — Done,
 *    Nov 9", linking to the ticket; the ticket's After the inspection panel lists the bid.
 *
 * Before Nov 9 the outcome was stamped on the click (a bid never saved still read "Outcome: Bid")
 * and a bid had no stored link at all — every pin below is red on that code.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

// The server-function wrapper hands the handler straight back (as bids-page-fixes-nov6.test.ts).
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    let validate: (d: unknown) => unknown = (d) => d;
    const b = {
      middleware: () => b,
      validator: (v: (d: unknown) => unknown) => {
        validate = v;
        return b;
      },
      handler:
        (h: (a: { data: unknown; context: unknown }) => unknown) =>
        (arg: { data: unknown; context: unknown }) =>
          h({ data: validate(arg.data), context: arg.context }),
    };
    return b;
  },
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));
vi.mock("@/lib/bid-locks.functions", () => ({ liveLockHeldElsewhere: vi.fn(async () => null) }));

import { fromInspectionLine } from "@/lib/bid-status";
import { parseEstimateSearch } from "@/lib/estimate-search";
import { flatTypes, readGeneratedTypes } from "@/test/generated-types";

const read = (p: string) => readFileSync(p, "utf8");
const UUID = "0f0e0d0c-0b0a-4908-8706-050403020100";

describe("the URL: ?inspection=<ticket id>", () => {
  it("keeps a ticket id and drops anything else", () => {
    expect(parseEstimateSearch({ inspection: UUID })).toEqual({ inspection: UUID });
    expect(parseEstimateSearch({ inspection: "6058" })).toEqual({});
    expect(parseEstimateSearch({ inspection: 6058 })).toEqual({});
    expect(parseEstimateSearch({})).toEqual({});
  });
  it("rides with the prefill the inspection hands over", () => {
    const got = parseEstimateSearch({
      pfName: "Site — Customer",
      pfAccount: UUID,
      inspection: UUID,
    });
    expect(got).toEqual({ pfName: "Site — Customer", pfAccount: UUID, inspection: UUID });
  });
});

describe("the line: From inspection #N — Stage, day", () => {
  it("names the ticket, its stage and the day it was marked Done (office time)", () => {
    expect(
      fromInspectionLine({ number: 6058, stage: "done", completed_at: "2026-11-09T16:07:01Z" }),
    ).toBe("From inspection #6058 — Done, Nov 9");
    // 02:30 UTC on the 10th is still the evening of the 9th in the office.
    expect(
      fromInspectionLine({
        number: 6060,
        stage: "authorized",
        completed_at: "2026-11-10T02:30:00Z",
      }),
    ).toBe("From inspection #6060 — Authorized, Nov 9");
  });
  it("leaves the day off when the ticket has none, and shows an unknown stage as typed", () => {
    expect(fromInspectionLine({ number: 6058, stage: "open", completed_at: null })).toBe(
      "From inspection #6058 — Open",
    );
    expect(fromInspectionLine({ number: 1, stage: "odd", completed_at: null })).toBe(
      "From inspection #1 — odd",
    );
  });
});

describe("the column and the migration", () => {
  it("bids.from_job_id exists in the types with its relationship, and the migration adds it", () => {
    const types = flatTypes(readGeneratedTypes());
    const bids = types.slice(
      types.indexOf("bids:{Row:{"),
      types.indexOf("bid_locks:{") > types.indexOf("bids:{Row:{")
        ? types.indexOf("bid_locks:{")
        : undefined,
    );
    expect(bids).toContain("from_job_id:string|null");
    expect(bids).toContain("from_job_id?:string|null");
    expect(types).toContain('foreignKeyName:"bids_from_job_id_fkey"');
    const mig = read("supabase/migrations/20261109180000_bids_from_job_id.sql");
    expect(mig).toContain(
      "add column if not exists from_job_id uuid references public.service_jobs(id) on delete set null",
    );
    expect(mig).toContain("create index if not exists bids_from_job_id_idx");
  });
});

describe("the server: linkBidToInspection", () => {
  const fn = read("src/lib/service-inspection.functions.ts");
  it("links the bid first and records the outcome only after the link is written", () => {
    expect(fn).toContain('export const linkBidToInspection = createServerFn({ method: "POST" })');
    const start = fn.indexOf("export const linkBidToInspection");
    const body = fn.slice(start);
    const link = body.indexOf(".update({ from_job_id: job.id })");
    const outcome = body.indexOf('await recordOutcome(sb, job.id, "bid", context.userId, name);');
    expect(link).toBeGreaterThan(-1);
    expect(outcome).toBeGreaterThan(link);
    // Only a completed inspection, only an unlinked (or same-linked) bid.
    expect(body).toContain(
      'if (job.service_type !== "inspection") throw new Error("This ticket is not an inspection");',
    );
    expect(body).toContain("if (!inspectionComplete(job.stage))");
    expect(body).toContain("if (bid.from_job_id === job.id) return { linked: true };");
    expect(body).toContain(
      'if (bid.from_job_id) throw new Error("This bid is already linked to another inspection");',
    );
    expect(body).toContain('.is("from_job_id", null)');
    expect(body).toContain('note: `Bid "${bid.name}" started from this inspection`');
  });
  it("the ticket's panel data lists the bids started from it, live ones only", () => {
    expect(fn).toContain("bids: LinkedBid[];");
    const q = fn.indexOf('.eq("from_job_id", job.id)', fn.indexOf('.from("bids")'));
    expect(q).toBeGreaterThan(-1);
    expect(fn.slice(q, q + 200)).toContain('.is("deleted_at", null)');
    expect(fn).toContain("bids: bids.data ?? [],");
    // The linked ticket carries completed_at for the line's day.
    expect(fn).toContain('.select("id, number, service_type, stage, completed_at")');
  });
});

describe("the screens", () => {
  it("Create bid hands the ticket over and records nothing on the click", () => {
    const section = read("src/components/service/inspection-section.tsx");
    expect(section).toContain("search={{ ...bidPrefill, inspection: job.id }}");
    expect(section).not.toContain('record.mutate("bid")');
    expect(section).toContain('mutationFn: (outcome: "none") =>');
    // The panel lists the bids with their status, and the outcome names the newest bid.
    expect(section).toContain('data-line="created-from-inspection"');
    expect(section).toContain('<Link to="/estimate" search={{ bid: b.id }}');
    expect(section).toContain("data.bids.at(-1)?.name ?? bidPrefill?.pfName ?? null");
  });
  it("the estimator links on the first save and shows the line under Status", () => {
    const est = read("src/routes/estimate.tsx");
    expect(est).toContain("if (search.inspection) linkInspection(search.inspection, row.id);");
    expect(est).toContain("linkInspectionFn({ data: { inspectionId, bidId: newBidId } })");
    expect(est).toContain("const fromInspectionId = loadedBid?.from_job_id ?? linkedInspectionId;");
    expect(est).toContain('data-line="from-inspection"');
    expect(est).toContain("{fromInspectionLine(fromInspection.data)}");
    // The link is written after the save, never before it (the save block sets bidId first).
    expect(est.indexOf("setBidId(row.id);")).toBeLessThan(
      est.indexOf("if (search.inspection) linkInspection(search.inspection, row.id);"),
    );
  });
  it("the Bids page reads the ticket with the list and shows the line on the row", () => {
    const fns = read("src/lib/bids.functions.ts");
    expect(fns).toContain(
      "account_id, opportunity_id, from_job_id, estimator_name:data->customer->>estimatorName",
    );
    expect(fns).toContain('.select("id, number, stage, completed_at")');
    expect(fns).toContain("from_job: b.from_job_id ? (tickets.get(b.from_job_id) ?? null) : null,");
    const page = read("src/routes/bids.tsx");
    expect(page).toContain('data-line="from-inspection"');
    expect(page).toContain("{fromInspectionLine(bid.from_job)}");
    expect(page).toContain('to="/service"\n                  search={{ id: bid.from_job.id }}');
  });
});

// ── the handlers, against a recording fake database ──────────────────────────────────────────
import { listBids } from "@/lib/bids.functions";
import type { BidListRow } from "@/lib/bids-list";
import { linkBidToInspection } from "@/lib/service-inspection.functions";

type Row = Record<string, unknown>;
/** A thenable query that records what was asked and answers by table. */
function fakeDb(rows: { job?: Row | null; bid?: Row | null; updatedBids?: Row[] }) {
  const calls: string[] = [];
  const from = (table: string) => {
    const st = { op: "select", filters: [] as string[], patch: null as unknown };
    const answer = () => {
      if (table === "profiles")
        return {
          role: "admin",
          access: ["service", "estimate"],
          technician: false,
          full_name: "Est Imator",
          email: "e@x",
        };
      if (table === "service_jobs") return rows.job ?? null;
      if (table === "bids") return rows.bid ?? null;
      return null;
    };
    const q = {
      select: () => q,
      eq: (k: string, v: unknown) => (st.filters.push(`${k}=${String(v)}`), q),
      is: (k: string, v: unknown) => (st.filters.push(`${k} is ${String(v)}`), q),
      in: () => q,
      order: () => q,
      update: (patch: unknown) => {
        st.op = "update";
        st.patch = patch;
        return q;
      },
      insert: (row: unknown) => {
        calls.push(`${table}.insert ${JSON.stringify(row)}`);
        return Promise.resolve({ data: null, error: null });
      },
      maybeSingle: () => {
        calls.push(`${table}.select ${st.filters.join(" ")}`);
        return Promise.resolve({ data: answer(), error: null });
      },
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
        calls.push(`${table}.${st.op} ${JSON.stringify(st.patch)} ${st.filters.join(" ")}`);
        const data =
          st.op === "update" && table === "bids" ? (rows.updatedBids ?? [{ id: "b1" }]) : null;
        return Promise.resolve({ data, error: null }).then(res, rej);
      },
    };
    return q;
  };
  return { sb: { from }, calls };
}
const call = (fn: unknown, data: unknown, sb: unknown) =>
  (fn as (a: { data: unknown; context: unknown }) => Promise<unknown>)({
    data,
    context: { supabase: sb, userId: "me" },
  });
const JOB = { id: "j1", number: 6058, service_type: "inspection", stage: "done", deleted_at: null };
const BID = { id: "b1", name: "Legacy Ford walls", from_job_id: null, deleted_at: null };
const IDS = {
  inspectionId: "0f0e0d0c-0b0a-4908-8706-050403020100",
  bidId: "1f0e0d0c-0b0a-4908-8706-050403020100",
};

describe("linkBidToInspection, against a fake database", () => {
  it("writes the link on the bid, then the outcome and a timeline note on the ticket", async () => {
    const { sb, calls } = fakeDb({ job: JOB, bid: BID });
    await expect(call(linkBidToInspection, IDS, sb)).resolves.toEqual({ linked: true });
    const link = calls.findIndex((c) => c.startsWith('bids.update {"from_job_id":"j1"}'));
    const outcome = calls.findIndex(
      (c) => c.startsWith("service_jobs.update") && c.includes('"inspection_outcome":"bid"'),
    );
    const note = calls.findIndex((c) => c.startsWith("service_job_events.insert"));
    expect(link).toBeGreaterThan(-1);
    expect(outcome).toBeGreaterThan(link);
    expect(note).toBeGreaterThan(outcome);
    // Only an unlinked bid is linked (a second save at the same moment cannot relink it).
    expect(calls[link]).toContain("id=b1 from_job_id is null");
    expect(calls[note]).toContain('Bid \\"Legacy Ford walls\\" started from this inspection');
    expect(calls[note]).toContain('"bid_id":"b1"');
  });
  it("when another save linked it first, nothing more is written", async () => {
    const { sb, calls } = fakeDb({ job: JOB, bid: BID, updatedBids: [] });
    await expect(call(linkBidToInspection, IDS, sb)).resolves.toEqual({ linked: true });
    expect(calls.some((c) => c.startsWith("service_jobs.update"))).toBe(false);
    expect(calls.some((c) => c.startsWith("service_job_events.insert"))).toBe(false);
  });
  it("the same pair again changes nothing; a bid linked elsewhere is refused", async () => {
    const same = fakeDb({ job: JOB, bid: { ...BID, from_job_id: "j1" } });
    await expect(call(linkBidToInspection, IDS, same.sb)).resolves.toEqual({ linked: true });
    expect(same.calls.some((c) => c.includes(".update"))).toBe(false);
    const other = fakeDb({ job: JOB, bid: { ...BID, from_job_id: "j9" } });
    await expect(call(linkBidToInspection, IDS, other.sb)).rejects.toThrow(
      "This bid is already linked to another inspection",
    );
    expect(other.calls.some((c) => c.includes(".update"))).toBe(false);
  });
  it("refuses a repair ticket, an inspection not yet Done, a deleted ticket or bid — and writes nothing", async () => {
    for (const [job, bid, msg] of [
      [{ ...JOB, service_type: "repair" }, BID, "This ticket is not an inspection"],
      [{ ...JOB, stage: "scheduled" }, BID, "The inspection is not done yet; mark it Done first"],
      [{ ...JOB, deleted_at: "2026-11-06T00:00:00Z" }, BID, "Ticket not found"],
      [JOB, { ...BID, deleted_at: "2026-11-06T00:00:00Z" }, "Bid not found"],
      [null, BID, "Ticket not found"],
    ] as const) {
      const { sb, calls } = fakeDb({ job, bid });
      await expect(call(linkBidToInspection, IDS, sb)).rejects.toThrow(msg);
      expect(calls.some((c) => c.includes(".update") || c.includes(".insert"))).toBe(false);
    }
  });
});

describe("listBids carries the inspection ticket with the row", () => {
  it("reads the linked tickets in one query and leaves a deleted or unreadable one off", async () => {
    const raw = (id: string, from_job_id: string | null) => ({
      id,
      name: id,
      status: "draft",
      grand_total: 1,
      created_at: "2026-11-09T00:00:00Z",
      updated_at: "2026-11-09T00:00:00Z",
      updated_by_name: null,
      folder: null,
      due_date: null,
      lost_reason: null,
      account_id: null,
      opportunity_id: null,
      from_job_id,
      estimator_name: null,
      typed_customer: null,
      roof_system: null,
      sections: null,
      import_source: null,
      account: null,
    });
    const inQueries: string[] = [];
    const sb = {
      from: (table: string) => ({
        select: () => {
          const q = {
            is: () => q,
            order: () => q,
            returns: () =>
              Promise.resolve({
                data: [raw("b1", "j1"), raw("b2", "gone"), raw("b3", null)],
                error: null,
              }),
            in: (_k: string, ids: string[]) => {
              inQueries.push(`${table}:${ids.join(",")}`);
              // The deleted ticket "gone" is filtered by the query and never comes back.
              return {
                is: () =>
                  Promise.resolve({
                    data: [
                      {
                        id: "j1",
                        number: 6058,
                        stage: "done",
                        completed_at: "2026-11-09T16:07:01Z",
                      },
                    ],
                    error: null,
                  }),
              };
            },
          };
          return q;
        },
      }),
    };
    const rows = (await call(listBids, undefined, sb)) as BidListRow[];
    expect(inQueries).toEqual(["service_jobs:j1,gone"]);
    expect(rows.map((r) => r.from_job)).toEqual([
      { id: "j1", number: 6058, stage: "done", completed_at: "2026-11-09T16:07:01Z" },
      null,
      null,
    ]);
    expect(rows.map((r) => r.from_job_id)).toEqual(["j1", "gone", null]);
  });
});
