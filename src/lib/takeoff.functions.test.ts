import { describe, it, expect } from "vitest";

import { saveTakeoffInput } from "@/lib/takeoff.functions";

const id = "0f8fad5b-d9cb-469f-a165-70867728950e";
const acct = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

describe("saveTakeoff input", () => {
  it("accepts a customer link, an unlink (null), or no change (absent)", () => {
    expect(saveTakeoffInput.parse({ id, account_id: acct }).account_id).toBe(acct);
    expect(saveTakeoffInput.parse({ id, account_id: null }).account_id).toBeNull();
    expect("account_id" in saveTakeoffInput.parse({ id, name: "Job" })).toBe(false);
  });

  it("rejects a customer id that is not a uuid", () => {
    expect(() => saveTakeoffInput.parse({ id, account_id: "acme" })).toThrow();
  });

  it("keeps an area's pitch in its attributes", () => {
    const parsed = saveTakeoffInput.parse({
      id,
      objects: [
        {
          id: "a",
          kind: "area",
          page: 0,
          points: [
            [0, 0],
            [10, 0],
            [10, 10],
          ],
          attrs: { name: "Roof 1", pitch: 4 },
        },
      ],
    });
    expect(parsed.objects?.[0]?.attrs).toEqual({ name: "Roof 1", pitch: 4 });
  });
});

describe("saveTakeoff keeps a sheet-read scale's tag", () => {
  it("passes source and note through the page schema", () => {
    const out = saveTakeoffInput.parse({
      id,
      pages: [
        {
          index: 0,
          name: "A1",
          rotation: 0,
          scale: {
            ax: 10,
            ay: 20,
            bx: 82,
            by: 20,
            feet: 8,
            source: "sheet",
            note: '1/8" = 1\'-0"',
          },
        },
      ],
    });
    const scale = out.pages?.[0]?.scale;
    expect(scale?.source).toBe("sheet");
    expect(scale?.note).toBe('1/8" = 1\'-0"');
  });
});
