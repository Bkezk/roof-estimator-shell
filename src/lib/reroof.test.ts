import { describe, expect, it } from "vitest";

import type { NashvillePermit } from "@/lib/leads.server";
import type { Client } from "@/lib/notify.server";
import { monthYear, reroofLine } from "@/lib/prospect";
import {
  FIRST_RUN_DAYS,
  PERMIT_SECTION,
  RUN_DAYS,
  cleanPurpose,
  isReroofPurpose,
  markReroofedBuildings,
  metresBetween,
  nashvilleReroofQueryUrl,
  nashvilleReroofRow,
  normalizeAddress,
  parseRoofType,
  parseSqft,
  permitNote,
  type ReroofSource,
} from "@/lib/reroof.server";

// Scopes copied from Metro Nashville's Building Permits Issued layer, "Building Commercial -
// Roofing / Siding", Sep 29, 2026 (the U&O line is from a Commercial - Change of Use permit).
const HOME_DEPOT = "to replace roof of existing home depot store. no change to footprint.";
const PINAIRE =
  "Tear off existing low slope roof area down to structural deck, install new insulation, flashing, TPO, crickets, edge metal, gutters and downspouts. Metal Roof restoration on the office.";
const HVAC =
  "Replacement of existing Roof Top HVAC units, along with Structural Steel Reinforcements to Roof and Minor Roof Repairs POC: Pamela Danzy 615-992-1400";
const USE_AND_OCCUPANCY = "use and occupancy for 7862SF warehouse. no construction.";
const SIDING_ONLY =
  "To replace siding only for BUILDING 2, Glastonbury Woods Apartments. No change in use. No change to exterior building/roof lines or footprint.";

describe("isReroofPurpose", () => {
  it("the owner's four samples: two re-roofs, the HVAC swap and the U&O are not", () => {
    expect(isReroofPurpose(HOME_DEPOT)).toBe(true);
    expect(isReroofPurpose(PINAIRE)).toBe(true);
    expect(isReroofPurpose(HVAC)).toBe(false);
    expect(isReroofPurpose(USE_AND_OCCUPANCY)).toBe(false);
  });

  it("reads the other ways a roof permit is worded", () => {
    expect(isReroofPurpose("to reroof existing warehouse building. no change to footprint.")).toBe(
      true,
    );
    expect(isReroofPurpose("to re-roof existing home depot building.")).toBe(true);
    expect(
      isReroofPurpose("Remove old shingles, install new shingles, Install flashing. POC: x"),
    ).toBe(true);
    expect(
      isReroofPurpose("Commercial roofing project - manufacturer is Carlisle - 60 MIL TPO."),
    ).toBe(true);
    expect(isReroofPurpose("Disable the existing EPDM roof membrane and leave in place")).toBe(
      true,
    );
    expect(isReroofPurpose("To install new roof, siding gutters and paint on Bldg 15.")).toBe(true);
    // A re-cover that mentions the rooftop units further on (permit 2026023818).
    expect(
      isReroofPurpose(
        "Disable the existing EPDM roof membrane and leave in place, remove existing wall flashings. Mechanically attach (1) layer of 1” Polyisocyanurate Insulation cover board over the existing EPDM membrane. Install ¼” per foot tapered insulation as needed at the high side of the HVAC units to provide positive drainage. Install new protective walk pads on access sides of the existing HVAC units.",
      ),
    ).toBe(true);
  });

  it("siding only, a patch, rooftop units and an empty scope are not re-roofs", () => {
    expect(isReroofPurpose(SIDING_ONLY)).toBe(false);
    expect(isReroofPurpose("Siding replacement, repaint & caulk exterior siding")).toBe(false);
    expect(isReroofPurpose("to make storm damage roof repairs to existing building.")).toBe(false);
    expect(
      isReroofPurpose(
        "Slope Shingle Roof Repair - small section of the roof that is being repaired - not going down to the decking",
      ),
    ).toBe(false);
    expect(isReroofPurpose("Set 4 new RTUs on existing roof curbs.")).toBe(false);
    // A repair that also replaces, and rooftop units alongside a plain re-roof, count.
    expect(isReroofPurpose("Remove and replace roof; repair deck as needed.")).toBe(true);
    expect(isReroofPurpose("Re-roof the building and reset the rooftop units.")).toBe(true);
    expect(isReroofPurpose("")).toBe(false);
    expect(isReroofPurpose(null)).toBe(false);
  });
});

describe("reading a permit's scope", () => {
  it("square feet in the forms the permits use (not roofing squares)", () => {
    expect(parseSqft(USE_AND_OCCUPANCY)).toBe(7862);
    expect(parseSqft("re-roof 19,063 S.F. of the east wing")).toBe(19063);
    expect(parseSqft("approx. 12,000 sq ft of TPO")).toBe(12000);
    expect(parseSqft("To remove approximately 36,300 sf of existing membrane")).toBe(36300);
    expect(parseSqft("Remove old BUR roof and deck in a 20,000sq foot area.")).toBe(20000);
    expect(parseSqft("Remove/replace 205 sq laminate shingles")).toBeNull();
    expect(parseSqft("2 layers of 2.2 ISO")).toBeNull();
    expect(parseSqft(null)).toBeNull();
  });

  it("the roof going on, not the one coming off", () => {
    expect(parseRoofType(PINAIRE)).toBe("TPO");
    expect(
      parseRoofType(
        "Remove old BUR roof and deck in a 20,000sq foot area. Install new N deck per engineer new taper insulation and new 60mil TPO roof",
      ),
    ).toBe("TPO");
    expect(
      parseRoofType("Remove and replace the existing roof with a new fully adhered EPDM"),
    ).toBe("EPDM");
    expect(parseRoofType("Remove/replace 205 sq laminate shingles, Ice & water shield")).toBe(
      "Shingle",
    );
    expect(parseRoofType("install new PVC membrane over cover board")).toBe("PVC");
    expect(parseRoofType("two-ply modified bitumen cap sheet")).toBe("Mod Bit");
    expect(parseRoofType("new standing seam metal roof panels")).toBe("Metal");
    expect(parseRoofType("replace built-up roof in kind")).toBe("Built-up");
    expect(parseRoofType(HOME_DEPOT)).toBeNull();
    // Only the roof coming off or staying under is named: no type.
    expect(
      parseRoofType(
        "Remove and discard the existing PVC membrane and EPS insulation down to the underlying EPDM only. Install ¼” tapered insulation.",
      ),
    ).toBeNull();
    expect(
      parseRoofType(
        "Retrofit the existing metal roof with flute filler, insulation and 60 mill TPO",
      ),
    ).toBe("TPO");
  });

  it("normalizes addresses for comparison", () => {
    expect(normalizeAddress("3441 Dickerson Pike, Suite 200")).toBe("3441 DICKERSON PIKE");
    expect(normalizeAddress("1300 56th Avenue North")).toBe("1300 56TH AVE N");
    expect(normalizeAddress("1300 56TH AVE N")).toBe("1300 56TH AVE N");
    expect(normalizeAddress("110 Whitsett Road")).toBe("110 WHITSETT RD");
    expect(normalizeAddress("2525 Perimeter Place Dr.")).toBe("2525 PERIMETER PL DR");
    expect(normalizeAddress("5010 Old Hickory Boulevard")).toBe("5010 OLD HICKORY BLVD");
    expect(normalizeAddress("6800 Highway 70 South")).toBe("6800 HWY 70 S");
    expect(normalizeAddress("1330 FOSTER AVE 100")).toBe("1330 FOSTER AVE");
    expect(normalizeAddress("1330 Foster Ave. #100")).toBe("1330 FOSTER AVE");
    expect(normalizeAddress("654 A WEDGEWOOD AVE")).toBe("654 WEDGEWOOD AVE");
    expect(normalizeAddress("10 A St")).toBe("10 A ST");
    expect(normalizeAddress("1 Cedar Pointe Parkway, Unit B")).toBe("1 CEDAR POINTE PKWY");
    expect(normalizeAddress("730 President Ronald Reagan Way")).toBe(
      "730 PRESIDENT RONALD REAGAN WAY",
    );
    expect(normalizeAddress(null)).toBe("");
  });

  it("drops the clerk's stamp notes and trims the roof record's note", () => {
    expect(
      cleanPurpose(
        "to re-roof existing home depot building.    ***Plans have been reviewed and stamped.  Attachment has been attached in CityWorks.***",
      ),
    ).toBe("to re-roof existing home depot building.");
    expect(cleanPurpose("New roof for MNPS.  **Stamped Plans in City Works**")).toBe(
      "New roof for MNPS.",
    );
    const long = permitNote({
      source: "nashville_permits",
      permit_no: "2026058410",
      cost: 510880,
      description: `${PINAIRE} ${"x".repeat(600)}`,
    });
    expect(long.startsWith("Metro Nashville permit 2026058410, $510,880: Tear off")).toBe(true);
    expect(long.length).toBeLessThanOrEqual(400);
    expect(long.endsWith("…")).toBe(true);
    expect(
      permitNote({ source: "nashville_permits", permit_no: "1", cost: null, description: null }),
    ).toBe("Metro Nashville permit 1: (no scope given)");
  });

  it("asks the layer for one type over a day window, in one request", () => {
    const url = new URL(nashvilleReroofQueryUrl(120, new Date("2026-09-29T15:00:00Z")));
    expect(url.pathname).toMatch(/Building_Permits_Issued_2\/FeatureServer\/0\/query$/);
    expect(url.searchParams.get("where")).toBe(
      "Permit_Type_Description = 'Building Commercial - Roofing / Siding' AND Date_Issued >= DATE '2026-06-01'",
    );
    expect(url.searchParams.get("resultRecordCount")).toBe("1000");
    expect(url.searchParams.has("resultOffset")).toBe(false);
  });

  it("maps a permit to a reroof_permits row", () => {
    const row = nashvilleReroofRow(
      permit({
        Permit__: "2026058410",
        Contact: "Pinaire Roofing",
        Const_Cost: 510880,
        Address: "1111 POLK AVE",
        City: "NASHVILLE",
        Purpose: `${PINAIRE}  **Stamped Plans in City Works**`,
        Lat: 36.1,
        Lon: -86.8,
        Date_Issued: Date.UTC(2026, 7, 20, 3), // Aug 19, 10 PM Central
      }),
      NOW,
    );
    expect(row).toMatchObject({
      source: "nashville_permits",
      permit_no: "2026058410",
      issued_on: "2026-08-19",
      contractor: "Pinaire Roofing",
      cost: 510880,
      address: "1111 POLK AVE",
      city: "NASHVILLE",
      state: "TN",
      lat: 36.1,
      lng: -86.8,
      description: PINAIRE,
      roof_type: "TPO",
      sqft: null,
    });
    expect(nashvilleReroofRow(permit({ Date_Issued: null }), NOW)).toBeNull();
  });
});

describe("the Buildings line", () => {
  it("says when and by whom", () => {
    expect(monthYear("2026-03-14")).toBe("Mar 2026");
    expect(monthYear("soon")).toBeNull();
    expect(reroofLine({ last_reroof_on: "2026-03-14", last_reroof_by: "Pinaire Roofing" })).toBe(
      "re-roofed Mar 2026 by Pinaire Roofing",
    );
    expect(reroofLine({ last_reroof_on: "2025-11-02", last_reroof_by: "kyle beatty" })).toBe(
      "re-roofed Nov 2025 by Kyle Beatty",
    );
    expect(reroofLine({ last_reroof_on: "2025-11-02", last_reroof_by: null })).toBe(
      "re-roofed Nov 2025",
    );
    expect(reroofLine({ last_reroof_on: null, roof_year: 2004 })).toBeNull();
    // A later year typed by hand wins (the plain roof age shows).
    expect(reroofLine({ last_reroof_on: "2025-11-02", roof_year: 2026 })).toBeNull();
    expect(reroofLine({ last_reroof_on: "2025-11-02", roof_year: 2025 })).toBe(
      "re-roofed Nov 2025",
    );
  });
});

/* ---- markReroofedBuildings against an in-memory stand-in ---------------------------------- */

type Rec = Record<string, unknown>;
const NOW = new Date("2026-09-29T15:00:00Z");

/** The three tables the step touches, with the roofs → buildings.roof_year trigger. */
class MemDb {
  tables: Record<string, Rec[]> = { buildings: [], roofs: [], reroof_permits: [] };
  private n = 0;
  nextId(prefix: string) {
    return `${prefix}-${++this.n}`;
  }
  from(table: string) {
    return new MemQuery(this, table);
  }
  /** public.sync_building_roof_year (20260924060000_roof_year.sql). */
  syncRoofYear(buildingId: string) {
    const years = this.tables["roofs"]!.filter(
      (r) => r["building_id"] === buildingId && r["install_date"],
    ).map((r) => Number(String(r["install_date"]).slice(0, 4)));
    const b = this.tables["buildings"]!.find((x) => x["id"] === buildingId);
    if (b && years.length) b["roof_year"] = Math.max(...years);
  }
}
class MemQuery {
  private op: "select" | "update" | "upsert" | "insert" = "select";
  private patch: Rec = {};
  private rows: Rec[] = [];
  private head = false;
  private single_ = false;
  private filters: ((r: Rec) => boolean)[] = [];
  private orderBy: { col: string; asc: boolean } | null = null;
  private max: number | null = null;
  constructor(
    private db: MemDb,
    private table: string,
  ) {}
  private get data() {
    return this.db.tables[this.table]!;
  }
  select(_cols?: string, opts?: { count?: string; head?: boolean }) {
    if (opts?.head) this.head = true;
    return this;
  }
  update(patch: Rec) {
    this.op = "update";
    this.patch = patch;
    return this;
  }
  upsert(rows: Rec[], opts: { onConflict: string }) {
    this.op = "upsert";
    const keys = opts.onConflict.split(",");
    for (const r of rows) {
      const cur = this.data.find((x) => keys.every((k) => x[k] === r[k]));
      if (cur) Object.assign(cur, r);
      else
        this.data.push({
          id: this.db.nextId("permit"),
          building_id: null,
          roof_id: null,
          match_method: null,
          matched_at: null,
          first_seen_at: NOW.toISOString(),
          ...r,
        });
    }
    return this;
  }
  insert(row: Rec) {
    this.op = "insert";
    this.rows = [{ id: this.db.nextId(this.table), ...row }];
    return this;
  }
  single() {
    this.single_ = true;
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
  gte(c: string, v: number | string) {
    this.filters.push(
      (r) => r[c] !== null && r[c] !== undefined && (r[c] as string) >= (v as string),
    );
    return this;
  }
  lte(c: string, v: number | string) {
    this.filters.push(
      (r) => r[c] !== null && r[c] !== undefined && (r[c] as string) <= (v as string),
    );
    return this;
  }
  ilike(c: string, pattern: string) {
    const re = new RegExp(
      `^${pattern
        .split("")
        .map((ch) =>
          ch === "%" ? ".*" : ch === "_" ? "." : ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        )
        .join("")}$`,
      "i",
    );
    this.filters.push((r) => typeof r[c] === "string" && re.test(r[c] as string));
    return this;
  }
  order(col: string, opts?: { ascending?: boolean }) {
    this.orderBy = { col, asc: opts?.ascending ?? true };
    return this;
  }
  limit(n: number) {
    this.max = n;
    return this;
  }
  then<T>(done: (v: { data: unknown; error: null; count?: number }) => T) {
    if (this.op === "insert") {
      this.data.push(...this.rows);
      if (this.table === "roofs") this.db.syncRoofYear(this.rows[0]!["building_id"] as string);
      const data = this.single_ ? { ...this.rows[0]! } : this.rows.map((r) => ({ ...r }));
      return Promise.resolve({ data, error: null }).then(done);
    }
    if (this.op === "upsert") return Promise.resolve({ data: null, error: null }).then(done);
    let hit = this.data.filter((r) => this.filters.every((f) => f(r)));
    if (this.op === "update") {
      for (const r of hit) Object.assign(r, this.patch);
      return Promise.resolve({ data: null, error: null }).then(done);
    }
    if (this.head)
      return Promise.resolve({ data: null, error: null, count: hit.length }).then(done);
    if (this.orderBy) {
      const { col, asc } = this.orderBy;
      hit = [...hit].sort((a, b) => String(a[col]).localeCompare(String(b[col])) * (asc ? 1 : -1));
    }
    if (this.max !== null) hit = hit.slice(0, this.max);
    return Promise.resolve({ data: hit.map((r) => ({ ...r })), error: null }).then(done);
  }
}

function permit(p: Partial<NashvillePermit>): NashvillePermit {
  return {
    Permit__: "P",
    Permit_Type_Description: "Building Commercial - Roofing / Siding",
    Permit_Subtype_Description: "Commercial Roofing & Siding Generic",
    Date_Issued: Date.UTC(2026, 7, 20, 17),
    Const_Cost: 100000,
    Address: null,
    City: "NASHVILLE",
    State: "TN",
    Contact: null,
    Purpose: HOME_DEPOT,
    Lat: null,
    Lon: null,
    ZIP: "37203",
    ...p,
  };
}
/** Noon Central on a day of 2026 (month 1-based). */
const day = (m: number, d: number, y = 2026) => Date.UTC(y, m - 1, d, 17);

/** A point `north` / `east` metres from (lat, lng). */
const offset = (lat: number, lng: number, north: number, east: number) => ({
  lat: lat + north / 111320,
  lng: lng + east / (111320 * Math.cos((lat * Math.PI) / 180)),
});
/** A square outline `half` metres each way around a centre (GeoJSON Polygon, [lng, lat]). */
const square = (c: { lat: number; lng: number }, half: number) => {
  const ne = offset(c.lat, c.lng, half, half);
  const sw = offset(c.lat, c.lng, -half, -half);
  return {
    type: "Polygon",
    coordinates: [
      [
        [sw.lng, sw.lat],
        [ne.lng, sw.lat],
        [ne.lng, ne.lat],
        [sw.lng, ne.lat],
        [sw.lng, sw.lat],
      ],
    ],
  };
};
function building(db: MemDb, b: Rec & { at?: { lat: number; lng: number }; half?: number }) {
  const { at, half, ...rest } = b;
  const row: Rec = {
    id: db.nextId("bldg"),
    name: "",
    address1: "",
    city: null,
    state: "TN",
    deleted_at: null,
    roof_year: null,
    year_built: null,
    last_reroof_on: null,
    last_reroof_by: null,
    centroid_lat: at?.lat ?? null,
    centroid_lng: at?.lng ?? null,
    footprint: at && half ? square(at, half) : null,
    ...rest,
  };
  db.tables["buildings"]!.push(row);
  return row;
}
/** A city whose fetch returns these permits and records the day windows it was asked for. */
function fakeSource(permits: NashvillePermit[]) {
  const asked: number[] = [];
  const src: ReroofSource = {
    source: "nashville_permits",
    label: "Metro Nashville",
    fetch: async (days, now) => {
      asked.push(days);
      return {
        rows: permits.map((p) => nashvilleReroofRow(p, now)!).filter(Boolean),
        truncated: false,
      };
    },
  };
  return { src, asked, permits };
}
const run = (db: MemDb, src: ReroofSource, now = NOW) =>
  markReroofedBuildings(db as unknown as Client, { sources: [src], now });

const POLK = { lat: 36.1498, lng: -86.7697 };
const CHURCH = { lat: 36.16, lng: -86.78 };
const FAR = { lat: 36.2, lng: -86.7 };

describe("markReroofedBuildings", () => {
  it("matches by address, else by point within 40 m, and stamps the building", async () => {
    const db = new MemDb();
    // Same address (the centre is 300 m off the permit point: the address decides).
    const polk = building(db, {
      address1: "1111 Polk Avenue",
      city: "Nashville",
      roof_year: 2004,
      at: offset(POLK.lat, POLK.lng, 300, 0),
    });
    // The same address on a deleted row, and in another city: never matched.
    building(db, {
      address1: "1111 Polk Ave",
      city: "Nashville",
      deleted_at: "2026-01-01",
      at: POLK,
    });
    building(db, { address1: "1111 Polk Ave", city: "Madison", at: POLK });
    // No address; its centre 25 m from the church permit's point (a second one at 35 m).
    const church = building(db, { at: offset(CHURCH.lat, CHURCH.lng, 25, 0) });
    building(db, { at: offset(CHURCH.lat, CHURCH.lng, 0, 35) });
    // 100 m from the third permit: too far.
    building(db, { at: offset(FAR.lat, FAR.lng, 100, 0) });

    const { src, asked } = fakeSource([
      permit({
        Permit__: "2026058410",
        Contact: "Pinaire Roofing",
        Const_Cost: 510880,
        Address: "1111 POLK AVE",
        Purpose: PINAIRE,
        Lat: POLK.lat,
        Lon: POLK.lng,
        Date_Issued: day(8, 20),
      }),
      permit({
        Permit__: "2026045225",
        Contact: "andrea serrano",
        Const_Cost: 426461,
        Address: "2200 WEST END AVE",
        Purpose: "to replace the roof of the existing church. no change to footprint.",
        Lat: CHURCH.lat,
        Lon: CHURCH.lng,
        Date_Issued: day(6, 3),
      }),
      permit({
        Permit__: "2026036960",
        Contact: "jacki scott",
        Address: "5010 OLD HICKORY BLVD",
        City: "HERMITAGE",
        Purpose: "to re-roof existing home depot building. 12,000 sq ft",
        Lat: FAR.lat,
        Lon: FAR.lng,
        Date_Issued: day(5, 1),
      }),
      // Rooftop units at the church: kept, never matched.
      permit({
        Permit__: "2026065071",
        Contact: "Burns Services Inc",
        Address: "2200 WEST END AVE",
        Purpose: HVAC,
        Lat: CHURCH.lat,
        Lon: CHURCH.lng,
        Date_Issued: day(9, 1),
      }),
    ]);

    const r1 = await run(db, src);
    expect(asked).toEqual([FIRST_RUN_DAYS]);
    expect(r1).toEqual({
      permits: 4,
      reroofs: 3,
      matched: 2,
      marked: 2,
      unmatched: 1,
      problems: [],
    });

    const roofs = db.tables["roofs"]!;
    expect(roofs).toHaveLength(2);
    const polkRoof = roofs.find((r) => r["building_id"] === polk["id"])!;
    expect(polkRoof).toMatchObject({
      section_name: PERMIT_SECTION,
      install_date: "2026-08-20",
      installer: "Pinaire Roofing",
      roof_type: "TPO",
      area_sqft: null,
    });
    expect(String(polkRoof["notes"])).toMatch(
      /^Metro Nashville permit 2026058410, \$510,880: Tear off existing low slope roof/,
    );
    expect(polk).toMatchObject({
      roof_year: 2026,
      last_reroof_on: "2026-08-20",
      last_reroof_by: "Pinaire Roofing",
    });
    expect(church).toMatchObject({
      roof_year: 2026,
      last_reroof_on: "2026-06-03",
      last_reroof_by: "andrea serrano",
    });

    const stored = (no: string) => db.tables["reroof_permits"]!.find((p) => p["permit_no"] === no)!;
    expect(stored("2026058410")).toMatchObject({
      building_id: polk["id"],
      roof_id: polkRoof["id"],
      match_method: "address",
      matched_at: NOW.toISOString(),
    });
    expect(stored("2026045225")).toMatchObject({
      building_id: church["id"],
      match_method: "point",
    });
    expect(stored("2026036960")).toMatchObject({
      building_id: null,
      roof_id: null,
      matched_at: null,
    });
    expect(stored("2026065071")).toMatchObject({ building_id: null, matched_at: null });

    // Second run: 120 days, nothing written twice, the unmatched one tried again.
    const later = new Date("2026-09-30T15:00:00Z");
    const r2 = await run(db, src, later);
    expect(asked).toEqual([FIRST_RUN_DAYS, RUN_DAYS]);
    expect(r2).toMatchObject({ permits: 4, reroofs: 3, matched: 0, marked: 0, unmatched: 1 });
    expect(db.tables["roofs"]).toHaveLength(2);
    expect(db.tables["reroof_permits"]).toHaveLength(4);

    // Tennessee buildings load: the Hermitage Home Depot finds its building on the next run.
    const depot = building(db, {
      address1: "5010 Old Hickory Blvd",
      city: "Hermitage",
      year_built: 1995,
      at: offset(FAR.lat, FAR.lng, 10, 10),
    });
    const r3 = await run(db, src, later);
    expect(r3).toMatchObject({ matched: 1, marked: 1, unmatched: 0 });
    expect(depot).toMatchObject({
      roof_year: 2026,
      last_reroof_on: "2026-05-01",
      last_reroof_by: "jacki scott",
    });
    expect(db.tables["roofs"]!.find((r) => r["building_id"] === depot["id"])).toMatchObject({
      area_sqft: 12000,
      installer: "jacki scott",
    });
    expect(stored("2026036960")).toMatchObject({ match_method: "address" });
  });

  it("prefers the building whose outline holds the point, even with its centre past 40 m", async () => {
    const db = new MemDb();
    const warehouse = building(db, { at: offset(POLK.lat, POLK.lng, 0, 120), half: 150 });
    building(db, { at: offset(POLK.lat, POLK.lng, 30, 0), half: 10 });
    const { src } = fakeSource([
      permit({ Permit__: "W1", Lat: POLK.lat, Lon: POLK.lng, Contact: "Stadry Roofing" }),
    ]);
    const r = await run(db, src);
    expect(r).toMatchObject({ matched: 1, unmatched: 0 });
    expect(warehouse["last_reroof_by"]).toBe("Stadry Roofing");
    expect(
      metresBetween(
        POLK.lat,
        POLK.lng,
        warehouse["centroid_lat"] as number,
        warehouse["centroid_lng"] as number,
      ),
    ).toBeGreaterThan(100);
  });

  it("keeps a later year and a later stamp; one roof record per building and day", async () => {
    const db = new MemDb();
    // Typed "Roof installed 2026" by hand, and a stamp from a later permit already there.
    const typed = building(db, { address1: "590 Hill Ave", city: "Nashville", roof_year: 2026 });
    const stamped = building(db, {
      address1: "1157 Bell Rd",
      city: "Antioch",
      last_reroof_on: "2026-09-01",
      last_reroof_by: "Earlier Roofing",
    });
    const { src } = fakeSource([
      permit({
        Permit__: "H1",
        Address: "590 HILL AVE",
        Contact: "denis durmic",
        Date_Issued: day(11, 5, 2025),
      }),
      // An apartment complex: three permits, one building here, one day.
      ...["B1", "B2", "B3"].map((no) =>
        permit({
          Permit__: no,
          Address: "1157 BELL RD",
          City: "ANTIOCH",
          Contact: "R3 Contractors",
          Purpose: "Remove old shingles, install new shingles, Install flashing.",
          Date_Issued: day(3, 2),
        }),
      ),
    ]);
    const r = await run(db, src);
    expect(r).toMatchObject({ matched: 4, marked: 1, unmatched: 0 });
    // The roofs trigger set roof_year to 2025 (the only roof record); the step wrote 2026 back.
    expect(typed).toMatchObject({
      roof_year: 2026,
      last_reroof_on: "2025-11-05",
      last_reroof_by: "denis durmic",
    });
    expect(stamped).toMatchObject({
      roof_year: 2026,
      last_reroof_on: "2026-09-01",
      last_reroof_by: "Earlier Roofing",
    });
    const bell = db.tables["roofs"]!.filter((x) => x["building_id"] === stamped["id"]);
    expect(bell).toHaveLength(1);
    expect(
      db.tables["reroof_permits"]!.filter((p) => p["roof_id"] === bell[0]!["id"]).map(
        (p) => p["permit_no"],
      ),
    ).toEqual(["B1", "B2", "B3"]);
  });

  it("a roof record deleted by hand is not written again", async () => {
    const db = new MemDb();
    const b = building(db, { address1: "1111 Polk Ave", city: "Nashville" });
    const { src } = fakeSource([permit({ Permit__: "D1", Address: "1111 POLK AVE" })]);
    await run(db, src);
    expect(db.tables["roofs"]).toHaveLength(1);
    // Deleted in the detail panel: the foreign key sets roof_id to null.
    db.tables["roofs"] = [];
    db.tables["reroof_permits"]![0]!["roof_id"] = null;
    const r = await run(db, src);
    expect(r).toMatchObject({ matched: 0, unmatched: 0 });
    expect(db.tables["roofs"]).toHaveLength(0);
    expect(b["last_reroof_on"]).toBe("2026-08-20");
  });

  it("gives up on an unmatched permit after 12 months; a failed fetch is reported, not thrown", async () => {
    const db = new MemDb();
    const { src } = fakeSource([
      permit({ Permit__: "OLD", Address: "1 NOWHERE RD", Date_Issued: day(9, 1, 2025) }),
    ]);
    const r = await run(db, src);
    expect(r).toMatchObject({ permits: 1, reroofs: 1, matched: 0, unmatched: 0 });
    expect(db.tables["reroof_permits"]).toHaveLength(1);

    const broken: ReroofSource = {
      source: "nashville_permits",
      label: "Metro Nashville",
      fetch: async () => {
        throw new Error("→ 503");
      },
    };
    const r2 = await run(db, broken);
    expect(r2.problems).toEqual(["Metro Nashville re-roof permits → 503"]);
  });
});
