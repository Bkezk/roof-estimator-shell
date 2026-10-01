import { describe, expect, it } from "vitest";

import {
  confirmedCrew,
  crewQuestionPending,
  defaultBillRate,
  effectiveBillRate,
  helperCountFor,
  parseRateText,
  planCrew,
  releadCrew,
} from "@/lib/service-crew";

const A = "a";
const B = "b";
const C = "c";
const TABLE = { tech: 85, helper: 55 };

describe("service crew rows", () => {
  it("puts the lead at sort 0 and the others after, dropping repeats and blanks", () => {
    expect(
      planCrew(A, 90, [
        { technician_id: B, bill_rate: 60 },
        { technician_id: A },
        { technician_id: "" },
        { technician_id: C, bill_rate: null },
        { technician_id: B, bill_rate: 99 },
      ]),
    ).toEqual([
      { technician_id: A, sort: 0, bill_rate: 90 },
      { technician_id: B, sort: 1, bill_rate: 60 },
      { technician_id: C, sort: 2, bill_rate: null },
    ]);
  });

  it("numbers the others from 1 when there is no lead", () => {
    expect(planCrew(null, null, [{ technician_id: B }, { technician_id: C }])).toEqual([
      { technician_id: B, sort: 1, bill_rate: null },
      { technician_id: C, sort: 2, bill_rate: null },
    ]);
  });

  it("keeps row 0 mirroring the ticket's technician when the lead changes", () => {
    const rows = planCrew(A, 90, [
      { technician_id: B, bill_rate: 60 },
      { technician_id: C, bill_rate: null },
    ]);
    // B becomes the lead (from the board): A leaves, B keeps its rate, C stays.
    expect(releadCrew(rows, B)).toEqual([
      { technician_id: B, sort: 0, bill_rate: 60 },
      { technician_id: C, sort: 1, bill_rate: null },
    ]);
    // Same lead: unchanged.
    expect(releadCrew(rows, A)).toEqual(rows);
    // Unassigned: the lead row goes, the others stay.
    expect(releadCrew(rows, null)).toEqual([
      { technician_id: B, sort: 1, bill_rate: 60 },
      { technician_id: C, sort: 2, bill_rate: null },
    ]);
    // An old-style ticket (no rows) stays old-style.
    expect(releadCrew([], B)).toEqual([]);
  });

  it("writes the technician's answer: alone keeps just the lead, picks keep known rates", () => {
    const rows = planCrew(A, 90, [{ technician_id: B, bill_rate: 60 }]);
    expect(confirmedCrew(rows, A, [])).toEqual([{ technician_id: A, sort: 0, bill_rate: 90 }]);
    expect(confirmedCrew(rows, A, [C, B])).toEqual([
      { technician_id: A, sort: 0, bill_rate: 90 },
      { technician_id: C, sort: 1, bill_rate: null },
      { technician_id: B, sort: 2, bill_rate: 60 },
    ]);
    expect(confirmedCrew([], A, [])).toEqual([{ technician_id: A, sort: 0, bill_rate: null }]);
  });

  it("keeps helper_count in step with the named others", () => {
    expect(helperCountFor(planCrew(A, null, []))).toBe(0);
    expect(helperCountFor(planCrew(A, null, [{ technician_id: B }, { technician_id: C }]))).toBe(2);
  });
});

describe("crew bill rates", () => {
  it("uses the ticket's $, else the profile rate, else the rate table by role", () => {
    expect(effectiveBillRate({ sort: 0, bill_rate: 100 }, 95, TABLE)).toBe(100);
    expect(effectiveBillRate({ sort: 0, bill_rate: null }, 95, TABLE)).toBe(95);
    expect(effectiveBillRate({ sort: 0, bill_rate: null }, null, TABLE)).toBe(85);
    expect(effectiveBillRate({ sort: 2, bill_rate: null }, undefined, TABLE)).toBe(55);
    // A $0 on the ticket is a real rate (no charge), not "blank".
    expect(effectiveBillRate({ sort: 1, bill_rate: 0 }, 70, TABLE)).toBe(0);
    expect(defaultBillRate(false, 70, TABLE)).toBe(70);
  });

  it("reads the $ box: blank is the default, junk is invalid", () => {
    expect(parseRateText("")).toBeNull();
    expect(parseRateText("  ")).toBeNull();
    expect(parseRateText("$1,085.5")).toBe(1085.5);
    expect(parseRateText("72.456")).toBe(72.46);
    expect(parseRateText("0")).toBe(0);
    expect(parseRateText("-5")).toBeUndefined();
    expect(parseRateText("abc")).toBeUndefined();
  });
});

describe("Who is on this job with you?", () => {
  it("must be answered before the field flow goes on, unless the ticket is finished", () => {
    expect(crewQuestionPending({ crew_confirmed_at: null, stage: "scheduled" })).toBe(true);
    expect(crewQuestionPending({ crew_confirmed_at: null, stage: "open" })).toBe(true);
    expect(
      crewQuestionPending({ crew_confirmed_at: "2026-09-30T12:00:00Z", stage: "scheduled" }),
    ).toBe(false);
    expect(crewQuestionPending({ crew_confirmed_at: null, stage: "done" })).toBe(false);
  });
});
