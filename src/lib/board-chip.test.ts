/**
 * The Tech Board card's lines (owner, Oct 13: "more details on the items shown on the calendar
 * week? right now it just has the ticket number and name"). Fails on the old board, whose card
 * showed "#number customer · description" and nothing of the property, type or rate.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  chipDescription,
  chipFacts,
  chipPlace,
  chipTitleLines,
  type ChipJob,
} from "@/lib/board-chip";

const base: ChipJob = {
  number: 6016,
  customer_name: "Bell County",
  site_name: "Courthouse",
  site_address: "101 Courthouse Sq, Pineville, KY 40977",
  site_city: "Pineville",
  site_state: "KY",
  service_type: "leak",
  labor_rate_kind: "standard",
  arrival_window: null,
  description: "Leak over the clerk's office",
};

describe("chipPlace", () => {
  it("site name, then city and state", () => {
    expect(chipPlace(base)).toBe("Courthouse · Pineville, KY");
  });
  it("city and state alone when the property has no name", () => {
    expect(chipPlace({ ...base, site_name: null })).toBe("Pineville, KY");
  });
  it("the street address when neither a name nor a city is known", () => {
    expect(chipPlace({ ...base, site_name: "", site_city: null, site_state: null })).toBe(
      "101 Courthouse Sq, Pineville, KY 40977",
    );
  });
  it("never repeats the customer's name as the property", () => {
    expect(chipPlace({ ...base, site_name: "bell county", site_city: null, site_state: "" })).toBe(
      "101 Courthouse Sq, Pineville, KY 40977",
    );
    expect(chipPlace({ ...base, site_name: "Bell County" })).toBe("Pineville, KY");
  });
  it("null when the ticket has no property at all", () => {
    expect(
      chipPlace({
        ...base,
        site_name: null,
        site_address: null,
        site_city: null,
        site_state: null,
      }),
    ).toBeNull();
  });
});

describe("chipFacts", () => {
  it("the type; Standard says nothing", () => {
    expect(chipFacts(base)).toEqual(["Leak"]);
  });
  it("Urgent and Emergency are called out, with the arrival window last", () => {
    expect(chipFacts({ ...base, labor_rate_kind: "urgent", arrival_window: "morning" })).toEqual([
      "Leak",
      "Urgent",
      "Morning 8–10",
    ]);
    expect(chipFacts({ ...base, service_type: "warranty", labor_rate_kind: "emergency" })).toEqual([
      "Warranty",
      "Emergency",
    ]);
  });
  it("unknown values are skipped, never shown raw", () => {
    expect(
      chipFacts({ ...base, service_type: "zzz", labor_rate_kind: "zzz", arrival_window: "zzz" }),
    ).toEqual([]);
  });
});

describe("chipDescription and the hover text", () => {
  it("the description trimmed, null when blank", () => {
    expect(chipDescription({ ...base, description: "  roof leak  " })).toBe("roof leak");
    expect(chipDescription({ ...base, description: "   " })).toBeNull();
    expect(chipDescription({ ...base, description: null })).toBeNull();
  });
  it("the hover text carries every line the card shows", () => {
    expect(chipTitleLines({ ...base, labor_rate_kind: "urgent" })).toEqual([
      "#6016 Bell County",
      "Courthouse · Pineville, KY",
      "Leak · Urgent",
      "Leak over the clerk's office",
    ]);
  });
});

describe("the Tech Board card uses them", () => {
  const board = readFileSync("src/components/service/board-page.tsx", "utf8");
  it("every chip line comes from board-chip.ts, the description on its own clamped line", () => {
    expect(board).toContain('from "@/lib/board-chip"');
    expect(board).toContain("const place = chipPlace(j);");
    expect(board).toContain("const facts = chipFacts(j);");
    expect(board).toContain("const description = chipDescription(j);");
    expect(board).toContain("{place && <span");
    expect(board).toContain("{facts.length > 0 && (");
    expect(board).toContain("{description && (");
    expect(board).toContain("...chipTitleLines(j)");
    // The old inline "· description" after the customer is gone.
    expect(board).not.toContain('<span className="opacity-80"> · {j.description}</span>');
  });
});
