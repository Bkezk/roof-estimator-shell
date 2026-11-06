/**
 * Setup audit, Nov 6 (docs/qa/setup-audit-2026-11-06.md; owner: "fix all please"):
 * 1. an unknown `?tab=` value opens the rates, not a blank page;
 * 2. the rates and drivers cards word a failed save in plain English, as the other cards;
 * 3. a materials save sends the markup only when it changed.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { markupToSend } from "@/lib/material-pricing-view";
import { knownTab } from "@/lib/setup-forms";
import { plainErrText } from "@/lib/plain-error";

const read = (p: string) => readFileSync(p, "utf8");
const page = read("src/routes/setup.tsx");
const rates = read("src/components/service-rates-settings.tsx");
const drivers = read("src/components/inventory/vehicle-drivers-card.tsx");
const materials = read("src/components/service/material-pricing-settings.tsx");

describe("1. an unknown ?tab= is the rates", () => {
  const TABS = ["rates", "materials", "inspection", "vehicles"] as const;
  it("knownTab: a listed value passes, anything else is nothing", () => {
    expect(knownTab("materials", TABS)).toBe("materials");
    expect(knownTab("bogus", TABS)).toBeUndefined();
    expect(knownTab(undefined, TABS)).toBeUndefined();
    expect(knownTab(3, TABS)).toBeUndefined();
    expect(knownTab("", TABS)).toBeUndefined();
  });
  it("the page reads its tab through it before choosing the active one", () => {
    expect(page).toContain("const tab = knownTab(Route.useSearch().tab, SETUP_TABS);");
    expect(page).toMatch(/const active: SetupTab = [\s\S]*?\(tab \?\? "rates"\)/);
    expect(page).not.toContain("const { tab } = Route.useSearch();");
  });
});

describe("2. a failed save in plain words on every card", () => {
  it("the rates card uses plainErrText", () => {
    expect(rates).toContain('import { plainErrText } from "@/lib/plain-error";');
    expect(rates).toContain("const errText = plainErrText;");
    expect(rates).not.toContain("e instanceof Error ? e.message : String(e)");
    expect(plainErrText(new Error("Failed to fetch"))).toBe(
      "No signal. Check your connection and try again.",
    );
  });
  it("the drivers card too, keeping its fallback for a non-Error", () => {
    expect(drivers).toContain('import { plainErrText } from "@/lib/plain-error";');
    expect(drivers).toContain(
      "const errText = (e: unknown, fallback: string) => (e instanceof Error ? plainErrText(e) : fallback);",
    );
  });
});

describe("3. the markup goes only when it changed", () => {
  it("markupToSend: the typed percent as a fraction when it differs, else nothing", () => {
    expect(markupToSend(75, 0.75)).toBeUndefined();
    expect(markupToSend(80, 0.75)).toBe(0.8);
    expect(markupToSend(0, 0.75)).toBe(0);
    // 33.333 % typed against a stored 0.33333: the same to the ninth place is the same.
    expect(markupToSend(33.333, 0.33333)).toBeUndefined();
  });
  it("the save leaves the markup out of the payload when it is unchanged", () => {
    expect(materials).toContain("const markup = markupToSend(markupPct, q.data?.markup ?? 0.75);");
    expect(materials).toContain(
      "saveFn({ data: { items, ...(markup === undefined ? {} : { markup }) } })",
    );
    expect(materials).not.toContain("markup: markupPct / 100 }");
  });
});
