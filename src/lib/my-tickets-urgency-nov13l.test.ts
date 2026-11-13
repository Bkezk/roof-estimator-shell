/**
 * Owner, Nov 13, on the question "do you want the same badge and order on the technician's phone
 * list?": "yes go ahead". Before, My tickets showed nothing of a ticket's urgency and listed each
 * group by day alone, so a technician on a roof could not tell an Emergency from a Standard call.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { urgentFirst } from "@/lib/rate-urgency";

const row = (id: string, rate: string | null, day: string | null) => ({
  id,
  labor_rate_kind: rate,
  scheduled_date: day,
});

describe("urgentFirst", () => {
  it("Emergency, then Urgent, then the rest; the day order it was given is kept within each", () => {
    const byDay = [
      row("std-mon", "standard", "2026-11-16"),
      row("urg-tue", "urgent", "2026-11-17"),
      row("std-wed", "standard", "2026-11-18"),
      row("emg-thu", "emergency", "2026-11-19"),
      row("urg-fri", "urgent", "2026-11-20"),
      row("blank-sat", null, "2026-11-21"),
      row("emg-sun", "emergency", "2026-11-22"),
    ];
    expect(urgentFirst(byDay).map((r) => r.id)).toEqual([
      "emg-thu",
      "emg-sun",
      "urg-tue",
      "urg-fri",
      "std-mon",
      "std-wed",
      "blank-sat",
    ]);
    expect(byDay[0]!.id).toBe("std-mon"); // the input is not reordered
  });
  it("a list with no urgent ticket comes back in the order it was given", () => {
    const plain = [row("b", "standard", "2026-11-16"), row("a", null, null), row("c", "zzz", null)];
    expect(urgentFirst(plain).map((r) => r.id)).toEqual(["b", "a", "c"]);
    expect(urgentFirst([])).toEqual([]);
  });
  it("hands back the same objects, so the page's groups still tell them apart", () => {
    const a = row("a", "urgent", null);
    expect(urgentFirst([row("b", null, null), a])[0]).toBe(a);
  });
});

describe("the My tickets page", () => {
  const page = readFileSync("src/components/service/today-page.tsx", "utf8");
  it("orders Today, Coming up and No date yet with the most urgent first", () => {
    expect(page.match(/urgentFirst\(/g)?.length).toBe(3);
    expect(page).toContain("const later = urgentFirst(");
    expect(page).toContain("const undated = urgentFirst(");
  });
  it("keeps Today ahead of Coming up: urgency orders inside a group, never across them", () => {
    const today = page.indexOf('title="Today"');
    const coming = page.indexOf('title="Coming up"');
    expect(today).toBeGreaterThan(0);
    expect(coming).toBeGreaterThan(today);
  });
  it("a card wears the badge above its title and the stripe down its edge", () => {
    expect(page).toContain("const urgency = urgentRate(j.labor_rate_kind);");
    expect(page).toContain('{urgency && <RateBadge kind={urgency} size="lg" />}');
    expect(page).toContain('${urgency ? RATE_TONES[urgency].stripe : ""}');
    expect(page.indexOf("<RateBadge kind={urgency}")).toBeLessThan(
      page.indexOf("#{j.number} · {j.customer_name}"),
    );
  });
  it("the server's read for the page carries the urgency", () => {
    const fns = readFileSync("src/lib/service-field.functions.ts", "utf8");
    const from = fns.indexOf("export const TODAY_JOB_SELECT");
    expect(fns.slice(from, fns.indexOf("as const", from))).toContain("labor_rate_kind");
  });
});

describe("one badge for the board and the phone", () => {
  const badge = readFileSync("src/components/service/rate-badge.tsx", "utf8");
  it("the board imports it and no longer keeps its own copy", () => {
    const board = readFileSync("src/components/service/board-page.tsx", "utf8");
    expect(board).toContain('import { RateBadge } from "@/components/service/rate-badge";');
    expect(board).not.toContain("function RateBadge(");
  });
  it("the phone's is the larger size", () => {
    expect(badge).toContain("lg:");
    expect(badge).toContain("text-xs");
    expect(badge).toContain('size = "sm"');
  });
});
