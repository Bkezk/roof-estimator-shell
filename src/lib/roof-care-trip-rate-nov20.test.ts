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
  tripCharged,
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
    // (Later on Nov 20, the owner: "why is it charging less than it cost?" The line now says
    // the trip is never charged under its cost, where it used to say how far under it was.)
    // (Nov 20, evening, break test 11: each line now ends by saying this round trip is the
    // smallest return trip.)
    expect(tripChargeNote(s)).toBe(
      "A return trip is never charged less than it costs us. For a round trip of 2.5 hours and 120 miles: it costs us $273.00, so it is charged at least that. Leave both boxes blank for that, or type rates here to charge more. This round trip is the smallest return trip: a property nearer than this is charged it too. A property further away is charged its own drive.",
    );
    expect(tripChargeNote({ ...s, trip_charge_per_hour: 100, trip_charge_per_mile: 0.5 })).toBe(
      "For a round trip of 2.5 hours and 120 miles: these two boxes charge $310.00. It costs us $273.00. This round trip is the smallest return trip: a property nearer than this is charged it too. A property further away is charged its own drive.",
    );
    // Rates that come to less than the cost: the cost is charged, and it says so.
    expect(tripChargeNote({ ...s, trip_charge_per_hour: 80, trip_charge_per_mile: null })).toBe(
      "For a round trip of 2.5 hours and 120 miles: these two boxes come to $200.00. It costs us $273.00, so it is charged $273.00. A return trip is never charged less than it costs us. This round trip is the smallest return trip: a property nearer than this is charged it too. A property further away is charged its own drive.",
    );
    // No round trip typed yet: nothing is said.
    expect(tripChargeNote(emptyRoofCareSettings())).toBeNull();
    expect(PAGE).toContain(
      "const tripNote = useMemo(() => tripChargeNote(read.settings), [read]);",
    );
    expect(PAGE).toContain("data-trip-charge-note");
  });
});

describe("a return trip is never charged less than it costs us", () => {
  const FLOOR = flat(
    read("supabase/migrations/20261120400000_roof_care_trip_never_under_cost.sql"),
  );
  it("the higher of what the rates come to and what the trip costs", () => {
    expect(tripCharged(200, 273)).toBe(273);
    expect(tripCharged(310, 273)).toBe(310);
    // One of the two not known: the other. Neither: not known, never nothing.
    expect(tripCharged(null, 273)).toBe(273);
    expect(tripCharged(200, null)).toBe(200);
    expect(tripCharged(null, null)).toBeNull();
    expect(tripCharged(0, 0)).toBeNull();
  });
  it("the database does it, with nothing to type", () => {
    // The cost: the whole crew for the hours, the vehicle for the miles, from the price setup.
    expect(FLOOR).toContain(
      "v_cost := round(v_hours * v_size * v_crew_cost + coalesce(v_miles, 0) * coalesce(v_vehicle, 0), 2);",
    );
    expect(FLOOR).toContain("return nullif(greatest(nullif(v_rate, 0), nullif(v_cost, 0)), 0);");
    // The rates are still the two boxes when typed, else the travel rates.
    expect(FLOOR).toContain("if v_per_hour > 0 or v_per_mile > 0 then");
    expect(FLOOR).toContain(
      "v_rate := round(v_hours * (v_tech + (v_size - 1) * coalesce(v_helper, 0)), 2);",
    );
    // No amount is typed into the repository.
    expect(FLOOR).not.toMatch(/v_cost := \d|v_rate := \d|v_crew_cost := \d/);
  });
});

// (The first rule of the day, kept in its own file. The rule in force is the one above.)
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
