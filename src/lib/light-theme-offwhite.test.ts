/**
 * The light theme's off-white page (owner, Oct 14: "some people in the office are having issues
 * with everything being white" — "lets try number 1": an off-white page, white cards). Fails on
 * the old tokens: page, card and pop-up all pure white, and no rule painting bordered boxes.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync("src/styles.css", "utf8");
const block = (selector: string): Record<string, string> => {
  const m = css.match(new RegExp(`\\n${selector.replace(".", "\\.")} \\{([\\s\\S]*?)\\n\\}`));
  if (!m) throw new Error(`no ${selector} block`);
  const out: Record<string, string> = {};
  for (const line of m[1]!.split("\n")) {
    const t = line.match(/^\s*(--[\w-]+):\s*([^;]+);/);
    if (t) out[t[1]!] = t[2]!.trim();
  }
  return out;
};
/** oklch lightness as a percentage. */
const L = (v: string): number => {
  const m = v.match(/oklch\(\s*([\d.]+)/);
  if (!m) throw new Error(`not oklch: ${v}`);
  return Number(m[1]) * 100;
};

describe("the light tokens", () => {
  const light = block(":root");
  it("the page is off-white (95–98%), not white; cards and pop-ups stay white", () => {
    expect(L(light["--background"]!)).toBeGreaterThanOrEqual(95);
    expect(L(light["--background"]!)).toBeLessThanOrEqual(98);
    expect(L(light["--card"]!)).toBeGreaterThanOrEqual(99.5);
    expect(L(light["--popover"]!)).toBeGreaterThanOrEqual(99.5);
  });
  it("muted fills sit a step under the page, borders a step under that, so edges read on a white card", () => {
    const page = L(light["--background"]!);
    expect(L(light["--muted"]!)).toBeLessThan(page);
    expect(L(light["--accent"]!)).toBeLessThan(page);
    expect(L(light["--border"]!)).toBeLessThan(L(light["--muted"]!));
    expect(L(light["--border"]!)).toBeGreaterThanOrEqual(85);
    expect(light["--input"]).toBe(light["--border"]);
  });
  it("text and red are untouched", () => {
    expect(light["--foreground"]).toBe("oklch(0.129 0.042 264.695)");
    expect(light["--destructive"]).toBe("oklch(0.577 0.245 27.325)");
  });
});

describe("bordered boxes are painted the card colour", () => {
  it("one zero-specificity rule under @layer base, so a box's own fill still wins", () => {
    const base = css.slice(css.indexOf("@layer base {"));
    expect(base).toContain(
      ":where(.rounded.border, .rounded-md.border, .rounded-lg.border, .rounded-xl.border) {",
    );
    expect(base).toContain("background-color: var(--color-card);");
    // Inside the base layer (before its closing brace), not an unlayered rule.
    const rule = base.indexOf(":where(.rounded.border");
    expect(rule).toBeGreaterThan(0);
    expect(base.slice(0, rule)).not.toMatch(/\n\}\n/);
  });
});
