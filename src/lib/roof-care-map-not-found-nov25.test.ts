/**
 * The sign-up says when the map has no roof size to offer (owner, Nov 25, 2026). Offered six
 * sentences, one for each cause, he said: "just saying you cant find it should be sufficent".
 * Before, the sign-up said nothing at all when the map had no size: the line that offers a size
 * was simply not there.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { MAP_ROOF_NOT_FOUND, mapRoofSize } from "@/lib/roof-care-plan";

describe("the map has no size to offer", () => {
  it("one plain sentence, with what to do next, and no cause", () => {
    expect(MAP_ROOF_NOT_FOUND).toBe(
      "The map could not find a roof size for this address. Type the roof's size in the box.",
    );
    expect(MAP_ROOF_NOT_FOUND).not.toMatch(/server|outline|footprint|timed out|error/i);
  });

  it("the cases it covers all answer nothing: no outline, none found, a shed", () => {
    expect(mapRoofSize(null, null)).toBeNull();
    expect(mapRoofSize({ areaSqFt: null }, null)).toBeNull();
    expect(mapRoofSize({ areaSqFt: 300 }, null)).toBeNull();
  });

  const card = readFileSync("src/components/roof-care/plan-card.tsx", "utf8");
  it("the sign-up shows it once the look-up has finished with nothing, never while looking", () => {
    expect(card).toContain("{!mapSize.data && (mapSize.isSuccess || mapSize.isError) && (");
    expect(card).toMatch(/data-sign-line="map-not-found">\s*\{MAP_ROOF_NOT_FOUND\}/);
  });
  it("a size the map does have is still offered as before", () => {
    expect(card).toMatch(
      /\{mapSize\.data && \(\s*<p className="text-muted-foreground" data-sign-line="map-size">/,
    );
  });
});
