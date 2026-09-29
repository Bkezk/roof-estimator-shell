import { describe, expect, it } from "vitest";

import {
  describeLead,
  isRoofLead,
  isUsDaylightTime,
  louisvilleLead,
  louisvilleQueryUrl,
  parseEasternDate,
  parsePlanroomHtml,
  planroomLead,
} from "@/lib/leads.server";

// Three rows copied from https://www.stateofkyplanroom.com/ on Sep 28, 2026.
const PLANROOM = `<table id="jobs"><tr><th>Project Name</th><th>Company Name</th><th>Project Type</th><th>Pre-Bid Date</th><th>Bid Date</th><th>Bids In</th></tr>
<tr><td valign="top"><a href="ViewJob.aspx?job_id=29687" class="h3">RFB-90-27 DOC - KCIW Electrical Repairs</a><br /><img src="../Common/Images/location.png" style="height:10px" /> Peewee Valley</td><td valign="top">Division of Engineering and Contract Administration</td><td valign="top"></td><td valign="top" class="fullWhiteSpaceNoWrap"></td><td valign="top" class="fullWhiteSpaceNoWrap">10/21/2026 01:30 PM ET</td><td valign="top" class="bidsInCircle"><div style="background-image:url('../Common/Images/bids_in/green.png')">23 Days</div></td></tr>
<tr><td valign="top"><a href="ViewJob.aspx?job_id=29677" class="h3">Request for Proposals - FWAE-001-27 - Civil Engineering Services for FILO</a><br /><img src="../Common/Images/location.png" style="height:10px" /> Various, Kentucky</td><td valign="top">State of KY Dept of Fish & Wildlife</td><td valign="top">RFP/RFQ</td><td valign="top" class="fullWhiteSpaceNoWrap"></td><td valign="top" class="fullWhiteSpaceNoWrap">10/20/2026 12:00 PM ET</td><td valign="top" class="bidsInCircle"><div style="background-image:url('../Common/Images/bids_in/green.png')">22 Days</div></td></tr>
<tr><td valign="top"><a href="ViewJob.aspx?job_id=29681" class="h3">RFB-86-27 FSS - Jackson SOB Roof Replacement</a><br /><img src="../Common/Images/location.png" style="height:10px" /> Jackson</td><td valign="top">Division of Engineering and Contract Administration</td><td valign="top"></td><td valign="top" class="fullWhiteSpaceNoWrap"></td><td valign="top" class="fullWhiteSpaceNoWrap">10/20/2026 01:30 PM ET</td><td valign="top" class="bidsInCircle"><div style="background-image:url('../Common/Images/bids_in/green.png')">22 Days</div></td></tr>
</table>`;

const KEYWORDS = ["roof", "roofing", "re-roof", "membrane", "epdm", "tpo", "pvc", "shingle"];

describe("State planroom list", () => {
  it("reads one job per row: id, name, town, agency, type, pre-bid and bid dates", () => {
    const jobs = parsePlanroomHtml(PLANROOM);
    expect(jobs.map((j) => j.jobId)).toEqual(["29687", "29677", "29681"]);
    const jackson = jobs[2]!;
    expect(jackson.name).toBe("RFB-86-27 FSS - Jackson SOB Roof Replacement");
    expect(jackson.location).toBe("Jackson");
    expect(jackson.company).toBe("Division of Engineering and Contract Administration");
    expect(jackson.projectType).toBeNull();
    expect(jackson.prebidAt).toBeNull();
    // 10/20/2026 01:30 PM Eastern daylight time = 17:30Z
    expect(jackson.bidAt).toBe("2026-10-20T17:30:00.000Z");
    const rfp = jobs[1]!;
    expect(rfp.company).toBe("State of KY Dept of Fish & Wildlife");
    expect(rfp.projectType).toBe("RFP/RFQ");
    expect(rfp.location).toBe("Various, Kentucky");
  });

  it("flags the roof job and not the electrical one, and links the job page", () => {
    const [electrical, , roof] = parsePlanroomHtml(PLANROOM).map((j) => planroomLead(j, KEYWORDS));
    expect(roof!.is_roof).toBe(true);
    expect(roof!.url).toBe("https://www.stateofkyplanroom.com/View/ViewJob.aspx?job_id=29681");
    expect(roof!.source).toBe("ky_planroom");
    expect(roof!.external_id).toBe("29681");
    expect(electrical!.is_roof).toBe(false);
  });

  it("returns nothing for a page without job links (layout change → the refresh reports it)", () => {
    expect(parsePlanroomHtml("<html><body>We're Sorry</body></html>")).toEqual([]);
  });
});

describe("Eastern dates", () => {
  it("knows US daylight time by the second Sunday of March and first Sunday of November", () => {
    expect(isUsDaylightTime(2026, 2, 7, 12)).toBe(false); // Mar 7, 2026
    expect(isUsDaylightTime(2026, 2, 8, 3)).toBe(true); // Mar 8, 2026 (2nd Sunday) after 2am
    expect(isUsDaylightTime(2026, 10, 1, 1)).toBe(true); // Nov 1, 2026 (1st Sunday) 1am
    expect(isUsDaylightTime(2026, 10, 1, 3)).toBe(false);
    expect(isUsDaylightTime(2026, 6, 4, 12)).toBe(true);
    expect(isUsDaylightTime(2026, 0, 15, 12)).toBe(false);
  });
  it("converts the planroom's clock to an instant, standard time in winter", () => {
    expect(parseEasternDate("10/20/2026 01:30 PM ET")).toBe("2026-10-20T17:30:00.000Z");
    expect(parseEasternDate("12/03/2026 09:30 AM ET")).toBe("2026-12-03T14:30:00.000Z");
    expect(parseEasternDate("12/03/2026 12:00 PM ET")).toBe("2026-12-03T17:00:00.000Z");
    expect(parseEasternDate("12/03/2026 12:15 AM ET")).toBe("2026-12-03T05:15:00.000Z");
    expect(parseEasternDate("")).toBeNull();
  });
});

describe("Louisville permits", () => {
  const settings = {
    louisville_types: ["Commercial New", "Commercial Addition"],
    louisville_min_sqft: 5000,
    louisville_days: 90,
  };
  it("asks the feature service for the chosen types, size and window", () => {
    const url = louisvilleQueryUrl(settings, 0, new Date("2026-09-28T12:00:00Z"));
    const where = new URL(url).searchParams.get("where");
    expect(where).toBe(
      "PERMIT_TYPE IN ('Commercial New','Commercial Addition') AND ISSUE_DATE >= DATE '2026-06-30' AND SQFT >= 5000",
    );
    expect(url).toContain("active_construction_permits/FeatureServer/0/query");
  });
  it("maps a permit row: address title, Jefferson County, point, sq ft, cost, issue date", () => {
    // COM-NEW-26-00159 as returned by the service on Sep 28, 2026.
    const lead = louisvilleLead(
      {
        PERMIT_NUMBER: "COM-NEW-26-00159",
        PERMIT_TYPE: "Commercial New",
        PERMIT_STATUS: "Issued",
        CONTRACTOR: "MONARCH RESTORATION",
        WORK_TYPE: null,
        SQFT: 1232,
        PROJECT_COSTS: 10000,
        ADDRESS: "1338 LYNMAR DR, 1",
        CITY: "LOUISVILLE",
        ZIPCODE: "40216",
        LATITUDE: 38.18,
        LONGITUDE: -85.85,
        ISSUE_DATE: Date.UTC(2026, 8, 24, 4),
      },
      KEYWORDS,
    );
    expect(lead.title).toBe("1338 LYNMAR DR, 1 — Commercial New");
    expect(lead.county).toBe("Jefferson");
    expect(lead.contractor).toBe("MONARCH RESTORATION");
    expect(lead.issued_on).toBe("2026-09-24");
    expect(lead.sqft).toBe(1232);
    expect(lead.project_cost).toBe(10000);
    // A whole new commercial building is roof work whatever the permit says.
    expect(lead.is_roof).toBe(true);
    expect(lead.external_id).toBe("COM-NEW-26-00159");
    // The card opens the site on the app's own map (the open-data explorer cannot link one permit).
    expect(lead.url).toBe("/prospect?at=38.18,-85.85");
  });
});

describe("roof keywords", () => {
  it("matches at a word start, case-insensitive, and not inside other words", () => {
    expect(isRoofLead("Harlan Armory Roof Replacement", KEYWORDS)).toBe(true);
    expect(isRoofLead("KCIW ROOFING repairs", KEYWORDS)).toBe(true);
    expect(isRoofLead("Re-Roof of gym", KEYWORDS)).toBe(true);
    expect(isRoofLead("Fireproofing upgrade", KEYWORDS)).toBe(false);
    expect(isRoofLead("Electrical Repairs", KEYWORDS)).toBe(false);
  });
  it("describes a lead for the notification line", () => {
    expect(
      describeLead({
        title: "Jackson SOB Roof Replacement",
        location: "Jackson",
        bid_at: "2026-10-20T17:30:00.000Z",
      }),
    ).toBe("Jackson SOB Roof Replacement (Jackson, bids Oct 20)");
    expect(
      describeLead({ title: "1338 LYNMAR DR — Commercial New", issued_on: "2026-09-24" }),
    ).toBe("1338 LYNMAR DR — Commercial New (permit Sep 24)");
  });
});
