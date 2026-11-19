/**
 * Roof Care: three rules the owner agreed on Nov 19 after the numbers showed where a plan lost
 * money ("we need some rules so the worst case on roof guard … doesnt happen"; docs/roof-care-
 * plans.md, docs/qa/roof-care-credit-2026-11-19.md).
 *
 *  1. "go for 1": an inspection we did not get to takes the price of ONE INSPECTION off the
 *     renewal, half of what Roof Watch costs for that roof and drive. It was half of the plan's
 *     own price, which on a larger plan gave back far more than the inspection was worth.
 *  2. "2. go for this. Just ensure it makes it into the service agreement": a refund also takes
 *     off the leak call travel that was not charged, and a storm inspection counts as an
 *     inspection done.
 *  3. "do we ever have the ability to dismiss that? say its owed and been 6 months and they
 *     just dont seem interested": a manager closes out an expired plan.
 *
 * THE NUMBERS HERE ARE MADE UP.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));

import {
  closedOutWords,
  readRefundWorked,
  refundLines,
  renewalChoiceWords,
  ROOF_CARE_TERMS,
  ROOF_CARE_TERMS_VERSION,
} from "@/lib/roof-care-plan";
import { closeOutRoofCarePlan } from "@/lib/roof-care-plan.functions";
import { fakeSupabase } from "@/test/fake-supabase";

const read = (p: string) => readFileSync(p, "utf8");
const flat = (p: string) => read(p).replace(/\s+/g, " ");
const SQL = flat("supabase/migrations/20261119950000_roof_care_inspection_credit.sql");

const ADMIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PLAN = "33333333-3333-4333-8333-333333333331";

describe("1. the price of one inspection comes off the renewal, not half the plan", () => {
  it("is half of Roof Watch for that roof and drive, and never more than the plan", () => {
    expect(SQL).toContain(
      "select (e->>''price'')::numeric into v_watch from jsonb_array_elements(v_price->''plans'') e where e->>''plan'' = ''watch'';",
    );
    expect(SQL).toContain(
      "b3 text := ' v_credit := least(v_amount, round(v_watch * least(v_n, 2) / 2.0, 2));';",
    );
    // The Renew box shows the same sum.
    expect(SQL).toContain(
      "b5 text := ' ''credit_if_half_off'', least(v_amount, round(v_watch * least(v_n, 2) / 2.0, 2)),';",
    );
    // The old sum is what is replaced, and a function that is not as expected stops the change.
    expect(SQL).toContain("a3 text := ' v_credit := round(v_amount * least(v_n, 2) / 2.0, 2);';");
    expect(SQL).toContain("raise exception '%roof_care_renew', wrong;");
  });

  it("the Renew box says it is the price of one inspection, or of two", () => {
    const offer = {
      price: 3000,
      credit_if_half_off: 500,
      carried_until: "2028-03-10",
      owed: [
        {
          kind: "visit2" as const,
          due_by: "2027-12-20",
          push_reason: null,
          customer_asked: false,
          late: true,
        },
      ],
    };
    expect(renewalChoiceWords("half_off", offer)).toBe(
      "We did not get there. Take $500.00 off the renewal, the price of one inspection: the customer pays $2,500.00. The inspection is dropped.",
    );
    const both = {
      ...offer,
      credit_if_half_off: 1000,
      owed: [offer.owed[0]!, { ...offer.owed[0]!, kind: "visit1" as const }],
    };
    expect(renewalChoiceWords("half_off", both)).toBe(
      "We did not get there. Take $1,000.00 off the renewal, the price of two inspections: the customer pays $2,000.00. The inspections are dropped.",
    );
  });
});

describe("2. the refund counts the leak call travel and the storm inspection", () => {
  it("the database takes the travel not charged off, and counts a storm inspection as one done", () => {
    expect(SQL).toContain(
      "where l.source = 'roof-care-travel:' || p_plan::text and i.status <> 'void';",
    );
    expect(SQL).toContain("v_storm := least(v_storm, greatest(2 - v_done, 0));");
    expect(SQL).toContain("v_done := least(v_done + v_storm, 2);");
    expect(SQL).toContain("'refund', greatest(v_share - v_repairs - v_travel, 0));");
  });

  it("the End plan box shows both", () => {
    const worked = readRefundWorked({
      paid: 3000,
      inspections_done: 1,
      storm_counted: 1,
      share: 1500,
      repairs: 400,
      travel: 150,
      refund: 950,
    })!;
    expect(worked).toMatchObject({ storm_counted: 1, travel: 150 });
    expect(refundLines(worked)).toEqual([
      "Paid for the year: $3,000.00",
      "Inspections done: 1 of 2 (a storm inspection counts as one)",
      "Share for the inspections not done: $1,500.00",
      "Minor repairs the plan already covered: $400.00 off",
      "Leak call travel that was not charged: $150.00 off",
      "Refund: $950.00",
    ]);
  });

  it("an answer made before the two were added still reads", () => {
    expect(
      readRefundWorked({ paid: 100, inspections_done: 0, share: 100, repairs: 0, refund: 100 }),
    ).toMatchObject({ storm_counted: 0, travel: 0 });
  });
});

describe('the agreement says both (owner: "ensure it makes it into the service agreement")', () => {
  it("is a new version of eleven terms", () => {
    expect(ROOF_CARE_TERMS_VERSION).toBe("2026-11-19.2");
    expect(ROOF_CARE_TERMS).toHaveLength(11);
    expect(ROOF_CARE_TERMS.join(" ")).not.toMatch(/\$\s?\d/);
  });

  it("the refund term names the leak call travel and the storm inspection", () => {
    expect(ROOF_CARE_TERMS[8]).toContain("and any leak call travel we did not charge.");
    expect(ROOF_CARE_TERMS[8]).toContain("A storm inspection counts as an inspection done.");
  });

  it("a new term says the plan ends after its year, and what happens with an inspection not done", () => {
    expect(ROOF_CARE_TERMS[9]).toBe(
      "The plan ends after its twelve months unless it is renewed. If an inspection was not done by then because we could not get there, the price of one inspection is taken off the renewal. If it was not done because we were not given access, it can still be done in the first 60 days of the new plan year.",
    );
    // Not "half": that was the rule the numbers argued against.
    expect(ROOF_CARE_TERMS[9]).not.toMatch(/half/i);
  });
});

describe("3. closing out an expired plan that will not be renewed", () => {
  it("is a manager's, needs a reason, and drops what was still owed", () => {
    expect(SQL).toContain("raise exception 'Only a manager closes out a Roof Care plan'");
    expect(SQL).toContain("raise exception 'Type why it is closed out';");
    expect(SQL).toContain(
      "where id = p_plan and status = 'ended' and ended_reason = 'Expired' and closed_out_on is null;",
    );
    expect(SQL).toContain(
      "raise exception 'This plan has a renewal waiting to be paid. Cancel the renewal first.';",
    );
    // An inspection that is done, or that somebody has started, is left alone.
    expect(SQL).toContain(
      "and (j.stage not in ('open', 'scheduled') or j.en_route_at is not null or j.on_site_at is not null or j.completed_at is not null))",
    );
    expect(SQL).toContain(
      "'Taken off the board: the Roof Care plan expired and was closed out. Reason: ' || trim(p_reason),",
    );
  });

  it("the server asks the database with the reason, and says how many were dropped", async () => {
    const env = fakeSupabase(
      {
        profiles: [{ id: ADMIN, role: "admin", access: [], full_name: "Ann Admin", email: "a@x" }],
      },
      { rpcs: { roof_care_close_out: () => 1 } },
    );
    const call = (data: unknown) =>
      (
        closeOutRoofCarePlan as unknown as (a: {
          data: unknown;
          context: unknown;
        }) => Promise<unknown>
      )({
        data,
        context: { supabase: env.db, userId: ADMIN },
      });
    expect(await call({ plan_id: PLAN, reason: "  Six months on, not interested  " })).toEqual({
      ok: true,
      dropped: 1,
    });
    expect(env.rpcCalls[0]).toEqual({
      fn: "roof_care_close_out",
      args: { p_plan: PLAN, p_reason: "Six months on, not interested" },
    });
    expect(() => call({ plan_id: PLAN, reason: "   " })).toThrow("Type why it is closed out");
  });

  it("the property says so, and offers it to a manager on an expired plan only", () => {
    expect(closedOutWords({ on: "2028-06-03", reason: "Not interested." })).toBe(
      "Closed out Jun 3, 2028: Not interested. What was still owed was dropped.",
    );
    const card = flat("src/components/roof-care/plan-card.tsx");
    expect(card).toContain("{manager && !expired.closed_out && (");
    expect(card).toContain('data-action="roof-care-close-out"');
    expect(card).toContain("data-roof-care-closed-out");
  });

  it("it leaves the Needs attention list", () => {
    expect(flat("src/lib/owner-attention.functions.ts")).toContain(
      "(p) => isExpired(p) && !p.closed_out && !live.some((x) => x.site_id === p.site_id)",
    );
  });

  it("the database types know it", () => {
    const t = flat("src/integrations/supabase/types.ts");
    expect(t).toContain(
      "roof_care_close_out: { Args: { p_plan: string; p_reason: string } Returns: number }",
    );
    expect(t).toContain("closed_out_on: string | null");
  });
});
