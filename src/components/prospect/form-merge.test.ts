import { describe, expect, it } from "vitest";

import { mergeEdits } from "@/components/prospect/form-merge";

describe("the detail form when its building is read again", () => {
  const base = {
    id: "a",
    name: "Lynmar Commons",
    owner_name: null as string | null,
    roof_year: null as number | null,
  };
  it("keeps what the person typed (bug: 'Add to my prospects' wiped the owner and roof year)", () => {
    const typed = { ...base, owner_name: "Acme Holdings LLC", roof_year: 2004 };
    // The stage button patched the cached row: same fields, nothing new.
    expect(mergeEdits(base, typed, { ...base })).toEqual(typed);
  });
  it("takes new values for the fields nobody touched", () => {
    const typed = { ...base, owner_name: "Acme Holdings LLC" };
    // A roof record was added and synced roof_year on the server.
    expect(mergeEdits(base, typed, { ...base, roof_year: 2019 })).toEqual({
      ...typed,
      roof_year: 2019,
    });
  });
  it("keeps a box the person cleared", () => {
    const b: typeof base = { ...base, owner_name: "Old Owner" };
    const cleared = { ...b, owner_name: null };
    expect(mergeEdits(b, cleared, { ...b, name: "Renamed" })).toEqual({
      ...cleared,
      name: "Renamed",
    });
  });
});
