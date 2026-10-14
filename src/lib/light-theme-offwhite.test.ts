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

describe("page-level panels are white, not a muted box on a muted page", () => {
  it("the filter bars and page sections carry no muted fill of their own (owner, Oct 14: 'why are the … forms not white?')", () => {
    for (const [f, cls] of [
      ["src/routes/bids.tsx", "flex flex-wrap items-end gap-3 rounded-lg border p-3"],
      ["src/components/takeoff-page.tsx", "flex flex-wrap items-end gap-3 rounded-lg border p-3"],
      ["src/components/service-page.tsx", "space-y-3 rounded-lg border p-3"],
      ["src/components/opportunities-page.tsx", "space-y-3 rounded-lg border p-3"],
      ["src/components/service/invoices-page.tsx", "space-y-3 rounded-lg border p-3"],
      ["src/components/inventory-page.tsx", "justify-between gap-2 rounded-md border px-3 py-2"],
      ["src/components/leads-page.tsx", "space-y-2 rounded-lg border p-3 text-sm"],
    ] as const) {
      const src = readFileSync(f, "utf8");
      expect(src, f).toContain(cls);
      expect(src, f).not.toContain("rounded-lg border bg-muted/30 p-3");
    }
  });
});

describe("inner panels say card, not background (owner, Oct 14: 'did you do the same for customers, service etc?')", () => {
  it("a bordered panel inside a card that used the page colour to mean white now uses the card colour", () => {
    for (const f of [
      "src/components/customers-page.tsx",
      "src/components/crm/site-form.tsx",
      "src/components/crm/property-sites.tsx",
      "src/components/service-page.tsx",
      "src/components/service/purchase-orders-section.tsx",
      "src/components/service/materials-section.tsx",
      "src/components/takeoff/editor.tsx",
      "src/components/takeoff/viewer.tsx",
    ]) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toMatch(/border bg-background\b/);
    }
    expect(readFileSync("src/components/customers-page.tsx", "utf8")).toContain(
      '<div className="divide-y rounded-md border bg-card">',
    );
  });
});

describe("bordered boxes are painted the card colour", () => {
  it("one zero-specificity rule under @layer base, so a box's own fill still wins", () => {
    const base = css.slice(css.indexOf("@layer base {"));
    // :is(), not :where(): two-class specificity beats preflight's transparent <button> in the
    // same layer (the bid folder cards are buttons — owner, Oct 14: "why are the folders … not
    // white?"); the utilities layer still wins over it.
    expect(base).toContain(
      ":is(.rounded.border, .rounded-md.border, .rounded-lg.border, .rounded-xl.border) {",
    );
    expect(base).not.toContain(":where(.rounded.border");
    expect(base).toContain("background-color: var(--color-card);");
    // Inside the base layer (before its closing brace), not an unlayered rule.
    const rule = base.indexOf(":is(.rounded.border");
    expect(rule).toBeGreaterThan(0);
    expect(base.slice(0, rule)).not.toMatch(/\n\}\n/);
  });
});

describe("forms and dropdowns are white (owner, Oct 14: 'can all the forms and dropdowns be white?')", () => {
  const ui = (f: string) => readFileSync(`src/components/ui/${f}`, "utf8");
  it("inputs, text areas, select boxes, outline buttons and toggles carry the card colour, not transparent", () => {
    expect(ui("input.tsx")).toContain("border border-input bg-card px-3 py-1");
    expect(ui("textarea.tsx")).toContain("border border-input bg-card px-3 py-2");
    expect(ui("select.tsx")).toContain("border border-input bg-card px-3 py-2");
    expect(ui("button.tsx")).toContain("border border-input bg-card shadow-sm");
    expect(ui("toggle.tsx")).toContain("border border-input bg-card shadow-sm");
    for (const f of ["input.tsx", "textarea.tsx", "select.tsx"])
      expect(ui(f)).not.toMatch(/border-input bg-transparent/);
  });
  it("dropdown lists and pop-ups are the popover colour (white); dialogs, sheets and drawers the card colour", () => {
    expect(ui("select.tsx")).toContain("rounded-md border bg-popover text-popover-foreground");
    expect(ui("dropdown-menu.tsx")).toContain(
      "rounded-md border bg-popover p-1 text-popover-foreground",
    );
    expect(ui("popover.tsx")).toContain("rounded-md border bg-popover p-4 text-popover-foreground");
    for (const f of ["dialog.tsx", "alert-dialog.tsx", "sheet.tsx", "drawer.tsx"]) {
      expect(ui(f), f).toContain("bg-card");
      expect(ui(f), f).not.toContain("bg-background");
    }
    const light = block(":root");
    expect(L(light["--popover"]!)).toBeGreaterThanOrEqual(99.5);
    expect(L(light["--card"]!)).toBeGreaterThanOrEqual(99.5);
  });
});
