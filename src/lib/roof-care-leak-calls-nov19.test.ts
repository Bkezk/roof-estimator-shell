/**
 * Roof Care, the owner's go of Nov 19 on three things (docs/roof-care-plans.md,
 * docs/qa/roof-care-refund-and-leak-calls-2026-11-19.md):
 *
 *  1. Roof Guard's leak calls: "two leak calls with the credit subtracting until it reaches 0
 *     and on those two leak calls travel is not charged? then after that it is", and "travel
 *     does come out of the later ones if theyve had 2 calls but havent used all their repair
 *     allotment yet".
 *  2. The refund when a plan ends early: "a share for inspections not done, if we did one half
 *     is refunded", and "i like the repairs coming off a refund rule".
 *  3. How they pay is said at the sign-up: "the payment needs to be by check or card either one
 *     during sign up".
 *
 * Before this the travel of a leak call was charged, or eaten out of the minor repairs credit;
 * ending a paid plan worked no refund out; and the sign-up did not ask how they pay.
 *
 * THE NUMBERS HERE ARE MADE UP.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));

import { ATTENTION_DEFAULTS, attentionList } from "@/lib/owner-attention";
import { allowanceCap, billableBefore } from "@/lib/roof-care-allowance";
import {
  asPayMethod,
  PAY_CARD_NOTE,
  PAY_METHODS,
  payWords,
  readRefundWorked,
  refundLines,
  refundStatusWords,
} from "@/lib/roof-care-plan";
import {
  isPlanLine,
  isTravelWaiverLine,
  travelBilled,
  travelBoxWords,
  travelLineSource,
  travelStatusWords,
  travelStep,
  travelWaived,
  travelWaiverLine,
  travelWaiverWords,
} from "@/lib/roof-care-travel";
import { syncPlanLines } from "@/lib/roof-care-travel.functions";
import { fakeSupabase } from "@/test/fake-supabase";

const read = (p: string) => readFileSync(p, "utf8");
const flat = (p: string) => read(p).replace(/\s+/g, " ");

const PLAN = "11111111-1111-4111-8111-111111111111";
const SITE = "22222222-2222-4222-8222-222222222222";
const JOB = "55555555-5555-4555-8555-555555555555";
const INV = "66666666-6666-4666-8666-666666666666";

describe("the travel of a leak call", () => {
  const lines = [
    { kind: "travel", source: "time:t1", total: 150 },
    { kind: "labor", source: "time:t2", total: 300 },
    { kind: "material", source: "mat:m1", total: 100 },
  ];

  it("is what the invoice's travel lines charge, and nothing else", () => {
    expect(travelBilled(lines)).toBe(150);
    expect(travelBilled([{ kind: "labor", total: 300 }])).toBe(0);
    expect(travelBilled([])).toBe(0);
  });

  it("comes off by itself while the plan has a call left", () => {
    expect(travelStep({ choice: null, travel: 150, calls: 2, usedElsewhere: 0 })).toEqual({
      choice: "auto",
      amount: 150,
    });
    expect(travelStep({ choice: "auto", travel: 150, calls: 2, usedElsewhere: 1 })).toEqual({
      choice: "auto",
      amount: 150,
    });
  });

  it("follows the invoice when its travel changes", () => {
    expect(travelStep({ choice: "auto", travel: 90, calls: 2, usedElsewhere: 0 }).amount).toBe(90);
    expect(travelStep({ choice: "auto", travel: 0, calls: 2, usedElsewhere: 0 })).toEqual({
      choice: null,
      amount: 0,
    });
  });

  it("is charged from the third call on", () => {
    expect(travelStep({ choice: null, travel: 150, calls: 2, usedElsewhere: 2 })).toEqual({
      choice: null,
      amount: 0,
    });
  });

  it("is charged when the office says the visit was not a leak call, and that stays", () => {
    expect(travelStep({ choice: "declined", travel: 150, calls: 2, usedElsewhere: 0 })).toEqual({
      choice: "declined",
      amount: 0,
    });
  });

  it("is never taken for a plan with no leak calls: Roof Watch and Roof Care", () => {
    expect(travelStep({ choice: null, travel: 150, calls: 0, usedElsewhere: 0 })).toEqual({
      choice: null,
      amount: 0,
    });
  });

  it("is one line the customer can read, saved as money off", () => {
    const line = travelWaiverLine({ id: PLAN, plan: "guard" }, 150, 4);
    expect(line).toMatchObject({
      sort: 4,
      description: "Roof Guard plan: leak call, travel included in your plan",
      total: -150,
      rate: -150,
      taxable: false,
      show_on_invoice: true,
      source: `roof-care-travel:${PLAN}`,
    });
    expect(travelWaiverWords("guard")).not.toMatch(/\d/);
    expect(isTravelWaiverLine(line)).toBe(true);
    expect(isPlanLine(line)).toBe(true);
    expect(isPlanLine({ source: `roof-care-allowance:${PLAN}` })).toBe(true);
    expect(isPlanLine({ source: "time:t1" })).toBe(false);
    expect(isPlanLine({ source: null })).toBe(false);
    expect(travelWaived([...lines, line])).toBe(150);
  });
});

describe("the owner's four calls, with the credit behind them", () => {
  // Each call: 300 labor, 100 materials, 150 travel. The plan: 2 calls, a credit of 1,400 (a made-up
  // figure; Nov 23: it was a real plan's amount, which is kept out of the repository).
  const call = [
    { kind: "travel", source: "time:t1", total: 150 },
    { kind: "labor", source: "time:t2", total: 300 },
    { kind: "material", source: "mat:m1", total: 100 },
  ];
  const one = (usedElsewhere: number, creditUsed: number) => {
    const t = travelStep({ choice: null, travel: travelBilled(call), calls: 2, usedElsewhere });
    const withWaiver = t.amount
      ? [...call, travelWaiverLine({ id: PLAN, plan: "guard" }, t.amount, 9)]
      : call;
    // The credit covers what the invoice still charges: the leak call line has come off it.
    const billable = billableBefore(withWaiver);
    const credit = allowanceCap({ allowance: 1400, usedElsewhere: creditUsed, billable });
    return { travelFree: t.amount > 0, credit, pays: billable - credit };
  };

  it("call 1 and 2: travel free, the repair off the credit, nothing to pay", () => {
    expect(one(0, 0)).toEqual({ travelFree: true, credit: 400, pays: 0 });
    expect(one(1, 400)).toEqual({ travelFree: true, credit: 400, pays: 0 });
  });

  it("call 3: travel charged, and it comes out of the credit that is left", () => {
    expect(one(2, 800)).toEqual({ travelFree: false, credit: 550, pays: 0 });
  });

  it("call 4: the credit runs out, and the customer pays the rest", () => {
    expect(one(2, 1350)).toEqual({ travelFree: false, credit: 50, pays: 500 });
  });
});

describe("the plan box says where the invoice stands", () => {
  const t = { plan_id: PLAN, plan: "guard", calls: 2, usedElsewhere: 0, travel: 150 };

  it("in plain words, for each case", () => {
    expect(travelBoxWords({ ...t, waived: 150, choice: "auto" })).toBe(
      "Leak call 1 of 2: the travel on this invoice is not charged.",
    );
    expect(travelBoxWords({ ...t, usedElsewhere: 1, waived: 150, choice: "auto" })).toBe(
      "Leak call 2 of 2: the travel on this invoice is not charged.",
    );
    expect(travelBoxWords({ ...t, waived: 0, choice: "declined" })).toBe(
      "The travel on this invoice is charged. The plan has 2 of 2 leak calls with no travel charge left.",
    );
    expect(travelBoxWords({ ...t, usedElsewhere: 2, waived: 0, choice: null })).toBe(
      "The plan's 2 leak calls with no travel charge are used. The travel on this invoice is charged.",
    );
    expect(travelBoxWords({ ...t, travel: 0, waived: 0, choice: null })).toBe(
      "This invoice has no travel to take off. The plan has 2 of 2 leak calls with no travel charge left.",
    );
    expect(travelStatusWords(2, 1)).toBe(
      "Leak calls with no travel charge: 1 of 2 used this plan year.",
    );
  });

  it("is on the invoice page, with the two answers", () => {
    const page = flat("src/components/service/invoice-editor.tsx");
    expect(page).toContain("{job && travelQ.data && ( <LeakCallBox");
    expect(page).toContain('data-action="leak-call-charge"');
    expect(page).toContain('data-action="leak-call-use"');
    // The line is read-only in the editor, as the credit's is.
    expect(page).toContain("isPlanLine(l) ? (");
  });
});

describe("keeping a repair invoice's plan lines in step", () => {
  const world = (over: { calls?: number; held?: number; choice?: string | null } = {}) => {
    const others = Array.from({ length: over.held ?? 0 }, (_, i) => `other-${i}`);
    return fakeSupabase({
      service_jobs: [{ id: JOB, site_id: SITE, roof_care_visit_id: null }],
      roof_care_plans: [
        {
          id: PLAN,
          plan: "guard",
          site_id: SITE,
          status: "active",
          // Nov 23: a plan pays only toward work done from its first day, so the plan here
          // has the day it was signed, as every real plan does. It had none before.
          signed_on: "2026-01-05",
          free_travel_calls: over.calls ?? 2,
          repair_allowance: 1400,
        },
      ],
      invoices: [
        {
          id: INV,
          service_job_id: JOB,
          bill_to_vendor_id: null,
          status: "draft",
          tax_rate: 0,
          care_travel_choice: over.choice ?? null,
          care_allowance_choice: null,
        },
        ...others.map((id) => ({ id, status: "final" })),
      ],
      invoice_lines: [
        {
          id: 1,
          invoice_id: INV,
          sort: 0,
          kind: "travel",
          source: "time:t1",
          total: 150,
          taxable: false,
        },
        {
          id: 2,
          invoice_id: INV,
          sort: 1,
          kind: "labor",
          source: "time:t2",
          total: 300,
          taxable: false,
        },
        {
          id: 3,
          invoice_id: INV,
          sort: 2,
          kind: "material",
          source: "mat:m1",
          total: 100,
          taxable: true,
        },
        ...others.map((id, i) => ({
          id: 100 + i,
          invoice_id: id,
          sort: 0,
          kind: "other",
          source: travelLineSource(PLAN),
          total: -150,
        })),
      ],
    });
  };
  const run = async (env: ReturnType<typeof world>) => {
    const inv = env.tables["invoices"]![0]! as never;
    const lines = env.tables["invoice_lines"]!.filter((l) => l["invoice_id"] === INV) as never;
    const changed = await syncPlanLines(env.db, inv, lines);
    const mine = env.tables["invoice_lines"]!.filter((l) => l["invoice_id"] === INV);
    return {
      changed,
      travel: mine.filter((l) => isTravelWaiverLine(l as never)).map((l) => Number(l["total"])),
      credit: mine
        .filter((l) => String(l["source"]).startsWith("roof-care-allowance:"))
        .map((l) => Number(l["total"])),
      inv: env.tables["invoices"]![0]!,
    };
  };

  it("first call: the travel comes off, then the credit covers the repair", async () => {
    const r = await run(world());
    expect(r.changed).toBe(true);
    expect(r.travel).toEqual([-150]);
    expect(r.credit).toEqual([-400]);
    expect(r.inv["care_travel_choice"]).toBe("auto");
    expect(r.inv["total"]).toBe(0);
  });

  it("third call: the travel stays charged, and the credit covers it with the repair", async () => {
    const r = await run(world({ held: 2 }));
    expect(r.travel).toEqual([]);
    expect(r.credit).toEqual([-550]);
    expect(r.inv["total"]).toBe(0);
  });

  it("marked as not a leak call: the travel is charged and the call is not used", async () => {
    const r = await run(world({ choice: "declined" }));
    expect(r.travel).toEqual([]);
    expect(r.credit).toEqual([-550]);
    expect(r.inv["care_travel_choice"]).toBe("declined");
  });

  it("a plan with no leak calls takes no travel off", async () => {
    const r = await run(world({ calls: 0 }));
    expect(r.travel).toEqual([]);
    expect(r.credit).toEqual([-550]);
  });

  it("is what every invoice path calls: a new draft, a save and a rebuild", () => {
    const f = flat("src/lib/invoices.functions.ts");
    // Nov 26, 2026: and a draft whose ticket is given another customer or property (three).
    expect(f.match(/syncPlanLines\(sb, /g)).toHaveLength(3);
    expect(f).not.toContain("await syncAllowance(");
    // On the customer's copy: the work, then the leak call's travel, then the credit.
    const pdf = flat("src/lib/invoices.server.ts");
    const work = pdf.indexOf("if (!isPlanLine(row.line)) listLine(row);");
    const travel = pdf.indexOf("if (isTravelWaiverLine(row.line)) listLine(row);");
    const credit = pdf.indexOf("if (isAllowanceLine(row.line)) listLine(row);");
    expect(work).toBeGreaterThan(0);
    expect(travel).toBeGreaterThan(work);
    expect(credit).toBeGreaterThan(travel);
  });
});

describe("the refund when a plan ends early", () => {
  it("reads the database's sum, and nothing that is not one", () => {
    expect(
      readRefundWorked({ paid: 1840, inspections_done: 1, share: 920, repairs: 400, refund: 520 }),
      // Nov 19, later: the two added parts read as nothing from an answer made before them.
    ).toEqual({
      paid: 1840,
      inspections_done: 1,
      storm_counted: 0,
      share: 920,
      repairs: 400,
      travel: 0,
      // (Nov 19, night: the card fee on a refund is its own line; none here.)
      card_fee: 0,
      refund: 520,
      // Nov 26, 2026: the three parts of a corrected roof size read as nothing from an answer
      // made before them.
      size_off: 0,
      size_left: 0,
      size_back: 0,
    });
    expect(readRefundWorked({ paid: 1840 })).toBeNull();
    expect(readRefundWorked(null)).toBeNull();
    expect(readRefundWorked("520")).toBeNull();
  });

  it("is shown a line at a time", () => {
    expect(
      refundLines({
        paid: 1840,
        inspections_done: 1,
        storm_counted: 0,
        share: 920,
        repairs: 400,
        travel: 0,
        card_fee: 0,
        refund: 520,
      }),
    ).toEqual([
      "Paid for the year: $1,840.00",
      "Inspections done: 1 of 2",
      "Share for the inspections not done: $920.00",
      "Minor repairs the plan already covered: $400.00 off",
      "Refund: $520.00",
    ]);
  });

  it("leaves the repairs line out when the plan covered none", () => {
    expect(
      refundLines({
        paid: 1100,
        inspections_done: 0,
        storm_counted: 0,
        share: 1100,
        repairs: 0,
        travel: 0,
        card_fee: 0,
        refund: 1100,
      }),
    ).toEqual([
      "Paid for the year: $1,100.00",
      "Inspections done: 0 of 2",
      "Share for the inspections not done: $1,100.00",
      "Refund: $1,100.00",
    ]);
  });

  it("says so when nothing was paid", () => {
    expect(
      refundLines({
        paid: 0,
        inspections_done: 0,
        storm_counted: 0,
        share: 0,
        repairs: 0,
        travel: 0,
        card_fee: 0,
        refund: 0,
      }),
    ).toEqual(["Nothing was paid for this plan year, so there is nothing to refund."]);
  });

  it("stays on the property until it is marked sent", () => {
    expect(refundStatusWords({ due: 650, sent_on: null, ref: null })).toBe("Refund owed: $650.00.");
    expect(refundStatusWords({ due: 650, sent_on: "2026-11-20", ref: "check 2001" })).toBe(
      "Refund of $650.00 sent Nov 20, 2026 (check 2001).",
    );
    expect(refundStatusWords({ due: 0, sent_on: null, ref: null })).toBe("");
    const card = flat("src/components/roof-care/plan-card.tsx");
    // Nov 20: also shown for a refund a manager changed, so "changed to $0.00" stays in view.
    expect(card).toContain(
      '{plan.status === "ended" && plan.refund && (plan.refund.due > 0 || (plan.refund.changes?.length ?? 0) > 0) && (',
    );
    expect(card).toContain('data-action="roof-care-refund-sent"');
  });

  it("is worked by the database and confirmed by the manager in the End plan box", () => {
    const card = flat("src/components/roof-care/plan-card.tsx");
    expect(card).toContain("{refundLines(worked.data).map((l) => (");
    expect(card).toContain("Refund to confirm (leave blank for the amount above)");
    // The box starts blank, as every number box does.
    expect(card).toContain('const [refundText, setRefundText] = useState("");');
    const f = flat("src/lib/roof-care-plan.functions.ts");
    expect(f).toContain('context.supabase.rpc("roof_care_end_refund", {');
    expect(f).toContain("...(data.refund == null ? {} : { p_refund: data.refund }),");
    // For a reader who does not see invoices the plan carries no refund.
    expect(f).toContain("money && p.refund_due != null");
  });

  it("is listed under Needs attention until it is sent", () => {
    const rows = attentionList({
      today: "2026-11-23",
      now: "2026-11-23T15:00:00Z",
      limits: ATTENTION_DEFAULTS,
      tickets: [],
      untouched: [],
      opps: [],
      bids: [],
      invoices: [],
      followups: [],
      repairFrom: [],
      bidFrom: [],
      names: {},
      careRefunds: [
        {
          plan_id: PLAN,
          site_id: SITE,
          title: "Roof Care · Unit 2 (Made Up Storage Co)",
          ended_on: "2026-11-20",
          amount: 650,
        },
        { plan_id: "none", site_id: SITE, title: "x", ended_on: "2026-11-20", amount: 0 },
      ],
    }).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      key: `care_plan_refund:${PLAN}`,
      group: "office",
      kind: "care_plan_refund",
      tag: "Roof Care",
      why: "The plan was ended Fri, Nov 20 and a refund is owed. Send it, then mark it sent on the property.",
      age: 3,
      amount: 650,
      href: `/properties/${SITE}`,
    });
  });
});

describe("how they pay is said at the sign-up", () => {
  it("is a check or a card, and nothing else", () => {
    expect([...PAY_METHODS]).toEqual(["check", "card"]);
    expect(asPayMethod("check")).toBe("check");
    expect(asPayMethod("card")).toBe("card");
    expect(asPayMethod("cash")).toBeNull();
    expect(asPayMethod(null)).toBeNull();
  });

  it("reads back in plain words, with the check's number when one was handed over", () => {
    expect(payWords("check", "#1042")).toBe("Paying by check (#1042).");
    expect(payWords("check", null)).toBe("Paying by check.");
    expect(payWords("card", "")).toBe("Paying by card.");
    expect(payWords(null, "x")).toBe("");
    expect(PAY_CARD_NOTE).toBe(
      "A card cannot be charged from here yet. The office takes the card and marks the invoice paid.",
    );
  });

  it("has to be picked before the plan can be signed, and goes to the database", () => {
    const card = flat("src/components/roof-care/plan-card.tsx");
    expect(card).toContain("!!payMethod &&");
    expect(card).toContain("pay_method: payMethod!,");
    expect(card).toContain("How they are paying for the year");
    const f = flat("src/lib/roof-care-plan.functions.ts");
    expect(f).toContain("p_pay_method: data.pay_method,");
    expect(f).toContain("pay_method: z.enum(PAY_METHODS, {");
  });

  it("is shown on the waiting plan and in Needs attention", () => {
    const card = flat("src/components/roof-care/plan-card.tsx");
    expect(card).toContain("{payWords(plan.pay_method, plan.pay_note)}");
    const rows = attentionList({
      today: "2026-11-23",
      now: "2026-11-23T15:00:00Z",
      limits: ATTENTION_DEFAULTS,
      tickets: [],
      untouched: [],
      opps: [],
      bids: [],
      invoices: [],
      followups: [],
      repairFrom: [],
      bidFrom: [],
      names: {},
      careUnpaid: [
        {
          plan_id: PLAN,
          site_id: SITE,
          title: "Roof Guard · Unit 2",
          signed_on: "2026-11-20",
          price: 3000,
          invoice: null,
          pay: "Paying by check (#1042).",
        },
      ],
    }).rows;
    expect(rows[0]!.why).toBe(
      "Signed Fri, Nov 20 and not paid, so the plan has not started. Paying by check (#1042). No invoice has been made. Open the property and press Make the invoice.",
    );
  });
});

describe("the database's side", () => {
  const sql = flat("supabase/migrations/20261119700000_roof_care_refund_and_leak_calls.sql");

  it("keeps the plan's leak calls from the price setup at sign-up, for Roof Guard alone", () => {
    expect(sql).toContain(
      "case when p_plan = 'guard' then least(greatest(round(coalesce( nullif(s.data->>'guard_leak_calls', '')::numeric, 0))::integer, 0), 24) else 0 end",
    );
    expect(sql).toContain("raise exception 'Pick how they are paying: by check or by card';");
  });

  it("lets no more invoices carry a leak call than the plan has, and none that adds money", () => {
    expect(sql).toContain("if new.source like 'roof-care-travel:%' then");
    expect(sql).toContain("select count(distinct l.invoice_id) into v_n");
    expect(sql).toContain(
      "where l.source = new.source and i.status <> 'void' and l.invoice_id <> new.invoice_id;",
    );
    expect(sql).toContain("if v_n >= coalesce(v_calls, 0) then");
    expect(sql).toContain(
      "raise exception 'A leak call line takes the travel off the invoice. It cannot add to it.';",
    );
  });

  it("works the refund: the share not done, less the repairs covered, never below nothing", () => {
    expect(sql).toContain("v_share := round(v_paid * (2 - v_done) / 2.0, 2);");
    expect(sql).toContain("'refund', greatest(v_share - v_repairs, 0));");
    expect(sql).toContain("where i.roof_care_plan_id = p_plan and i.status <> 'void';");
    expect(sql).toContain(
      "where l.source = 'roof-care-allowance:' || p_plan::text and i.status <> 'void';",
    );
  });

  it("is found by a call that leaves the amount out: the box left blank (seen in the browser)", () => {
    // The first cut had no default on the amount. The page leaves it out when the box is blank,
    // and the database then answered that it could not find the function at all.
    expect(sql).toContain(
      "create or replace function public.roof_care_end_refund( p_plan uuid, p_reason text, p_refund numeric default null)",
    );
    expect(flat("src/lib/roof-care-plan.functions.ts")).toContain(
      "...(data.refund == null ? {} : { p_refund: data.refund }),",
    );
  });

  it("only a manager ends a plan with its refund, and never for more than was paid", () => {
    const fn = sql.slice(
      sql.indexOf("create or replace function public.roof_care_end_refund("),
      sql.indexOf("create or replace function public.roof_care_refund_sent("),
    );
    expect(fn).toContain("raise exception 'Only a manager ends a Roof Care plan'");
    expect(fn).toContain("if v_amount > (v_worked->>'paid')::numeric then");
    // Worked before the plan ends, because ending removes an unpaid invoice.
    expect(fn.indexOf("v_worked := public.roof_care_refund_worked(p_plan);")).toBeLessThan(
      fn.indexOf("perform public.roof_care_end(p_plan, p_reason);"),
    );
    expect(sql).toContain(
      "revoke all on function public.roof_care_refund_worked(uuid) from public, anon, authenticated;",
    );
  });

  it("holds no number of the office's", () => {
    const file = read("supabase/migrations/20261119700000_roof_care_refund_and_leak_calls.sql");
    expect(file).not.toMatch(/\$\s?\d{2,}/);
    expect(file).not.toMatch(/1,?500|3,?300|15,?000/);
  });
});
