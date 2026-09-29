import { beforeEach, describe, expect, it, vi } from "vitest";

// saveLeadRows tells Prospecting users about new roof leads through notify(); the tests count
// the calls instead of sending anything. serverClient hands back the client it is given.
const notifyMock = vi.hoisted(() =>
  vi.fn(
    async (ids: string[], _msg: { kind: string; title: string; url?: string | null }) => ids.length,
  ),
);
vi.mock("@/lib/notify.server", () => ({
  notify: notifyMock,
  serverClient: async (c: unknown) => c,
  hasServiceRole: () => true,
}));

import type { Client } from "@/lib/notify.server";
import {
  BROWSER_PORTALS,
  BROWSER_SOURCES,
  bonfireCloseText,
  bonfireRows,
  browserImportSchema,
} from "@/lib/leads-browser";
import {
  browserBidLead,
  lexingtonLead,
  LEXINGTON_BIDS_URL,
  parseLexingtonBids,
  parseLexingtonDate,
  saveLeadRows,
  STORED_PAGE,
  storedLeadKeys,
} from "@/lib/leads.server";

const KEYWORDS = ["roof", "roofing", "re-roof", "membrane", "epdm", "tpo", "shingle"];

/* ---- Lexington (LFUCG) bids: the Ionwave current-bids list --------------------------------- */

// https://lexingtonky.ionwave.net/SourcingEvents.aspx?SourceType=1, Sep 29, 2026: the grid's
// header row, the pager's item count and the first three of its seven rows (the filter row and
// the pager buttons dropped).
const LEX = `<table class="rgMasterTable" id="ctl00_mainContent_rgBidList_ctl00" style="width:100%;table-layout:auto;empty-cells:show;">
<thead>
<tr>
<th scope="col" class="rgHeader" style="white-space:nowrap;">&nbsp;</th><th scope="col" class="rgHeader" style="white-space:nowrap;"><a onclick="Telerik.Web.UI.Grid.Sort($find(&#39;ctl00_mainContent_rgBidList_ctl00&#39;), &#39;BidNumber&#39;); return false;" title="Click here to sort" href="javascript:__doPostBack(&#39;ctl00$mainContent$rgBidList$ctl00$ctl02$ctl01$ctl00&#39;,&#39;&#39;)">Bid Number</a></th><th scope="col" class="rgHeader" style="white-space:nowrap;"><a onclick="Telerik.Web.UI.Grid.Sort($find(&#39;ctl00_mainContent_rgBidList_ctl00&#39;), &#39;Title&#39;); return false;" title="Click here to sort" href="javascript:__doPostBack(&#39;ctl00$mainContent$rgBidList$ctl00$ctl02$ctl01$ctl01&#39;,&#39;&#39;)">Bid Title</a></th><th scope="col" class="rgHeader" style="white-space:nowrap;"><a onclick="Telerik.Web.UI.Grid.Sort($find(&#39;ctl00_mainContent_rgBidList_ctl00&#39;), &#39;TypeTitle&#39;); return false;" title="Click here to sort" href="javascript:__doPostBack(&#39;ctl00$mainContent$rgBidList$ctl00$ctl02$ctl01$ctl02&#39;,&#39;&#39;)">Bid Type</a></th><th scope="col" class="rgHeader" style="white-space:nowrap;display:none;"><a onclick="Telerik.Web.UI.Grid.Sort($find(&#39;ctl00_mainContent_rgBidList_ctl00&#39;), &#39;WorkGroupName&#39;); return false;" title="Click here to sort" href="javascript:__doPostBack(&#39;ctl00$mainContent$rgBidList$ctl00$ctl02$ctl01$ctl03&#39;,&#39;&#39;)">Organization</a></th><th scope="col" class="rgHeader" style="white-space:nowrap;"><a onclick="Telerik.Web.UI.Grid.Sort($find(&#39;ctl00_mainContent_rgBidList_ctl00&#39;), &#39;OpenDate&#39;); return false;" title="Click here to sort" href="javascript:__doPostBack(&#39;ctl00$mainContent$rgBidList$ctl00$ctl02$ctl01$ctl05&#39;,&#39;&#39;)">Bid Issue Date</a></th><th scope="col" class="rgHeader rgSorted" style="white-space:nowrap;"><a onclick="Telerik.Web.UI.Grid.Sort($find(&#39;ctl00_mainContent_rgBidList_ctl00&#39;), &#39;CloseDate&#39;); return false;" title="Click here to sort" href="javascript:__doPostBack(&#39;ctl00$mainContent$rgBidList$ctl00$ctl02$ctl01$ctl06&#39;,&#39;&#39;)">Bid Close Date/Time</a>&nbsp;<input type="submit" name="ctl00$mainContent$rgBidList$ctl00$ctl02$ctl01$ctl07" value=" " title="Sorted asc" class="rgSortAsc" /></th>
</tr>
</thead><tfoot>
<tr class=" rgPager"><td colspan="6"><div class="rgWrap rgInfoPart">
 &nbsp;<strong>7</strong> items in <strong>1</strong> pages
</div></td></tr>
</tfoot><tbody>
<tr class="rgRow" valign="top" id="ctl00_mainContent_rgBidList_ctl00__0">
<td align="center" valign="top" style="width:1%;white-space:nowrap;">
<span class="flaticon-grid_View" title="View Bid"></span>
</td><td valign="top" style="width:25%;">RFP-42-2026 Addendum 2</td><td valign="top" style="width:25%;">Yard Waste Transporting and Composting</td><td valign="top" style="width:15%;">RFP</td><td valign="top" style="width:10%;display:none;">Purchasing</td><td valign="top" style="width:5%;">8/31/2026</td><td class="rgSorted" valign="top" style="width:15%;white-space:nowrap;">10/2/2026 02:00:00 PM (ET)</td>
</tr>
<tr class="rgAltRow" valign="top" id="ctl00_mainContent_rgBidList_ctl00__1">
<td align="center" valign="top" style="width:1%;white-space:nowrap;">
<span class="flaticon-grid_View" title="View Bid"></span>
</td><td valign="top" style="width:25%;">Bid 105-2026</td><td valign="top" style="width:25%;">Traffic Signal and Control Equipment</td><td valign="top" style="width:15%;">Bid</td><td valign="top" style="width:10%;display:none;">Purchasing</td><td valign="top" style="width:5%;">9/15/2026</td><td class="rgSorted" valign="top" style="width:15%;white-space:nowrap;">10/13/2026 02:00:00 PM (ET)</td>
</tr>
<tr class="rgRow" valign="top" id="ctl00_mainContent_rgBidList_ctl00__2">
<td align="center" valign="top" style="width:1%;white-space:nowrap;">
<span class="flaticon-grid_View" title="View Bid"></span>
</td><td valign="top" style="width:25%;">Bid 106-2026 Addendum 1</td><td valign="top" style="width:25%;">Firefighter Helmets</td><td valign="top" style="width:15%;">Bid</td><td valign="top" style="width:10%;display:none;">Purchasing</td><td valign="top" style="width:5%;">9/29/2026</td><td class="rgSorted" valign="top" style="width:15%;white-space:nowrap;">10/13/2026 02:00:00 PM (ET)</td>
</tr>
</tbody>
</table>`;

describe("Lexington city bids (lexington_bids)", () => {
  it("reads the grid by its header labels, the addendum kept apart from the number", () => {
    const list = parseLexingtonBids(LEX);
    expect(list.grid).toBe(true);
    expect(list.empty).toBe(false);
    expect(list.total).toBe(7);
    expect(list.pages).toBe(1);
    expect(list.rowsOnPage).toBe(3);
    expect(list.labels.slice(1)).toEqual([
      "Bid Number",
      "Bid Title",
      "Bid Type",
      "Organization",
      "Bid Issue Date",
      "Bid Close Date/Time",
    ]);
    expect(list.bids.map((b) => [b.number, b.addendum, b.title, b.type])).toEqual([
      ["RFP-42-2026", 2, "Yard Waste Transporting and Composting", "RFP"],
      ["Bid 105-2026", null, "Traffic Signal and Control Equipment", "Bid"],
      ["Bid 106-2026", 1, "Firefighter Helmets", "Bid"],
    ]);
    expect(list.bids[0]).toMatchObject({
      numberShown: "RFP-42-2026 Addendum 2",
      organization: "Purchasing",
      issueText: "8/31/2026",
      issuedOn: "2026-08-31",
      closeText: "10/2/2026 02:00:00 PM (ET)",
      // 2:00 PM EDT, not midnight (the list shows seconds).
      bidAt: "2026-10-02T18:00:00.000Z",
      url: null,
    });
  });

  it("maps a bid to a Kentucky lead that links the list", () => {
    const [b] = parseLexingtonBids(LEX).bids;
    const lead = lexingtonLead(b!, KEYWORDS);
    expect(lead).toMatchObject({
      source: "lexington_bids",
      external_id: "RFP-42-2026",
      title: "Yard Waste Transporting and Composting",
      agency: "Lexington-Fayette Urban County Government",
      location: "Lexington",
      city: "Lexington",
      county: "Fayette",
      state: "KY",
      project_type: "RFP",
      bid_at: "2026-10-02T18:00:00.000Z",
      issued_on: "2026-08-31",
      url: LEXINGTON_BIDS_URL,
      contact: null,
      is_roof: false,
      gone_at: null,
    });
    expect((lead.raw as { numberShown: string }).numberShown).toBe("RFP-42-2026 Addendum 2");
    const roof = lexingtonLead(
      { ...b!, title: "Re-Roof of Fire Station 12", url: "https://lexingtonky.ionwave.net/x" },
      KEYWORDS,
    );
    expect(roof.is_roof).toBe(true);
    expect(roof.url).toBe("https://lexingtonky.ionwave.net/x");
  });

  it("reads Central and Eastern close times; standard time after November 1", () => {
    expect(parseLexingtonDate("10/2/2026 02:00:00 PM (ET)")).toBe("2026-10-02T18:00:00.000Z");
    expect(parseLexingtonDate("12/3/2026 10:30:00 AM (ET)")).toBe("2026-12-03T15:30:00.000Z");
    expect(parseLexingtonDate("10/2/2026 02:00:00 PM (CT)")).toBe("2026-10-02T19:00:00.000Z");
    expect(parseLexingtonDate("10/2/2026")).toBe("2026-10-02T04:00:00.000Z");
    expect(parseLexingtonDate("soon")).toBeNull();
  });

  it("says when the list runs past the first page", () => {
    const paged = LEX.replace(
      /<strong>7<\/strong> items in <strong>1<\/strong> pages/,
      "<strong>23</strong> items in <strong>2</strong> pages",
    );
    const list = parseLexingtonBids(paged);
    expect(list.total).toBe(23);
    expect(list.pages).toBe(2);
    expect(list.bids).toHaveLength(3);
  });

  it("tells an error page and an empty list apart from a list", () => {
    expect(parseLexingtonBids("<html><h1>An error has occurred</h1></html>").grid).toBe(false);
    const empty = LEX.replace(
      /<tbody>[\s\S]*<\/tbody>/,
      '<tbody><tr class="rgNoRecords"><td colspan="6"><div>No records to display.</div></td></tr></tbody>',
    );
    const list = parseLexingtonBids(empty);
    expect(list).toMatchObject({ grid: true, empty: true, rowsOnPage: 0, bids: [] });
    // Columns renamed: the grid is there, nothing is read, the refresh fails loudly.
    const renamed = parseLexingtonBids(LEX.replace(">Bid Title<", ">Solicitation<"));
    expect(renamed.grid).toBe(true);
    expect(renamed.bids).toEqual([]);
    expect(renamed.empty).toBe(false);
  });
});

/* ---- Louisville Metro bids: Bonfire, read by the nightly browser job ---------------------- */

// The JSON Louisville's Bonfire portal page loads for its Open Public Opportunities tab
// (GET /PublicPortal/getOpenPublicOpportunitiesSectionData), Sep 29, 2026: three of its 12
// projects and their departments (PrivateProjectID dropped).
const LOU_JSON = {
  success: 1,
  message: "Success",
  payload: {
    projects: {
      "254351": {
        ProjectID: "254351",
        ReferenceID: "RFP270054",
        ProjectStatusID: "2",
        ProjectSubStatusID: "1",
        ProjectVisibilityID: "1",
        ProjectName: "Playground and Shade Structure Equipment and Services REBID",
        DateClose: "2026-10-01 19:00:00",
        DepartmentID: "903",
      },
      "253755": {
        ProjectID: "253755",
        ReferenceID: "IFB270050",
        ProjectStatusID: "2",
        ProjectSubStatusID: "1",
        ProjectVisibilityID: "1",
        ProjectName: "West Muhammad Ali Blvd. & West Chestnut Street Resurfacing REBID",
        DateClose: "2026-10-02 20:30:00",
        DepartmentID: "896",
      },
      "253558": {
        ProjectID: "253558",
        ReferenceID: "RFI270045",
        ProjectStatusID: "2",
        ProjectSubStatusID: "1",
        ProjectVisibilityID: "1",
        ProjectName:
          "INFORMATIONAL ONLY - Belvedere Transformation Project - External Bid Advertisement (Structural Reinforcement of Garage & Belvedere)",
        DateClose: "2026-10-05 18:00:00",
        DepartmentID: "879",
      },
    },
    departments: {
      "879": { DepartmentName: "Facilities/Fleet Management" },
      "903": { DepartmentName: "Louisville Zoo" },
      "896": { DepartmentName: "Public Works" },
    },
  },
};
const LOU = BROWSER_PORTALS.louisville_bids;

describe("Louisville Metro bids (louisville_bids, Bonfire)", () => {
  it("is the browser job's third portal, Eastern time, Kentucky", () => {
    expect(BROWSER_SOURCES).toContain("louisville_bids");
    expect(LOU).toMatchObject({
      kind: "bonfire",
      label: "Louisville Metro bids",
      timeZone: "America/New_York",
      zone: "ET",
      agency: "Louisville Metro Government",
      city: "Louisville",
      county: "Jefferson",
      state: "KY",
    });
    // The table's own words for its dates.
    expect(LOU.timeZoneText.test("Oct 2nd 2026, 4:30 PM EDT")).toBe(true);
    expect(LOU.timeZoneText.test("Dec 2nd 2026, 4:30 PM EST")).toBe(true);
    expect(LOU.timeZoneText.test("Oct 1st 2026, 4:00 PM CDT")).toBe(false);
  });

  it("turns Bonfire's UTC close date into the portal's wall clock", () => {
    expect(bonfireCloseText("2026-10-02 20:30:00", "America/New_York")).toBe("10/2/2026 4:30 PM");
    expect(bonfireCloseText("2026-12-01 20:00:00", "America/New_York")).toBe("12/1/2026 3:00 PM");
    expect(bonfireCloseText("2026-10-03 04:00:00", "America/New_York")).toBe("10/3/2026 12:00 AM");
    expect(bonfireCloseText("Oct 2", "America/New_York")).toBeNull();
  });

  it("maps the list's JSON to rows, soonest close first", () => {
    const rows = bonfireRows(LOU_JSON, LOU);
    expect(rows.map((r) => [r.number, r.type, r.closeDate, r.url])).toEqual([
      [
        "RFP270054",
        "RFP",
        "10/1/2026 3:00 PM",
        "https://louisvilleky.bonfirehub.com/opportunities/254351",
      ],
      [
        "IFB270050",
        "IFB",
        "10/2/2026 4:30 PM",
        "https://louisvilleky.bonfirehub.com/opportunities/253755",
      ],
      [
        "RFI270045",
        "RFI",
        "10/5/2026 2:00 PM",
        "https://louisvilleky.bonfirehub.com/opportunities/253558",
      ],
    ]);
    expect(rows[1]).toMatchObject({
      title: "West Muhammad Ali Blvd. & West Chestnut Street Resurfacing REBID",
      status: "Open",
      postingDate: null,
      buyer: null,
      attachments: [],
      detailsRead: false,
      details: {
        Department: "Public Works",
        "Close Date (UTC)": "2026-10-02 20:30:00",
        "Project ID": "253755",
      },
    });
    // What the script posts passes the route's check.
    const payload = {
      ok: true,
      source: "louisville_bids",
      portalTimeZone: "America/New_York",
      fetchedAt: "2026-09-29T22:00:00.000Z",
      rows,
    };
    expect(browserImportSchema.safeParse(payload).success).toBe(true);
    expect(
      browserImportSchema.safeParse({ ...payload, portalTimeZone: "America/Chicago" }).success,
    ).toBe(false);
    // A row link off the portal's own site is refused.
    const off = [{ ...rows[0]!, url: "https://example.com/opportunities/1" }];
    expect(browserImportSchema.safeParse({ ...payload, rows: off }).success).toBe(false);
  });

  it("maps a row to a Kentucky lead with its department and its own page", () => {
    const [, ifb] = bonfireRows(LOU_JSON, LOU);
    const lead = browserBidLead(ifb!, "louisville_bids", KEYWORDS);
    expect(lead).toMatchObject({
      source: "louisville_bids",
      external_id: "IFB270050",
      title: "West Muhammad Ali Blvd. & West Chestnut Street Resurfacing REBID",
      agency: "Louisville Metro Government — Public Works",
      location: "Louisville",
      city: "Louisville",
      county: "Jefferson",
      state: "KY",
      project_type: "IFB",
      bid_at: "2026-10-02T20:30:00.000Z",
      prebid_at: null,
      issued_on: null,
      url: "https://louisvilleky.bonfirehub.com/opportunities/253755",
      contact: null,
      is_roof: false,
    });
    const roof = browserBidLead(
      { ...ifb!, title: "Metro Hall Roof Replacement" },
      "louisville_bids",
      KEYWORDS,
    );
    expect(roof.is_roof).toBe(true);
  });

  it("an empty list is nothing open; anything but the list fails (nothing posted)", () => {
    expect(bonfireRows({ success: 1, payload: { projects: [], departments: [] } }, LOU)).toEqual(
      [],
    );
    expect(bonfireRows({ success: 1, payload: { projects: {} } }, LOU)).toEqual([]);
    expect(() => bonfireRows({ success: 0, message: "Error" }, LOU)).toThrow(/not a success/);
    expect(() => bonfireRows({ success: 1, payload: {} }, LOU)).toThrow(/no project list/);
    expect(() => bonfireRows("<html>", LOU)).toThrow();
    expect(() =>
      bonfireRows({ success: 1, payload: { projects: { a: { ProjectName: "x" } } } }, LOU),
    ).toThrow(/without a reference/);
    expect(() =>
      bonfireRows(
        {
          success: 1,
          payload: { projects: { a: { ReferenceID: "R1", ProjectName: "x", DateClose: "soon" } } },
        },
        LOU,
      ),
    ).toThrow(/close date/);
  });
});

/* ---- saveLeadRows: stored leads read in pages (the API caps a query at 1,000 rows) ---------- */

type Rec = Record<string, unknown>;
/** The leads table as the API serves it: at most 1,000 rows per query, like Supabase's default. */
class CappedDb {
  leads: Rec[] = [];
  reads = 0;
  from(_table: string) {
    return new CappedQuery(this);
  }
  async rpc(name: string) {
    return { data: name === "prospect_user_ids" ? ["u1"] : null, error: null };
  }
}
class CappedQuery {
  private op: "select" | "update" | "upsert" = "select";
  private patch: Rec = {};
  private filters: ((r: Rec) => boolean)[] = [];
  private orderBy: string | null = null;
  private window: [number, number] | null = null;
  constructor(private db: CappedDb) {}
  select() {
    return this;
  }
  update(patch: Rec) {
    this.op = "update";
    this.patch = patch;
    return this;
  }
  upsert(rows: Rec[]) {
    this.op = "upsert";
    for (const r of rows) {
      const cur = this.db.leads.find(
        (x) => x["source"] === r["source"] && x["external_id"] === r["external_id"],
      );
      if (cur) Object.assign(cur, r);
      else this.db.leads.push({ status: "new", ...r });
    }
    return this;
  }
  eq(c: string, v: unknown) {
    this.filters.push((r) => r[c] === v);
    return this;
  }
  is(c: string, v: null) {
    this.filters.push((r) => (r[c] ?? null) === v);
    return this;
  }
  in(c: string, vs: unknown[]) {
    this.filters.push((r) => vs.includes(r[c]));
    return this;
  }
  not(c: string, op: string, list: string) {
    expect(op).toBe("in");
    const vs = [...list.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]!.replace(/\\"/g, '"'));
    this.filters.push((r) => !vs.includes(r[c] as string));
    return this;
  }
  order(c: string) {
    this.orderBy = c;
    return this;
  }
  range(from: number, to: number) {
    this.window = [from, to];
    return this;
  }
  then<T>(done: (v: { data: unknown; error: null }) => T) {
    let hit = this.db.leads.filter((r) => this.filters.every((f) => f(r)));
    if (this.op === "update") for (const r of hit) Object.assign(r, this.patch);
    if (this.op === "select") {
      this.db.reads++;
      if (this.orderBy) {
        const k = this.orderBy;
        hit = [...hit].sort((a, b) => String(a[k] ?? "").localeCompare(String(b[k] ?? "")));
      }
      if (this.window) hit = hit.slice(this.window[0], this.window[1] + 1);
      hit = hit.slice(0, 1000); // the API's cap
    }
    const data = this.op === "upsert" ? null : hit;
    return Promise.resolve({ data, error: null }).then(done);
  }
}

describe("stored leads past 1,000 rows", () => {
  beforeEach(() => {
    notifyMock.mockClear();
  });

  const stored = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: `id-${String(i).padStart(5, "0")}`,
      source: "bidnet",
      external_id: `b${i}`,
      title: `Job ${i}`,
      is_roof: false,
      gone_at: null,
    }));

  it("reads every stored key, a page at a time", async () => {
    const db = new CappedDb();
    db.leads.push(...stored(2345), {
      id: "id-x",
      source: "knox_county_bids",
      external_id: "k1",
      gone_at: null,
    });
    const keys = await storedLeadKeys(db as unknown as Client, ["bidnet"]);
    expect(STORED_PAGE).toBe(1000);
    expect(keys.size).toBe(2345);
    expect(keys.has("bidnet|b2344")).toBe(true);
    expect(keys.has("knox_county_bids|k1")).toBe(false);
    expect(db.reads).toBe(3); // 1,000 + 1,000 + 345
  });

  it("a lead stored past the first 1,000 is not new again (no second notification)", async () => {
    const db = new CappedDb();
    db.leads.push(...stored(1500));
    db.leads[1400]!["is_roof"] = true;
    db.leads[1400]!["title"] = "Roof Replacement - Senior Center";
    const rows = [
      { ...db.leads[1400]!, state: "KY" },
      {
        source: "bidnet",
        external_id: "b-new",
        title: "Gym Roof Replacement",
        is_roof: true,
        gone_at: null,
        state: "KY",
      },
    ];
    const r = await saveLeadRows(db as unknown as Client, [
      { source: "bidnet", rows: rows as never, count: 2 },
    ]);
    expect(r.fresh.map((x) => x.external_id)).toEqual(["b-new"]);
    expect(r.newRoof.map((x) => x.external_id)).toEqual(["b-new"]);
    expect(notifyMock).toHaveBeenCalledTimes(1);
    expect(notifyMock.mock.calls[0]![1]).toMatchObject({ title: "1 new roof lead" });
  });

  it("exactly 1,000 stored: one more (empty) page is read", async () => {
    const db = new CappedDb();
    db.leads.push(...stored(1000));
    const keys = await storedLeadKeys(db as unknown as Client, ["bidnet"]);
    expect(keys.size).toBe(1000);
    expect(db.reads).toBe(2);
  });
});
