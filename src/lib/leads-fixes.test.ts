import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Bid Board fixes (Sep 30): what a refresh writes, what it reports, when a city bid closes,
// the keyword match, and BidNet copies of jobs on the city portals.
//
// saveLeadRows tells Prospecting users about new roof leads through notify(); the tests count
// the calls instead of sending anything. serverClient hands back the client it is given.
const notifyMock = vi.hoisted(() => vi.fn(async (ids: string[]) => ids.length));
vi.mock("@/lib/notify.server", () => ({
  notify: notifyMock,
  serverClient: async (c: unknown) => c,
  hasServiceRole: () => true,
}));
// No planroom login in these tests: the refresh reads no job pages.
vi.mock("@/lib/planroom.server", () => ({
  STATE_PLANROOM: { base: "https://www.stateofkyplanroom.com/View", label: "State planroom" },
  LYNN_PLANROOM: { base: "https://www.lynnimaging.com/distribution/View", label: "Lynn planroom" },
  planroomCredentials: () => null,
  planroomSignIn: async () => null,
  planroomSignOut: async () => undefined,
  fetchJobDetails: async () => null,
  contactLine: () => null,
}));
const reroofMock = vi.hoisted(() =>
  vi.fn(async () => ({ marked: 0, problems: ["Metro Nashville re-roof permits → 503"] })),
);
vi.mock("@/lib/reroof.server", () => ({ markReroofedBuildings: reroofMock }));

import { createClient } from "@supabase/supabase-js";

import type { Client } from "@/lib/notify.server";
import { isClosedBid } from "@/components/prospect/lead-format";
import type { PortalRow } from "@/lib/leads-browser";
import {
  campusLead,
  cityLead,
  importBrowserBids,
  isRoofLead,
  louisvilleLead,
  lynnLead,
  nashvilleLead,
  parsePaducahBids,
  planroomLead,
  refreshLeads,
  saveLeadRows,
} from "@/lib/leads.server";
import {
  applyLeadFilters,
  countLeads,
  listLeadRows,
  leadSearchFilter,
} from "@/lib/leads.functions";

const KW = ["roof", "roofing", "re-roof", "shingle", "new building", "addition"];

/* ---- 1. A refresh never writes over the team's note, an enriched contact, or the read stamp -- */

describe("saveLeadRows: what each upsert request sends", () => {
  type Req = { method: string; url: URL; body: Record<string, unknown>[] | null };
  const reqs: Req[] = [];
  const fakeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : null;
    reqs.push({
      method: init?.method ?? "GET",
      url,
      body: Array.isArray(body) ? (body as Record<string, unknown>[]) : null,
    });
    return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
  };
  beforeEach(() => {
    reqs.length = 0;
    notifyMock.mockClear();
  });

  it("sends only the keys each row has, one source per request, never note or the read stamp", async () => {
    // The real client, so the request is exactly what PostgREST would get.
    const sb = createClient("https://example.supabase.co", "anon", {
      global: { fetch: fakeFetch as typeof fetch },
    });
    const planroom = planroomLead(
      {
        jobId: "123",
        name: "Jackson SOB Roof Replacement",
        location: "Jackson",
        company: "Finance",
        projectType: "Roofing",
        prebidAt: null,
        bidAt: "2026-10-20T17:30:00.000Z",
      },
      KW,
    );
    const campus = campusLead(
      {
        jobId: "77",
        name: "Cherry Hall Roof",
        location: "26-538 Bowling Green, Kentucky",
        company: "Messer Construction Co.",
        projectType: null,
        prebidAt: null,
        bidAt: null,
      },
      { domain: "wkuplanroom.com", label: "WKU" },
      KW,
    );
    const lynn = lynnLead(
      {
        id: "999",
        title: "Owner – Roof Replacement",
        postUrl: "https://www.lynnimaging.com/bids/x/",
        jobUrl: null,
        location: "Frankfort, KY",
        scope: "",
        postedAt: null,
      },
      KW,
    );
    const louisville = louisvilleLead(
      {
        PERMIT_NUMBER: "P1",
        PERMIT_TYPE: "Commercial New",
        PERMIT_STATUS: null,
        CONTRACTOR: "ACME",
        WORK_TYPE: null,
        SQFT: 9000,
        PROJECT_COSTS: 1,
        ADDRESS: "1 Main",
        CITY: "Louisville",
        ZIPCODE: "40202",
        LATITUDE: 38,
        LONGITUDE: -85,
        ISSUE_DATE: Date.UTC(2026, 8, 1),
      } as never,
      KW,
    );
    const nashville = nashvilleLead(
      {
        Permit__: "T2026",
        Permit_Type_Description: "Building Commercial - New",
        Permit_Subtype_Description: "Office",
        Date_Issued: Date.UTC(2026, 8, 20),
        Const_Cost: 2000000,
        Address: "1 Broadway",
        City: "NASHVILLE",
        ZIP: "37203",
        Contact: "Jane Roe",
        Purpose: "New office building",
        Lat: 36.16,
        Lon: -86.78,
      } as never,
      KW,
    );
    await saveLeadRows(sb as never, [
      { source: "ky_planroom", rows: [planroom], count: 1 },
      { source: "campus_planrooms", rows: [campus], count: 1 },
      { source: "louisville_permits", rows: [louisville], count: 1 },
      { source: "lynn_bids", rows: [lynn], count: 1 },
      { source: "nashville_permits", rows: [nashville], count: 1 },
    ]);
    const upserts = reqs.filter((r) => r.method === "POST" && r.url.pathname.endsWith("/leads"));
    expect(upserts.length).toBeGreaterThanOrEqual(5);
    for (const u of upserts) {
      const columns = (u.url.searchParams.get("columns") ?? "").replace(/"/g, "").split(",");
      const body = u.body!;
      const sources = new Set(body.map((r) => r["source"]));
      // Never two sources in one request.
      expect(sources.size).toBe(1);
      const source = [...sources][0] as string;
      // The team's note and the job-page stamp belong to the app, not to a list.
      expect(columns).not.toContain("note");
      expect(columns).not.toContain("details_read_at");
      expect(columns).not.toContain("details");
      // The job page (read with the planroom login) owns the contact on these sources.
      if (["ky_planroom", "lynn_bids", "campus_planrooms"].includes(source))
        expect(columns).not.toContain("contact");
      // Every column sent is a key every row of the request has: nothing is sent as null for
      // a row that did not say it.
      for (const r of body) expect(Object.keys(r).sort()).toEqual([...columns].sort());
    }
    // Permits keep their contact line (the general contractor / applicant).
    const lou = upserts.find((u) => u.body![0]!["source"] === "louisville_permits")!;
    expect(lou.url.searchParams.get("columns")).toContain('"contact"');
  });
});

/* ---- 2. The refresh stores its problems apart from the note ------------------------------ */

type Rec = Record<string, unknown>;
class FakeDb {
  leads: Rec[] = [];
  settings: Rec = {
    id: 1,
    roof_keywords: KW,
    louisville_types: ["Commercial New"],
    louisville_min_sqft: 5000,
    louisville_days: 90,
    nashville_types: ["Building Commercial - New"],
    nashville_min_cost: 500000,
    // BidNet and SAM.gov pulled a moment ago: not due.
    source_fetched_at: { bidnet: new Date().toISOString(), sam_gov: new Date().toISOString() },
  };
  upserts: Rec[][] = [];
  rpcs: { name: string; args: Rec }[] = [];
  from(table: string) {
    return new FakeQuery(this, table);
  }
  async rpc(name: string, args: Rec = {}) {
    this.rpcs.push({ name, args });
    return { data: name === "prospect_user_ids" ? ["u1"] : null, error: null };
  }
}
class FakeQuery {
  private op: "select" | "update" | "upsert" = "select";
  private patch: Rec = {};
  private filters: ((r: Rec) => boolean)[] = [];
  private single_ = false;
  private window: [number, number] | null = null;
  constructor(
    private db: FakeDb,
    private table: string,
  ) {}
  select() {
    return this;
  }
  single() {
    this.single_ = true;
    return this;
  }
  update(patch: Rec) {
    this.op = "update";
    this.patch = patch;
    return this;
  }
  upsert(rows: Rec[]) {
    this.op = "upsert";
    this.db.upserts.push(rows);
    for (const r of rows) {
      const cur = this.db.leads.find(
        (x) => x["source"] === r["source"] && x["external_id"] === r["external_id"],
      );
      if (cur) Object.assign(cur, r);
      else this.db.leads.push({ id: `id${this.db.leads.length + 1}`, status: "new", ...r });
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
  order() {
    return this;
  }
  limit() {
    return this;
  }
  range(from: number, to: number) {
    this.window = [from, to];
    return this;
  }
  then<T>(done: (v: { data: unknown; error: null }) => T) {
    const rows = this.table === "leads" ? this.db.leads : [this.db.settings];
    let hit = rows.filter((r) => this.filters.every((f) => f(r)));
    if (this.window) hit = hit.slice(this.window[0], this.window[1] + 1);
    if (this.op === "update") for (const r of hit) Object.assign(r, this.patch);
    const data = this.op === "upsert" ? null : this.single_ ? (hit[0] ?? null) : hit;
    return Promise.resolve({ data, error: null }).then(done);
  }
}

describe("refreshLeads: the problems are stamped as a list", () => {
  beforeEach(() => {
    // Every site is down.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("down", { status: 503 })),
    );
    reroofMock.mockClear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("passes every failure, the re-roof step's included, to stamp_lead_fetch", async () => {
    const db = new FakeDb();
    const r = await refreshLeads(db as unknown as Client);
    const final = db.rpcs.filter((x) => x.name === "stamp_lead_fetch").at(-1)!;
    expect(final.args["note"]).toBe(r.note);
    expect(final.args["problems"]).toEqual(r.failed);
    const problems = final.args["problems"] as string[];
    expect(problems).toContain("Metro Nashville re-roof permits → 503");
    expect(problems).toContain("State planroom → 503");
    // The progress stamps carry no problems (they leave the last run's list alone).
    for (const s of db.rpcs.filter((x) => x.name === "stamp_lead_fetch").slice(0, -1))
      expect(s.args["problems"]).toBeUndefined();
  });

  it("reports a re-roof step that threw", async () => {
    reroofMock.mockImplementationOnce(async () => {
      throw new Error("Could not find the table 'public.reroof_permits' in the schema cache");
    });
    const db = new FakeDb();
    await refreshLeads(db as unknown as Client);
    const final = db.rpcs.filter((x) => x.name === "stamp_lead_fetch").at(-1)!;
    expect(final.args["problems"]).toContain(
      "Re-roof marking Could not find the table 'public.reroof_permits' in the schema cache",
    );
  });
});

/* ---- 3. Paducah's due date closes the bid ------------------------------------------------- */

// The Coleman Road block as https://paducahky.gov/request-bids-or-proposals showed it on Sep 30,
// 2026, plus a second request whose deadline names no date.
const PADUCAH = `<h2>Active Requests for Bids or Proposals</h2>
<h4>Request for Proposals - Professional Services - Design, Engineering, and Construction Administration - Coleman Road Sidewalk Project</h4>
<p class="MsoNoSpacing">The City of Paducah, Kentucky, is requesting proposals from professional services firms to assist the City in designing and engineering the Coleman Road Sidewalk Project.</p>
<p><a class="buttons button-blue-white" data-file-id="23635" href="/files/9/RFP-2026-Paducah-Coleman-Rd-Sidewalk-Project-RFP.pdf">RFP Information Packet - Coleman Road Sidewalk Project</a></p>
<p>Five (5) individual copies of the proposal should be submitted to the City of Paducah, Attn: City Clerk’s Office, 300 South 5th Street, P.O. Box 2267, Paducah, KY 42002-2267, and clearly marked on the outside with “Bid Documents: Coleman Rd-Engineering RFP”. Alternately, proposals may be emailed to <a href="" class="PYVq--YWvKitItgA" data-href="#zgbjafraq/ng/cnqhpnuxl.tbi"><span class="PYVq--YWvKitItgA-inner">mtownsend<span class="PYVq--YWvKitItgA-image"></span>paducahky.gov</span></a>, a delivery receipt requested, and “Coleman Rd Sidewalk-Engineering RFP” must be clearly indicated in the subject line. Proposals must be received no later than 4:30 p.m. CT on Tuesday, October 13.</p>
<p>Inquiries regarding this RFQ should be directed to Melanie Townsend, Engineering Project Manager, at <a href="" class="PYVq--YWvKitItgA" data-href="#zgbjafraq/ng/cnqhpnuxl.tbi"><span class="PYVq--YWvKitItgA-inner">mtownsend<span class="PYVq--YWvKitItgA-image"></span>paducahky.gov</span></a>. Questions must be received by Tuesday, October 6, 2026, no later than 12 noon CT.</p>
<h4>Sale of Surplus Property</h4>
<p>Sealed proposals will be received no later than 10:00 a.m., local time on the day of the opening. Proposals will be opened and read aloud publicly.</p>
<h2>Bid Results</h2>`;

describe("cityLead: the due date becomes the bid date", () => {
  const sep30 = new Date("2026-09-30T15:00:00Z");
  it("reads Paducah's 'no later than 4:30 p.m. CT on Tuesday, October 13' as a Central time", () => {
    const [coleman, surplus] = parsePaducahBids(PADUCAH);
    expect(coleman!.dueText).toBe("received no later than 4:30 p.m. CT on Tuesday, October 13.");
    const lead = cityLead(coleman!, "paducah_bids", KW, sep30);
    // 4:30 pm CDT.
    expect(lead.bid_at).toBe("2026-10-13T21:30:00.000Z");
    expect(isClosedBid(lead as never, Date.parse("2026-10-13T21:29:00Z"))).toBe(false);
    expect(isClosedBid(lead as never, Date.parse("2026-10-13T21:31:00Z"))).toBe(true);
    // No date in the sentence: no bid date.
    expect(cityLead(surplus!, "paducah_bids", KW, sep30).bid_at ?? null).toBeNull();
  });

  it("puts a date without a year in the right year around New Year", () => {
    const bid = { ...parsePaducahBids(PADUCAH)[0]! };
    bid.dueText = "received no later than 2:00 p.m. CT on Tuesday, December 15.";
    // Still listed in January: December is last year's, so the bid has closed.
    expect(cityLead(bid, "paducah_bids", KW, new Date("2027-01-10T15:00:00Z")).bid_at).toBe(
      "2026-12-15T20:00:00.000Z",
    );
    bid.dueText = "received no later than 2:00 p.m. CT on Wednesday, February 3.";
    expect(cityLead(bid, "paducah_bids", KW, new Date("2026-11-20T15:00:00Z")).bid_at).toBe(
      "2027-02-03T20:00:00.000Z",
    );
  });
});

/* ---- 4. The Open count follows the Source filter and the search box ------------------------ */

/** Records every builder call; awaiting it answers an empty count. */
function recorder() {
  const queries: string[][] = [];
  const sb = {
    from(table: string) {
      const calls: string[] = [`from(${table})`];
      queries.push(calls);
      const q: Record<string, unknown> = {};
      for (const m of [
        "select",
        "eq",
        "in",
        "is",
        "or",
        "not",
        "limit",
        "order",
        "single",
        "ilike",
      ])
        q[m] = (...args: unknown[]) => {
          calls.push(`${m}(${args.map((a) => JSON.stringify(a)).join(",")})`);
          return q;
        };
      q["then"] = (done: (v: unknown) => unknown) =>
        Promise.resolve({ data: table === "lead_settings" ? {} : [], count: 0, error: null }).then(
          done,
        );
      return q;
    },
  };
  return { sb, queries };
}

describe("lead filters shared by the list and the counts", () => {
  it("builds one search filter over the fields the card shows, safe for PostgREST", () => {
    expect(leadSearchFilter("  Roof ")).toBe(
      "title.ilike.%Roof%,agency.ilike.%Roof%,location.ilike.%Roof%,address.ilike.%Roof%,city.ilike.%Roof%,contractor.ilike.%Roof%",
    );
    // Commas, parentheses, quotes and wildcards cannot break out of the filter.
    expect(leadSearchFilter('a,b(c)"%_*')).toBe(
      ["title", "agency", "location", "address", "city", "contractor"]
        .map((f) => `${f}.ilike.%a_b_c_____%`)
        .join(","),
    );
    expect(leadSearchFilter("   ")).toBeNull();
  });

  it("applies source, state and search to every count query", async () => {
    const { sb, queries } = recorder();
    await countLeads(sb as never, { state: "TN", source: "bidnet", q: "hydrant" });
    const counts = queries.filter((q) => q[0] === "from(leads)");
    expect(counts).toHaveLength(3);
    for (const q of counts) {
      expect(q).toContain('eq("source","bidnet")');
      expect(q).toContain('eq("state","TN")');
      expect(q).toContain(`or(${JSON.stringify(leadSearchFilter("hydrant"))})`);
    }
  });

  it("the list applies the very same filters", async () => {
    const { sb, queries } = recorder();
    await listLeadRows(sb as never, {
      roofOnly: true,
      state: "TN",
      source: "bidnet",
      q: "hydrant",
    });
    const list = queries.find((q) => q[0] === "from(leads)")!;
    const { sb: sb2, queries: q2 } = recorder();
    await countLeads(sb2 as never, { state: "TN", source: "bidnet", q: "hydrant" });
    const count = q2.find((q) => q[0] === "from(leads)")!;
    const shared = (calls: string[]) =>
      calls.filter((c) => /^(eq\("(source|state)"|or\("title\.ilike)/.test(c));
    expect(shared(list)).toEqual(shared(count));
    expect(shared(list)).toHaveLength(3);
  });

  it("no filters: only the retired sources are left out (owner, Oct 6; retired-lead-sources.test.ts)", () => {
    const calls: string[] = [];
    const q = {
      eq: (...a: unknown[]) => (calls.push(`eq${JSON.stringify(a)}`), q),
      or: (...a: unknown[]) => (calls.push(`or${JSON.stringify(a)}`), q),
      not: (...a: unknown[]) => (calls.push(`not${JSON.stringify(a)}`), q),
    };
    applyLeadFilters(q, {});
    expect(calls).toEqual([
      'not["source","in","(louisville_permits,louisville_bids,nashville_permits,nashville_bids)"]',
    ]);
  });
});

/* ---- 7. Keywords match whole words and plain endings -------------------------------------- */

describe("isRoofLead", () => {
  it("does not take 'addition' for 'additional'", () => {
    expect(isRoofLead("Janitorial services — additional questions", ["addition"])).toBe(false);
    expect(isRoofLead("Additionally, the boiler", ["addition"])).toBe(false);
    expect(isRoofLead("Addition of a track", ["addition"])).toBe(true);
    expect(isRoofLead("Gym additions", ["addition"])).toBe(true);
  });
  it("still catches the plain endings", () => {
    expect(isRoofLead("Roofs at three schools", ["roof"])).toBe(true);
    expect(isRoofLead("KCIW ROOFING repairs", ["roof"])).toBe(true);
    expect(isRoofLead("Gym re-roofing", ["re-roof"])).toBe(true);
    expect(isRoofLead("Architectural shingles", ["shingle"])).toBe(true);
    expect(isRoofLead("New Building for Parks", ["new building"])).toBe(true);
    expect(isRoofLead("new building addition", ["addition"])).toBe(true);
    expect(isRoofLead("Roofed shelter", ["roof"])).toBe(true);
    expect(isRoofLead("Roofer services", ["roof"])).toBe(true);
    expect(isRoofLead("Fireproofing upgrade", ["roof"])).toBe(false);
  });
});

/* ---- 8. A BidNet copy of a job on a city portal ------------------------------------------- */

const lead = (source: string, id: string, over: Rec = {}) => ({
  source,
  external_id: id,
  title: `Job ${id}`,
  is_roof: false,
  gone_at: null,
  state: "TN",
  ...over,
});

describe("BidNet copies of portal jobs", () => {
  beforeEach(() => {
    notifyMock.mockClear();
  });

  it("drops a BidNet row whose title matches an open portal lead in the same state", async () => {
    const db = new FakeDb();
    db.leads.push(
      { id: "a", ...lead("nashville_bids", "GG1", { title: "Golf Merchandise" }) },
      // Closed at the portal: no longer a reason to drop the BidNet row.
      {
        id: "b",
        ...lead("chattanooga_bids", "200", { title: "Bulk Fuel", gone_at: "2026-09-01" }),
      },
      { id: "c", ...lead("bidnet", "777", { title: "Golf Merchandise" }) },
      // A title that names no particular job is not taken for the same job.
      { id: "d", ...lead("knox_county_bids", "3801", { title: "Roof Replacement" }) },
    );
    await saveLeadRows(db as unknown as Client, [
      {
        source: "bidnet",
        rows: [
          lead("bidnet", "777", { title: "GOLF  merchandise" }),
          lead("bidnet", "778", { title: "Bulk Fuel" }),
          // Same words in Kentucky: another job.
          lead("bidnet", "779", { title: "Golf Merchandise", state: "KY" }),
          lead("bidnet", "780", { title: "ROOF REPLACEMENT" }),
        ] as never,
        count: 4,
      },
    ]);
    const saved = db.upserts.flat().map((x) => `${x["source"]}:${x["external_id"]}`);
    expect(saved.sort()).toEqual(["bidnet:778", "bidnet:779", "bidnet:780"]);
    // The stored BidNet copy is retired; the portal lead is untouched.
    expect(db.leads.find((x) => x["id"] === "c")!["gone_at"]).toBeTruthy();
    expect(db.leads.find((x) => x["id"] === "a")!["gone_at"]).toBeNull();
  });

  it("importing a portal row retires the stored BidNet copy", async () => {
    const db = new FakeDb();
    db.leads.push(
      {
        id: "b1",
        ...lead("bidnet", "444", { title: "THREE FIRE HYDRANT REPLACEMENTS – Parks" }),
      },
      { id: "b2", ...lead("bidnet", "445", { title: "Camera System Replacement" }) },
      // Kentucky: not the Nashville job.
      {
        id: "b3",
        ...lead("bidnet", "446", {
          title: "Three Fire Hydrant Replacements - Parks",
          state: "KY",
        }),
      },
    );
    const row: PortalRow = {
      number: "GG000130",
      title: "Three Fire Hydrant Replacements - Parks",
      type: "RFQ",
      status: "Active",
      postingDate: null,
      openDate: null,
      closeDate: "11/3/2026 2:00 PM",
      url: null,
      buyer: "Bradley D Wall",
      email: "Brad.Wall@nashville.gov",
      description: null,
      prebid: null,
      attachments: [],
      details: null,
      detailsRead: false,
    };
    const r = await importBrowserBids(db as unknown as Client, {
      ok: true,
      source: "nashville_bids",
      portalTimeZone: "America/Chicago",
      fetchedAt: "2026-09-30T11:05:00.000Z",
      rows: [row],
    });
    expect(db.leads.find((x) => x["id"] === "b1")!["gone_at"]).toBeTruthy();
    expect(db.leads.find((x) => x["id"] === "b2")!["gone_at"]).toBeNull();
    expect(db.leads.find((x) => x["id"] === "b3")!["gone_at"]).toBeNull();
    // The owner's own-list copy (with the buyer to call) is kept.
    expect(
      db.leads.find((x) => x["source"] === "nashville_bids" && x["external_id"] === "GG000130"),
    ).toMatchObject({ contact: "Bradley D Wall — Brad.Wall@nashville.gov", gone_at: null });
    expect(r.gone).toBe(1);
  });
});
