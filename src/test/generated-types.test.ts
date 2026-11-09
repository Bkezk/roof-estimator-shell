/**
 * The tests read the generated database types through a prettier-formatted copy (the global
 * setup), so Lovable regenerating the file in its own style (no semicolons, Nov 9) does not
 * break the pins on columns and functions.
 */
import { describe, expect, it } from "vitest";

import { readGeneratedTypes } from "./generated-types";

describe("readGeneratedTypes", () => {
  it("returns the types in the repo's style: semicolons, double quotes", () => {
    const types = readGeneratedTypes();
    expect(types).toContain('PostgrestVersion: "14.17";');
    expect(types).toContain("export type Database = {");
    expect(types).toContain("folder: string | null;");
    expect(types).toContain("Functions: {");
  });
});
