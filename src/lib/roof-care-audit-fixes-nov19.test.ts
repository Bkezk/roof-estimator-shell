/**
 * Fixes after the Nov 18 audit of Roof Care (owner, Nov 19: "2. Fix 3. Fix … 5. Fix … 11 Fix").
 *
 *  11  "X plus Y for the drive" always adds up to the price.
 *   2  One live ticket for an inspection: a restore beside its replacement is refused.
 *   5  Ending a plan takes its untouched tickets off the board, and an ended plan bills nothing by
 *      itself.
 *   3  The saved price is the shown price: roof-care-plan-nov18.test.ts (the sign-up's tests).
 *
 * Every number here is made up. The office's own are not in the repository.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { billsItself, carePlanInvoiceLines, withLineSwitches } from "@/lib/roof-care-invoice";
import {
  AUTHORIZED_BUT,
  authorizedAnyway,
  CARE_PLAN_AUTHORIZE_NOTE,
  carePlanAuthorizedToast,
} from "@/lib/ticket-stage";
import { emptyRoofCareSettings, roofCareQuote, type RoofCareSettings } from "@/lib/roof-care-price";

const read = (p: string) => readFileSync(p, "utf8");
const flat = (s: string) => s.replace(/\s+/g, " ");

/** Made-up numbers with awkward fractions, so the roundings are exercised. */
function settings(over: Partial<RoofCareSettings> = {}): RoofCareSettings {
  return {
    ...emptyRoofCareSettings(),
    crew_cost_per_hour: 37,
    crew_size: 3,
    baseline_drive_hours: 2,
    baseline_miles: 90,
    vehicle_cost_per_mile: 0.675,
    report_cost_per_visit: 20,
    repair_cost_pct: 40,
    allowance_used_pct: 100,
    guard_leak_calls: 2,
    guard_storm_inspections: 1,
    guard_hours_per_leak_call: 2,
    guard_forecast_cost: 10,
    custom_quote_over_sqft: 90000,
    plans: {
      watch: { base: 410, per_sqft: 0.017, allowance: null },
      care: { base: 730, per_sqft: 0.043, allowance: 300 },
      guard: { base: 1290, per_sqft: 0.081, allowance: 900 },
    },
    hours: [
      { sqft: 10000, inspection: 1, drains: 1, gutters: 1 },
      { sqft: 90000, inspection: 5, drains: 3, gutters: 2 },
    ],
    ...over,
  } as RoofCareSettings;
}

describe("11. the list price and the drive's share add up to the price", () => {
  it("for every roof and drive tried, on all three plans", () => {
    const s = settings();
    let cases = 0;
    const off: string[] = [];
    for (const sqft of [1, 777, 12345, 33333, 50001, 89999])
      for (const hours of [1, 2, 2.01, 2.5, 3.33, 6.33, 8.5, 20])
        for (const miles of [50, 90, 90.1, 127.6, 311.7, 423.4, 1002]) {
          const r = roofCareQuote(s, { sqft, drive: { hours, miles } });
          expect(r.quote, `${sqft} ${hours} ${miles}`).not.toBeNull();
          for (const p of r.quote!.plans) {
            cases++;
            if (p.list + p.travel !== p.price) off.push(`${sqft}/${hours}/${miles}/${p.plan}`);
            expect(p.travel).toBeGreaterThanOrEqual(0);
            // Nov 20: the two halves per visit are gone (a plan is paid for the year up front).
            expect(Number.isInteger(p.price)).toBe(true);
          }
        }
    expect(cases).toBe(6 * 8 * 7 * 3);
    expect(off).toEqual([]);
  });
  it("a drive inside the list price's round trip still adds nothing", () => {
    const r = roofCareQuote(settings(), { sqft: 12345, drive: { hours: 1.5, miles: 60 } });
    for (const p of r.quote!.plans) {
      expect(p.travel).toBe(0);
      expect(p.price).toBe(p.list);
    }
  });
  it("half a cent on a trip goes up, as the database rounds it", () => {
    // 0.5 mile over at 0.57 a mile is 0.285: held in binary as 0.28499…, it used to round down
    // to 0.28 here and up to 0.29 in the database.
    const s = settings({ vehicle_cost_per_mile: 0.57, baseline_miles: 100 });
    const near = roofCareQuote(s, { sqft: 10000, drive: { hours: 2, miles: 100.5 } });
    const base = roofCareQuote(s, { sqft: 10000, drive: { hours: 2, miles: 100 } });
    // Two trips of 0.29 on Roof Watch: 0.58 over the list price, before the whole-dollar round.
    expect(near.quote!.beyond_baseline).toBe(true);
    expect(near.quote!.plans[0]!.price).toBe(Math.round(410 + 0.017 * 10000 + 0.58));
    expect(base.quote!.plans[0]!.price).toBe(Math.round(410 + 0.017 * 10000));
    const src = read("src/lib/roof-care-price.ts");
    expect(src).toContain("Math.round(Number((n * 100).toFixed(6))) / 100;");
  });
  it("the database says the same: the drive's share is the price less the list price", () => {
    const sql = flat(read("supabase/migrations/20261119100000_roof_care_audit_fixes.sql"));
    expect(sql).toContain("$a$'travel', v_price - round(v_list)$a$");
    expect(flat(read("src/lib/roof-care-price.ts"))).toContain("travel: price - dollars(list),");
  });
});

describe("2. one live ticket for an inspection", () => {
  const sql = flat(read("supabase/migrations/20261119100000_roof_care_audit_fixes.sql"));
  it("the database holds it with a unique index over tickets that are not deleted", () => {
    expect(sql).toContain(
      "create unique index if not exists service_jobs_one_per_care_visit on public.service_jobs (roof_care_visit_id) where roof_care_visit_id is not null and deleted_at is null;",
    );
  });
  it("restoring a deleted ticket beside the one made in its place is refused in words", () => {
    expect(sql).toContain("old.deleted_at is not null and new.deleted_at is null");
    expect(sql).toContain(
      "raise exception 'This care plan inspection already has ticket #%. This one stays deleted.', v_other;",
    );
    // The rule now runs when a ticket is deleted or restored, not only when it is dated.
    expect(sql).toContain(
      "before insert or update of scheduled_date, roof_care_visit_id, deleted_at on public.service_jobs",
    );
  });
  it("the morning check steps over an inspection another run has just ticketed", () => {
    expect(sql).toContain("on conflict do nothing");
  });
});

describe("5. ending a plan", () => {
  const sql = flat(read("supabase/migrations/20261119100000_roof_care_audit_fixes.sql"));
  it("takes its untouched inspection tickets off the board, and leaves started ones", () => {
    expect(sql).toContain("set deleted_at = now(), updated_by_name = v_name");
    expect(sql).toContain("and sj.stage in ('open', 'scheduled')");
    expect(sql).toContain(
      "and sj.en_route_at is null and sj.on_site_at is null and sj.completed_at is null and sj.invoice_id is null",
    );
    expect(sql).toContain("'Taken off the board: the Roof Care plan was ended. Reason: '");
  });
  it("is still a manager's, with a reason", () => {
    expect(sql).toContain("raise exception 'Only a manager ends a Roof Care plan'");
    expect(sql).toContain("raise exception 'Type why the plan is ending';");
    expect(sql).toContain(
      "revoke all on function public.roof_care_end(uuid, text) from public, anon;",
    );
  });
  it("an ended plan's inspection is not invoiced by itself", () => {
    const visit = { id: "v", kind: "visit1", amount: 500, plan: "care" };
    expect(billsItself(visit)).toBe(true);
    expect(billsItself({ ...visit, ended: true })).toBe(false);
    expect(billsItself(null)).toBe(false);
    const fn = flat(read("src/lib/invoices.functions.ts"));
    expect(fn).toContain("if (!billsItself(visit)) return false;");
    expect(flat(read("src/lib/invoices.server.ts"))).toContain('ended: p?.status === "ended",');
  });
  it("a storm inspection gets its invoice for nothing, so its cost is counted", () => {
    // It bills 0, so it used to get no invoice and what the trip cost was counted nowhere.
    expect(billsItself({ id: "v", kind: "storm", amount: 0, plan: "guard" })).toBe(true);
    expect(billsItself({ id: "v", kind: "storm", amount: 0, plan: "guard", ended: true })).toBe(
      false,
    );
    // A visit with nothing to bill is not a storm inspection: no invoice.
    expect(billsItself({ id: "v", kind: "visit2", amount: 0, plan: "watch" })).toBe(false);
  });
  it("the screen says what happened to the tickets", () => {
    expect(read("src/components/roof-care/plan-card.tsx")).toContain(
      "Plan ended. Its inspection tickets not yet started were taken off the board.",
    );
  });
});

/**
 * The live test of the automatic invoice (owner, Nov 19: "You can run a test automatic
 * invoice"). A care plan inspection with time on it was authorized: the invoice was made with
 * its total and no lines, and the server answered
 *   null value in column "rate_overridden" of relation "invoice_lines" violates not-null constraint
 * The plan's own line and the ticket's lines named different columns. Rows saved in one request
 * must name the same ones: a column a row leaves out is saved as nothing, not as its default.
 */
describe("the invoice of a care plan inspection with time on the ticket", () => {
  // What the builder makes for a time entry and a material: no switch named.
  const labor = {
    sort: 0,
    kind: "labor",
    description: "Labor",
    qty: 2,
    unit: "hr",
    rate: 85,
    total: 170,
    cost_rate: 40,
    cost_total: 80,
    on_date: "2026-11-18",
    source: "time:labor:lead",
    taxable: false,
  };
  const material = { ...labor, sort: 1, kind: "material", source: "cell:a|b|c", taxable: true };
  const visit = { id: "v", kind: "visit1", amount: 600, plan: "care" };
  const columns = (row: object) => Object.keys(row).sort().join(",");

  it("every line names the same columns, the three switches among them", () => {
    const lines = carePlanInvoiceLines([labor, material], visit);
    expect(lines).toHaveLength(3);
    expect(new Set(lines.map(columns)).size).toBe(1);
    for (const l of lines) {
      expect(typeof l.rate_overridden).toBe("boolean");
      expect(typeof l.show_on_invoice).toBe("boolean");
      expect(typeof l.hide_price).toBe("boolean");
    }
  });
  it("the plan's line is listed and priced by the plan; the ticket's lines are covered", () => {
    const [own, time, mat] = carePlanInvoiceLines([labor, material], visit);
    expect(own).toMatchObject({ total: 600, rate_overridden: false, show_on_invoice: true });
    expect(time).toMatchObject({ total: 0, cost_total: 80, rate_overridden: true });
    expect(time!.show_on_invoice).toBe(false);
    expect(mat).toMatchObject({ total: 0, cost_total: 80, taxable: false });
  });
  it("a switch a line already carries is kept", () => {
    expect(withLineSwitches({ show_on_invoice: true, hide_price: true })).toEqual({
      rate_overridden: false,
      show_on_invoice: true,
      hide_price: true,
    });
    expect(withLineSwitches({ kind: "labor" })).toEqual({
      kind: "labor",
      rate_overridden: false,
      show_on_invoice: false,
      hide_price: false,
    });
  });
  it("the first save names them on every line, and a failed save leaves no empty invoice", () => {
    const fn = flat(read("src/lib/invoices.functions.ts"));
    expect(fn).toContain(
      ".insert(lines.map((l) => ({ ...withLineSwitches(l), invoice_id: inv.id })));",
    );
    expect(fn).toContain(
      'const { error: dErr } = await sb.from("invoices").delete().eq("id", inv.id);',
    );
  });
});

describe("authorizing a care plan inspection says what happens", () => {
  it("the card says the invoice is made at that press", () => {
    expect(CARE_PLAN_AUTHORIZE_NOTE).toContain("its draft invoice is made by itself");
    expect(CARE_PLAN_AUTHORIZE_NOTE).not.toContain("Nothing is invoiced");
    expect(carePlanAuthorizedToast(6012)).toBe(
      "Inspection #6012 authorized. Its draft invoice is on the ticket.",
    );
    const card = flat(read("src/components/service/invoice-block.tsx"));
    expect(card).toContain("{carePlan ? CARE_PLAN_AUTHORIZE_NOTE : signOff");
    expect(card).not.toContain("is included in the plan and is not invoiced");
  });
  it("authorized with the invoice not made: the words are shown whole and the ticket is read again", () => {
    const said = `${AUTHORIZED_BUT} the invoice for this care plan inspection was not made (x). Open the ticket and press Invoice this care plan inspection.`;
    expect(authorizedAnyway(new Error(said))).toBe(said);
    expect(authorizedAnyway(new Error(`Server error: ${said}`))).toBe(said);
    expect(authorizedAnyway(new Error("Ticket not found"))).toBeNull();
    expect(authorizedAnyway(null)).toBeNull();
    const card = flat(read("src/components/service/invoice-block.tsx"));
    expect(card).toContain("const anyway = authorizedAnyway(e); if (anyway) { reread();");
    expect(flat(read("src/lib/service.functions.ts"))).toContain(
      "`${AUTHORIZED_BUT} the invoice for this care plan inspection was not made (",
    );
  });
});
