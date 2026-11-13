/**
 * Owner, Nov 13: "can we have the labor rate reflected on the tech board tiles like if a service
 * is urgent or emergancy it has some sort of indicator on that tile and its sorted by most urgent
 * to least urgent and subsorted by date".
 *
 * Before: the rate was three plain words in the middle of the card's facts line
 * ("Repair · Urgent · Morning 8–10"), a technician's day was ordered by ticket number alone, and
 * the Unassigned rail by day alone, so an Emergency for next week sat under a Standard for today.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { chipBadge, chipFacts, chipTitleLines, type ChipJob } from "@/lib/board-chip";
import { rateRank, sortCell, urgentRate } from "@/lib/rate-urgency";
import { sortUnassigned } from "@/lib/service-schedule";
import { RATE_TONES, STAGE_TONES } from "@/lib/stage-colors";

const base: ChipJob = {
  number: 6016,
  customer_name: "Bell County",
  site_name: "Courthouse",
  site_address: null,
  site_city: "Pineville",
  site_state: "KY",
  service_type: "repair",
  labor_rate_kind: "standard",
  arrival_window: "morning",
  description: "Leak over the clerk's office",
};

describe("how urgent a ticket is", () => {
  it("Emergency, then Urgent, then everything else", () => {
    expect(rateRank("emergency")).toBe(0);
    expect(rateRank("urgent")).toBe(1);
    expect(rateRank("standard")).toBe(2);
  });
  it("a blank or unknown rate counts as Standard, so an odd row never jumps the queue", () => {
    for (const v of [null, undefined, "", "  ", "EMERGENCY!", "rush"]) {
      expect(rateRank(v)).toBe(2);
      expect(urgentRate(v)).toBeNull();
    }
    expect(urgentRate(" urgent ")).toBe("urgent");
  });
});

describe("the badge on a card", () => {
  it("Urgent and Emergency wear one; Standard wears none", () => {
    expect(chipBadge({ ...base, labor_rate_kind: "emergency" })).toEqual({
      kind: "emergency",
      label: "Emergency",
    });
    expect(chipBadge({ ...base, labor_rate_kind: "urgent" })).toEqual({
      kind: "urgent",
      label: "Urgent",
    });
    expect(chipBadge(base)).toBeNull();
    expect(chipBadge({ ...base, labor_rate_kind: null })).toBeNull();
    expect(chipBadge({ ...base, labor_rate_kind: "zzz" })).toBeNull();
  });
  it("the card's facts line leaves the rate to the badge; the hover text still says it", () => {
    const j = { ...base, labor_rate_kind: "urgent" };
    expect(chipFacts(j, { rate: false })).toEqual(["Repair", "Morning 8–10"]);
    expect(chipFacts(j)).toEqual(["Repair", "Urgent", "Morning 8–10"]);
    expect(chipTitleLines(j)).toContain("Repair · Urgent · Morning 8–10");
  });
  it("its colours are red and yellow, in no stage's family, with a word and an icon", () => {
    expect(RATE_TONES.emergency.badge).toContain("bg-red-600");
    expect(RATE_TONES.urgent.badge).toContain("bg-yellow-300");
    for (const t of Object.values(STAGE_TONES)) {
      expect(t.chip).not.toMatch(/\b(?:bg|border)-(?:red|yellow)-/);
    }
    const board = readFileSync("src/components/service/board-page.tsx", "utf8");
    expect(board).toContain('const Icon = kind === "emergency" ? Siren : TriangleAlert;');
    expect(board).toContain("{RATE_KIND_LABELS[kind]}");
  });
});

describe("a technician's day", () => {
  const cell = [
    { number: 6001, labor_rate_kind: "standard" },
    { number: 6002, labor_rate_kind: "urgent" },
    { number: 6003, labor_rate_kind: null },
    { number: 6004, labor_rate_kind: "emergency" },
    { number: 6005, labor_rate_kind: "urgent" },
    { number: 6000, labor_rate_kind: "emergency" },
  ];
  it("Emergency first, then Urgent, then the rest; ticket number within each", () => {
    expect(sortCell(cell).map((j) => j.number)).toEqual([6000, 6004, 6002, 6005, 6001, 6003]);
  });
  it("an all-Standard day keeps the old order, and the input is left alone", () => {
    const plain = [{ number: 3 }, { number: 1 }, { number: 2 }];
    expect(sortCell(plain).map((j) => j.number)).toEqual([1, 2, 3]);
    expect(plain[0]!.number).toBe(3);
    expect(sortCell([])).toEqual([]);
  });
});

describe("the Unassigned rail", () => {
  const row = (id: string, rate: string | null, day: string | null, created: string) => ({
    id,
    labor_rate_kind: rate,
    scheduled_date: day,
    created_at: `${created}T00:00:00Z`,
  });
  it("most urgent first, then by day within each: overdue, today, later, undated", () => {
    const rows = [
      row("std-overdue", "standard", "2026-11-02", "2026-10-01"),
      row("urg-later", "urgent", "2026-11-20", "2026-11-01"),
      row("emg-undated", "emergency", null, "2026-11-12"),
      row("std-today", "standard", "2026-11-13", "2026-11-10"),
      row("urg-today-b", "urgent", "2026-11-13", "2026-11-12"),
      row("emg-later", "emergency", "2026-11-25", "2026-11-13"),
      row("urg-today-a", "urgent", "2026-11-13", "2026-11-05"),
      row("blank-undated", null, null, "2026-09-01"),
      row("emg-today", "emergency", "2026-11-13", "2026-11-13"),
    ];
    expect(sortUnassigned(rows).map((r) => r.id)).toEqual([
      "emg-today",
      "emg-later",
      "emg-undated",
      "urg-today-a",
      "urg-today-b",
      "urg-later",
      "std-overdue",
      "std-today",
      "blank-undated",
    ]);
    expect(rows[0]!.id).toBe("std-overdue");
  });
  it("rows with no rate at all keep the day order they had", () => {
    const rows = [
      { id: "undated", scheduled_date: null, created_at: "2026-10-08T00:00:00Z" },
      { id: "later", scheduled_date: "2026-10-20", created_at: "2026-09-01T00:00:00Z" },
      { id: "overdue", scheduled_date: "2026-10-01", created_at: "2026-10-07T00:00:00Z" },
    ];
    expect(sortUnassigned(rows).map((r) => r.id)).toEqual(["overdue", "later", "undated"]);
  });
});

describe("the board page uses them", () => {
  const board = readFileSync("src/components/service/board-page.tsx", "utf8");
  it("a technician's day is ordered by sortCell, no longer by number alone", () => {
    expect(board).toContain(
      "sortCell(jobs.filter((j) => j.technician_id === techId && boardDay(j) === ymd));",
    );
    expect(board).not.toContain(".sort((a, b) => a.number - b.number);");
  });
  it("every card draws the badge and the stripe, and its facts line drops the rate", () => {
    expect(board).toContain("const badge = chipBadge(j);");
    expect(board).toContain("const facts = chipFacts(j, { rate: false });");
    expect(board).toContain("<RateBadge kind={badge.kind} />");
    expect(board).toContain('${badge ? RATE_TONES[badge.kind].stripe : ""}');
  });
  it("the rail says what the badges mean", () => {
    expect(board).toContain('data-legend="rate"');
    expect(board).toContain("go first, then by day.");
  });
  it("the finished group keeps its own order: longest waiting first", () => {
    expect(board).toContain("const finished = finishedUnassigned(jobs).filter(");
  });
  it("the board's read carries the rate", () => {
    const fns = readFileSync("src/lib/service.functions.ts", "utf8");
    const cols = fns.slice(
      fns.indexOf("LIST_JOB_COLUMNS"),
      fns.indexOf("as const", fns.indexOf("LIST_JOB_COLUMNS")),
    );
    expect(cols).toContain("labor_rate_kind");
  });
});
