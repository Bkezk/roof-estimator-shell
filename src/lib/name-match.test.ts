import { describe, expect, it } from "vitest";

import { editDistance, namesLookAlike, wordsMatch } from "@/lib/name-match";

describe("name matching for bid suggestions", () => {
  it("measures edits with a cap", () => {
    expect(editDistance("elementry", "elementary")).toBe(1);
    expect(editDistance("knox", "knoxville", 2)).toBe(3);
    expect(editDistance("abc", "abc")).toBe(0);
  });

  it("matches words with a typo or a truncation, not short guesses", () => {
    expect(wordsMatch("elementry", "elementary")).toBe(true);
    expect(wordsMatch("broad", "broad")).toBe(true);
    expect(wordsMatch("knox", "knoxville")).toBe(true);
    expect(wordsMatch("bell", "bull")).toBe(false);
    expect(wordsMatch("head", "heed")).toBe(false);
  });

  it("finds the owner's case: a misspelled customer and the real bid", () => {
    expect(namesLookAlike("broad head elementry", "Broad Head Elementary")).toBe(true);
    expect(namesLookAlike("Knox County", "Knox County BOE re-roof")).toBe(true);
    expect(namesLookAlike("Knox County BOE", "Knox County High School")).toBe(true);
    expect(namesLookAlike("Bell County BOE", "Yellow Creek Elementary")).toBe(false);
    expect(namesLookAlike("Knox County", "Knox Fork Church")).toBe(false);
    expect(namesLookAlike("First Baptist Church", "First Baptist Church of Corbin")).toBe(true);
    expect(namesLookAlike("School", "Elementary School")).toBe(false);
    expect(namesLookAlike("", "Anything")).toBe(false);
  });
});
