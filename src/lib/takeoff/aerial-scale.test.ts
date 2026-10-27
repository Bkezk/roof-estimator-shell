/**
 * New takeoff › From an address (owner, Oct 27): the pure side. The page scale set from the
 * imagery — a 200 px line across the picture's middle whose feet are the view's ground scale at
 * its centre latitude and zoom (Web Mercator: 156543.03392 × cos(lat) / 2^zoom m/px) — the
 * createTakeoff input the dialog builds from the view, the state hint read off the address, and
 * the viewer's wording for an imagery-set scale.
 */
import { describe, expect, it } from "vitest";

import { feetPerPx } from "@/lib/takeoff/model";
import {
  aerialScaleDetail,
  isAerialScaleNote,
  scaleOrigin,
  scaleOriginLabel,
  sheetScaleMessage,
} from "@/components/takeoff/sheet-scale";

import {
  AERIAL_SCALE_NOTE_PREFIX,
  AERIAL_SCALE_PX,
  aerialFeetPerPixel,
  aerialPageScale,
  aerialScaleNote,
} from "./aerial-scale";
import {
  NO_IMAGERY_MESSAGE,
  addressStateHint,
  aerialFileName,
  takeoffFromAerial,
} from "./aerial-takeoff";

const view = (lat: number, zoom: number) => ({
  center: [-88.3148, lat] as [number, number],
  zoom,
  width: 800,
  height: 600,
});

describe("aerialPageScale", () => {
  it("at the equator, zoom 18: 0.597 m/px → 200 px = 391.8 ft", () => {
    const s = aerialPageScale(view(0, 18));
    const metresPerPx = s.feet / 3.28084 / AERIAL_SCALE_PX;
    expect(metresPerPx).toBeCloseTo(0.597, 3);
    expect(s.feet).toBeCloseTo(0.5972 * 200 * 3.28084, 0);
  });
  it("at latitude 37°, zoom 18: 0.4768 m/px → 200 px = 312.9 ft", () => {
    const s = aerialPageScale(view(37, 18));
    expect(s.feet / 3.28084 / AERIAL_SCALE_PX).toBeCloseTo(0.4768, 3);
    expect(s.feet).toBeCloseTo(312.9, 0);
    expect(aerialFeetPerPixel(view(37, 18)) * 200).toBeCloseTo(312.9, 0);
  });
  it("the two points are 200 px apart horizontally through the picture's centre", () => {
    const s = aerialPageScale(view(37, 19));
    expect([s.ax, s.ay, s.bx, s.by]).toEqual([300, 300, 500, 300]);
    expect(Math.hypot(s.bx - s.ax, s.by - s.ay)).toBe(AERIAL_SCALE_PX);
    // One more zoom level halves the ground per pixel.
    expect(s.feet).toBeCloseTo(aerialPageScale(view(37, 18)).feet / 2, 6);
    // The editor's feet-per-pixel reads the imagery's scale straight back.
    expect(feetPerPx(s)).toBeCloseTo(aerialFeetPerPixel(view(37, 19)), 9);
  });
  it('is tagged as set from the imagery: source "sheet", note "Aerial imagery, zoom <z>"', () => {
    const s = aerialPageScale(view(36.6, 19));
    expect(s.source).toBe("sheet");
    expect(s.note).toBe("Aerial imagery, zoom 19");
    expect(aerialScaleNote(21)).toBe(`${AERIAL_SCALE_NOTE_PREFIX}, zoom 21`);
    expect(s.note!.length).toBeLessThanOrEqual(120); // the save schema's note limit
  });
});

describe("the viewer's wording for an imagery-set scale", () => {
  it("says the scale came from the imagery, not 'read from the sheet'", () => {
    expect(isAerialScaleNote("Aerial imagery, zoom 19")).toBe(true);
    expect(isAerialScaleNote('1/8" = 1\'-0"')).toBe(false);
    expect(aerialScaleDetail("Aerial imagery, zoom 19")).toBe("zoom 19");
    expect(sheetScaleMessage("Aerial imagery, zoom 19")).toBe(
      "Scale set from the aerial imagery (zoom 19) — check it against a known dimension",
    );
    expect(scaleOriginLabel("Aerial imagery, zoom 19")).toBe(
      "Scale from the aerial imagery (zoom 19)",
    );
    // A sheet note reads as before.
    expect(sheetScaleMessage('1/8" = 1\'-0"')).toBe(
      'Scale read from the sheet: 1/8" = 1\'-0" — check it against a printed dimension',
    );
    expect(scaleOriginLabel('1/8" = 1\'-0"')).toBe('Scale read from the sheet: 1/8" = 1\'-0"');
  });
  it("the page reads as scaled (no calibration prompt): scaleOrigin sees a sheet-source scale", () => {
    const s = aerialPageScale(view(36.6, 19));
    expect(scaleOrigin(s)).toEqual({ source: "sheet", note: "Aerial imagery, zoom 19" });
    expect(feetPerPx(s)).not.toBeNull();
  });
});

describe("takeoffFromAerial", () => {
  const v = view(36.6103, 19);
  it("builds createTakeoff's input: an image underlay named after the address, one scaled page, the address kept", () => {
    const { input, scale } = takeoffFromAerial(v, " 412 Main St, Murray, KY 42071 ", {
      fileSize: 123456,
    });
    expect(input.name).toBe("412 Main St, Murray, KY 42071");
    expect(input.underlay_kind).toBe("image");
    expect(input.file_name).toBe("aerial-412-main-st-murray-ky-42071.png");
    expect(input.file_size).toBe(123456);
    expect(input.source_address).toBe("412 Main St, Murray, KY 42071");
    expect(input.pages).toHaveLength(1);
    const page = input.pages[0]!;
    expect(page).toMatchObject({
      index: 0,
      name: "412 Main St, Murray, KY 42071",
      rotation: 0,
      width: 800,
      height: 600,
    });
    expect(page.scale).toEqual(scale);
    expect(scale).toEqual(aerialPageScale(v));
    expect(scale.source).toBe("sheet");
    expect("account_id" in input).toBe(false);
  });
  it("a typed name wins over the address; a customer pick is carried as account_id", () => {
    const { input } = takeoffFromAerial(v, "412 Main St, Murray, KY", {
      fileSize: 1,
      name: "  Smith Warehouse roof ",
      accountId: "a0000000-0000-4000-8000-000000000001",
    });
    expect(input.name).toBe("Smith Warehouse roof");
    expect(input.account_id).toBe("a0000000-0000-4000-8000-000000000001");
    expect(takeoffFromAerial(v, "412 Main St", { fileSize: 1, name: "   " }).input.name).toBe(
      "412 Main St",
    );
  });
  it("names the PNG from the address's letters and digits", () => {
    expect(aerialFileName("88 Elm Street, Nashville, TN 37207")).toBe(
      "aerial-88-elm-street-nashville-tn-37207.png",
    );
    expect(aerialFileName("   ")).toBe("aerial.png");
    expect(aerialFileName("x".repeat(200)).length).toBeLessThanOrEqual(92);
  });
});

describe("addressStateHint", () => {
  it("reads KY / TN off the end of the address and names the imagery", () => {
    expect(addressStateHint("412 Main St, Murray, KY 42071")).toEqual({
      state: "KY",
      outside: false,
      hint: "Kentucky imagery will be searched.",
    });
    expect(addressStateHint("88 Elm Street, Nashville, Tennessee")).toEqual({
      state: "TN",
      outside: false,
      hint: "Tennessee imagery will be searched.",
    });
    // No house number yet: the state still reads off the tail.
    expect(addressStateHint("Murray, KY").state).toBe("KY");
  });
  it("another state is outside the imagery; no state means both are searched", () => {
    expect(addressStateHint("1 Main St, Columbus, OH 43215")).toEqual({
      state: null,
      outside: true,
      hint: "OH is outside the imagery (Kentucky and Tennessee only).",
    });
    expect(addressStateHint("412 Main St, Murray")).toEqual({
      state: null,
      outside: false,
      hint: "End the address with the state (KY or TN) so the right map is searched.",
    });
    expect(addressStateHint("").outside).toBe(false);
  });
  it("the no-imagery line", () => {
    expect(NO_IMAGERY_MESSAGE).toBe(
      "No aerial imagery for that address (imagery covers Kentucky and Tennessee); upload a screenshot instead",
    );
  });
});
