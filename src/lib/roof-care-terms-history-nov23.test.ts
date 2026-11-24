/**
 * Nov 23, the owner: "2 go". Every set of Roof Care terms that was ever in use is kept on file
 * under its version, so a plan signed under older terms can still be emailed the words it
 * agreed to. Until now only the set in use was kept, and an older plan's agreement was held
 * with "an older set that cannot be emailed from here".
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { agreementEmail, TERMS_BY_VERSION, type PlanEmailFacts } from "@/lib/roof-care-email";
import { ROOF_CARE_TERMS, ROOF_CARE_TERMS_VERSION } from "@/lib/roof-care-plan";
import { ROOF_CARE_TERMS_PAST } from "@/lib/roof-care-terms-history";

const mark = (terms: readonly string[]) =>
  createHash("sha256").update(JSON.stringify(terms)).digest("hex").slice(0, 16);

/**
 * Every version that has been in use, oldest first, with the fingerprint of its words. The last
 * one is the set in use now.
 *
 * WHEN THIS TEST FAILS because the terms were changed: do not edit a line here. Copy the set
 * that was in use into roof-care-terms-history.ts under its version, give the new set a new
 * version in roof-care-plan.ts, and add one line at the end of this list for the new set.
 */
const EVERY_VERSION: readonly [string, string][] = [
  ["2026-11-18", mark(ROOF_CARE_TERMS_PAST["2026-11-18"] ?? [])],
  ["2026-11-19", mark(ROOF_CARE_TERMS_PAST["2026-11-19"] ?? [])],
  ["2026-11-19.2", mark(ROOF_CARE_TERMS_PAST["2026-11-19.2"] ?? [])],
  ["2026-11-19.3", mark(ROOF_CARE_TERMS_PAST["2026-11-19.3"] ?? [])],
  ["2026-11-19.4", mark(ROOF_CARE_TERMS_PAST["2026-11-19.4"] ?? [])],
  ["2026-11-20.1", mark(ROOF_CARE_TERMS_PAST["2026-11-20.1"] ?? [])],
  ["2026-11-23.1", mark(ROOF_CARE_TERMS_PAST["2026-11-23.1"] ?? [])],
  ["2026-11-24.1", "4696c80dfb0d5de4"],
];

const facts = (terms_version: string): PlanEmailFacts => ({
  plan: "guard",
  plan_number: 1004,
  site: "Main plant",
  address: "120 Mill St, London, KY 40741",
  agreed_by: "Pat Smith",
  signed_on: "2026-11-21",
  price: 2222,
  pay_method: "check",
  first_visit: "window",
  first_days: null,
  terms_version,
  benefits: null,
  company: "JBK Roofing",
  contact: "888-555-0100",
});

describe("every set of terms that was in use is kept", () => {
  it("the set in use has the version and the words this test knows", () => {
    const last = EVERY_VERSION[EVERY_VERSION.length - 1]!;
    // Changed words under the same version would rewrite what earlier customers agreed to.
    expect([ROOF_CARE_TERMS_VERSION, mark(ROOF_CARE_TERMS)]).toEqual(last);
  });
  it("the Nov 23 set was filed word for word when the Nov 24 set took its place", () => {
    // Its fingerprint as this test knew it while it was the set in use.
    expect(mark(ROOF_CARE_TERMS_PAST["2026-11-23.1"] ?? [])).toBe("733b0dca9d3ea3f0");
    // Nov 24 (owner: "the shorter version looks fine"): the last term alone changed.
    const before = ROOF_CARE_TERMS_PAST["2026-11-23.1"]!;
    expect(ROOF_CARE_TERMS.slice(0, -1)).toEqual(before.slice(0, -1));
    expect(before[before.length - 1]).toBe(
      "The plan is not a warranty and does not cover replacing the roof.",
    );
    expect(ROOF_CARE_TERMS[ROOF_CARE_TERMS.length - 1]).toBe(
      "The plan is not a warranty or insurance and does not cover replacing the roof. An inspection is a visual check on the day of the visit and cannot find every problem. We are not responsible for leaks or for damage from a leak or from a condition we did not find.",
    );
  });
  it("each earlier version is on file, with words, and none has been dropped", () => {
    const past = EVERY_VERSION.slice(0, -1).map(([v]) => v);
    expect(Object.keys(ROOF_CARE_TERMS_PAST)).toEqual(past);
    for (const v of past) {
      expect(ROOF_CARE_TERMS_PAST[v]!.length, v).toBeGreaterThanOrEqual(10);
      for (const line of ROOF_CARE_TERMS_PAST[v]!)
        expect(line.trim().length, v).toBeGreaterThan(20);
    }
    // The set in use is not also filed as a past one.
    expect(ROOF_CARE_TERMS_PAST[ROOF_CARE_TERMS_VERSION]).toBeUndefined();
  });
  it("an earlier set keeps its own words: the Nov 20 set does not carry the Nov 23 sentence", () => {
    const nov23 = "Work done before the plan starts is not covered.";
    expect(ROOF_CARE_TERMS.join(" ")).toContain(nov23);
    expect(ROOF_CARE_TERMS_PAST["2026-11-20.1"]!.join(" ")).not.toContain(nov23);
    expect(ROOF_CARE_TERMS_PAST["2026-11-18"]!).toHaveLength(10);
    expect(ROOF_CARE_TERMS_PAST["2026-11-20.1"]!).toHaveLength(11);
  });
  it("every version can be emailed, each with the words it had", () => {
    for (const [v] of EVERY_VERSION) {
      expect(TERMS_BY_VERSION[v], v).toBeDefined();
      const mail = agreementEmail(facts(v));
      expect(mail, v).not.toBeNull();
      expect(mail!.text, v).toContain(`Terms version ${v}.`);
      for (const line of TERMS_BY_VERSION[v]!) expect(mail!.text, v).toContain(line);
    }
    expect(TERMS_BY_VERSION[ROOF_CARE_TERMS_VERSION]).toBe(ROOF_CARE_TERMS);
    // An older plan's agreement prints its own term 3, not today's.
    expect(agreementEmail(facts("2026-11-20.1"))!.text).not.toContain(
      "Work done before the plan starts is not covered.",
    );
  });
  it("a version nobody ever used is still not emailed", () => {
    expect(agreementEmail(facts("2025-01-01"))).toBeNull();
    expect(agreementEmail(facts(""))).toBeNull();
  });
});
