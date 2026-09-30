import { describe, expect, it } from "vitest";

import {
  campusLead,
  cityLead,
  dropPlanroomDuplicates,
  lynnLead,
  samLead,
  samQueryUrl,
  parseBgkyBids,
  parseLongDate,
  parseLynnFeed,
  parsePaducahBids,
} from "@/lib/leads.server";

const KEYWORDS = ["roof", "roofing", "re-roof", "membrane", "epdm", "tpo", "shingle"];

// Two items copied from https://www.lynnimaging.com/bids/feed/ on Sep 29, 2026.
const LYNN = `<?xml version="1.0"?><rss><channel><item>
		<title>First Presbyterian Church of Mayfield &#8211; A New Church Facility</title>
		<link>https://www.lynnimaging.com/bids/2026/09/28/first-presbyterian-church-of-mayfield-a-new-church-facility/</link>
					<comments>https://www.lynnimaging.com/bids/2026/09/28/first-presbyterian-church-of-mayfield-a-new-church-facility/#respond</comments>
		
		<dc:creator><![CDATA[Lynn Imaging Distribution Team]]></dc:creator>
		<pubDate>Mon, 28 Sep 2026 14:42:06 +0000</pubDate>
				<category><![CDATA[Uncategorized]]></category>
		<guid isPermaLink="false">https://www.lynnimaging.com/bids/2026/09/28/first-presbyterian-church-of-mayfield-a-new-church-facility/</guid>

					<description><![CDATA[First Presbyterian Church of Mayfield &#8211; A New Church Facility The entire project will consist of 7 structures to be constructed on a campus in central Mayfield, KY that encompasses a portion of two city blocks that front on Broadway, Ninth, and North Streets. The Main Campus, facing Broadway, will have 4 structures (1 heated, [&#8230;]]]></description>
										<content:encoded><![CDATA[<p><b>First Presbyterian Church of Mayfield &#8211; A New Church Facility</b></p>
<p>The entire project will consist of 7 structures to be constructed on a campus in central Mayfield,<br />
KY that encompasses a portion of two city blocks that front on Broadway, Ninth, and North<br />
Streets. The Main Campus, facing Broadway, will have 4 structures (1 heated, 2 open-air<br />
structures and an open-air, but fenced playground). The North Campus, fronting the corner of<br />
9th and North Streets, will consist of 3 permanent structures. The specifications for all 7<br />
structures are contained within the project manual, and the drawings are provided in two<br />
volumes as described below.</p>
<p><b>Project Location:</b>  Mayfield, Kentucky</p>
<p><a href="/distribution/View/ViewJob.aspx?job_id=29688">More Details</a></p>
]]></content:encoded>
					
					<wfw:commentRss>https://www.lynnimaging.com/bids/2026/09/28/first-presbyterian-church-of-mayfield-a-new-church-facility/feed/</wfw:commentRss>
			<slash:comments>0</slash:comments>
		
		
			</item>
<item>
		<title>Housing Authority of Maysville &#8211; Flat Roof Replacement</title>
		<link>https://www.lynnimaging.com/bids/2026/09/25/housing-authority-of-maysville-flat-roof-replacement/</link>
					<comments>https://www.lynnimaging.com/bids/2026/09/25/housing-authority-of-maysville-flat-roof-replacement/#respond</comments>
		
		<dc:creator><![CDATA[Lynn Imaging Distribution Team]]></dc:creator>
		<pubDate>Fri, 25 Sep 2026 16:11:37 +0000</pubDate>
				<category><![CDATA[Uncategorized]]></category>
		<guid isPermaLink="false">https://www.lynnimaging.com/bids/2026/09/25/housing-authority-of-maysville-flat-roof-replacement/</guid>

					<description><![CDATA[Housing Authority of Maysville &#8211; Flat Roof Replacement The work to be performed consists of: • Remove existing flat roofs, and provide and install new EPDM roof system with all necessary accessories. • Remove existing, provide and install new metal coping at fire walls. • Remove existing, provide new gutters and downspouts. Work includes providing [&#8230;]]]></description>
										<content:encoded><![CDATA[<p><b>Housing Authority of Maysville &#8211; Flat Roof Replacement</b></p>
<p>The work to be performed consists of:</p>
<p>• Remove existing flat roofs, and provide and install new EPDM roof system with all necessary<br />
accessories.<br />
• Remove existing, provide and install new metal coping at fire walls.<br />
• Remove existing, provide new gutters and downspouts.<br />
Work includes providing all items, articles, materials, operations or methods herein listed, mentioned<br />
or scheduled on the Project Documents and / or herein, including all labor, materials, equipment, services and<br />
incidentals as necessary for their completion.</p>
<p><b>Project Location:</b>  Maysville, Kentucky</p>
<p><a href="/distribution/View/ViewJob.aspx?job_id=29686">More Details</a></p>
]]></content:encoded>
					
					<wfw:commentRss>https://www.lynnimaging.com/bids/2026/09/25/housing-authority-of-maysville-flat-roof-replacement/feed/</wfw:commentRss>
			<slash:comments>0</slash:comments>
		
		
			</item></channel></rss>`;
// The "Open Opportunities" table from https://www.bgky.org/bids on Sep 29, 2026.
const BG = `<html><body><h3><strong>Open Opportunities</strong></h3>

    <table class="table table-striped">
        <thead>
            <tr>
                <th style="width:75%;">Title</th>
                <th style="width:25%;">Posted Date</th>
            </tr>
            </thead>

            <tr>
            <td><a href="https://bgky.bonfirehub.com/opportunities/253906">Reference #: 2027-11. Name: Parking Lot Overlay - Police East Precinct</a></p></td>
            <td>Sep 21, 2026</td>
        </tr>
        </table>


    <h3><strong></h3></body></html>`;
// The "Active Requests" block from https://paducahky.gov/request-bids-or-proposals, Sep 29, 2026.
const PADUCAH = `<html><body><h2>Active Requests for Bids or Proposals</h2>
<h4>Request for Proposals - Professional Services - Design, Engineering, and Construction Administration - Coleman Road Sidewalk Project</h4>
<p class="MsoNoSpacing">The City of Paducah, Kentucky, is requesting proposals from professional services firms to assist the City in designing and engineering the Coleman Road Sidewalk Project.</p>
<p><a class="buttons button-blue-white" data-file-id="23635" href="/files/9/RFP-2026-Paducah-Coleman-Rd-Sidewalk-Project-RFP.pdf">RFP Information Packet - Coleman Road Sidewalk Project</a></p>
<p>Five (5) individual copies of the proposal should be submitted to the City of Paducah, Attn: City Clerk’s Office, 300 South 5th Street, P.O. Box 2267, Paducah, KY 42002-2267, and clearly marked on the outside with “Bid Documents: Coleman Rd-Engineering RFP”. Alternately, proposals may be emailed to <a href="" class="PYVq--YWvKitItgA" data-href="#zgbjafraq/ng/cnqhpnuxl.tbi"><span class="PYVq--YWvKitItgA-inner">mtownsend<span class="PYVq--YWvKitItgA-image"></span>paducahky.gov</span></a>, a delivery receipt requested, and “Coleman Rd Sidewalk-Engineering RFP” must be clearly indicated in the subject line. Proposals must be received no later than 4:30 p.m. CT on Tuesday, October 13.</p>
<p>Inquiries regarding this RFQ should be directed to Melanie Townsend, Engineering Project Manager, at <a href="" class="PYVq--YWvKitItgA" data-href="#zgbjafraq/ng/cnqhpnuxl.tbi"><span class="PYVq--YWvKitItgA-inner">mtownsend<span class="PYVq--YWvKitItgA-image"></span>paducahky.gov</span></a>. Questions must be received by Tuesday, October 6, 2026, no later than 12 noon CT.</p>
<p>Women and Minority owned businesses are encouraged to submit proposals for this project.</p>
<p>The City of Paducah is an Equal Opportunity Employer. The City of Paducah does not discriminate on the basis of race, color, national origin, sex, age, religion, or disability, and provides, upon request, reasonable accommodation, including auxiliary aids and services, to afford an individual with a disability an equal opportunity to participate in all services, programs, and activities.\u00a0</p>
<hr>
<h4>Request for Bids - Surplus Property Parcels</h4>
<p>The City of Paducah, Kentucky is accepting sealed proposals for the purchase and transfer of surplus real property for the construction of site built, conventionally framed owner-occupied single-family homes. Commercial development also will be considered, under the same construction guidelines.\u00a0</p>
<p>All bids must be submitted in a sealed envelope clearly marked “Sealed Bid” with the address of the property on the outside and the bidder's name and contact information on the outside of the bid package. Persons interested in submitting a sealed proposal for more than one property must submit a separate written offer for each property. Proposals can be mailed or delivered in person to the City of Paducah, Planning Department, 300 South 5th Street, City Hall, Paducah, KY 42003. The City of Paducah reserves the right to reject any or all proposals submitted. \u00a0</p>
<p>For additional information, call the Planning Department at 270-444-8690.\u00a0</p>
<p><a class="buttons button-blue-white" href="/departments/planning/city-surplus-property">List of Surplus Property Parcels and Proposal Information</a></p>
<hr>
<h4></body></html>`;

describe("Lynn Imaging bids feed", () => {
  it("reads each post: title, town, scope, posted date and the planroom job link", () => {
    const posts = parseLynnFeed(LYNN);
    expect(posts.map((p) => p.id)).toEqual(["29688", "29686"]);
    const roof = posts[1]!;
    expect(roof.title).toBe("Housing Authority of Maysville – Flat Roof Replacement");
    expect(roof.location).toBe("Maysville, Kentucky");
    expect(roof.scope).toContain("install new EPDM roof system");
    expect(roof.scope).not.toContain("Project Location");
    expect(roof.scope).not.toContain("More Details");
    expect(roof.postedAt).toBe("2026-09-25T16:11:37.000Z");
    expect(roof.jobUrl).toBe(
      "https://www.lynnimaging.com/distribution/View/ViewJob.aspx?job_id=29686",
    );
  });
  it("makes leads: owner as agency, town without the state, roof flag from title + scope", () => {
    const [church, roof] = parseLynnFeed(LYNN).map((p) => lynnLead(p, KEYWORDS));
    expect(roof!.agency).toBe("Housing Authority of Maysville");
    expect(roof!.location).toBe("Maysville");
    expect(roof!.is_roof).toBe(true);
    expect(roof!.source).toBe("lynn_bids");
    expect(church!.agency).toBe("First Presbyterian Church of Mayfield");
    expect(church!.title).toBe("First Presbyterian Church of Mayfield – A New Church Facility");
    // Seven new structures, but nothing in the text says "roof": the keyword filter is honest.
    expect(church!.is_roof).toBe(false);
  });
});

describe("Bowling Green bids page", () => {
  it("reads the open opportunities table: reference, name, Bonfire link, posted date", () => {
    const bids = parseBgkyBids(BG);
    expect(bids).toHaveLength(1);
    expect(bids[0]).toMatchObject({
      id: "2027-11",
      title: "Parking Lot Overlay - Police East Precinct",
      url: "https://bgky.bonfirehub.com/opportunities/253906",
      postedAt: "2026-09-21",
    });
    const lead = cityLead(bids[0]!, "bgky_bids", KEYWORDS);
    expect(lead.agency).toBe("City of Bowling Green");
    expect(lead.county).toBe("Warren");
    expect(lead.issued_on).toBe("2026-09-21");
    expect(lead.is_roof).toBe(false);
  });
  it("returns nothing when the heading is gone (layout change → the refresh reports it)", () => {
    expect(parseBgkyBids("<html><body>Bids</body></html>")).toEqual([]);
  });
});

const surplusContact = (bids: ReturnType<typeof parsePaducahBids>) =>
  bids.find((b) => /Surplus/.test(b.title))?.contact ?? null;

describe("Paducah bids page", () => {
  it("reads each active request heading with its packet link, scope and due-date sentence", () => {
    const bids = parsePaducahBids(PADUCAH);
    expect(bids.length).toBeGreaterThanOrEqual(2);
    const rfp = bids[0]!;
    expect(rfp.title).toContain("Coleman Road Sidewalk Project");
    expect(rfp.url).toBe(
      "https://paducahky.gov/files/9/RFP-2026-Paducah-Coleman-Rd-Sidewalk-Project-RFP.pdf",
    );
    expect(rfp.dueText).toContain("no later than 4:30 p.m. CT on Tuesday, October 13");
    expect(rfp.scope).toContain("requesting proposals from professional services firms");
    // The site hides the e-mail behind a span; the contact line puts it back together.
    expect(rfp.contact).toBe(
      "Melanie Townsend, Engineering Project Manager — mtownsend@paducahky.gov",
    );
    // The surplus-property block names a phone and no person.
    expect(surplusContact(bids)).toBe("270-444-8690");
    const surplus = bids[1]!;
    expect(surplus.title).toBe("Request for Bids - Surplus Property Parcels");
    expect(surplus.url).toBe("https://paducahky.gov/request-bids-or-proposals");
    const lead = cityLead(rfp, "paducah_bids", KEYWORDS);
    expect(lead.agency).toBe("City of Paducah");
    expect(lead.county).toBe("McCracken");
  });
});

describe("long dates", () => {
  it("parses month-name dates and rejects the rest", () => {
    expect(parseLongDate("Sep 21, 2026")).toBe("2026-09-21");
    expect(parseLongDate("posted September 3, 2026")).toBe("2026-09-03");
    expect(parseLongDate("10/20/2026")).toBeNull();
  });
});

describe("Lynn posts that repeat a state planroom job", () => {
  const row = (source: "ky_planroom" | "lynn_bids", title: string, id: string) =>
    ({ source, external_id: id, title }) as Parameters<typeof dropPlanroomDuplicates>[0][number];
  it("drops the Lynn copy by matching title (dash styles differ) or solicitation code", () => {
    const planroom = [
      row("ky_planroom", "RFB-86-27 FSS - Jackson SOB Roof Replacement", "29681"),
      row("ky_planroom", "RFB-39-27 RE-AD of RFB-281-26 KAC- Roof Replacement", "29433"),
    ];
    const lynn = [
      row("lynn_bids", "RFB-86-27 FSS – Jackson SOB Roof Replacement", "29681"),
      row("lynn_bids", "RFB-39-27 KAC Roof Replacement (re-ad)", "29500"),
      row("lynn_bids", "Housing Authority of Maysville – Flat Roof Replacement", "29686"),
    ];
    const { keep, dropped } = dropPlanroomDuplicates(lynn, planroom);
    expect(dropped).toEqual(["29681", "29500"]);
    expect(keep.map((r) => r.external_id)).toEqual(["29686"]);
  });
});

describe("campus planrooms", () => {
  const job = {
    jobId: "29592",
    name: "Eastern Kentucky University - Elmwood Roof Project",
    location: "26-488 Richmond, Kentucky",
    company: "Eastern Kentucky University",
    projectType: null,
    prebidAt: null,
    bidAt: "2026-09-15T18:00:00.000Z",
  };
  it("strips Lynn's job number from the town and names the plan issuer when it is not the owner", () => {
    const eku = campusLead(
      job,
      { domain: "ekuplanroom.com", label: "Eastern Kentucky University" },
      KEYWORDS,
    );
    expect(eku.location).toBe("Richmond");
    expect(eku.external_id).toBe("ekuplanroom.com:29592");
    expect(eku.url).toBe("https://www.ekuplanroom.com/View/ViewJob.aspx?job_id=29592");
    expect(eku.contractor).toBeNull();
    expect(eku.is_roof).toBe(true);
    const wku = campusLead(
      { ...job, company: "Messer Construction Co.", location: "26-545 Bowling Green, Kentucky" },
      { domain: "wkuplanroom.com", label: "Western Kentucky University" },
      KEYWORDS,
    );
    expect(wku.contractor).toBe("Messer Construction Co.");
    // The job page owns the contact (readPlanroomPages); the card names the issuer until then.
    expect(wku).not.toHaveProperty("contact");
    expect(wku.location).toBe("Bowling Green");
  });
});

describe("SAM.gov", () => {
  it("asks for roofing opportunities in Kentucky posted in the window", () => {
    const url = new URL(samQueryUrl("KEY", 60, new Date("2026-09-29T12:00:00Z")));
    expect(url.origin + url.pathname).toBe("https://api.sam.gov/opportunities/v2/search");
    expect(url.searchParams.get("ncode")).toBe("238160");
    expect(url.searchParams.get("state")).toBe("KY");
    expect(url.searchParams.get("postedFrom")).toBe("07/31/2026");
    expect(url.searchParams.get("postedTo")).toBe("09/29/2026");
    expect(url.searchParams.get("ptype")).toBe("o,p,k");
  });
  it("maps an opportunity: agency path, place, deadline as bid date, point of contact", () => {
    const lead = samLead(
      {
        noticeId: "abc123",
        title: "Replace Roof Building 1234",
        solicitationNumber: "W912QR26R0010",
        fullParentPathName: "DEPT OF DEFENSE.DEPT OF THE ARMY.USACE.LOUISVILLE DISTRICT",
        postedDate: "2026-09-15",
        type: "Solicitation",
        typeOfSetAsideDescription: "Total Small Business Set-Aside (FAR 19.5)",
        responseDeadLine: "2026-10-20T14:00:00-04:00",
        naicsCode: "238160",
        placeOfPerformance: {
          city: { name: "Fort Knox" },
          state: { code: "KY", name: "Kentucky" },
        },
        pointOfContact: [
          {
            fullName: "Jane Doe",
            email: "jane.doe@usace.army.mil",
            phone: "5025550100",
            type: "primary",
          },
        ],
        uiLink: "https://sam.gov/opp/abc123/view",
      },
      KEYWORDS,
    );
    expect(lead.title).toBe("W912QR26R0010 — Replace Roof Building 1234");
    expect(lead.agency).toBe("USACE / LOUISVILLE DISTRICT");
    expect(lead.location).toBe("Fort Knox, KY");
    expect(lead.bid_at).toBe("2026-10-20T18:00:00.000Z");
    expect(lead.issued_on).toBe("2026-09-15");
    expect(lead.contact).toBe("Jane Doe — jane.doe@usace.army.mil — 5025550100");
    expect(lead.project_type).toBe("Solicitation · Total Small Business Set-Aside (FAR 19.5)");
    expect(lead.is_roof).toBe(true);
    expect(lead.source).toBe("sam_gov");
  });
});
