/**
 * The repair library (owner, Oct 6: "click new repair on our test service and look at all the
 * repairs you can choose from, ensure we have the same on our side"; prices as reference only;
 * "load exactly as is"). CenterPoint's Repair Library — the list its "Select Repair" picker
 * offers — read on Oct 6: 475 repairs with unit, price and roof-type tags.
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const PATH = "supabase/migrations/20261006120000_repair_library.sql";
const sql = existsSync(PATH) ? readFileSync(PATH, "utf8") : "";
const rows = [
  ...sql.matchAll(
    /^ \('((?:[^']|'')*)', (null|'[^']*'), '([^']+)', ([\d.]+), array\[(.*)\]::text\[\]\)[,;]$/gm,
  ),
].map((m) => ({
  name: m[1]!.replace(/''/g, "'"),
  category: m[2] === "null" ? null : m[2]!.slice(1, -1),
  unit: m[3]!,
  price: Number(m[4]),
  tags: m[5] ? m[5].split(",").map((t) => t.slice(1, -1)) : [],
}));
const byName = (n: string) => rows.filter((r) => r.name === n);

describe("the repair library migration", () => {
  it("exists", () => {
    expect(existsSync(PATH)).toBe(true);
  });
  it("loads all 475 CenterPoint repairs, as they are", () => {
    expect(rows).toHaveLength(475);
    expect(rows.filter((r) => r.price === 0)).toHaveLength(111);
    expect(byName("A/C - Condensate Drains on Roof")[0]).toMatchObject({
      unit: "EA",
      price: 250,
      category: "A/C",
      tags: ["General", "BUR", "Sheetmetal", "Modified", "Single Ply", "Duro-Last"],
    });
    expect(byName("Roof Access - Hatch damaged")[0]).toMatchObject({ unit: "EA", price: 2100 });
    expect(byName("Misc - Frozen Storm Sewer")[0]).toMatchObject({ unit: "HR", price: 65 });
    expect(byName("Brick Mason Work")[0]).toMatchObject({ price: 0, tags: [] });
    // Duplicates are kept (CenterPoint has both); a quote in a name survives.
    expect(
      byName("Membrane - Shrinkage")
        .map((r) => r.unit)
        .sort(),
    ).toEqual(["EA", "SF"]);
    expect(byName("2' X2' Curb flashing")).toHaveLength(1);
  });
  it("adds the tags column and matches by name + unit, so it can run twice", () => {
    expect(sql).toMatch(/add column if not exists tags text\[\] not null default '\{\}'/);
    expect(sql).toMatch(/where t\.name = c\.name and t\.unit = c\.unit;/);
    expect(sql).toMatch(
      /where not exists \(select 1 from public\.repair_templates t where t\.name = c\.name and t\.unit = c\.unit\)/,
    );
  });
  it("retires the starter templates but keeps Previous Repair Failure (in both lists)", () => {
    const retire =
      /update public\.repair_templates set active = false[\s\S]*?\);/.exec(sql)?.[0] ?? "";
    expect(retire).toContain("'Drainage – Clogged Scupper/Drain'");
    expect(retire).toContain("'Other Repair'");
    expect(retire.match(/'[^']+'/g)).toHaveLength(15);
    expect(retire).not.toContain("Previous Repair Failure");
  });
  it("carries the starter favourites over so the close-out chips stay useful", () => {
    const fav = /set favorite = true[\s\S]*?\);/.exec(sql)?.[0] ?? "";
    for (const n of ["Drainage - Clogged Scupper/Drain", "Membrane - Holes", "Leak Location"]) {
      expect(fav).toContain(`'${n}'`);
      expect(byName(n)).toHaveLength(1);
    }
  });
  it("never prices an invoice: the invoice builder does not read unit_price", () => {
    const inv = readFileSync("src/lib/invoices.server.ts", "utf8");
    expect(inv).not.toContain("unit_price");
  });
});
