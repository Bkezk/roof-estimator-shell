/**
 * Roof Care: a draft invoice's plan lines are worked out again when the draft is opened and when
 * it is finalised (owner, Nov 20, of the break test's number 2: "go with 2";
 * docs/qa/roof-care-draft-credit-2026-11-20.md).
 *
 * The finding: a repair's draft took all that was left of the plan's minor repairs. Another
 * draft of the same plan was then deleted, which freed credit. The repair's draft still took the
 * old amount, the customer was billed for what the plan would now cover, and Finalise accepted
 * it. A leak call that came free was missed the same way.
 *
 * The rule: the same step a save takes (syncPlanLines) now also runs when the draft is opened in
 * the invoice page and, on the server, at Finalise. When an amount moved, the draft is saved
 * with what is true, the office is told what changed, and a Finalise stops until it is pressed
 * again. What a person chose by hand is kept: a "does not use the plan" stays, a typed amount
 * is held and never raised, "charge the travel" stays. Final, paid and void invoices are never
 * worked out again.
 *
 * THE NUMBERS HERE ARE MADE UP: they match no plan price, allowance or rate of the office.
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));
vi.mock("@/lib/ticket-events.server", () => ({ afterTicketStage: vi.fn(async () => {}) }));
vi.mock("@/lib/followups.server", () => ({ syncFollowup: vi.fn(async () => {}) }));
const drawn: number[] = [];
vi.mock("@/lib/invoices.server", async (orig) => ({
  ...(await orig<typeof import("@/lib/invoices.server")>()),
  renderInvoicePdf: vi.fn(async (_sb: unknown, b: { invoice: { total: unknown } }) => {
    drawn.push(Number(b.invoice.total));
    return new Uint8Array([37, 80, 68, 70]);
  }),
}));

import { finalizeInvoice } from "@/lib/invoices.functions";
import {
  PLAN_LINES_LOOK_AGAIN,
  allowanceLineSource,
  PLAN_WORK_OUTSIDE,
  planLinesChangeWords,
  planLinesMoved,
} from "@/lib/roof-care-allowance";
import {
  planLinesStand,
  reworkDraftPlanLines,
  reworkInvoicePlanLines,
} from "@/lib/roof-care-allowance.functions";
import { travelLineSource } from "@/lib/roof-care-travel";
import { fakeSupabase } from "@/test/fake-supabase";

const read = (p: string) => readFileSync(p, "utf8");
const flat = (p: string) => read(p).replace(/\s+/g, " ");

const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PLAN = "7b1e9f0e-6f0c-4a3e-9d5f-2f6c1b9a4e11";
const JOB = "3e4f5a6b-7c8d-4e9f-8a1b-2c3d4e5f6a7b";
const SITE = "4f5a6b7c-8d9e-4f0a-9b2c-3d4e5f6a7b8c";
const INV = "7c8d9e0f-1a2b-4c3d-8e5f-6a7b8c9d0e1f";
const OTHER = "8d9e0f1a-2b3c-4d4e-9f6a-7b8c9d0e1f2a";
const OTHER2 = "9e0f1a2b-3c4d-4e5f-8a7b-8c9d0e1f2a3b";

type Row = Record<string, unknown>;

/**
 * A repair's draft at a property with a plan. The plan includes 740 of minor repairs and
 * `calls` leak calls. The repair is 60 of travel and 700 of work: 760. Another invoice of the
 * plan holds `otherCredit` of the repairs (in `otherStatus`), and `otherCalls` invoices hold a
 * leak call each. The draft stands as it was last saved: `credit` taken, `waived` travel off.
 */
function world(
  o: {
    credit?: number;
    waived?: number;
    choice?: string | null;
    travelChoice?: string | null;
    otherCredit?: number;
    otherStatus?: string | null;
    calls?: number;
    otherCalls?: string[];
    status?: string;
    stage?: string;
    /** Nov 23: the day the plan was signed, and the day the ticket's work was completed. */
    planFrom?: string;
    workedOn?: string;
  } = {},
) {
  const credit = o.credit ?? 0;
  const waived = o.waived ?? 0;
  const lines: Row[] = [
    { id: 1, invoice_id: INV, sort: 0, kind: "travel", source: "time:t1", total: 60 },
    { id: 2, invoice_id: INV, sort: 1, kind: "labor", source: "time:t2", total: 700 },
  ];
  if (waived > 0)
    lines.push({
      id: 3,
      invoice_id: INV,
      sort: 2,
      kind: "other",
      source: travelLineSource(PLAN),
      qty: 1,
      rate: -waived,
      total: -waived,
    });
  if (credit > 0)
    lines.push({
      id: 4,
      invoice_id: INV,
      sort: 3,
      kind: "other",
      source: allowanceLineSource(PLAN),
      qty: 1,
      rate: -credit,
      total: -credit,
    });
  const invoices: Row[] = [
    {
      id: INV,
      number: 7001,
      service_job_id: JOB,
      bid_id: null,
      roof_care_plan_id: null,
      bill_to_vendor_id: null,
      status: o.status ?? "draft",
      tax_rate: 0,
      subtotal: 760 - waived - credit,
      tax: 0,
      total: 760 - waived - credit,
      care_allowance_choice: o.choice === undefined ? (credit > 0 ? "auto" : null) : o.choice,
      care_allowance_plan_id: credit > 0 ? PLAN : null,
      care_travel_choice:
        o.travelChoice === undefined ? (waived > 0 ? "auto" : null) : o.travelChoice,
      invoice_date: "2026-11-20",
      created_at: "2026-11-20T15:00:00Z",
      bill_to: {},
    },
  ];
  if (o.otherStatus !== null && (o.otherCredit ?? 0) > 0) {
    invoices.push({ id: OTHER, status: o.otherStatus ?? "draft", service_job_id: "other-job" });
    lines.push({
      id: 50,
      invoice_id: OTHER,
      sort: 0,
      kind: "other",
      source: allowanceLineSource(PLAN),
      total: -(o.otherCredit ?? 0),
    });
  }
  (o.otherCalls ?? []).forEach((status, i) => {
    const id = i === 0 ? OTHER2 : `call-${i}`;
    invoices.push({ id, status, service_job_id: `call-job-${i}` });
    lines.push({
      id: 60 + i,
      invoice_id: id,
      sort: 0,
      kind: "other",
      source: travelLineSource(PLAN),
      total: -55,
    });
  });
  return fakeSupabase(
    {
      profiles: [
        {
          id: ME,
          role: "manager",
          access: [],
          technician: false,
          full_name: "Mo Manager",
          email: "mo@example.com",
        },
      ],
      service_jobs: [
        {
          id: JOB,
          number: 7001,
          site_id: SITE,
          account_id: null,
          technician_id: null,
          roof_care_visit_id: null,
          stage: o.stage ?? "authorized",
          customer_name: "Made-up Plaza",
          completed_at: o.workedOn ? `${o.workedOn}T17:00:00Z` : null,
        },
      ],
      roof_care_plans: [
        {
          id: PLAN,
          plan: "guard",
          site_id: SITE,
          status: "active",
          // Nov 23: a plan pays only toward work done from its first day, so the plan here
          // has the day it was signed, as every real plan does. It had none before.
          signed_on: o.planFrom ?? "2026-01-05",
          repair_allowance: 740,
          free_travel_calls: o.calls ?? 0,
        },
      ],
      invoices,
      invoice_lines: lines,
    },
    { rpcs: { set_ticket_stage_from_invoice: () => null } },
  );
}
type Env = ReturnType<typeof world>;
const mine = (env: Env) => env.tables["invoice_lines"]!.filter((l) => l["invoice_id"] === INV);
const creditOf = (env: Env) =>
  mine(env)
    .filter((l) => l["source"] === allowanceLineSource(PLAN))
    .map((l) => Number(l["total"]));
const waivedOf = (env: Env) =>
  mine(env)
    .filter((l) => l["source"] === travelLineSource(PLAN))
    .map((l) => Number(l["total"]));
const invOf = (env: Env) => env.tables["invoices"]!.find((i) => i["id"] === INV)!;
const rework = (env: Env) => reworkDraftPlanLines(env.db, invOf(env) as never, mine(env) as never);
const call = <T>(fn: unknown, env: Env, data: unknown) =>
  (fn as (a: { data: unknown; context: unknown }) => Promise<T>)({
    data,
    context: { supabase: env.db, userId: ME },
  });

beforeEach(() => {
  drawn.length = 0;
});

describe("the finding: credit freed by another invoice reaches the draft", () => {
  // Another draft of the plan took 430, so 310 was left and this draft took it: billed 450.
  it("while the other invoice stands, the draft is right and nothing is changed", async () => {
    const env = world({ credit: 310, otherCredit: 430 });
    expect(await rework(env)).toBeNull();
    expect(env.writes).toEqual([]);
    expect(creditOf(env)).toEqual([-310]);
  });

  it("the other draft deleted: the plan covers all 740 it can, and the office is told", async () => {
    const env = world({ credit: 310, otherCredit: 430, otherStatus: null });
    const r = await rework(env);
    expect(creditOf(env)).toEqual([-740]);
    expect(invOf(env)).toMatchObject({ total: 20, subtotal: 20, care_allowance_choice: "auto" });
    expect(r?.invoice).toMatchObject({ id: INV, total: 20 });
    expect(r?.lines.map((l) => Number(l.total))).toEqual([60, 700, -740]);
    expect(r?.note).toBe(
      "The Roof Care plan now takes $740.00 off this invoice for minor repairs. It took $310.00 before. More of the plan's minor repairs amount is free: another invoice that used it was deleted, voided or changed. The invoice total is now $20.00. It was $450.00.",
    );
  });

  it("the other invoice voided gives its credit back the same way", async () => {
    const env = world({ credit: 310, otherCredit: 430, otherStatus: "void" });
    expect((await rework(env))?.note).toContain("now takes $740.00 off");
    expect(creditOf(env)).toEqual([-740]);
  });

  it("a draft that took nothing, because nothing was left, takes what came free", async () => {
    const env = world({ credit: 0, choice: null, otherCredit: 740, otherStatus: null });
    const r = await rework(env);
    expect(creditOf(env)).toEqual([-740]);
    expect(r?.note).toContain(
      "The Roof Care plan now takes $740.00 off this invoice for minor repairs. It took nothing before.",
    );
  });

  it("the other way: another invoice holds more than was read, and the draft comes down", async () => {
    // The draft holds 400; a final invoice of the plan holds 470, so 270 is this one's.
    const env = world({ credit: 400, otherCredit: 470, otherStatus: "final" });
    const r = await rework(env);
    expect(creditOf(env)).toEqual([-270]);
    expect(r?.note).toBe(
      "The Roof Care plan now takes $270.00 off this invoice for minor repairs. It took $400.00 before. Another invoice of this plan used part of the minor repairs amount first. The invoice total is now $490.00. It was $360.00.",
    );
  });
});

describe("what a person chose by hand is kept", () => {
  it("does not use the plan: stays off, whatever came free", async () => {
    const env = world({ credit: 0, choice: "declined", otherCredit: 430, otherStatus: null });
    expect(await rework(env)).toBeNull();
    expect(env.writes).toEqual([]);
    expect(creditOf(env)).toEqual([]);
    expect(invOf(env)["care_allowance_choice"]).toBe("declined");
  });

  it("an amount typed lower is held and never raised", async () => {
    const env = world({ credit: 200, choice: "applied", otherCredit: 430, otherStatus: null });
    expect(await rework(env)).toBeNull();
    expect(env.writes).toEqual([]);
    expect(creditOf(env)).toEqual([-200]);
    expect(invOf(env)["care_allowance_choice"]).toBe("applied");
  });

  it("a typed amount is still cut to what the plan has left", async () => {
    const env = world({ credit: 300, choice: "applied", otherCredit: 470, otherStatus: "final" });
    const r = await rework(env);
    expect(creditOf(env)).toEqual([-270]);
    expect(invOf(env)["care_allowance_choice"]).toBe("applied");
    expect(r?.note).toContain("now takes $270.00 off this invoice");
  });

  it("charge the travel: stays charged, though a leak call is free", async () => {
    const env = world({ credit: 740, calls: 2, travelChoice: "declined" });
    expect(await rework(env)).toBeNull();
    expect(waivedOf(env)).toEqual([]);
    expect(invOf(env)["care_travel_choice"]).toBe("declined");
  });
});

describe("the leak call's travel goes the same way", () => {
  // The plan's two leak calls were held by two other invoices, so this draft charged its travel.
  it("a call freed by a voided invoice: the travel comes off, and it is said", async () => {
    const env = world({ credit: 740, calls: 2, otherCalls: ["void", "final"] });
    const r = await rework(env);
    expect(waivedOf(env)).toEqual([-60]);
    // The credit then covers what is still charged: 700 of the 740.
    expect(creditOf(env)).toEqual([-700]);
    expect(invOf(env)).toMatchObject({ total: 0, care_travel_choice: "auto" });
    expect(r?.note).toBe(
      "The Roof Care plan now takes $700.00 off this invoice for minor repairs. It took $740.00 before. This invoice bills less than the plan was covering. The travel on this invoice, $60.00, is no longer charged: the plan has a leak call free again. The invoice total is now $0.00. It was $20.00.",
    );
  });

  it("both calls still held: nothing changes", async () => {
    const env = world({ credit: 740, calls: 2, otherCalls: ["final", "paid"] });
    expect(await rework(env)).toBeNull();
    expect(waivedOf(env)).toEqual([]);
  });

  it("a call this draft held that is no longer the plan's to give is charged again", async () => {
    const env = world({ credit: 700, waived: 60, calls: 2, otherCalls: ["final", "final"] });
    const r = await rework(env);
    expect(waivedOf(env)).toEqual([]);
    expect(creditOf(env)).toEqual([-740]);
    expect(r?.note).toContain(
      "The travel on this invoice, $60.00, is charged again: the plan's leak calls are used by its other invoices, or the invoice has no travel now.",
    );
  });
});

describe("only a draft is ever worked out again", () => {
  it.each(["final", "paid", "void"])("a %s invoice is left exactly as it is", async (status) => {
    const env = world({ credit: 310, otherCredit: 430, otherStatus: null, status });
    expect(await rework(env)).toBeNull();
    expect(await call(reworkInvoicePlanLines, env, { id: INV })).toBeNull();
    expect(env.writes).toEqual([]);
    expect(creditOf(env)).toEqual([-310]);
  });

  it("an invoice with no ticket (a trade bid's, a plan year's) is left alone", async () => {
    const env = world({ credit: 310, otherCredit: 430, otherStatus: null });
    invOf(env)["service_job_id"] = null;
    expect(await rework(env)).toBeNull();
    expect(env.writes).toEqual([]);
  });
});

describe("when the draft is opened", () => {
  it("the page's call answers the draft as it now stands, with what changed", async () => {
    const env = world({ credit: 310, otherCredit: 430, otherStatus: null });
    const r = await call<{ invoice: Row; lines: Row[]; note: string | null } | null>(
      reworkInvoicePlanLines,
      env,
      { id: INV },
    );
    expect(r?.invoice["total"]).toBe(20);
    expect(r?.note).toContain("now takes $740.00 off this invoice");
    // Opened again: it stands, and nothing is said twice.
    expect(await call(reworkInvoicePlanLines, env, { id: INV })).toBeNull();
  });

  it("an invoice that is not there is said, not passed over", async () => {
    const env = world();
    await expect(
      call(reworkInvoicePlanLines, env, { id: "0f1a2b3c-4d5e-4f6a-9b8c-9d0e1f2a3b4c" }),
    ).rejects.toThrow("Invoice not found");
  });

  it("the invoice page asks once per draft, and shows only the plan's lines as changed", () => {
    const page = flat("src/components/service/invoice-editor.tsx");
    expect(page).toContain("const reworkFn = useServerFn(reworkInvoicePlanLines);");
    expect(page).toContain(
      "if (reworked.current || !job) return; reworked.current = true; reworkFn({ data: { id: inv.id } })",
    );
    expect(page).toContain(
      "if (w.note) toast.warning(w.note, { duration: Infinity, closeButton: true });",
    );
    // What was typed in the moment the page opened is not thrown away.
    expect(page).toContain("setLines((ls) => [...ls.filter((l) => !isPlanLine(l)), ...own]);");
    // A check that fails is said out loud.
    expect(page).toContain("Could not check this invoice against its Roof Care plan:");
  });
});

describe("at Finalise", () => {
  it("a stale draft is saved with what is true, and the Finalise stops and says so", async () => {
    const env = world({ credit: 310, otherCredit: 430, otherStatus: null });
    await expect(call(finalizeInvoice, env, { id: INV })).rejects.toThrow(
      `The Roof Care plan now takes $740.00 off this invoice for minor repairs. It took $310.00 before. More of the plan's minor repairs amount is free: another invoice that used it was deleted, voided or changed. The invoice total is now $20.00. It was $450.00. ${PLAN_LINES_LOOK_AGAIN}`,
    );
    // Nothing is final, no PDF was drawn or stored, and the ticket has not moved.
    expect(invOf(env)).toMatchObject({ status: "draft", total: 20 });
    expect(creditOf(env)).toEqual([-740]);
    expect(drawn).toEqual([]);
    expect(env.uploads).toEqual([]);
    expect(env.tables["service_jobs"]![0]!["stage"]).toBe("authorized");
    expect(env.rpcCalls).toEqual([]);
  });

  it("pressed again, it is final at the amount the office has now seen", async () => {
    const env = world({ credit: 310, otherCredit: 430, otherStatus: null });
    await call(finalizeInvoice, env, { id: INV }).catch(() => {});
    const r = await call<{ invoice: Row }>(finalizeInvoice, env, { id: INV });
    expect(r.invoice).toMatchObject({ status: "final", total: 20 });
    expect(drawn).toEqual([20]);
    expect(env.uploads).toHaveLength(1);
  });

  it("a draft that already stands right is final at the first press", async () => {
    const env = world({ credit: 310, otherCredit: 430 });
    const r = await call<{ invoice: Row }>(finalizeInvoice, env, { id: INV });
    expect(r.invoice).toMatchObject({ status: "final", total: 450 });
    expect(drawn).toEqual([450]);
  });

  it("the server does it whatever the screen did, ahead of the PDF", () => {
    const f = flat("src/lib/invoices.functions.ts");
    const again = f.indexOf("const again = await reworkDraftPlanLines(sb, b.invoice, b.lines);");
    expect(again).toBeGreaterThan(0);
    expect(f).toContain(
      "if (again?.note) throw new Error(`${again.note} ${PLAN_LINES_LOOK_AGAIN}`);",
    );
    expect(again).toBeLessThan(f.indexOf("const pdf = await renderInvoicePdf(sb, b);"));
    // Rows tidied with no amount moved: the invoice is read again before it is drawn.
    expect(f).toContain("if (again) { // Rows tidied and no amount moved");
  });

  it("the invoice page checks first, shows the draft and waits for a second press", () => {
    const page = flat("src/components/service/invoice-editor.tsx");
    expect(page).toContain(
      "const w = await reworkFn({ data: { id: inv.id } }); if (w) takeServer({ invoice: w.invoice, lines: w.lines }); if (w?.note) { setConfirm(null); toast.warning(`${w.note} ${PLAN_LINES_LOOK_AGAIN}`,",
    );
    expect(PLAN_LINES_LOOK_AGAIN).toBe(
      "The invoice is not final yet. Look it over, then press Finalise again.",
    );
  });
});

describe("the words", () => {
  const stand = (credit: number, travel: number, total: number) => ({ credit, travel, total });

  it("nothing is said when no amount moved", () => {
    expect(planLinesMoved(stand(310, 0, 450), stand(310, 0, 450))).toBe(false);
    expect(planLinesChangeWords(stand(310, 0, 450), stand(310, 0, 450))).toBeNull();
    // Under a cent is not a change.
    expect(planLinesChangeWords(stand(310, 0, 450), stand(310.004, 0, 450))).toBeNull();
  });

  it("a credit that came off altogether, and why", () => {
    expect(planLinesChangeWords(stand(310, 0, 450), stand(0, 0, 760), { left: 0 })).toBe(
      "The Roof Care plan no longer takes anything off this invoice for minor repairs. It took $310.00 before. Another invoice of this plan used part of the minor repairs amount first. The invoice total is now $760.00. It was $450.00.",
    );
    expect(
      planLinesChangeWords(stand(310, 0, 0), stand(150, 0, 0), { left: 740, billable: 150 }),
    ).toContain("This invoice bills less than the plan was covering.");
    expect(planLinesChangeWords(stand(310, 0, 0), stand(150, 0, 0))).toContain(
      "The plan has less left for this invoice than it had.",
    );
  });

  it("travel that follows the invoice's own travel", () => {
    expect(planLinesChangeWords(stand(0, 60, 0), stand(0, 85, 0))).toBe(
      "The travel taken off for the plan's leak call is now $85.00. It was $60.00: it follows the travel on the invoice. The invoice total is now $0.00. It was $0.00.",
    );
  });

  it("where a draft stands is read off its own lines", () => {
    const env = world({ credit: 310, waived: 60 });
    expect(planLinesStand(invOf(env) as never, mine(env) as never)).toEqual({
      credit: 310,
      travel: 60,
      total: 390,
    });
  });
});

// Nov 23 (owner: "credit only applies to work done after plans starts"). A draft made under the
// older rule can carry credit, or a leak call's travel, for work dated before the plan started.
describe("Nov 23: a draft whose work is dated before the plan started", () => {
  it("loses the credit at the next re-work, and the office reads why", async () => {
    // The repair was done Mar 3. The plan started Mar 10. The draft holds 310 of credit.
    const env = world({ credit: 310, planFrom: "2027-03-10", workedOn: "2027-03-03" });
    const r = await rework(env);
    expect(creditOf(env)).toEqual([]);
    expect(invOf(env)).toMatchObject({ total: 760, subtotal: 760 });
    expect(r?.note).toBe(
      `The Roof Care plan no longer takes anything off this invoice for minor repairs. It took $310.00 before. ${PLAN_WORK_OUTSIDE} The invoice total is now $760.00. It was $450.00.`,
    );
  });
  it("the leak call's travel is charged again with it: the normal trip charge", async () => {
    const env = world({
      credit: 310,
      waived: 60,
      calls: 2,
      planFrom: "2027-03-10",
      workedOn: "2027-03-03",
    });
    const r = await rework(env);
    expect(creditOf(env)).toEqual([]);
    expect(waivedOf(env)).toEqual([]);
    expect(invOf(env)).toMatchObject({ total: 760 });
    expect(r?.note).toContain("The travel on this invoice, $60.00, is charged again.");
    expect(r?.note?.split(PLAN_WORK_OUTSIDE)).toHaveLength(2);
  });
  it("work done on the plan's first day keeps its credit and nothing is said", async () => {
    const env = world({ credit: 740, planFrom: "2027-03-10", workedOn: "2027-03-10" });
    expect(await rework(env)).toBeNull();
    expect(creditOf(env)).toEqual([-740]);
  });
});
