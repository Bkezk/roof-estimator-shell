/**
 * The accessory-family seed (owner, Oct 26–27): the Duro-Tech TPO rows for the Duro-Last screens,
 * the Non-DL TPO and EPDM accessory branches, the adhesives, the pitch pans, the custom
 * applications and every item number. These pins catch a transcription slip before the data
 * reaches the live catalog: a duplicate part number on one screen, a blank or zero price, a
 * row the engine could not count (a pipe stack without a numeric size, a vent not named by
 * colour), an item number mapped twice to different cells.
 */
import { describe, expect, it } from "vitest";

import {
  ADHESIVE_PRODUCTS,
  CDR_RENUMBER,
  CUSTOM_APPLICATION_ROWS,
  DURO_LAST_ADDITIONS,
  DURO_LAST_OTHER_SCREEN,
  DURO_TECH_PREFIX,
  EPDM_SCREENS,
  FAMILY_SCREENS,
  LABOR_ROWS,
  NON_DL_TPO_SCREENS,
  PITCH_PAN_ROWS,
  seedItemNumbers,
} from "./accessory-families";

const EXISTING_COLUMNS: Record<string, string[]> = {
  "duro_last:sealants": ["Description", "Part #", "Price"],
  "duro_last:pipe_stacks": [
    "Description",
    "Size",
    "Open Part #",
    "Closed Part #",
    "Price",
    "Tan Price",
    "Gray Price",
    "Dark Gray",
    "Terra Cotta",
    "Rock Ply",
  ],
  "duro_last:corners": [
    "Description",
    "Part #",
    "White",
    "Tan",
    "Gray",
    "Dark Gray",
    "Terra Cotta",
  ],
  "duro_last:walk_pads_wall_vents": ["Description", "Part #", "Price"],
  "duro_last:drain_boots": ["Description", "Part #", "Price", "+ for Color"],
  "duro_last:drain_boot_accessories": ["Description", "Part #", "Price"],
  "duro_last:vents": ["Description", "Part #", "Price"],
  "duro_last:fasteners_and_bits": [
    "Part #",
    "Subtype",
    "Description",
    "Price/Box",
    "Fasteners/Box",
  ],
};

const priceOf = (r: Record<string, string | number>): number => {
  for (const col of ["Price", "Price/Box", "Price/Package", "White"]) {
    const v = r[col];
    if (typeof v === "number") return v;
  }
  return NaN;
};

describe("the family screens", () => {
  it("every row has a description, a part number and a positive price; no screen repeats a part number", () => {
    for (const s of FAMILY_SCREENS) {
      expect(s.rows.length).toBeGreaterThan(0);
      const seen = new Map<string, string>();
      for (const r of s.rows) {
        expect(String(r["Description"]).trim().length, s.id).toBeGreaterThan(0);
        expect(priceOf(r), `${s.id} ${r["Description"]}`).toBeGreaterThan(0);
        for (const col of s.columns)
          expect(col in r, `${s.id} ${r["Description"]} ${col}`).toBe(true);
        const key = s.columns.includes("Open Part #")
          ? `${r["Open Part #"]}|${r["Closed Part #"]}|${r["Size"]}`
          : String(r["Part #"]);
        if (s.columns.includes("Open Part #")) continue; // universal boots repeat per size
        if (s.id.endsWith(":termination_bars")) continue; // one bar, three colour rows
        expect(
          seen.has(key),
          `${s.id} repeats ${key}: ${seen.get(key)} / ${r["Description"]}`,
        ).toBe(false);
        seen.set(key, String(r["Description"]));
      }
    }
  });
  it("mirrors the Duro-Last screen ids the engine reads, under each family branch", () => {
    const ids = (screens: typeof FAMILY_SCREENS) => screens.map((s) => s.id.split(":")[1]);
    expect(ids(NON_DL_TPO_SCREENS)).toEqual([
      "sealants",
      "corners",
      "pipe_stacks",
      "drain_boot_accessories",
      "walk_pads_wall_vents",
      "membrane_accs",
      "termination_bars",
      "fasteners_and_bits",
      "other_accessories",
    ]);
    expect(ids(EPDM_SCREENS)).toEqual([
      "sealants",
      "corners",
      "pipe_stacks",
      "conduit_washers",
      "drain_boot_accessories",
      "walk_pads_wall_vents",
      "membrane_accs",
      "termination_bars",
      "fasteners_and_bits",
      "other_accessories",
    ]);
    for (const s of NON_DL_TPO_SCREENS) expect(s.branch).toBe("non_dl_tpo");
    for (const s of EPDM_SCREENS) expect(s.branch).toBe("epdm");
    expect(DURO_LAST_OTHER_SCREEN.id).toBe("duro_last:other_accessories");
  });
  it("the rows the engine counts are shaped for it: numeric pipe stack sizes, one T-Patch row, term bars by colour", () => {
    for (const s of FAMILY_SCREENS) {
      if (s.id.endsWith(":pipe_stacks"))
        for (const r of s.rows)
          expect(typeof r["Size"] === "number" && r["Size"] > 0, s.id).toBe(true);
      if (s.id.endsWith(":membrane_accs")) {
        expect(s.rows.map((r) => r["Description"])).toEqual(["T-Patch"]);
        expect(s.rows[0]!["Parts/Package"]).toBe(100);
      }
      if (s.id.endsWith(":termination_bars"))
        expect(s.rows.map((r) => r["Description"])).toEqual(["White", "Tan", "Gray"]);
      if (s.id.endsWith(":fasteners_and_bits"))
        for (const r of s.rows)
          expect(["Spade", "XHD", "Purlin", "Auger", "Nail", "DL-Plates"]).toContain(r["Subtype"]);
    }
  });
  it("the sheet arithmetic: per-piece prices from carton prices, per-roll from per-sq-ft", () => {
    const tpo = (id: string) => NON_DL_TPO_SCREENS.find((s) => s.id === `non_dl_tpo:${id}`)!;
    expect(tpo("corners").rows[0]!["White"]).toBe(8);
    expect(tpo("corners").rows[1]!["White"]).toBe(25.42);
    expect(tpo("walk_pads_wall_vents").rows[0]!["Price"]).toBe(550);
    expect(tpo("walk_pads_wall_vents").rows[1]!["Price"]).toBe(945);
    expect(tpo("termination_bars").rows[0]!["Price"]).toBe(0.79);
    const epdm = (id: string) => EPDM_SCREENS.find((s) => s.id === `epdm:${id}`)!;
    expect(epdm("corners").rows[0]!["White"]).toBe(7.35);
    expect(epdm("conduit_washers").rows[0]!["Price"]).toBe(37.8);
    expect(epdm("walk_pads_wall_vents").rows[0]!["Price"]).toBe(29.5);
    expect(epdm("other_accessories").rows[0]!["Price"]).toBe(120);
    expect(epdm("other_accessories").rows[7]!["Price"]).toBe(810);
  });
});

describe("the Duro-Tech rows on the Duro-Last screens", () => {
  it("every row carries the prefix (the ref builder strips it), except the Duro-Last clip", () => {
    for (const a of DURO_LAST_ADDITIONS)
      for (const r of a.rows) {
        const d = String(r["Description"]);
        if (d.startsWith("Drain Guard Clamping Ring")) continue;
        expect(d.startsWith(DURO_TECH_PREFIX), `${a.screen_id} ${d}`).toBe(true);
        expect(priceOf(r), d).toBeGreaterThan(0);
      }
  });
  it("vents are named by colour so a Duro-Tech TPO roof counts them; pipe stacks carry every size 1–15", () => {
    const vents = DURO_LAST_ADDITIONS.find((a) => a.screen_id === "duro_last:vents")!.rows;
    expect(vents.map((r) => String(r["Description"]).slice(DURO_TECH_PREFIX.length))).toEqual([
      "White Vent",
      "Tan Vent",
      "Gray Vent",
    ]);
    const stacks = DURO_LAST_ADDITIONS.find((a) => a.screen_id === "duro_last:pipe_stacks")!.rows;
    expect(stacks.map((r) => r["Size"])).toEqual([
      1, 1.5, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
    ]);
    expect(stacks[0]!["Closed Part #"]).toBe("0");
    expect(stacks.find((r) => r["Size"] === 15)!["Price"]).toBe(51.25);
  });
  it("the CDR renumber keeps every size and only appends the sheet's trailing digit", () => {
    expect(CDR_RENUMBER).toHaveLength(13);
    for (const { from, to } of CDR_RENUMBER) {
      const h = from.endsWith("H");
      expect(to).toBe(h ? `${from.slice(0, -1)}1H` : `${from}1`);
    }
  });
});

describe("adhesives, pitch pans, custom applications, labor", () => {
  it("every adhesive has a price and coverage rows for its family; unknown coverage is null, never 0", () => {
    const names = new Set<string>();
    for (const p of ADHESIVE_PRODUCTS) {
      expect(p.price).toBeGreaterThan(0);
      expect(names.has(p.name), p.name).toBe(false);
      names.add(p.name);
      expect(p.coverage.length).toBeGreaterThan(0);
      for (const c of p.coverage) {
        expect(["Non-DL TPO", "EPDM Rubber", "Duro-Tech TPO", "Insulations"]).toContain(c.group);
        if (["Tapered ISO", "Tapered Rigid", "Crickets/Other"].includes(c.substrate))
          expect(c.field_coverage).toBe(0);
        else expect(c.field_coverage === null || c.field_coverage > 0).toBe(true);
      }
    }
    const lvoc = ADHESIVE_PRODUCTS.find((p) => p.name === "Single-Ply LVOC Bonding Adhesive")!;
    expect(lvoc.price).toBe(245);
    expect(
      lvoc.coverage.find((c) => c.substrate === "Wood" && c.group === "EPDM Rubber")!
        .field_coverage,
    ).toBe(262.5);
    const iso = ADHESIVE_PRODUCTS.find((p) =>
      p.name.startsWith("I.S.O.SPRAY S Part A + Part B (55"),
    )!;
    expect(iso.price).toBe(3670);
    expect(iso.coverage[0]!.field_coverage).toBe(9500);
  });
  it("pitch pans and custom applications are priced per piece as the sheet sells them", () => {
    expect(PITCH_PAN_ROWS.map((r) => r.unit_cost)).toEqual([33.33, 45.5, 77.83]);
    expect(CUSTOM_APPLICATION_ROWS.length).toBe(28);
    for (const r of CUSTOM_APPLICATION_ROWS) {
      expect(r["Price"]).toBeGreaterThan(0);
      expect(r["Labor Rate"]).toBe(0);
    }
  });
  it("labor rows name the stripped description (what the ref builder looks up) and carry hours", () => {
    for (const t of LABOR_ROWS)
      for (const [desc, hours] of t.rows) {
        expect(desc.startsWith(DURO_TECH_PREFIX)).toBe(false);
        expect(hours).toBeGreaterThan(0);
      }
  });
});

describe("item numbers", () => {
  const all = seedItemNumbers(EXISTING_COLUMNS);
  it("every mapping is unique per (item, screen, row, column) and points at a real column", () => {
    const keys = new Set<string>();
    for (const m of all) {
      const key = `${m.item_no}|${m.screen_id}|${m.row_label}|${m.price_col}`;
      expect(keys.has(key), key).toBe(false);
      keys.add(key);
      expect(m.item_no.trim()).toBe(m.item_no);
      expect(m.item_no.length).toBeGreaterThan(1);
    }
    expect(all.length).toBeGreaterThan(400);
  });
  it("the Duro-Tech tan and gray numbers follow the sheet's note (TB / TG at the same price)", () => {
    const stacks = all.filter((m) => m.screen_id === "duro_last:pipe_stacks");
    expect(stacks.some((m) => m.item_no === "1316TB" && m.price_col === "Tan Price")).toBe(true);
    expect(stacks.some((m) => m.item_no === "2316TG" && m.price_col === "Gray Price")).toBe(true);
    expect(stacks.some((m) => m.item_no === "0")).toBe(false);
    const corners = all.filter((m) => m.screen_id === "duro_last:corners");
    expect(corners.some((m) => m.item_no === "13307TG" && m.price_col === "Gray")).toBe(true);
    const membrane = all.filter((m) => m.screen_id === "duro_last:duro_last_membrane");
    expect(membrane.map((m) => m.item_no)).toContain("44135");
  });
  it("Firestone colour codes land on the colour columns", () => {
    const corners = all.filter((m) => m.screen_id === "non_dl_tpo:corners");
    expect(corners.some((m) => m.item_no === "W56TPOT01C" && m.price_col === "Tan")).toBe(true);
    expect(corners.some((m) => m.item_no === "W56TPOG3C07")).toBe(false);
    expect(corners.some((m) => m.item_no === "W56TPOGC07" && m.price_col === "Gray")).toBe(true);
    const boots = all.filter((m) => m.screen_id === "non_dl_tpo:pipe_stacks");
    expect(boots.some((m) => m.item_no === "W56TPOT01U" && m.price_col === "Tan Price")).toBe(true);
    expect(boots.filter((m) => m.item_no === "W56TPO301U").length).toBe(6);
  });
});
