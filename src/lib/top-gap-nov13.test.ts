/**
 * The top bar in the iPhone Home Screen app sits clear of the clock and battery (owner, Nov 13:
 * "the reason the top is blurry is the words, search etc are too close to the time and battery;
 * when I pull down it goes away"). lib/top-gap.ts and the rules at the foot of styles.css.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  TOP_GAP_DEFAULT,
  TOP_GAP_KEY,
  TOP_GAP_MAX,
  TOP_GAP_STEP,
  clampTopGap,
  parseTopGap,
  readTopGap,
  saveTopGap,
  stepTopGap,
} from "@/lib/top-gap";

const flat = (p: string) => readFileSync(p, "utf8").replace(/\s+/g, " ");

describe("the number", () => {
  it("is a whole number of pixels from 0 to the most allowed", () => {
    expect(clampTopGap(-5)).toBe(0);
    expect(clampTopGap(19.6)).toBe(20);
    expect(clampTopGap(999)).toBe(TOP_GAP_MAX);
    expect(clampTopGap(Number.NaN)).toBe(TOP_GAP_DEFAULT);
  });
  it("nothing kept, or rubbish kept, is no number at all (the stylesheet's own stands)", () => {
    expect(parseTopGap(null)).toBeNull();
    expect(parseTopGap("")).toBeNull();
    expect(parseTopGap("lots")).toBeNull();
    expect(parseTopGap("28")).toBe(28);
    expect(parseTopGap("0")).toBe(0);
    expect(parseTopGap("500")).toBe(TOP_GAP_MAX);
  });
  it("Less and More move it one step and stop at the ends", () => {
    expect(stepTopGap(TOP_GAP_DEFAULT, 1)).toBe(TOP_GAP_DEFAULT + TOP_GAP_STEP);
    expect(stepTopGap(TOP_GAP_DEFAULT, -1)).toBe(TOP_GAP_DEFAULT - TOP_GAP_STEP);
    expect(stepTopGap(0, -1)).toBe(0);
    expect(stepTopGap(TOP_GAP_MAX, 1)).toBe(TOP_GAP_MAX);
  });
  it("is kept on the phone, and a phone with storage off does not break", () => {
    const kept = new Map<string, string>();
    const storage = {
      getItem: (k: string) => kept.get(k) ?? null,
      setItem: (k: string, v: string) => void kept.set(k, v),
    };
    expect(readTopGap(storage)).toBeNull();
    saveTopGap(32, storage);
    expect(kept.get(TOP_GAP_KEY)).toBe("32");
    expect(readTopGap(storage)).toBe(32);
    const off = {
      getItem: () => {
        throw new Error("off");
      },
      setItem: () => {
        throw new Error("off");
      },
    };
    expect(readTopGap(off)).toBeNull();
    expect(() => saveTopGap(10, off)).not.toThrow();
    expect(readTopGap(null)).toBeNull();
  });
});

describe("the wiring", () => {
  const css = flat("src/styles.css");
  it("only the Home Screen app on iOS gets the space by default, and it is the lib's number", () => {
    expect(css).toContain(
      `@media (display-mode: standalone) { @supports (-webkit-touch-callout: none) { :root { --jbk-top-gap: ${TOP_GAP_DEFAULT}px; } } }`,
    );
  });
  it("the top bar and the phone menu are pushed down by it, by nothing elsewhere", () => {
    expect(css).toContain(
      "[data-app-header] { height: calc(3.5rem + var(--jbk-top-gap, 0px)); padding-top: var(--jbk-top-gap, 0px); }",
    );
    expect(css).toContain(
      '[data-sidebar="sidebar"][data-mobile="true"] { padding-top: var(--jbk-top-gap, 0px); }',
    );
  });
  it("the bar carries the mark and a kept number is applied on arrival", () => {
    const gate = flat("src/components/auth-gate.tsx");
    expect(gate).toContain(
      '<header data-app-header className="flex h-14 items-center gap-3 border-b px-4">',
    );
    expect(gate).toContain("useEffect(() => applyKeptTopGap(), []);");
    const lib = flat("src/lib/top-gap.ts");
    expect(lib).toMatch(
      /export function applyKeptTopGap\(\): void \{ if \(!iosHomeScreenApp\(\)\) return;/,
    );
  });
  it("My account offers Less / More on the iPhone Home Screen app only", () => {
    const page = flat("src/routes/account.tsx");
    expect(page).toContain("setShow(iosHomeScreenApp());");
    expect(page).toContain("if (!show) return null;");
    expect(page).toContain("saveTopGap(next); applyTopGap(next);");
    expect(page).toContain("<TopBarSpacingCard />");
  });
});
