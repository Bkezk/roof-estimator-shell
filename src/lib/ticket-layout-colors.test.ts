/**
 * Owner, Oct 6: "on [a service ticket] have a little toggle next to the delete button on the
 * right that is a page layout toggle, one layout is what we currently have and another is where
 * the dropdowns (aerial, materials, purchase orders etc) are below the forms rather than beside
 * them. Also can you add colors to those drop downs too?"
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { SECTION_TONES, sectionTone } from "@/components/service/section-tones";

const page = readFileSync("src/components/service-page.tsx", "utf8");

describe("the ticket's layout toggle", () => {
  it("sits right after Delete in the header, on wide screens, for the office's two panes", () => {
    const del = page.indexOf('<Trash2 className="mr-1 h-4 w-4" /> Delete');
    const toggle = page.indexOf('onClick={() => setLayout(stacked ? "side" : "stacked")}');
    expect(del).toBeGreaterThan(0);
    expect(toggle).toBeGreaterThan(del);
    expect(page.slice(del, toggle)).toContain("{twoPane && (");
    expect(page.slice(del, toggle)).toContain('className="hidden xl:inline-flex"');
  });
  it("switches the same sections between beside and below the form, remembered per device", () => {
    expect(page).toContain('const stacked = twoPane && layout === "stacked";');
    expect(page).toContain('const STACKED_PANES = "mx-auto max-w-5xl space-y-6";');
    expect(page).toContain(
      '<div className={stacked ? "mx-auto max-w-5xl space-y-6" : "space-y-6"}>',
    );
    expect(page).toContain('const TICKET_LAYOUT_KEY = "bid-o-matic:ticket-layout";');
    expect(page).toContain("window.localStorage.setItem(TICKET_LAYOUT_KEY, l);");
  });
});

describe("colours on the folding sections", () => {
  it("each section has its own colour, light and dark", () => {
    const keys = [
      "aerial",
      "inspection",
      "repairs",
      "materials",
      "purchase-orders",
      "time",
      "timeline",
      "invoice",
    ];
    const edges = keys.map((k) => SECTION_TONES[k]?.edge);
    expect(edges.every(Boolean)).toBe(true);
    expect(new Set(edges).size).toBe(keys.length);
    for (const k of keys) expect(SECTION_TONES[k]!.head).toMatch(/dark:/);
  });
  it("a review copy takes its section's colour", () => {
    expect(sectionTone("materials-review")).toBe(SECTION_TONES["materials"]);
    expect(sectionTone("time-review")).toBe(SECTION_TONES["time"]);
    expect(sectionTone(undefined)).toBeUndefined();
  });
  it("the folding box and the invoice block use them", () => {
    const box = readFileSync("src/components/service/field-shared.tsx", "utf8");
    expect(box).toContain("const t = sectionTone(toneKey ?? storageKey);");
    expect(box).toContain("${t?.head");
    expect(readFileSync("src/components/service/invoice-block.tsx", "utf8")).toContain(
      'SECTION_TONES["invoice"]!.edge',
    );
  });
});
