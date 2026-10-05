/** The Tech Board's week label (owner, Oct 5: it read "Oct 5 – 2026 (day: 11)"). */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { weekLabel } from "./board-week";

describe("weekLabel", () => {
  it("within one month: 'Oct 5 – 11, 2026' — never '(day: 11)'", () => {
    expect(weekLabel("2026-10-05", "2026-10-11")).toBe("Oct 5 – 11, 2026");
  });
  it("across a month: 'Sep 28 – Oct 4, 2026'", () => {
    expect(weekLabel("2026-09-28", "2026-10-04")).toBe("Sep 28 – Oct 4, 2026");
  });
  it("across a year: both years shown", () => {
    expect(weekLabel("2025-12-29", "2026-01-04")).toBe("Dec 29, 2025 – Jan 4, 2026");
  });
  it("is what the board uses, with no date formatter that could print '(day: N)'", () => {
    const board = readFileSync("src/components/service/board-page.tsx", "utf8");
    expect(board).toContain('import { weekLabel } from "@/lib/board-week";');
    expect(board).toContain("weekLabel(days[0]!, days[6]!)");
    expect(board).not.toMatch(/\{ day: "numeric", year: "numeric" \}/);
  });
});
