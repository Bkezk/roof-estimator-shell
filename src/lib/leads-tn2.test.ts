import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BIDNET_GROUPS,
  bidnetLead,
  bidnetPageUrl,
  bidnetPlace,
  chattanoogaLead,
  chattanoogaQueryUrl,
  dropPlanroomDuplicates,
  easternDay,
  fetchBidnetList,
  isBidnetChallenge,
  isTnUniversityPage,
  knoxCountyLead,
  parseBidnetAbstract,
  parseBidnetList,
  parseKnoxCountyBids,
  TN_UNIVERSITIES,
  tnUniversityLead,
  type ChattanoogaPermit,
} from "@/lib/leads.server";

const KEYWORDS = ["roof", "roofing", "re-roof", "membrane", "epdm", "tpo", "shingle"];
const school = (key: string) => TN_UNIVERSITIES.find((s) => s.key === key)!;
const TN = BIDNET_GROUPS.find((g) => g.state === "TN")!;
const KY = BIDNET_GROUPS.find((g) => g.state === "KY")!;

// BidNet Direct, Tennessee Purchasing Group (https://www.bidnetdirect.com/tennessee), Sep 29,
// 2026: the count header, the pager's first and last page, and the first two rows (scripts and
// icons dropped).
const BIDNET = `<span class="simpleResultsNumResults">
 272 Open Solicitations</span>
<option class="mets-pagination-number" value="1" selected="selected" data-page-number="1" data-page-size="25" data-href="/tennessee/solicitations/open-bids/page1" title="Current Page (1)">
<option class="mets-pagination-number" value="11"  data-page-number="11" data-page-size="25" data-href="/tennessee/solicitations/open-bids/page11" title="Go to Page 11 ">
<table id="g_5" class="sol-table mets-table useSVGImage">
<tbody>
<tr data-index="0" class="mets-table-row odd">
 <td class="mainCol">
 <div class="sol-info-container">
 <div class="sol-info-col">
 <div class="sol-title">
 <a id="g_8" href="/public/supplier/solicitations/statewide/444177732225/abstract?purchasingGroupId=388528051&origin=1" class="solicitation-link mets-command-link">Porte Cochere Addition For: Kingsport Senior Center</a>
 </div>
 <div class="sol-region">
 <span class="sol-region-item">Tennessee</span>
 </div>
 </div>
 <span class="dates-col">
 <span class="dates-col-content">
 <span class="sol-publication-date">
 <span class="date-label">Published</span>
 <span class="date-value">09/29/2026</span>
 </span>
 <span class="sol-closing-date open">
 <span class="date-label">Closing</span>
 <span class="date-value">10/22/2026</span>
 </span>
 </span>
 </span>
 </div>
 </td>
 </tr>
<tr data-index="1" class="mets-table-row even">
 <td class="mainCol">
 <div class="sol-info-container">
 <div class="sol-info-col">
 <div class="sol-title">
 <a id="g_11" href="/public/supplier/solicitations/statewide/444178020062/abstract?purchasingGroupId=388528051&origin=1" class="solicitation-link mets-command-link">BHS Gym Audio</a>
 </div>
 <div class="sol-region">
 <span class="sol-region-item">Tennessee</span>
 </div>
 </div>
 <span class="dates-col">
 <span class="dates-col-content">
 <span class="sol-publication-date">
 <span class="date-label">Published</span>
 <span class="date-value">09/29/2026</span>
 </span>
 <span class="sol-closing-date open">
 <span class="date-label">Closing</span>
 <span class="date-value">10/19/2026</span>
 </span>
 </span>
 </span>
 </div>
 </td>
 </tr>
</tbody>
</table>`;

// What BidNet sent instead of page 3 on one request (HTTP 202; keys shortened).
const CHALLENGE = `<!DOCTYPE html>
<html lang="en">
<head>
 <meta charset="utf-8">
 <meta name="viewport" content="width=device-width, initial-scale=1">
 <title></title>
 <style>
 body {
 font-family: "Arial";
 }
 </style>
 <script src="https://019c5971e490.9439d00e.us-east-1.token.awswaf.com/019c5971e490/34db175464fc/fd17e651dc9a/challenge.js"></script>
</head>
<body>
 <div id="challenge-container"></div>
 <noscript>
 <h1>JavaScript is disabled</h1>
 In order to continue, we need to verify that you're not a robot.
 This requires JavaScript. Enable JavaScript and then reload the page.
 </noscript>
</body>
</html>`;

// The public part of an abstract page (the rest is "Registered members only").
const ABSTRACT = `<div class="purchasingGroupLogoLightbox" style="background-image:url('/public/supplier/interception/purchasing-group/logo/388528051')"></div>
									<div id="g_2"  class="mets-field mets-field-view">
		<span  class="mets-field-label">
							Location</span>
					<div class="mets-field-body ">
			Tennessee<br />
									</div>
	</div>
<div id="g_3"  class="mets-field mets-field-view">
		<span  class="mets-field-label">
							Publication Date</span>
					<div class="mets-field-body ">
			09/29/2026 03:09 PM EDT</div>
	</div>
<div id="g_4"  class="mets-field mets-field-view">
		<span  class="mets-field-label">
							Closing Date</span>
					<div class="mets-field-body ">
			10/22/2026 04:00 PM EDT</div>
	</div>`;

// Knox County purchasing (https://www.knoxcounty.org/apps/solicitations/solicitations.php),
// Sep 29: the header, a solicitation with its pre-bid note, and one without.
const KNOX = `<table width="100%" border="1" cellpadding="2" bgcolor="#6699FF">
<tr>
                                    <td width="31%">
                                        <span class="style1">Name of Solicitation</span>
                                    </td>
                                    <td width="13%">
                                        <span class="style1">Solicitation Number</span>
                                    </td>
                                    <td width="13%">
                                        <span class="style1">Deadline Due Date</span>
                                    </td>
                                    <td width="13%">
                                        <span class="style1">Buyer</span>
                                    </td>
                                    <td width="20%">
                                        <span class="style1">Attachments</span>
                                    </td>
                                </tr>
<tr bgcolor="#FFFFFF">
                                                                <td  rowspan="2"  >
                                    <!-- =mysql_result($query, $i, "title") -->
                                     Traffic Signals at Nubbin Ridge Road and Ebenezer Road & Pedigo Road and E. Emory Road (S.R. 131)                                </td>
                                <td><!-- =mysql_result($query, $i, "bid")? -->
                                    3764                                </td>
                                <td>10-06-26</td> <!-- date("m-d-y", mysql_result($query, $i, "open")) -->
                                 <!-- $h = mysql_result($query, $i, "title_buyer")."<br>".mysql_result($query, $i, "phone") -->
                                <td bgcolor="#FFFFFF">
                                <p><a href='mailto:brian.hubbs@knoxcounty.org'>Brian Hubbs</a><br/>(865) 215-5753</p></td> <!-- mysql_result($query, $i, "name") -->
                                <td bgcolor="#FFFFFF">
                                    <a href='/purchasing/pdfs/showfile.php?id=6887&&filename=AD FOR BIDS - BID 3764.pdf'>Click Here for the Solicitation</a><br><br><a href='/purchasing/pdfs/showfile.php?id=6894&&filename=Bid 3764 - Sign-In Sheet.pdf'>Click Here for the Other</a><br><br><a href='/purchasing/pdfs/showfile.php?id=6900&&filename=ADDENDUM I-BID 3764.pdf'>Click Here for the Addendum I</a><br><br>                                </td>
                              </tr>
<tr bgcolor="#FFFFFF">
                                  <td colspan="5">
                                    <strong>Note:</strong> A Mandatory Pre-Bid Meeting will be held on September 22, 2026 at promptly 10:00 a.m. local time.  Meeting will be held at the Knox County Procurement Office, 1000 N. Central Street, Suite 100, Knoxville, TN 37917.  Bidders must have a representative present at the mandatory pre-bid meeting in order for their bid to be considered.                                  </td>
                              </tr>
<tr bgcolor="#DFEFFF">
                                                                <td  >
                                    <!-- =mysql_result($query, $i, "title") -->
                                     Adult Opioid Overdose Prevention and Recovery Social Media Initiative                                </td>
                                <td><!-- =mysql_result($query, $i, "bid")? -->
                                    3762                                </td>
                                <td>10-07-26</td> <!-- date("m-d-y", mysql_result($query, $i, "open")) -->
                                 <!-- $h = mysql_result($query, $i, "title_buyer")."<br>".mysql_result($query, $i, "phone") -->
                                <td bgcolor="#DFEFFF">
                                <p><a href='mailto:susan.colella@knoxcounty.org'>Susan Colella</a><br/>(865) 215-5769</p></td> <!-- mysql_result($query, $i, "name") -->
                                <td bgcolor="#DFEFFF">
                                    <a href='/purchasing/pdfs/showfile.php?id=6881&&filename=RFP 3762.pdf'>Click Here for the Solicitation</a><br><br><a href='/purchasing/pdfs/showfile.php?id=6892&&filename=ADDENDUM II.pdf'>Click Here for the Addendum II</a><br><br><a href='/purchasing/pdfs/showfile.php?id=6882&&filename=ADDENDUM I.pdf'>Click Here for the Addendum I</a><br><br>                                </td>
                              </tr>
</table>`;

// ETSU (https://www.etsu.edu/facilities/planning/bid.php), Sep 29.
const ETSU = `<h2 class="level4"><span class="underline thick gold tucked text--uppercase border--gold border--threeFourth border--quarter">Available Projects to Bid</span></h2>
                  <p>&nbsp;</p>
                  <table style="height: 100px; width: 546px; background-color: #fbeeb8; border-color: #236fa1; border-style: solid; margin-left: auto; margin-right: auto;">
                     <tbody>
                        <tr>
                           <td style="border-color: #236fa1;">
                              <p><strong>SBC Project:</strong></p>
                              <p style="padding-left: 40px;">369/005-05-2024<br>East Tennessee State University<br>COM Bldg 2 Learning Community Renovation<br>Johnson City, Tennessee</p>
                              </td>
                           </tr>
                        <tr>
                           <td style="border-color: #236fa1;">
                              <p><strong>Bids Received:</strong></p>
                              <p style="padding-left: 40px;">The Physical Plant<br>Wilbur Bond Maintenance Building<br>East Tennessee State University<br>1380 Jack Vest Drive<br>Johnson City, Tennessee &nbsp; 37614</p>
                              <p style="padding-left: 40px;">until&nbsp;</p>
                              <p style="padding-left: 40px;"><strong>UPDATED 2:00 pm local time Wednesday, October 7, 2026</strong></p>
                              </td>
                           </tr>
                        <tr>
                           <td style="border-color: #236fa1;">
                              <p><strong>Designer:</strong></p>
                              <p style="padding-left: 40px;">Clark Nexsen, Inc.<br>121 N. Commerce Street Suite 103<br>Johnson City, TN &nbsp;37601<br>Contact: &nbsp;Chadwick Roberson<br>Phone: &nbsp;(828) 333-6278</p>
                              </td>
                           </tr>
                        </tbody>
                     </table>
                  <hr>
               </div>`;

// Tennessee Tech (https://www.tntech.edu/capital-projects/sbc-capital/bid-list.php), Sep 29:
// the first project and the (empty) TBR table.
const TTU = `<h3>TN Tech&nbsp;Managed Projects</h3>
                           <p>Please click on available projects below for bidding information and related documents.
                              Any addenda issued will be posted in the project drop-down.</p>
                           <section class="accordionSection">
                              <div class="grid-x">
                                 <div class="medium-12 cell">
                                    <p class="h3 title"></p>
                                 </div>
                              </div>
                              <div class="grid-x">
                                 <div class="medium-12 cell">
                                    <ul class="accordion" data-accordion="data-accordion" data-allow-all-closed="true">
                                       <li class="accordion-item" data-accordion-item="data-accordion-item"><a href="#" class="accordion-title">Track and Field Facility&nbsp; SBC# 364/011-05-2025
                                             <div class="triangle"></div></a><div class="accordion-content" data-tab-content="data-tab-content">
                                             <p>
                                                <h4><span style="font-size: 1.6rem;">Project Description:</span></h4>
                                                <p>Project includes but may not be limited to, the addition of a competition track &amp;
                                                   field facility with a multi-purpose artificial turf athletic field, complete with
                                                   amenities including a masonry storage building and field lighting.&nbsp; &nbsp;The new facility
                                                   will be located on a portion of the Intramural Field that is near the corner of West
                                                   12th Street and North Willow Avenue.</p>
                                                <p><span style="font-size: 1.6rem;">Pre-Bid:</span></p>
                                                <p>Wednesday, &nbsp;August 12, 2026</p>
                                                <p>at 9:00 AM, local time</p>
                                                <p>TTU Facilities Office Building</p>
                                                <p>Conference Room 107</p>
                                                <p>220 West 10th Street</p>
                                                <p>Cookeville, TN 38501</p>
                                                <p><span style="font-size: 1.6rem;">Bid Opening:</span></p>
                                                <p>Wednesday,&nbsp; August 26 , 2026</p>
                                                <p>at 2:00 PM, local time</p>
                                                <p>TTU Facilities Office Building</p>
                                                <p>220 W. 10th Street,</p>
                                                <p>Cookeville, TN 38501</p>
                                                <p>Bids will be received in office 116</p>
                                                <p>Bids will be opened in room 107</p>
                                                <p><span style="font-size: 1.6rem;">Documents:</span></p>
                                                <p>Please contact, Art Carlton, at Bauer Askew Architecture, <a href="mailto:acarlton@baueraskewarchitecture.com">acarlton@baueraskewarchitecture.com</a></p>
                                                <p>615-726-0047</p>
                                                <p><a class="button goldBtn " href="/capital-projects/files/10_bid_docs/TRACK_001116_InvitationToBid.pdf">INVITATION TO BID</a></p>
                                                <p><a class="button goldBtn " href="/capital-projects/files/10_bid_docs/TRACK_ADD_1_Final.pdf">ADDENDUM 1</a></p>
                                                <p>&nbsp;</p>
                                                <p>&nbsp;</p>
                                                <p>&nbsp;</p>
                                                </p>
                                          </div>
                                       </li>
                                       </ul>
<h3>TBR Managed Projects</h3>
                           <p>Projects begun with TBR prior to&nbsp;June 30, 2018 will continue to bid through and be
                              managed by TBR.&nbsp;</p>
                           <p>Official postings of project bids should be obtained from the&nbsp;TBR website&nbsp;and the
                              most current posted version of the <a class="button purpleBarBtn " href="https://www.tbr.edu/facilities/construction-bid">TBR Construction Bid List</a>.</p>
                           <h4>Current TBR Bid Opportunities:</h4>
                           <table>
                              <thead>
                                 <tr>
                                    <td>Project Name</td>
                                    <td>SBC#</td>
                                    <td>Bid Date</td>
                                    </tr>
                                 </thead>
                              <tbody>
                                 <tr>
                                    <td>None available at this time</td>
                                    <td>&nbsp;</td>
                                    <td>&nbsp;</td>
                                    </tr>
                                 </tbody>
                              </table>`;

// Austin Peay (https://www.apsu.edu/univ-design-and-construction/construction_bid_list.php).
const APSU = `<h2>Project Bids</h2>
            <div id="accordion-d27e166" class="accordion"><button class="accordion__toggle accordion__toggle--active" tabindex="0"><span class="hide">Toggle </span><span class="accordion__icon accordion__icon--inactive"><span class="svgstore svgstore--DropDown_Arrow_Down"><svg><use xlink:href="/_resources/images/svgstore.svg#DropDown_Arrow_Down"></use></svg></span></span><span class="accordion__icon accordion__icon--active"><span class="svgstore svgstore--DropDown_Arrow_Up"><svg><use xlink:href="/_resources/images/svgstore.svg#DropDown_Arrow_Up"></use></svg></span></span>Baseball Field Drainage Upgrades</button><div class="accordion__content accordion__content--active" tabindex="0">
                  <h3>Baseball Field Drainage Upgrades Bid Schedule</h3>
                  <p><a class="button button--full" href="/univ-design-and-construction/files/373-003-01-2026-invitation-to-bid.pdf" target="_blank" rel="noopener noreferrer" aria-describedby="new-tab-warning" data-link-processed="true">Invitation to Bid<span class="link-file-type"> (PDF)</span></a></p>
                  <p>&nbsp;</p>
                  <table style="width: 100%;">
                     <tbody>
                        <tr>
                           <td style="width: 50%; vertical-align: top;">
                              <h4>Pre-Bid Conference</h4>
                              <p>June 24, 2026 at 2:00 p.m. CDT</p>
                              <p>&nbsp;</p>
                              <p>255 Marion Street, Suite 10<br>Clarksville, TN 37044</p>
                              </td>
                           <td style="width: 20px; vertical-align: top;">
                              <p><strong>&nbsp;</strong></p>
                              </td>
                           <td style="width: 50%; vertical-align: top;">
                              <h4>Bid Opening</h4>
                              <p>Due by July 8, 2026, 2:00 p.m. CDT</p>
                              <p>&nbsp;</p>
                              <p>Received at<br>255 Marion Street, Suite 10<br>Clarksville, TN 37044</p>
                              </td>
                           </tr>
                        </tbody>
                     </table>
                  <p>&nbsp;</p>
                  <hr>
                  <p style="text-align: left;">&nbsp;</p>
                  <h4 style="text-align: center;">Questions?</h4>
                  <p style="text-align: center;">All questions related to the bidding documents should be directed to the engineers
                     and designer:</p>
                  <p style="text-align: center;">&nbsp;</p>
                  <p style="text-align: center;"><strong>Bacon Farmer Workman Engineering &amp; Testing, Inc.<br></strong>1215 Diuguid Drive, Murray, Kentucky 42071<br>phone: (270) 753-7307&nbsp; |&nbsp; fax: (270) 759-4950<br><em>Designer: </em>Christopher N. Farmer, P.E.<br><a href="https://bfwengineers.com/" data-link-processed="true">bfwengineers.com</a></p>
                  <p style="text-align: center;">&nbsp;</p>
                  <hr>
                  <p style="text-align: left;">&nbsp;</p>
                  <p style="text-align: center;"><strong>APSU Contact<br></strong>Capital Planning, Design &amp; Construction<strong><br></strong>(931) 221-6197&nbsp; | &nbsp;<a href="mailto:udc@apsu.edu" data-link-processed="true">udc@apsu.edu</a></p>
                  </div>
            </div>`;

// TBR (https://www.tbr.edu/facilities/construction-bid), Sep 29: three of the nine rows.
const TBR = `<table  class="views-table cols-4">
         <thead>
      <tr>
                  <th  class="views-field views-field-nothing" scope="col">
            Submittal Deadline          </th>
                  <th  class="views-field views-field-nothing-1" scope="col">
            Project          </th>
                  <th  class="views-field views-field-body" scope="col">
            Project Description           </th>
                  <th  class="views-field views-field-nothing-2" scope="col">
            Solicitor          </th>
              </tr>
    </thead>
    <tbody>
<tr  class="odd views-row-first">
                  <td  class="views-field views-field-nothing">
            October 14, 2026 02:00 PM local time <br />
Chattanooga<br />
Bid<br />
          </td>
                  <td  class="views-field views-field-nothing-1">
            in Chattanooga, TN <br />
012-02-2023 <br />
Chattanooga SCC<br />
TCAT Chattanooga Bldg 2 &amp; Auto Tech Bldg Update<br />          </td>
                  <td  class="views-field views-field-body">
            Renovate select areas of TCAT Building 2 and the Auto Tech Building.  Project includes all related work.          </td>
                  <td  class="views-field views-field-nothing-2">
            Hefferlin + Kronenberg Architects PLLC <br />
Contact: Clifton McCormick<br />
423-713-7935 <br />
$ document deposit <br />          </td>
              </tr>
<tr  class="odd">
                  <td  class="views-field views-field-nothing">
            September 30, 2026 02:00 PM local time <br />
Nashville<br />
Bid<br />
          </td>
                  <td  class="views-field views-field-nothing-1">
            in Nashville, TN <br />
064-01-2022A <br />
TCAT - Nashville<br />
Building 6 Re-Roof<br />          </td>
                  <td  class="views-field views-field-body">
            Removal and construction of approximately 10,875 SF of roofing on existing Building 6 at TCAT - Nashville          </td>
                  <td  class="views-field views-field-nothing-2">
            Johnson Johnson Crabtree Architects P.C. <br />
Contact: Linda Mark<br />
615-837-0656 <br />
$0 document deposit <br />          </td>
              </tr>
<tr  class="even">
                  <td  class="views-field views-field-nothing">
            September 30, 2026 02:00 PM local time <br />
Knoxville<br />
Bid<br />
          </td>
                  <td  class="views-field views-field-nothing-1">
            in Jacksboro, TN <br />
056-01-2023F <br />
TCAT - Jacksboro<br />
Furniture Package<br />          </td>
                  <td  class="views-field views-field-body">
            Furniture package for the capital project.          </td>
                  <td  class="views-field views-field-nothing-2">
            MBI Companies, Inc. <br />
Contact: Erin Harlow<br />
615-524-0326 <br />
$ document deposit <br />          </td>
              </tr>
</tbody>
</table>`;

// MTSU (https://www.mtsu.edu/campusplanning/construction/), Sep 29: the table is empty.
const MTSU = `<h1 class="entry-title">Construction Bid List</h1>
<figure class="wp-block-table"><table><tbody><tr><th><strong>Submittal Deadline</strong></th><th><strong>Project</strong></th><th><strong>Project Description</strong></th><th><strong>Solicitor</strong></th></tr><tr><td></td><td></td><td><br></td><td></td></tr><tr><td></td><td></td><td></td><td></td></tr></tbody></table></figure>
<p class="wp-block-paragraph"><strong>MTSU Project Bid List</strong></p>
<p class="wp-block-paragraph"><strong>Notice to Bidders</strong><br><strong>Bid Opportunity</strong></p>`;

// Chattanooga-Hamilton County RPA building permits, two features as the query returned them.
const CHATT_SHELL: ChattanoogaPermit = {
  OBJECTID: 91326,
  PERMIT_NUM: "CB-26-341",
  ADDRESS: "1412 MORRIS HILL RD",
  VALUATION: 4250000,
  PERMIT_DAT: 1785520560000,
  PERMIT_YEAR: 2026,
  CATEGORY: "New",
  P_TYPE: "Non-Residential",
  DEV_TYPE_C: "328",
  P_DESC:
    "SECOND OF 2 NEW 19,063 S.F., 2-STORY MIXED USE COMMERCIAL COLD DARK SHELL BUILDINGS ON THIS SITE, EACH ARE MIRROR COPIES OF THE OTHER. MASONRY & STEEL FRAME CONSTRUCTION WITH BRICK VENEER AND FIBER CEMENT SIDING, STUB UP PLUMBING & ELECTRICAL LOCATIONS ON",
  CITY: "Chattanooga",
};
const CHATT_TACO: ChattanoogaPermit = {
  OBJECTID: 91315,
  PERMIT_NUM: "CB-26-330",
  ADDRESS: "4115 HIXSON PIKE",
  VALUATION: 750000,
  PERMIT_DAT: 1785503160000,
  PERMIT_YEAR: 2026,
  CATEGORY: "New",
  P_TYPE: "Non-Residential",
  DEV_TYPE_C: "327",
  P_DESC: "New Freestanding Taco Bell restaurant\u00a0",
  CITY: "Chattanooga",
};

describe("BidNet list (bidnet)", () => {
  it("reads the rows, the count and the last page", () => {
    const { rows, total, lastPage } = parseBidnetList(BIDNET);
    expect(total).toBe(272);
    expect(lastPage).toBe(11);
    expect(rows).toEqual([
      {
        id: "444177732225",
        title: "Porte Cochere Addition For: Kingsport Senior Center",
        region: "Tennessee",
        publishedOn: "2026-09-29",
        closingOn: "2026-10-22",
        url: "https://www.bidnetdirect.com/public/supplier/solicitations/statewide/444177732225/abstract?purchasingGroupId=388528051&origin=1",
      },
      {
        id: "444178020062",
        title: "BHS Gym Audio",
        region: "Tennessee",
        publishedOn: "2026-09-29",
        closingOn: "2026-10-19",
        url: "https://www.bidnetdirect.com/public/supplier/solicitations/statewide/444178020062/abstract?purchasingGroupId=388528051&origin=1",
      },
    ]);
    expect(bidnetPageUrl("tennessee", 1)).toBe("https://www.bidnetdirect.com/tennessee");
    expect(bidnetPageUrl("kentucky", 3)).toBe(
      "https://www.bidnetdirect.com/kentucky/solicitations/open-bids/page3",
    );
  });

  it("tells the robot check from a list page", () => {
    expect(isBidnetChallenge(202, CHALLENGE)).toBe(true);
    expect(isBidnetChallenge(200, CHALLENGE)).toBe(true);
    expect(isBidnetChallenge(200, BIDNET)).toBe(false);
    expect(parseBidnetList(CHALLENGE).rows).toEqual([]);
  });

  it("reads the abstract's closing time in the zone it names", () => {
    expect(parseBidnetAbstract(ABSTRACT)).toEqual({
      publishedText: "09/29/2026 03:09 PM EDT",
      closingText: "10/22/2026 04:00 PM EDT",
      closingAt: "2026-10-22T20:00:00.000Z",
    });
    const central = ABSTRACT.replace("04:00 PM EDT", "02:00 PM CDT");
    expect(parseBidnetAbstract(central).closingAt).toBe("2026-10-22T19:00:00.000Z");
  });

  it("makes a lead: the group as agency, 4 PM Eastern unless the abstract was read", () => {
    const [porte] = parseBidnetList(BIDNET).rows;
    const lead = bidnetLead(porte!, TN, KEYWORDS);
    expect(lead).toMatchObject({
      source: "bidnet",
      external_id: "444177732225",
      title: "Porte Cochere Addition For: Kingsport Senior Center",
      agency: "Tennessee Purchasing Group (BidNet)",
      location: null,
      city: null,
      county: null,
      state: "TN",
      bid_at: "2026-10-22T20:00:00.000Z",
      issued_on: "2026-09-29",
      url: porte!.url,
      contact: null,
      is_roof: false,
    });
    expect((lead.raw as { closing_time: string }).closing_time).toMatch(/assumed/);
    const read = bidnetLead(
      { ...porte!, title: "Roof Replacement - Warren County Justice Center" },
      KY,
      KEYWORDS,
      { at: "2026-10-22T18:00:00.000Z", text: "10/22/2026 02:00 PM EDT" },
    );
    expect(read).toMatchObject({
      agency: "Kentucky Purchasing Group (BidNet)",
      state: "KY",
      county: "Warren",
      location: "Warren County",
      bid_at: "2026-10-22T18:00:00.000Z",
      is_roof: true,
    });
  });

  it("takes the place only when the title names one", () => {
    expect(bidnetPlace("Crow Recreation Center HVAC Replacement for City of Clarksville")).toEqual({
      city: "Clarksville",
      county: null,
    });
    expect(bidnetPlace("Mowing Services for City of Franklin Park Department").city).toBe(
      "Franklin",
    );
    expect(bidnetPlace("Demolition Svc Warren County P.24").county).toBe("Warren");
    expect(bidnetPlace("Serving Line Counters for Hamilton County Schools").county).toBe(
      "Hamilton",
    );
    expect(bidnetPlace("Kingsport City Schools Re-Roof").city).toBe("Kingsport");
    expect(bidnetPlace("BHS Gym Audio")).toEqual({ city: null, county: null });
  });

  it("drops a BidNet copy of a job the owner's own list already has", () => {
    const [porte] = parseBidnetList(BIDNET).rows;
    const copy = bidnetLead(
      { ...porte!, title: "RFB-86-27 Roof Replacement Jackson State Office Building" },
      KY,
      KEYWORDS,
    );
    const state = {
      ...copy,
      source: "ky_planroom",
      title: "RFB-86-27 FSS – Jackson SOB Roof Replacement",
    };
    const { keep, dropped } = dropPlanroomDuplicates([copy], [state]);
    expect(keep).toEqual([]);
    expect(dropped).toEqual(["444177732225"]);
  });
});

describe("BidNet pull (one page at a time, robot checks skipped)", () => {
  afterEach(() => vi.unstubAllGlobals());

  const page = (ids: string[]) =>
    BIDNET.replace(/<tbody>[\s\S]*<\/tbody>/, () => {
      const [row] = /<tr [\s\S]*?<\/tr>/.exec(BIDNET)!;
      return `<tbody>${ids.map((id) => row.replaceAll("444177732225", id)).join("")}</tbody>`;
    }).replace("272 Open Solicitations", "60 Open Solicitations");

  it("reads every page in turn, skips a robot-checked page and says so", async () => {
    const asked: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        asked.push(url);
        if (url.endsWith("/page2")) return new Response(CHALLENGE, { status: 202 });
        const ids = url.endsWith("/page3") ? ["3001", "3002"] : ["1001", "1002"];
        return new Response(page(ids), { status: 200 });
      }),
    );
    const r = await fetchBidnetList(TN, Date.now() + 60000);
    expect(asked).toEqual([
      "https://www.bidnetdirect.com/tennessee",
      "https://www.bidnetdirect.com/tennessee/solicitations/open-bids/page2",
      "https://www.bidnetdirect.com/tennessee/solicitations/open-bids/page3",
    ]);
    expect(r.pages).toBe(3);
    expect(r.read).toBe(2);
    expect(r.requests).toBe(3);
    expect(r.rows.map((x) => x.id)).toEqual(["1001", "1002", "3001", "3002"]);
    expect(r.problem).toBe(
      "→ 2 of 3 pages read; 1 of 3 pages answered with a robot check (AWS WAF challenge; not retried): page 2",
    );
  });

  it("fails loudly when the first page is a robot check or unreadable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(CHALLENGE, { status: 202 })),
    );
    await expect(fetchBidnetList(KY, Date.now() + 60000)).rejects.toThrow(/robot check/);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html>272 Open Solicitations</html>", { status: 200 })),
    );
    await expect(fetchBidnetList(KY, Date.now() + 60000)).rejects.toThrow(/nothing parsed/);
  });

  it("stops at the time budget", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(page(["1"]), { status: 200 })),
    );
    const r = await fetchBidnetList(TN, Date.now() - 1);
    expect(r.requests).toBe(1);
    expect(r.problem).toMatch(/stopped after page 1 of 3/);
  });
});

describe("Chattanooga permits (chattanooga_permits)", () => {
  it("asks for new non-residential over the cost floor in the last 180 days, in WGS84", () => {
    const url = new URL(chattanoogaQueryUrl(100000, 0, new Date("2026-09-29T12:00:00Z")));
    expect(url.pathname).toBe(
      "/cclAu9OKhOfjeUdr/arcgis/rest/services/Building_Permits_to_April_2021/FeatureServer/0/query",
    );
    expect(url.searchParams.get("where")).toBe(
      "P_TYPE = 'Non-Residential' AND PERMIT_DAT >= DATE '2026-04-02' AND (DEV_TYPE_C IS NULL OR DEV_TYPE_C <> '329') AND VALUATION >= 100000",
    );
    expect(url.searchParams.get("outSR")).toBe("4326");
    expect(url.searchParams.get("returnGeometry")).toBe("true");
    expect(new URL(chattanoogaQueryUrl(0)).searchParams.get("where")).not.toMatch(/VALUATION/);
  });

  it("makes a permit lead: building kind as title, the site, Eastern issue day, a roof", () => {
    const lead = chattanoogaLead(CHATT_SHELL, { lat: 35.00197, lng: -85.13178 }, KEYWORDS);
    expect(lead).toMatchObject({
      source: "chattanooga_permits",
      external_id: "CB-26-341",
      title: "New non-residential — Other non-residential",
      agency: "Chattanooga-Hamilton County RPA",
      location: "1412 MORRIS HILL RD, Chattanooga, TN",
      address: "1412 MORRIS HILL RD",
      city: "Chattanooga",
      county: "Hamilton",
      state: "TN",
      lat: 35.00197,
      lng: -85.13178,
      project_type: "Other non-residential",
      sqft: 19063,
      project_cost: 4250000,
      contact: null,
      issued_on: "2026-07-31", // 1785520560000 = Jul 31, 13:56 EDT
      url: null,
      is_roof: true,
    });
    const taco = chattanoogaLead(CHATT_TACO, { lat: null, lng: null }, KEYWORDS);
    expect(taco.title).toBe("New non-residential — Stores and customer services");
    expect(taco.sqft).toBeNull();
    expect(taco.is_roof).toBe(true);
    // An unknown building code falls back to the keywords.
    expect(
      chattanoogaLead({ ...CHATT_TACO, DEV_TYPE_C: null }, { lat: null, lng: null }, KEYWORDS)
        .is_roof,
    ).toBe(false);
    expect(easternDay(Date.UTC(2026, 6, 31, 3, 30))).toBe("2026-07-30"); // 11:30 pm EDT
  });
});

describe("Knox County solicitations (knox_county_bids)", () => {
  it("reads each row with its buyer, documents and pre-bid note", () => {
    const bids = parseKnoxCountyBids(KNOX);
    expect(bids).toHaveLength(2);
    const [signals, opioid] = bids;
    expect(signals).toMatchObject({
      number: "3764",
      title:
        "Traffic Signals at Nubbin Ridge Road and Ebenezer Road & Pedigo Road and E. Emory Road (S.R. 131)",
      deadlineText: "10-06-26",
      bidAt: "2026-10-06T18:00:00.000Z", // 2:00 PM EDT (assumed: the page gives no time)
      buyer: "Brian Hubbs",
      phone: "(865) 215-5753",
      email: "brian.hubbs@knoxcounty.org",
      prebidAt: "2026-09-22T14:00:00.000Z", // 10:00 a.m. local (Eastern)
    });
    expect(signals!.documents.map((d) => d.label)).toEqual(["Solicitation", "Other", "Addendum I"]);
    expect(signals!.documents[0]!.url).toBe(
      "https://www.knoxcounty.org/purchasing/pdfs/showfile.php?id=6887&&filename=AD%20FOR%20BIDS%20-%20BID%203764.pdf",
    );
    expect(opioid).toMatchObject({ number: "3762", note: null, prebidAt: null });
  });

  it("makes a lead: Knox County, Knoxville, the buyer as contact, the solicitation PDF", () => {
    const lead = knoxCountyLead(parseKnoxCountyBids(KNOX)[0]!, KEYWORDS);
    expect(lead).toMatchObject({
      source: "knox_county_bids",
      external_id: "3764",
      agency: "Knox County",
      location: "Knoxville",
      city: "Knoxville",
      county: "Knox",
      state: "TN",
      contact: "Brian Hubbs — (865) 215-5753 — brian.hubbs@knoxcounty.org",
      url: "https://www.knoxcounty.org/purchasing/pdfs/showfile.php?id=6887&&filename=AD%20FOR%20BIDS%20-%20BID%203764.pdf",
      is_roof: false,
    });
    expect((lead.raw as { bid_time: string }).bid_time).toMatch(/2:00 PM ET assumed/);
    expect(parseKnoxCountyBids("<html><body>Maintenance</body></html>")).toEqual([]);
  });
});

describe("TN university bid lists (tn_university_bids)", () => {
  it("ETSU: SBC number, project, bid time (Eastern) and the designer", () => {
    const s = school("etsu");
    expect(isTnUniversityPage(ETSU, s)).toBe(true);
    const [b] = s.parse(ETSU, s);
    expect(b).toMatchObject({
      id: "369/005-05-2024",
      title: "COM Bldg 2 Learning Community Renovation",
      city: "Johnson City",
      designer: "Clark Nexsen, Inc.",
      contact: "Clark Nexsen, Inc. — Chadwick Roberson — (828) 333-6278",
      bidAt: "2026-10-07T18:00:00.000Z", // 2:00 pm EDT
    });
    expect(tnUniversityLead(b!, s, KEYWORDS)).toMatchObject({
      source: "tn_university_bids",
      external_id: "etsu:369/005-05-2024",
      agency: "East Tennessee State University",
      county: "Washington",
      state: "TN",
      contractor: "Clark Nexsen, Inc.",
      url: "https://www.etsu.edu/facilities/planning/bid.php",
      is_roof: false,
    });
  });

  it("Tennessee Tech: date and time on separate lines (Central), the invitation PDF, no TBR rows", () => {
    const s = school("ttu");
    const bids = s.parse(TTU, s);
    expect(bids).toHaveLength(1);
    expect(bids[0]).toMatchObject({
      id: "364/011-05-2025",
      title: "Track and Field Facility",
      prebidAt: "2026-08-12T14:00:00.000Z", // 9:00 AM CDT
      bidAt: "2026-08-26T19:00:00.000Z", // 2:00 PM CDT
      designer: "Bauer Askew Architecture",
      contact:
        "Art Carlton, Bauer Askew Architecture — acarlton@baueraskewarchitecture.com — 615-726-0047",
      url: "https://www.tntech.edu/capital-projects/files/10_bid_docs/TRACK_001116_InvitationToBid.pdf",
    });
    expect(bids[0]!.description).toMatch(/^Project includes but may not be limited to/);
  });

  it("Austin Peay: the toggle title, CDT times, the designer, the SBC number from the PDF", () => {
    const s = school("apsu");
    const [b] = s.parse(APSU, s);
    expect(b).toMatchObject({
      id: "373/003-01-2026",
      title: "Baseball Field Drainage Upgrades",
      prebidAt: "2026-06-24T19:00:00.000Z",
      bidAt: "2026-07-08T19:00:00.000Z",
      designer: "Bacon Farmer Workman Engineering & Testing, Inc.",
      contact:
        "Bacon Farmer Workman Engineering & Testing, Inc. — Christopher N. Farmer, P.E. — (270) 753-7307",
      url: "https://www.apsu.edu/univ-design-and-construction/files/373-003-01-2026-invitation-to-bid.pdf",
    });
  });

  it("TBR: one row per project, the institution, local time by region, the roof job flagged", () => {
    const s = school("tbr");
    expect(isTnUniversityPage(TBR, s)).toBe(true);
    const bids = s.parse(TBR, s);
    expect(bids.map((b) => [b.id, b.institution, b.city, b.bidAt])).toEqual([
      ["012-02-2023", "Chattanooga SCC", "Chattanooga", "2026-10-14T18:00:00.000Z"], // EDT
      ["064-01-2022A", "TCAT - Nashville", "Nashville", "2026-09-30T19:00:00.000Z"], // CDT
      ["056-01-2023F", "TCAT - Jacksboro", "Jacksboro", "2026-09-30T18:00:00.000Z"], // EDT
    ]);
    const roof = tnUniversityLead(bids[1]!, s, KEYWORDS);
    expect(roof).toMatchObject({
      external_id: "tbr:064-01-2022A",
      title: "Building 6 Re-Roof",
      agency: "TCAT - Nashville (TBR)",
      city: "Nashville",
      county: "Davidson",
      contractor: "Johnson Johnson Crabtree Architects P.C.",
      contact: "Johnson Johnson Crabtree Architects P.C. — Linda Mark — 615-837-0656",
      url: "https://www.tbr.edu/facilities/construction-bid",
      is_roof: true,
    });
    expect(tnUniversityLead(bids[0]!, s, KEYWORDS).county).toBeNull();
  });

  it("MTSU: the same table, empty today — zero bids, not an error", () => {
    const s = school("mtsu");
    expect(isTnUniversityPage(MTSU, s)).toBe(true);
    expect(s.parse(MTSU, s)).toEqual([]);
    expect(isTnUniversityPage("<html><h1>Page not found</h1></html>", s)).toBe(false);
  });
});
