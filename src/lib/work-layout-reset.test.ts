/**
 * Owner, Oct 9: "i restored the layout on the work overview but it doesnt remember i restored it
 * when i navigate away and then back." Reset saved the default to the profile and cleared the
 * browser copy, but the page's cached copy of the SAVED layout (query ["work-layout", userId],
 * stale for five minutes) was never updated; the next mount re-applied that stale layout and
 * wrote it back. Now every save (Reset included) writes the cache first.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const src = readFileSync("src/components/my-work-page.tsx", "utf8");

describe("Work Overview layout: a save keeps the saved-layout cache in step", () => {
  it("the save mutation writes the cache in onMutate, null for the default", () => {
    expect(src).toMatch(
      /onMutate: \(l\) => \{\s*qc\.setQueryData<\{ layout: WorkLayout \| null \}>\(\["work-layout", userId\], \{\s*layout: isDefaultWorkLayout\(l\) \? null : l,\s*\}\);/,
    );
  });
  it("the old one-line mutation is gone", () => {
    expect(src).not.toContain(
      "const saveLayout = useMutation({ mutationFn: (l: WorkLayout) => saveLayoutFn({ data: l }) });",
    );
  });
});
