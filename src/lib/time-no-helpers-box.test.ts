/**
 * Owner, Oct 5: "hide the helpers box — we really don't need the helpers box at all since we
 * are naming the crew members who are present." A ticket's time entries have no Helpers box any
 * more; under the list, the crew the time is billed for.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { billedCrewLine } from "@/lib/service-crew";

describe("billedCrewLine", () => {
  it("the named crew, lead first", () => {
    expect(
      billedCrewLine(
        [
          { name: "Donnie Carpenter", sort: 1 },
          { name: "Trace Floyd", sort: 0 },
        ],
        [{ helper_count: 3 }],
      ),
    ).toBe("Billed for: Trace Floyd, Donnie Carpenter");
  });
  it("an older ticket with no named crew says what its entries still bill", () => {
    expect(billedCrewLine([], [{ helper_count: 0 }, { helper_count: 1 }])).toBe(
      "Billed for the technician and a helper (an older ticket without a named crew)",
    );
    expect(billedCrewLine([], [{ helper_count: 2 }])).toContain("2 helpers");
    expect(billedCrewLine([], [{ helper_count: 0 }])).toBeNull();
  });
});

describe("the time editor", () => {
  const src = readFileSync("src/components/service/field-shared.tsx", "utf8");
  it("has no Helpers box and no per-entry helper count", () => {
    expect(src).not.toMatch(/>\s*Helpers\s*</);
    expect(src).not.toContain("helper_count: Math.round(n)");
    expect(src).not.toContain("with helpers");
    expect(src).not.toMatch(/helper\$\{r\.helper_count > 1/);
    expect(src).toContain("sm:grid-cols-[110px_90px_1fr]");
  });
  it("shows who the time is billed for, from the named crew", () => {
    expect(src).toContain("billedCrewLine(crewQ.data, rows)");
    expect(src).toContain("queryKey: fieldKeys.crew(jobId)");
  });
  it("the invoice still bills each crew member per entry (unchanged)", () => {
    const labor = readFileSync("src/lib/invoice-labor.ts", "utf8");
    expect(labor).toContain("for (const m of crew) {");
  });
});
