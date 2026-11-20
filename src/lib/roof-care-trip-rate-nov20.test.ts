/**
 * Roof Care: a trip rate of the plan's own for a return trip (owner, Nov 20: "2. go";
 * docs/qa/roof-care-trip-rate-2026-11-20.md).
 *
 * Before this a return trip was charged the hours of the round trip at the Service rates page's
 * travel rates, which count no miles, and came out under what the trip costs us.
 *
 * THE NUMBERS HERE ARE MADE UP: they match no plan price and no rate of the office.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { draftFrom, settingsFromDraft } from "@/lib/roof-care-form";
import {
  asRoofCareSettings,
  emptyRoofCareSettings,
  SETTING_LABELS,
  settingsProblems,
  tripChargeNote,
  tripCostAndCharge,
} from "@/lib/roof-care-price";

const read = (p: string) => readFileSync(p, "utf8");
const flat = (s: string) => s.replace(/\s+/g, " ");
const SQL = flat(read("supabase/migrations/20261120300000_roof_care_trip_rate.sql"));
const PAGE = flat(read("src/components/roof-care-settings.tsx"));

// A crew of 3 at 30 an hour each, the vehicle at 0.4 a mile.
const costs = { crew_cost_per_hour: 30, crew_size: 3, vehicle_cost_per_mile: 0.4 };
const drive = { hours: 2.5, miles: 120 };

describe("what a return trip costs us and what it is charged", () => {
  it("the cost is the whole crew for the hours and the vehicle for the miles", () => {
    const r = tripCostAndCharge(
      { ...costs, trip_charge_per_hour: null, trip_charge_per_mile: null },
      drive,
    );
    // 2.5 hours x 3 people x 30, and 120 miles x 0.4
    expect(r.cost).toBe(273);
    // Both boxes blank: the travel rates are used, and that amount is the database's to work.
    expect(r.charge).toBeNull();
  });
  it("the two boxes charge the hours and the miles of the round trip", () => {
    const s = { ...costs, trip_charge_per_hour: 100, trip_charge_per_mile: 0.5 };
    // 2.5 x 100 and 120 x 0.5
    expect(tripCostAndCharge(s, drive).charge).toBe(310);
    // One box alone is enough.
    expect(tripCostAndCharge({ ...s, trip_charge_per_mile: null }, drive).charge).toBe(250);
    expect(tripCostAndCharge({ ...s, trip_charge_per_hour: null }, drive).charge).toBe(60);
    // A 0 is a blank, never a charge of nothing.
    expect(
      tripCostAndCharge({ ...s, trip_charge_per_hour: 0, trip_charge_per_mile: 0 }, drive).charge,
    ).toBeNull();
  });
  it("the cost is not guessed while a number it needs is blank", () => {
    expect(
      tripCostAndCharge(
        { ...costs, crew_size: null, trip_charge_per_hour: 100, trip_charge_per_mile: null },
        drive,
      ),
    ).toEqual({ cost: null, charge: 250 });
  });
});

describe("the price setup page", () => {
  it("has the two boxes, blank until typed, and they are not needed for a price", () => {
    expect(SETTING_LABELS.trip_charge_per_hour).toBe(
      "Return trip charge per hour of the round trip, whole crew ($)",
    );
    expect(SETTING_LABELS.trip_charge_per_mile).toBe("Return trip charge per mile ($)");
    const blank = emptyRoofCareSettings();
    expect(blank.trip_charge_per_hour).toBeNull();
    expect(draftFrom(blank).values.trip_charge_per_hour).toBe("");
    expect(settingsProblems(blank).join(" ")).not.toContain("Return trip");
    expect(PAGE).toContain('keys: ["trip_charge_per_hour", "trip_charge_per_mile"],');
  });
  it("a typed rate is kept, and settings saved before the boxes existed still read", () => {
    const d = draftFrom(emptyRoofCareSettings());
    d.values.trip_charge_per_hour = "100";
    d.values.trip_charge_per_mile = "0.5";
    expect(settingsFromDraft(d).settings).toMatchObject({
      trip_charge_per_hour: 100,
      trip_charge_per_mile: 0.5,
    });
    const old = asRoofCareSettings({ crew_size: 3 });
    expect(old.crew_size).toBe(3);
    expect(old.trip_charge_per_hour ?? null).toBeNull();
  });
  it("says under the boxes what the list price's round trip costs us and is charged", () => {
    const s = {
      ...emptyRoofCareSettings(),
      ...costs,
      baseline_drive_hours: 2.5,
      baseline_miles: 120,
    };
    expect(tripChargeNote(s)).toBe(
      "Both blank: a return trip is charged at the travel rates on the Service rates page. For a round trip of 2.5 hours and 120 miles: It costs us $273.00.",
    );
    expect(tripChargeNote({ ...s, trip_charge_per_hour: 100, trip_charge_per_mile: 0.5 })).toBe(
      "For a round trip of 2.5 hours and 120 miles: these two boxes charge $310.00. It costs us $273.00.",
    );
    // Charged under the cost: it says by how much.
    expect(tripChargeNote({ ...s, trip_charge_per_hour: 80, trip_charge_per_mile: null })).toBe(
      "For a round trip of 2.5 hours and 120 miles: these two boxes charge $200.00. It costs us $273.00. That is $73.00 under what it costs us.",
    );
    // No round trip typed yet: nothing is said.
    expect(tripChargeNote(emptyRoofCareSettings())).toBeNull();
    expect(PAGE).toContain(
      "const tripNote = useMemo(() => tripChargeNote(read.settings), [read]);",
    );
    expect(PAGE).toContain("data-trip-charge-note");
  });
});

describe("the database works the charge", () => {
  it("from the plan's own round trip at the two rates, when either is typed", () => {
    expect(SQL).toContain("if v_per_hour > 0 or v_per_mile > 0 then");
    expect(SQL).toContain(
      "v_out := round(coalesce(v_hours, 0) * v_per_hour + coalesce(v_miles, 0) * v_per_mile, 2);",
    );
    expect(SQL).toContain("coalesce(p.drive_miles, nullif(d->>'baseline_miles', '')::numeric)");
  });
  it("never as nothing, and from the travel rates when both are blank", () => {
    expect(SQL).toContain("return case when v_out > 0 then v_out end;");
    expect(SQL).toContain(
      "return round(v_hours * (v_tech + (v_size - 1) * coalesce(v_helper, 0)), 2);",
    );
    // No rate is typed into the repository.
    expect(SQL).not.toMatch(/v_per_hour := \d|v_per_mile := \d/);
  });
});
