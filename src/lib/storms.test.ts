import { describe, expect, it } from "vitest";

import {
  describeReport,
  parseMagnitude,
  parseSpcCsv,
  spcDateCode,
  spcUrl,
  windowDates,
} from "@/lib/storms.server";
import { stormHitQualifies, stormReportQualifies, stormWindowFrom } from "@/lib/storms.functions";

// Rows copied from the real SPC files on Sep 28, 2026 (May 16, 2025 hail; Jul 1, 2025 wind/torn).
const HAIL = `Time,Size,Location,County,State,Lat,Lon,Comments
1208,100,1 SSW Berea,Madison,KY,37.57,-84.3,(LMK)
1308,150,2 SSW South Hill,Butler,KY,37.15,-86.83,(LMK)
1344,200,Tyner,Jackson,KY,37.35,-83.9,Social media photos of estimated 2 to 3 inch diameter hail, from the Tyner Lake area. (JKL)
2157,100,1 ESE Rockerville,Pennington,SD,43.95,-103.33,(UNR)
`;
const WIND = `Time,Speed,Location,County,State,Lat,Lon,Comments
1335,UNK,5 NE Lake Hope State Pa,Athens,OH,39.38,-82.27,Line down on Carbondale Road. (RLX)
1431,77,5 ESE Kenel,Campbell,KY,45.82,-100.37,Public weather station observation. (ABR)
`;
const TORN = `Time,F_Scale,Location,County,State,Lat,Lon,Comments
2000,UNK,2 W Farson,Sweetwater,KY,42.11,-109.48,[Landspout] brief. (RIW)
2047,EF1,3 NNW Amity Gardens,Berks,KY,40.31,-75.75,A brief tornado. (PHI)
`;

describe("SPC storm reports", () => {
  it("names the day's files the way NOAA does", () => {
    const d = new Date("2025-07-01T18:00:00Z");
    expect(spcDateCode(d)).toBe("250701");
    expect(spcUrl(d, "tornado")).toBe(
      "https://www.spc.noaa.gov/climo/reports/250701_rpts_torn.csv",
    );
  });

  it("reads hail in inches, wind in mph, tornadoes as an EF number, UNK as unknown", () => {
    expect(parseMagnitude("hail", "175")).toBe(1.75);
    expect(parseMagnitude("wind", "77")).toBe(77);
    expect(parseMagnitude("wind", "UNK")).toBeNull();
    expect(parseMagnitude("tornado", "EF1")).toBe(1);
    expect(parseMagnitude("tornado", "UNK")).toBeNull();
  });

  it("keeps only the wanted states and the comment past the seventh comma", () => {
    const rows = parseSpcCsv(HAIL, "hail", "2025-05-16", ["KY"]);
    expect(rows.map((r) => r.county)).toEqual(["Madison", "Butler", "Jackson"]);
    expect(rows[1]).toMatchObject({
      report_date: "2025-05-16",
      kind: "hail",
      report_time: "1308",
      magnitude: 1.5,
      lat: 37.15,
      lng: -86.83,
      state: "KY",
    });
    expect(rows[2]!.comments).toBe(
      "Social media photos of estimated 2 to 3 inch diameter hail, from the Tyner Lake area. (JKL)",
    );
    expect(parseSpcCsv(WIND, "wind", "2025-07-01", ["KY"])).toHaveLength(1);
    expect(parseSpcCsv(TORN, "tornado", "2025-07-01", ["KY"]).map((r) => r.magnitude)).toEqual([
      null,
      1,
    ]);
    // No state filter keeps everything.
    expect(parseSpcCsv(HAIL, "hail", "2025-05-16", [])).toHaveLength(4);
  });

  it("covers today back through the window", () => {
    const days = windowDates(7, new Date("2026-09-28T15:00:00Z"));
    expect(days).toHaveLength(8);
    expect(days[0]!.toISOString().slice(0, 10)).toBe("2026-09-28");
    expect(days[7]!.toISOString().slice(0, 10)).toBe("2026-09-21");
  });

  it("describes a report for a person", () => {
    expect(describeReport({ kind: "hail", magnitude: 1.75 })).toBe("1.75-inch hail");
    expect(describeReport({ kind: "hail", magnitude: 1 })).toBe("1.0-inch hail");
    expect(describeReport({ kind: "wind", magnitude: null })).toBe("damaging wind");
    expect(describeReport({ kind: "tornado", magnitude: 2 })).toBe("EF2 tornado");
  });
});

describe("which stored hits still count", () => {
  const settings = {
    states: ["KY", "TN"],
    min_hail_in: 1.5,
    min_wind_mph: 58,
    hail_radius_mi: 1,
    wind_radius_mi: 3,
    tornado_radius_mi: 5,
  };
  it("starts the window where the panel does", () => {
    expect(stormWindowFrom(7, Date.parse("2026-09-30T15:00:00Z"))).toBe("2026-09-23");
  });
  it("applies today's thresholds, states and radius (match_storm_reports' rule)", () => {
    const hail = { kind: "hail", magnitude: 1.0, state: "KY" };
    expect(stormReportQualifies(settings, hail)).toBe(false);
    expect(stormReportQualifies(settings, { ...hail, magnitude: 1.75 })).toBe(true);
    expect(stormHitQualifies(settings, { ...hail, magnitude: 1.75 }, 2.5)).toBe(false);
    expect(stormHitQualifies(settings, { ...hail, magnitude: 1.75 }, 0.8)).toBe(true);
    expect(stormReportQualifies(settings, { kind: "wind", magnitude: null, state: "TN" })).toBe(
      true,
    );
    expect(stormReportQualifies(settings, { kind: "wind", magnitude: 50, state: "TN" })).toBe(
      false,
    );
    expect(stormReportQualifies(settings, { kind: "tornado", magnitude: null, state: "IN" })).toBe(
      false,
    );
    expect(stormHitQualifies(settings, { kind: "tornado", magnitude: 1, state: "KY" }, 4.9)).toBe(
      true,
    );
  });
});
