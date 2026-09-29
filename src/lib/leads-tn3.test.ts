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
  browserImportSchema,
  currentRounds,
  negotiationRound,
  type PortalRow,
} from "@/lib/leads-browser";
import {
  browserBidLead,
  importBrowserBids,
  parsePortalDate,
  portalDay,
  saveLeadRows,
} from "@/lib/leads.server";
import { importRequest } from "@/lib/leads-import.server";

const KEYWORDS = ["roof", "roofing", "re-roof", "membrane", "epdm", "tpo", "shingle"];

const row = (over: Partial<PortalRow>): PortalRow => ({
  number: "X1",
  title: "Something",
  type: "RFQ",
  status: "Active",
  postingDate: null,
  openDate: null,
  closeDate: null,
  description: null,
  buyer: null,
  email: null,
  prebid: null,
  attachments: [],
  details: null,
  detailsRead: false,
  ...over,
});

// Metro Nashville's Negotiation Abstracts, Sep 29, 2026 (a row and its abstract, as the script
// sends them; the dry run read 220 rows over the year, 9 open).
const NASH_HAZMAT = row({
  number: "GG000105,2",
  title: "Environmental and Hazardous Material (Hazmat) Inspection and Testing Services",
  type: "RFQ",
  status: "Active",
  postingDate: "9/28/2026 9:07 AM",
  openDate: "9/28/2026 9:07 AM",
  closeDate: "10/12/2026 2:00 PM",
  description:
    "-Attached online discussion questions and answers. -Extended the closing date of the solicitation to Monday, October 12, 2026 at 2:00 p.m. Central time.",
  buyer: "Bradley D Wall",
  email: "Brad.Wall@nashville.gov",
  attachments: ["Master Template - IT Environment - 07272026.pdf"],
  details: {
    Title: "Environmental and Hazardous Material (Hazmat) Inspection and Testing Services",
  },
  detailsRead: true,
});

// The City of Chattanooga's Solicitation Abstracts, Sep 29, 2026 (8 open of 459 rows).
const CHATT_DEMO = row({
  number: "200999,2",
  title: "Demolition Services for Public Works",
  type: "Construction Bid",
  status: "Active",
  postingDate: "9/28/26 11:58 AM",
  openDate: "9/13/26 8:00 AM",
  closeDate: "10/15/26 2:00 PM",
  description: "D-26-006-201 Demolition Services for Public Works — Addendum #2",
  buyer: "Daniel Harrigan",
  email: "DHarrigan@chattanooga.gov",
  prebid: "9/30/26 10:00 AM",
  attachments: [
    "D-26-006 Addendum 2.pdf",
    "D-26-006 Signed Adv (2).pdf",
    "D-26-006 Addendum 1.pdf",
  ],
  details: { "Pre-Bid Date & Time": "9/30/26 10:00 AM" },
  detailsRead: true,
});

describe("Oracle portal dates (both zones, both year formats)", () => {
  it("reads Nashville's M/D/YYYY in Central time and Chattanooga's M/D/YY in Eastern", () => {
    expect(parsePortalDate("10/22/2026 2:00 PM", "CT")).toBe("2026-10-22T19:00:00.000Z"); // CDT
    expect(parsePortalDate("10/15/26 2:00 PM", "ET")).toBe("2026-10-15T18:00:00.000Z"); // EDT
    // Standard time after the first Sunday of November.
    expect(parsePortalDate("12/1/26 10:00 AM", "ET")).toBe("2026-12-01T15:00:00.000Z");
    expect(parsePortalDate("1/5/2027 2:00 PM", "CT")).toBe("2027-01-05T20:00:00.000Z");
    // Both formats, both zones.
    expect(parsePortalDate("10/15/2026 2:00 PM", "ET")).toBe("2026-10-15T18:00:00.000Z");
    expect(parsePortalDate("10/22/26 2:00 PM", "CT")).toBe("2026-10-22T19:00:00.000Z");
    // 12 AM / 12 PM, a date alone (midnight local).
    expect(parsePortalDate("9/30/26 12:00 PM", "ET")).toBe("2026-09-30T16:00:00.000Z");
    expect(parsePortalDate("9/30/26 12:30 AM", "CT")).toBe("2026-09-30T05:30:00.000Z");
    expect(parsePortalDate("9/28/26", "ET")).toBe("2026-09-28T04:00:00.000Z");
    // Not dates.
    expect(parsePortalDate("13/1/26 2:00 PM", "ET")).toBeNull();
    expect(parsePortalDate("2/30/2026", "CT")).toBeNull();
    expect(parsePortalDate("", "CT")).toBeNull();
    expect(parsePortalDate("10/15/202 2:00 PM", "ET")).toBeNull();
  });

  it("gives the calendar day a posting date shows", () => {
    expect(portalDay("9/28/26 11:58 AM")).toBe("2026-09-28");
    expect(portalDay("9/28/2026 3:24 PM")).toBe("2026-09-28");
    expect(portalDay("9/28/26")).toBe("2026-09-28");
    expect(portalDay("soon")).toBeNull();
  });
});

describe("amendment rounds", () => {
  it("splits the round off the number", () => {
    expect(negotiationRound("GG000106,2")).toEqual({ base: "GG000106", round: 2 });
    expect(negotiationRound("GG000111")).toEqual({ base: "GG000111", round: 0 });
    expect(negotiationRound("200999,2")).toEqual({ base: "200999", round: 2 });
    // A re-solicitation keeps its "-2" in the base.
    expect(negotiationRound("GG000068-2,1")).toEqual({ base: "GG000068-2", round: 1 });
    expect(negotiationRound("200966-2")).toEqual({ base: "200966-2", round: 0 });
  });

  it("keeps the highest round of each solicitation and drops the closed ones", () => {
    // Rows as the Nashville list shows them (newest first), Sep 29.
    const rows = [
      row({ number: "GG000106,2", status: "Active", closeDate: "10/1/2026 2:00 PM" }),
      row({ number: "GG000106,1", status: "Amended" }),
      row({ number: "GG000106", status: "Amended" }),
      row({ number: "GG000098,2", status: "Closed" }),
      row({ number: "GG000098,1", status: "Amended" }),
      row({ number: "GG000068-2,1", status: "Awarded" }),
      row({ number: "GG000070,3", status: "Canceled" }),
      row({ number: "GG000111", status: "Active" }),
      // Out of order and a two-digit round: 10 beats 9.
      row({ number: "GG000050,9", status: "Amended" }),
      row({ number: "GG000050,10", status: "Active" }),
    ];
    expect(currentRounds(rows).map((r) => r.number)).toEqual([
      "GG000106,2",
      "GG000111",
      "GG000050,10",
    ]);
    // A solicitation whose latest round is still Amended (no newer row listed) stays open.
    expect(currentRounds([row({ number: "A,1", status: "Amended" })])).toHaveLength(1);
    expect(currentRounds([])).toEqual([]);
  });
});

describe("portal rows → leads", () => {
  it("Metro Nashville: base number, Central close time, posting day, the buyer to ask", () => {
    const lead = browserBidLead(NASH_HAZMAT, "nashville_bids", KEYWORDS);
    expect(lead).toMatchObject({
      source: "nashville_bids",
      external_id: "GG000105",
      title: "Environmental and Hazardous Material (Hazmat) Inspection and Testing Services",
      agency: "Metro Nashville",
      location: "Nashville",
      city: "Nashville",
      county: "Davidson",
      state: "TN",
      project_type: "RFQ",
      bid_at: "2026-10-12T19:00:00.000Z",
      prebid_at: null,
      issued_on: "2026-09-28",
      url: "https://ibqhjb.fa.ocs.oraclecloud.com/fscmUI/faces/NegotiationAbstracts?prcBuId=300000006739049",
      contact: "Bradley D Wall — Brad.Wall@nashville.gov",
      is_roof: false,
      gone_at: null,
    });
    expect(lead.raw).toMatchObject({
      number: "GG000105,2",
      round: 2,
      portal_time_zone: "America/Chicago",
    });
  });

  it("Chattanooga: Eastern close and pre-bid times, a construction bid is not a roof by itself", () => {
    const lead = browserBidLead(CHATT_DEMO, "chattanooga_bids", KEYWORDS);
    expect(lead).toMatchObject({
      source: "chattanooga_bids",
      external_id: "200999",
      agency: "City of Chattanooga",
      city: "Chattanooga",
      county: "Hamilton",
      state: "TN",
      project_type: "Construction Bid",
      bid_at: "2026-10-15T18:00:00.000Z",
      prebid_at: "2026-09-30T14:00:00.000Z",
      issued_on: "2026-09-28",
      url: "https://fa-eqto-saasfaprod1.fa.ocs.oraclecloud.com/fscmUI/faces/NegotiationAbstracts?prcBuId=300000003584083",
      contact: "Daniel Harrigan — DHarrigan@chattanooga.gov",
      is_roof: false,
    });
  });

  it("flags roof work from the title, the synopsis or an attachment name", () => {
    const lead = (over: Partial<PortalRow>) =>
      browserBidLead({ ...CHATT_DEMO, ...over }, "chattanooga_bids", KEYWORDS);
    expect(lead({ title: "Fire Hall 12 Roof Replacement" }).is_roof).toBe(true);
    expect(lead({ title: "Re-Roof of the Development Resource Center" }).is_roof).toBe(true);
    expect(lead({ description: "Remove and replace the TPO membrane on Building C" }).is_roof).toBe(
      true,
    );
    expect(lead({ attachments: ["Roofing Specifications.pdf"] }).is_roof).toBe(true);
    // No buyer, no dates read: nulls, not guesses.
    const bare = browserBidLead(
      row({ number: "201001", title: "THREE FIRE HYDRANT REPLACEMENTS", type: null }),
      "chattanooga_bids",
      KEYWORDS,
    );
    expect(bare).toMatchObject({
      external_id: "201001",
      contact: null,
      bid_at: null,
      prebid_at: null,
      issued_on: null,
      project_type: null,
      is_roof: false,
    });
  });
});

const payload = (over: Record<string, unknown> = {}) => ({
  ok: true,
  source: "nashville_bids",
  portalTimeZone: "America/Chicago",
  fetchedAt: "2026-09-29T21:05:38.292Z",
  rows: [NASH_HAZMAT],
  ...over,
});

describe("the import payload (zod)", () => {
  it("accepts the script's payload, and an empty list (nothing open)", () => {
    expect(browserImportSchema.safeParse(payload()).success).toBe(true);
    expect(browserImportSchema.safeParse(payload({ rows: [] })).success).toBe(true);
    expect(
      browserImportSchema.safeParse(
        payload({
          source: "chattanooga_bids",
          portalTimeZone: "America/New_York",
          rows: [CHATT_DEMO],
        }),
      ).success,
    ).toBe(true);
  });

  it("refuses anything else", () => {
    const bad = (p: unknown) => browserImportSchema.safeParse(p).success;
    expect(bad(payload({ source: "bidnet" }))).toBe(false);
    expect(bad(payload({ ok: false }))).toBe(false);
    expect(bad(payload({ portalTimeZone: "America/New_York" }))).toBe(false); // Nashville is Central
    expect(bad(payload({ fetchedAt: "yesterday" }))).toBe(false);
    expect(bad(payload({ rows: Array.from({ length: 501 }, () => NASH_HAZMAT) }))).toBe(false);
    expect(bad(payload({ rows: [{ ...NASH_HAZMAT, title: "x".repeat(501) }] }))).toBe(false);
    expect(bad(payload({ rows: [{ ...NASH_HAZMAT, number: "" }] }))).toBe(false);
    expect(bad(payload({ rows: [{ ...NASH_HAZMAT, attachments: Array(61).fill("a.pdf") }] }))).toBe(
      false,
    );
    const many = Object.fromEntries(Array.from({ length: 41 }, (_, i) => [`f${i}`, "v"]));
    expect(bad(payload({ rows: [{ ...NASH_HAZMAT, details: many }] }))).toBe(false);
    const { buyer: _b, ...noBuyer } = NASH_HAZMAT;
    expect(bad(payload({ rows: [noBuyer] }))).toBe(false);
    expect(bad(null)).toBe(false);
  });
});

describe("POST /api/cron/leads-import", () => {
  beforeEach(() => {
    process.env["LOVABLE_CRON_SECRET"] = "test-secret";
  });
  const req = (body: string, auth = "Bearer test-secret") =>
    new Request("https://app.example/api/cron/leads-import", {
      method: "POST",
      headers: { Authorization: auth, "Content-Type": "application/json" },
      body,
    });

  it("refuses a request without the cron secret before reading it", async () => {
    expect((await importRequest(req(JSON.stringify(payload()), "Bearer wrong"))).status).toBe(401);
    expect((await importRequest(req(JSON.stringify(payload()), ""))).status).toBe(401);
  });

  it("answers 400 with the reasons for a bad payload, and saves nothing", async () => {
    const res = await importRequest(
      req(JSON.stringify(payload({ source: "somewhere_else", rows: [{ number: "GG1" }] }))),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; issues: string[] };
    expect(body.ok).toBe(false);
    expect(body.issues.join("\n")).toMatch(/source/);
    expect(body.issues.join("\n")).toMatch(/rows\.0\.title/);
    expect((await importRequest(req("not json"))).status).toBe(400);
  });
});

/* ---- saveLeadRows against a small in-memory stand-in for the leads table -------------------- */

type Rec = Record<string, unknown>;
class FakeDb {
  leads: Rec[] = [];
  settings: Rec = {
    id: 1,
    roof_keywords: KEYWORDS,
    source_fetched_at: { sam_gov: "2026-09-29T10:00:00Z" },
  };
  upserts: Rec[][] = [];
  from(table: string) {
    return new FakeQuery(this, table);
  }
  async rpc(name: string) {
    return { data: name === "prospect_user_ids" ? ["u1", "u2"] : null, error: null };
  }
}
class FakeQuery {
  private op: "select" | "update" | "upsert" = "select";
  private patch: Rec = {};
  private filters: ((r: Rec) => boolean)[] = [];
  private single_ = false;
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
  then<T>(done: (v: { data: unknown; error: null }) => T) {
    const rows = this.table === "leads" ? this.db.leads : [this.db.settings];
    const hit = rows.filter((r) => this.filters.every((f) => f(r)));
    if (this.op === "update") for (const r of hit) Object.assign(r, this.patch);
    const data = this.op === "upsert" ? null : this.single_ ? (hit[0] ?? null) : hit;
    return Promise.resolve({ data, error: null }).then(done);
  }
}
const lead = (source: string, id: string, over: Rec = {}) => ({
  source,
  external_id: id,
  title: `Job ${id}`,
  is_roof: false,
  gone_at: null,
  ...over,
});

describe("saveLeadRows (shared by the refresh and the browser import)", () => {
  beforeEach(() => {
    notifyMock.mockClear();
  });

  it("upserts, marks what dropped off a source gone, and tells Prospecting about new roof leads", async () => {
    const db = new FakeDb();
    db.leads.push(
      { ...lead("knox_county_bids", "3764"), status: "watching", note: "call Brian" },
      { ...lead("knox_county_bids", "3700") },
      { ...lead("ut_bids", "utk:a.pdf") }, // another source: untouched
      { ...lead("lynn_bids", "old-post") }, // Lynn: scrolling off the feed is not gone
    );
    const r = await saveLeadRows(db as unknown as Client, [
      {
        source: "knox_county_bids",
        rows: [
          lead("knox_county_bids", "3764", { state: "TN" }),
          lead("knox_county_bids", "3801", {
            title: "Roof Replacement",
            is_roof: true,
            state: "TN",
          }),
        ] as never,
        count: 2,
      },
      { source: "lynn_bids", rows: [lead("lynn_bids", "new-post")] as never, count: 1 },
    ]);
    const get = (s: string, id: string) =>
      db.leads.find((x) => x["source"] === s && x["external_id"] === id)!;
    expect(r.counts).toEqual({ knox_county_bids: 2, lynn_bids: 1 });
    expect(r.saved).toBe(3);
    expect(r.fresh.map((x) => x.external_id)).toEqual(["3801", "new-post"]);
    expect(r.newRoof.map((x) => x.external_id)).toEqual(["3801"]);
    expect(r.gone).toBe(1);
    expect(get("knox_county_bids", "3700")["gone_at"]).toBeTruthy();
    expect(get("knox_county_bids", "3764")).toMatchObject({
      gone_at: null,
      status: "watching",
      note: "call Brian",
    });
    expect(get("ut_bids", "utk:a.pdf")["gone_at"]).toBeNull();
    expect(get("lynn_bids", "old-post")["gone_at"]).toBeNull();
    // A row without a state is saved as Kentucky (the column is not null).
    expect(get("lynn_bids", "new-post")["state"]).toBe("KY");
    expect(notifyMock).toHaveBeenCalledTimes(1);
    expect(notifyMock.mock.calls[0]![0]).toEqual(["u1", "u2"]);
    expect(notifyMock.mock.calls[0]![1]).toMatchObject({
      kind: "lead",
      title: "1 new roof lead",
      url: "/prospect/leads?roof=1",
    });
    expect(r.notified).toBe(2);
  });

  it("keeps the duplicate rules: Lynn and BidNet copies are dropped and retired", async () => {
    const db = new FakeDb();
    db.leads.push(lead("bidnet", "444"), lead("lynn_bids", "9"));
    const r = await saveLeadRows(db as unknown as Client, [
      {
        source: "ky_planroom",
        rows: [lead("ky_planroom", "1", { title: "RFB-86-27 Jackson SOB Roof" })] as never,
        count: 1,
      },
      {
        source: "lynn_bids",
        rows: [
          lead("lynn_bids", "9", { title: "RFB-86-27 FSS – Jackson SOB Roof Replacement" }),
        ] as never,
        count: 1,
      },
      {
        source: "knox_county_bids",
        rows: [lead("knox_county_bids", "3764", { title: "Salt Dome Roof" })] as never,
        count: 1,
      },
      {
        source: "bidnet",
        rows: [lead("bidnet", "444", { title: "Salt Dome Roof" }), lead("bidnet", "445")] as never,
        count: 2,
      },
    ]);
    expect(
      db.upserts
        .flat()
        .map((x) => `${x["source"]}:${x["external_id"]}`)
        .sort(),
    ).toEqual(["bidnet:445", "knox_county_bids:3764", "ky_planroom:1"]);
    // The stored Lynn and BidNet copies are retired.
    expect(db.leads.find((x) => x["external_id"] === "9")!["gone_at"]).toBeTruthy();
    expect(db.leads.find((x) => x["external_id"] === "444")!["gone_at"]).toBeTruthy();
    expect(r.counts).toEqual({ ky_planroom: 1, lynn_bids: 1, knox_county_bids: 1, bidnet: 2 });
  });

  it("leaves a source read only in part alone", async () => {
    const db = new FakeDb();
    db.leads.push(lead("bidnet", "1"), lead("bidnet", "2"));
    const r = await saveLeadRows(
      db as unknown as Client,
      [{ source: "bidnet", rows: [lead("bidnet", "1")] as never, count: 1 }],
      { partial: new Set(["bidnet"]) },
    );
    expect(r.gone).toBe(0);
    expect(db.leads.every((x) => x["gone_at"] === null)).toBe(true);
  });
});

describe("importBrowserBids", () => {
  beforeEach(() => {
    notifyMock.mockClear();
  });

  it("saves the current rounds, retires what closed, stamps the source", async () => {
    const db = new FakeDb();
    db.leads.push(
      lead("nashville_bids", "GG000105", { status: "watching" }),
      lead("nashville_bids", "GG000098"), // closed since: gone
      lead("chattanooga_bids", "200999"), // other portal: untouched
    );
    const r = await importBrowserBids(db as unknown as Client, {
      ok: true,
      source: "nashville_bids",
      portalTimeZone: "America/Chicago",
      fetchedAt: "2026-09-29T21:05:38.292Z",
      rows: [
        NASH_HAZMAT,
        { ...NASH_HAZMAT, number: "GG000105,1", status: "Amended" },
        row({
          number: "GG000120",
          title: "Metro Courthouse Roof Replacement",
          closeDate: "11/3/2026 2:00 PM",
        }),
      ],
    });
    expect(r).toEqual({
      source: "nashville_bids",
      received: 3,
      open: 2,
      roof: 1,
      new_leads: 1,
      new_roof_leads: 1,
      gone: 1,
      notified: 2,
    });
    const nash = db.leads.filter((x) => x["source"] === "nashville_bids");
    expect(nash.find((x) => x["external_id"] === "GG000105")).toMatchObject({
      status: "watching",
      gone_at: null,
      bid_at: "2026-10-12T19:00:00.000Z",
    });
    expect(nash.find((x) => x["external_id"] === "GG000098")!["gone_at"]).toBeTruthy();
    expect(db.leads.find((x) => x["source"] === "chattanooga_bids")!["gone_at"]).toBeNull();
    const stamps = db.settings["source_fetched_at"] as Record<string, string>;
    expect(stamps["sam_gov"]).toBe("2026-09-29T10:00:00Z"); // kept
    expect(Date.parse(stamps["nashville_bids"]!)).toBeGreaterThan(Date.now() - 60000);
  });

  it("an empty list with ok: true retires that source's open leads", async () => {
    const db = new FakeDb();
    db.leads.push(lead("chattanooga_bids", "200999"), lead("chattanooga_bids", "201001"));
    const r = await importBrowserBids(db as unknown as Client, {
      ok: true,
      source: "chattanooga_bids",
      portalTimeZone: "America/New_York",
      fetchedAt: "2026-09-29T21:06:08.758Z",
      rows: [],
    });
    expect(r.gone).toBe(2);
    expect(r.open).toBe(0);
    expect(notifyMock).not.toHaveBeenCalled();
  });
});
