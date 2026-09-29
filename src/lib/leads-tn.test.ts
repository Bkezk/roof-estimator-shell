import { describe, expect, it } from "vitest";

import {
  centralDay,
  describeLead,
  nashvilleLead,
  nashvilleQueryUrl,
  parseCentralDate,
  parseEasternDate,
  parseStreamBidList,
  parseStreamRfps,
  parseUtBids,
  parseWrittenDateTime,
  samLead,
  samQueryUrl,
  streamLead,
  UT_CAMPUSES,
  utLead,
  type NashvillePermit,
} from "@/lib/leads.server";

const KEYWORDS = ["roof", "roofing", "re-roof", "membrane", "epdm", "tpo", "shingle"];
const campus = (slug: string) => UT_CAMPUSES.find((c) => c.slug === slug)!;

// Two accordion items copied from the STREAM construction bid list
// (https://www.tn.gov/generalservices/stream/stream/contractors/construction-bid-list.html) on
// Sep 29, 2026: one with "Bid Opening (WebEx):", one with "Bid Opening (WebEx) :" and an
// Eastern-time pre-bid; blank lines trimmed.
const STREAM = `<div class="accordion" id="accordion-a5808451e2714fa890d6c13031507150">
                <div class="accordion-item">
                        <div class="accordion-heading">
                            <span class="accordion-title">
                                <button class="accordion-button icon-angle-right collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#collapse-a5808451e2714fa890d6c13031507150-0" aria-controls="collapse-a5808451e2714fa890d6c13031507150-0" aria-expanded="false">
                                    142/013-01-2022 - BCCX Guild and Annex Fire Alarm Upgrades
                                </button>
                            </span>
                        </div>
                        <div id="collapse-a5808451e2714fa890d6c13031507150-0" class="accordion-collapse collapse" data-bs-parent="#accordion-a5808451e2714fa890d6c13031507150">
                            <div class="accordion-body panel-body" tabindex="0">
                                <div>
    <div class="tn-simpletable parbase"><table width="100%" cellspacing="0" cellpadding="1" border="0">
<tbody><tr><th valign="baseline">Project:</th>
<td valign="baseline"><p>BCCX Guild and Annex Fire Alarm Upgrades</p>
<p>Bledsoe County Correctional Complex</p>
<p>Pikeville, Bledsoe County, Tennessee</p>
<p>SBC Project No. 142/013-01-2022</p>
</td>
<td> </td>
<td> </td>
</tr><tr><th valign="baseline">Designer:</th>
<td colspan="3" height="20" width="243"><p>I.C. Thomasson Associates, Inc.</p>
<p>Contact: Erich Vierkant     </p>
<p>Phone: (615) 346-3400</p>
<p>E-Mail: <a href="mailto:evierkant@icthomasson.com">evierkant@icthomasson.com</a></p>
</td>
</tr><tr><th valign="baseline">Description:</th>
<td valign="baseline">The project includes replacing the existing fire alarm systems in Administration Building, Guilds, Annex Administration and Kitchen/Dining, Dorms, Education Building, and Industrial Building with new addressable fire alarm systems.</td>
<td> </td>
<td> </td>
</tr><tr><th valign="baseline">Pre-Bid:</th>
<td colspan="3" height="20%" width="267%" valign="baseline">At the facility, Administration Building, on Wednesday, August 26, 2026 at 10:30 a.m. Local Time (Central Time).</td>
</tr><tr><th valign="baseline">Bid Opening (WebEx):</th>
<td valign="baseline"><p>At 9:00 a.m. Local Time (Central Time) on Thursday, October 1, 2026</p>
<p>Meeting Number (access code): 2314 036 7823</p>
<p>Meeting Password: 142-013-01-2022</p>
<p>Join by phone: (415) 655-0001</p>
<p>Link: <a href="https://tn.webex.com/tn/j.php?MTID=ma4af0fca291494ae76b21bdbde8a6b8f">https://tn.webex.com/tn/j.php?MTID=ma4af0fca291494ae76b21bdbde8a6b8f</a></p>
</td>
<td> </td>
<td> </td>
</tr></tbody></table>
</div>
</div>
                            </div>
                        </div>
                </div>
                <div class="accordion-item">
                        <div class="accordion-heading">
                            <span class="accordion-title">
                                <button class="accordion-button icon-angle-right collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#collapse-a5808451e2714fa890d6c13031507150-3" aria-controls="collapse-a5808451e2714fa890d6c13031507150-3" aria-expanded="false">
                                    346/007-01-2025 - East Tennessee Intermediate Care Facility Renovation
                                </button>
                            </span>
                        </div>
                        <div id="collapse-a5808451e2714fa890d6c13031507150-3" class="accordion-collapse collapse" data-bs-parent="#accordion-a5808451e2714fa890d6c13031507150">
                            <div class="accordion-body panel-body" tabindex="0">
                                <div>
    <div class="tn-simpletable parbase"><table width="100%" cellspacing="0" cellpadding="1" border="0">
<tbody><tr><th valign="baseline">Project:</th>
<td valign="baseline"><p>East Tennessee Intermediate Care Facility Renovation</p>
<p>East TN Regional Office</p>
<p>Greeneville, Greene County, Tennessee</p>
<p>SBC Project No. 346/007-01-2025</p>
</td>
<td> </td>
<td> </td>
</tr><tr><th valign="baseline">Designer:</th>
<td colspan="3" height="20" width="290"><p>Shaw &amp; Shanks Architects, PC</p>
<p>Contact: Thomas Shanks  </p>
<p>Phone: (423) 928-7444</p>
<p>E-Mail: <a href="mailto:TomShanks@ShawandShanksArchitects.com">TomShanks@ShawandShanksArchitects.com</a></p>
</td>
</tr><tr><th valign="baseline">Description:</th>
<td valign="baseline">Perform interior, exterior, and building systems renovations. Interior work includes new finishes and space reconfiguration; exterior work includes roof replacement, new windows, and concrete replacement; building systems work includes a new generator, HVAC, plumbing, electrical, and replacement of the existing sprinkler system to a dry system.</td>
<td> </td>
<td> </td>
</tr><tr><th valign="baseline">Pre-Bid:</th>
<td colspan="3" height="20%" width="267%" valign="baseline">at the Greene Valley facility, lobby of the Hawthorn Cottage, on Friday, September 25, 2026 at 9:00 a.m. Local Time (Eastern Time).</td>
</tr><tr><th valign="baseline">Bid Opening (WebEx) :</th>
<td><p>At 9:00 a.m. Local Time (Central Time) on Thursday, October 08, 2026</p>
<p>Meeting Number (access code): 2309 722 6169</p>
<p>Meeting Password: 346-007-01-2025</p>
<p>Join by phone: (415) 655-0001</p>
<p>Link: <a href="https://tn.webex.com/tn/j.php?MTID=me4014f95d2869de363845f3fe252583e">https://tn.webex.com/tn/j.php?MTID=me4014f95d2869de363845f3fe252583e</a></p>
</td>
<td> </td>
<td> </td>
</tr></tbody></table>
</div>
</div>
                            </div>
                        </div>
                </div>
    </div>`;

// The table from the STREAM RFP page
// (https://www.tn.gov/generalservices/stream/stream/contractors/requests-for-proposal--rfps-.html),
// Sep 29, 2026; the last two attachment links trimmed.
const STREAM_RFP = `<div class="tn-simpletable parbase"><table width="100%" border="1" cellspacing="0" cellpadding="1">
<tbody><tr><th style="text-align: left;"><u>SBC No.</u></th>
<th style="text-align: left;"><u>AGENCY</u></th>
<th style="text-align: left;"><u><strong>PROJECT TITLE</strong></u></th>
<th style="text-align: left;"><u><strong>ATTACHMENTS</strong></u></th>
</tr><tr><td style="text-align: left;">361/000-03-2025</td>
<td style="text-align: left;">Military</td>
<td style="text-align: center;"><p style="text-align: left;">TEMA New EOC and Administrative Building</p>
<p style="text-align: left;">Nashville, Davidson County, Tennessee</p>
</td>
<td style="text-align: left;"><a title="TEMA New EOC and Admin Bldg CM GC RFP with Attachments Release 7.29.26" href="/content/dam/tn/generalservices/documents/tema-new-eoc-and-admin-building/TEMA%20New%20EOC%20and%20Admin%20Bldg%20CM%20GC%20RFP%20with%20Attachments%20Release%207.29.26.pdf" target="_blank">TEMA New EOC and Admin Bldg CM GC RFP with Attachments Release 7.29.26</a><p style="text-align: left;"><a title="TEMA New EOC and Admin Bldg CM GC Cost Proposal" href="/content/dam/tn/generalservices/documents/tema-new-eoc-and-admin-building/TEMA%20New%20EOC%20and%20Admin%20Bldg%20CM%20GC%20Cost%20Proposal.xlsx" target="_blank">TEMA New EOC and Admin Bldg CM GC Cost Proposal</a></p>
</td>
</tr><tr><td> </td>
<td> </td>
<td> </td>
<td> </td>
</tr></tbody></table>
</div>`;

// The page body of the UT Health Science Center bids page
// (https://tennessee.edu/about/divisions/finance-admin/capital-projects/construction-opportunities/uthsc-bids/)
// fetched with browser headers on Sep 29, 2026 (two invitations and two results trimmed), after
// the sidebar's office block.
const UT_OFFICE = `<div class="prose sm:prose-lg max-w-[--prose-max-width]">
  <h3>Knoxville Office</h3><p>(Mailing Address)<br />
505 Summer Place<br />
UT Tower 9th Floor<br />
Knoxville, TN 37902<br />
865-974-2231</p>
</div>`;
const UTHSC = `${UT_OFFICE}
<div class="with-sidebar__main-inner-wrapper">
<h2 class="wp-block-heading has-h-2-style-font-size" style="margin-top:0px">Recent Procurement Awards</h2>

<ul class="wp-block-list">
<li>No information available at this time.</li>
</ul>

<h2 class="wp-block-heading has-h-2-style-font-size">Invitations to Bid</h2>

<p class="wp-block-paragraph"></p>

<ul class="wp-block-list">
<li><a href="https://tennessee.edu/wp-content/uploads/2026/02/UTHSC-GALR-BP2-FLINTCO-Invitation-to-Bid-2026-02-02.pdf">UTHSC Gross Anatomy Lab Renovation (24/25) (SP 2 &#8211; Relocation of Compounding Pharmacy Lab) &#8211; Bid Package 2 &#8211; Compounding Pharmacy</a>
<ul class="wp-block-list">
<li><strong>This bid opening has been moved from March 10, 2026 to March 12, 2026 at 2:00 pm CT</strong></li>

<li>Post Date:  February 11, 2026</li>
</ul>
</li>

<li><a href="https://tennessee.edu/wp-content/uploads/2026/08/UTHSC-Johnson-Mechanical-Electrical-Upgrades-Invitation-to-Bid-FINAL.pdf">UTHSC Johnson Mechanical and Electrical Upgrades (25/26)</a>
<ul class="wp-block-list">
<li>The bid opening has been moved from September 30, 2026 at 10:00 am CT to October 7, 2026 at 10:00 am CT</li>

<li>Post Date:  August 26, 2026</li>
</ul>
</li>

<li><a href="https://tennessee.edu/wp-content/uploads/2026/09/UTHSC-Multi-Bldg-Boiler-Repairs-Invitation-to-Bid-FINAL.pdf">UTHSC Multiple Building Boiler Repairs (24/25)</a>
<ul class="wp-block-list">
<li>Post Date:  September 23, 2026</li>
</ul>
</li>
</ul>

<h2 class="wp-block-heading has-h-2-style-font-size">Bid Results</h2>

<ul class="wp-block-list">
<li><a href="https://tennessee.edu/wp-content/uploads/2025/11/Final-Bid-Tab.pdf">UTHSC Campus Fencing (24/25)</a>
<ul class="wp-block-list">
<li>Bid Date:  October 2, 2025</li>
</ul>
</li>
</ul>
</div>
</main>
<footer><ul><li><a href="https://tennessee.edu/news/">News</a></li></ul></footer>`;

// UT Chattanooga's only invitation (Sep 29, 2026): a moved bid opening written without a year,
// and a roof job that is listed only under Bid Results.
const UTC = `<h2 class="wp-block-heading has-h-2-style-font-size">Invitations to Bid</h2>

<ul class="wp-block-list">
<li><a href="https://tennessee.edu/wp-content/uploads/2026/01/19_UTC-Fletcher-Notice-to-Bidders_R1.pdf">Fletcher Hall Addition &amp; Renovation &#8211; (Bid Package 4 &#8211; Main Building Package)</a>
<ul class="wp-block-list">
<li>Post Date:  January 28, 2026</li>

<li><strong>Bid Opening has been moved to Friday, February 27th at 2:00 pm ET</strong></li>
</ul>
</li>
</ul>

<h2 class="wp-block-heading has-h-2-style-font-size">Bid Results</h2>

<ul class="wp-block-list">
<li><a href="https://tennessee.edu/wp-content/uploads/2026/09/F54-Bid-Tab-2019-07-official_executed-2.pdf">Roof Replacements (Subproject 4)</a>
<ul class="wp-block-list">
<li>Bid Date:  July 28, 2026</li>
</ul>
</li>
</ul>
</main>`;

// UT Institute of Agriculture (Sep 29, 2026), with the fume-hood entry's "moved" bullet removed
// so the invitation is closed by its Bid Results line instead.
const UTIA = `<h2 class="wp-block-heading has-h-2-style-font-size">Invitations to Bid</h2>
<ul class="wp-block-list">
<li><a href="https://tennessee.edu/wp-content/uploads/2026/06/UTIA-CVM-Fume-Hood-Upgrades-Invitation-to-Bid-FINAL.pdf">UTIA CVM Fume Hood Upgrades (24/25)</a>
<ul class="wp-block-list">
<li>Post Date:  June 17, 2026</li>
</ul>
</li>
<li><a href="https://tennessee.edu/wp-content/uploads/2026/07/4-H-Centers-Security-Upgrades-Invitation-to-Bid-FINAL.pdf">4-H Centers Security Upgrades</a>
<ul class="wp-block-list">
<li>Post Date:  July 8, 2026</li>
</ul>
</li>
</ul>
<h2 class="wp-block-heading has-h-2-style-font-size">Bid Results</h2>
<ul class="wp-block-list">
<li><a href="https://tennessee.edu/wp-content/uploads/2026/09/UTIA-CVM-Fume-Hood-Upgrades_F54-Bid-Tab-2019-07-FINAL.pdf">UTIA CVM Fume Hood Upgrades (24/25)</a>
<ul class="wp-block-list">
<li>Bid Date:  July 21, 2026</li>
</ul>
</li>
</ul>
</main>`;

// One feature from Metro Nashville's Building_Permits_Issued_2 layer (Sep 29, 2026), and one
// roofing permit shaped like it.
const NASH_REHAB: NashvillePermit = {
  Permit__: "2026020119",
  Permit_Type_Description: "Building Commercial - Rehab",
  Permit_Subtype_Description: "Warehouse, Storage S-1",
  Date_Issued: 1790571600000,
  Const_Cost: 45000,
  Address: "151 OLD HERMITAGE AVE",
  City: "NASHVILLE",
  State: "TN",
  Contact: "aaron pendley",
  Purpose: "use and occupancy for 7862SF warehouse with minor interior alterations",
  Lon: -86.7,
  Lat: 36.15,
  ZIP: "37210",
};
const NASH_NEW: NashvillePermit = {
  Permit__: "2025070715",
  Permit_Type_Description: "Building Commercial - New",
  Permit_Subtype_Description: "Community Education, Stadiums",
  Date_Issued: 1790312400000,
  Const_Cost: 468971,
  Address: "1020 MAPLEHURST AVE",
  City: "NASHVILLE",
  Contact: "Scott Jackson",
  Purpose:
    "To construct new 51'x42' non-residential structure for existing tenant; LIPSCOMB ACADEMY MCCADAMS ATHLETIC CENTER.    Poc: Scott Jackson 615-704-4478  scottj@boonetime.com",
  Lon: -86.79251121999998,
  Lat: 36.10437858,
  ZIP: "37204",
};

describe("Central and written-out dates", () => {
  it("reads the planroom format in Central time, an hour after the same Eastern time", () => {
    // Oct 20, 2026 is daylight time: 1:30 PM CDT = 18:30Z; the Eastern reading is 17:30Z.
    expect(parseCentralDate("10/20/2026 01:30 PM")).toBe("2026-10-20T18:30:00.000Z");
    expect(parseEasternDate("10/20/2026 01:30 PM ET")).toBe("2026-10-20T17:30:00.000Z");
    // After the first Sunday of November: standard time, UTC-6.
    expect(parseCentralDate("11/05/2026 09:00 AM")).toBe("2026-11-05T15:00:00.000Z");
  });

  it("reads STREAM and UT prose, taking the zone the text names", () => {
    expect(
      parseWrittenDateTime(
        "At 9:00 a.m. Local Time (Central Time) on Thursday, October 1, 2026",
        "CT",
      ),
    ).toBe("2026-10-01T14:00:00.000Z");
    expect(
      parseWrittenDateTime(
        "on Friday, September 25, 2026 at 9:00 a.m. Local Time (Eastern Time).",
        "CT",
      ),
    ).toBe("2026-09-25T13:00:00.000Z");
    // No year: the next Feb 27 after the post date.
    expect(
      parseWrittenDateTime(
        "Bid Opening has been moved to Friday, February 27th at 2:00 pm ET",
        "CT",
        new Date("2026-01-28T12:00:00Z"),
      ),
    ).toBe("2026-02-27T19:00:00.000Z");
    // No zone named: the default; no time: midnight local.
    expect(parseWrittenDateTime("Bid Date:  July 21, 2026", "ET")).toBe("2026-07-21T04:00:00.000Z");
    expect(parseWrittenDateTime("Meeting Number (access code): 2314 036 7823", "CT")).toBeNull();
    expect(parseWrittenDateTime("February 30, 2026", "CT")).toBeNull();
  });

  it("puts an epoch on the Central calendar", () => {
    expect(centralDay(1790312400000)).toBe("2026-09-25"); // 05:00Z = midnight CDT
    expect(centralDay(Date.UTC(2026, 11, 2, 5, 30))).toBe("2026-12-01"); // 11:30 PM CST
  });
});

describe("STREAM bid list (tn_stream)", () => {
  it("reads each accordion item: SBC number, name, facility, town, designer, pre-bid, bid", () => {
    const [bccx, etn] = parseStreamBidList(STREAM);
    expect(bccx).toMatchObject({
      kind: "bid",
      sbc: "142/013-01-2022",
      name: "BCCX Guild and Annex Fire Alarm Upgrades",
      facility: "Bledsoe County Correctional Complex",
      city: "Pikeville",
      county: "Bledsoe",
      designer: "I.C. Thomasson Associates, Inc.",
      designerContact: "Erich Vierkant",
      designerPhone: "(615) 346-3400",
      designerEmail: "evierkant@icthomasson.com",
      prebidAt: "2026-08-26T15:30:00.000Z", // 10:30 a.m. CDT
      bidAt: "2026-10-01T14:00:00.000Z", // 9:00 a.m. CDT
    });
    expect(bccx!.bidText).toBe(
      "At 9:00 a.m. Local Time (Central Time) on Thursday, October 1, 2026",
    );
    // "Bid Opening (WebEx) :" with a space; an Eastern pre-bid and a Central bid opening.
    expect(etn!.sbc).toBe("346/007-01-2025");
    expect(etn!.designer).toBe("Shaw & Shanks Architects, PC");
    expect(etn!.prebidAt).toBe("2026-09-25T13:00:00.000Z");
    expect(etn!.bidAt).toBe("2026-10-08T14:00:00.000Z");
    expect(etn!.description).toContain("roof replacement");
  });

  it("makes a Tennessee lead: designer as the contact, the list URL with the SBC number", () => {
    const [bccx, etn] = parseStreamBidList(STREAM).map((p) => streamLead(p, KEYWORDS));
    expect(etn).toMatchObject({
      source: "tn_stream",
      external_id: "346/007-01-2025",
      title: "East Tennessee Intermediate Care Facility Renovation",
      agency: "East TN Regional Office",
      location: "Greeneville, Greene County",
      city: "Greeneville",
      county: "Greene",
      state: "TN",
      contractor: "Shaw & Shanks Architects, PC",
      contact:
        "Shaw & Shanks Architects, PC — Thomas Shanks — (423) 928-7444 — TomShanks@ShawandShanksArchitects.com",
      url: "https://www.tn.gov/generalservices/stream/stream/contractors/construction-bid-list.html#346/007-01-2025",
      is_roof: true, // "roof replacement" in the description
    });
    expect(bccx!.is_roof).toBe(false);
  });

  it("reads the RFP page into the same source, linking the RFP document", () => {
    const rfps = parseStreamRfps(STREAM_RFP);
    expect(rfps).toHaveLength(1);
    const lead = streamLead(rfps[0]!, KEYWORDS);
    expect(lead).toMatchObject({
      source: "tn_stream",
      external_id: "rfp:361/000-03-2025",
      title: "TEMA New EOC and Administrative Building",
      agency: "State of Tennessee — Military",
      location: "Nashville, Davidson County",
      state: "TN",
      contact: null,
      bid_at: null,
      project_type: "Request for proposals",
      url: "https://www.tn.gov/content/dam/tn/generalservices/documents/tema-new-eoc-and-admin-building/TEMA%20New%20EOC%20and%20Admin%20Bldg%20CM%20GC%20RFP%20with%20Attachments%20Release%207.29.26.pdf",
    });
  });

  it("returns nothing for a page without accordion items or an RFP table", () => {
    expect(parseStreamBidList("<html><body>Page not found</body></html>")).toEqual([]);
    expect(parseStreamRfps("<table><tr><th>Name</th></tr><tr><td>x</td></tr></table>")).toEqual([]);
  });
});

describe("UT campus bids (ut_bids)", () => {
  it("reads the invitations only, with post date, moved bid opening and the office line", () => {
    const bids = parseUtBids(UTHSC, campus("uthsc"));
    expect(bids.map((b) => b.id)).toEqual([
      "UTHSC-GALR-BP2-FLINTCO-Invitation-to-Bid-2026-02-02.pdf",
      "UTHSC-Johnson-Mechanical-Electrical-Upgrades-Invitation-to-Bid-FINAL.pdf",
      "UTHSC-Multi-Bldg-Boiler-Repairs-Invitation-to-Bid-FINAL.pdf",
    ]);
    const [galr, johnson, boiler] = bids;
    expect(galr!.title).toBe(
      "UTHSC Gross Anatomy Lab Renovation (24/25) (SP 2 – Relocation of Compounding Pharmacy Lab) – Bid Package 2 – Compounding Pharmacy",
    );
    expect(galr!.postedAt).toBe("2026-02-11");
    expect(galr!.bidAt).toBe("2026-03-12T19:00:00.000Z"); // the new date, 2 pm CDT
    expect(johnson!.bidAt).toBe("2026-10-07T15:00:00.000Z"); // Oct 7, 10 am CDT
    expect(boiler!.bidAt).toBeNull();
    expect(boiler!.contact).toBe("UT Capital Projects — Knoxville office 865-974-2231");
  });

  it("reads a yearless bid date against the post date; a results-only job is not a lead", () => {
    const bids = parseUtBids(UTC, campus("utc"));
    expect(bids).toHaveLength(1);
    expect(bids[0]!.bidAt).toBe("2026-02-27T19:00:00.000Z");
    expect(bids[0]!.contact).toBeNull(); // no office block in this excerpt
  });

  it("closes an invitation that shows up under Bid Results", () => {
    const [hood, fourH] = parseUtBids(UTIA, campus("utia"));
    expect(hood!.closedByResult).toBe(true);
    expect(hood!.bidAt).toBe("2026-07-21T04:00:00.000Z"); // July 21, Knoxville (Eastern)
    expect(fourH!.bidAt).toBeNull();
    expect(fourH!.closedByResult).toBe(false);
  });

  it("makes a lead per invitation: campus as agency, campus town, the PDF as the link", () => {
    const c = campus("uthsc");
    const lead = utLead(parseUtBids(UTHSC, c)[2]!, c, KEYWORDS);
    expect(lead).toMatchObject({
      source: "ut_bids",
      external_id: "uthsc:UTHSC-Multi-Bldg-Boiler-Repairs-Invitation-to-Bid-FINAL.pdf",
      title: "UTHSC Multiple Building Boiler Repairs (24/25)",
      agency: "UT Health Science Center",
      location: "Memphis",
      city: "Memphis",
      county: "Shelby",
      state: "TN",
      issued_on: "2026-09-23",
      url: "https://tennessee.edu/wp-content/uploads/2026/09/UTHSC-Multi-Bldg-Boiler-Repairs-Invitation-to-Bid-FINAL.pdf",
      is_roof: false,
    });
    expect(
      utLead({ ...parseUtBids(UTHSC, c)[2]!, title: "UTM Roof Replacement" }, c, KEYWORDS).is_roof,
    ).toBe(true);
  });

  it("returns nothing for a page without an Invitations to Bid heading", () => {
    expect(parseUtBids("<html><h2>Access denied</h2></html>", campus("utk"))).toEqual([]);
  });
});

describe("Nashville permits (nashville_permits)", () => {
  it("queries the chosen types, cost floor and window, newest first", () => {
    const url = new URL(
      nashvilleQueryUrl(
        {
          nashville_types: ["Building Commercial - New", "Building Commercial - Roofing / Siding"],
          nashville_min_cost: 100000,
          louisville_days: 90,
        },
        1000,
        new Date("2026-09-29T12:00:00Z"),
      ),
    );
    expect(url.pathname).toBe(
      "/HdTo6HJqh92wn4D8/arcgis/rest/services/Building_Permits_Issued_2/FeatureServer/0/query",
    );
    expect(url.searchParams.get("where")).toBe(
      "Permit_Type_Description IN ('Building Commercial - New','Building Commercial - Roofing / Siding') AND Date_Issued >= DATE '2026-07-01' AND Const_Cost >= 100000",
    );
    expect(url.searchParams.get("orderByFields")).toBe("Date_Issued DESC");
    expect(url.searchParams.get("resultOffset")).toBe("1000");
  });

  it("makes a permit lead: type as title, address as place, Central issue day, no link", () => {
    const lead = nashvilleLead(NASH_REHAB, KEYWORDS);
    expect(lead).toMatchObject({
      source: "nashville_permits",
      external_id: "2026020119",
      title: "Commercial - Rehab — Warehouse, Storage S-1",
      agency: "Metro Nashville Codes",
      contractor: "aaron pendley",
      contact: "aaron pendley",
      location: "151 OLD HERMITAGE AVE, Nashville, TN 37210",
      address: "151 OLD HERMITAGE AVE",
      city: "Nashville",
      county: "Davidson",
      state: "TN",
      lat: 36.15,
      lng: -86.7,
      project_type: "Warehouse, Storage S-1",
      project_cost: 45000,
      sqft: 7862,
      issued_on: "2026-09-28", // 1790571600000 = Sep 28, 00:00 CDT
      url: null,
      is_roof: false, // a rehab with no roof words
    });
  });

  it("counts a new building as a roof lead and picks the phone and e-mail out of the scope", () => {
    const lead = nashvilleLead(NASH_NEW, KEYWORDS);
    expect(lead.is_roof).toBe(true);
    expect(lead.contact).toBe("Scott Jackson — 615-704-4478 — scottj@boonetime.com");
    expect(lead.issued_on).toBe("2026-09-25");
    expect(
      nashvilleLead(
        { ...NASH_REHAB, Purpose: "remove and replace TPO roof membrane on existing warehouse" },
        KEYWORDS,
      ).is_roof,
    ).toBe(true);
    expect(
      nashvilleLead(
        { ...NASH_REHAB, Permit_Type_Description: "Building Commercial - Roofing / Siding" },
        KEYWORDS,
      ).is_roof,
    ).toBe(true);
    expect(describeLead(lead)).toBe(
      "Commercial - New — Community Education, Stadiums (1020 MAPLEHURST AVE, Nashville, TN 37204, permit Sep 25)",
    );
  });
});

describe("SAM.gov in Tennessee", () => {
  it("asks for the state it is given", () => {
    const url = new URL(samQueryUrl("KEY", 60, new Date("2026-09-29T12:00:00Z"), "TN"));
    expect(url.searchParams.get("state")).toBe("TN");
    expect(new URL(samQueryUrl("KEY")).searchParams.get("state")).toBe("KY");
  });

  it("takes the state from the place of performance, else the state asked for", () => {
    const base = { noticeId: "n1", title: "Roof Replacement, Building 7", naicsCode: "238160" };
    const tn = samLead(
      { ...base, placeOfPerformance: { city: { name: "Fort Campbell" }, state: { code: "tn" } } },
      KEYWORDS,
      "KY",
    );
    expect(tn.state).toBe("TN");
    expect(tn.location).toBe("Fort Campbell, TN");
    const none = samLead(base, KEYWORDS, "TN");
    expect(none.state).toBe("TN");
    expect(none.location).toBe("TN");
    expect(samLead(base, KEYWORDS).state).toBe("KY");
  });
});
