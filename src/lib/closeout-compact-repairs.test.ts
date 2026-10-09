/**
 * Owner, Oct 9: "when you open ticket to fill it out from the tech perspective … the repairs
 * are a bit space consuming especially if you have more than one." Each repair is one folded
 * row (name, × qty unit, Before / After counts, what it still needs) that opens to the card;
 * one is open at a time, the one just added opens itself, the only repair is always open, and
 * Remove moved into the card's header. These fail on the old screen (no repairSummary, no
 * RepairRow, Remove on its own row at the bottom).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { repairSummary } from "@/lib/closeout-repairs";

const repair = (over: Partial<Parameters<typeof repairSummary>[0]> = {}) => ({
  name: "Membrane – Holes",
  quantity: 2,
  unit: "EA",
  resolution_text: "Patched both",
  ...over,
});

describe("repairSummary", () => {
  it("× qty unit, the photo counts, nothing needed when complete", () => {
    expect(
      repairSummary(repair(), [
        { role: "before" },
        { role: "before" },
        { role: "after" },
        { role: "note" },
      ]),
    ).toEqual({ qtyText: "× 2 EA", before: 2, after: 1, needs: [] });
  });
  it("lists the before photo, the after photo and the what-you-did text it still needs, in that order", () => {
    // Owner, Oct 9: the box is "What you did to fix it", so the hint says "what you did".
    expect(repairSummary(repair({ resolution_text: "  " }), []).needs).toEqual([
      "before photo",
      "after photo",
      "what you did",
    ]);
    expect(repairSummary(repair({ resolution_text: null }), [{ role: "before" }]).needs).toEqual([
      "after photo",
      "what you did",
    ]);
    expect(repairSummary(repair(), [{ role: "after" }]).needs).toEqual(["before photo"]);
  });
  it("formats a decimal quantity (numeric from the database may be a string) and defaults the unit", () => {
    expect(repairSummary(repair({ quantity: "1.5", unit: "LF" }), []).qtyText).toBe("× 1.5 LF");
    expect(repairSummary(repair({ quantity: 0.125, unit: "" }), []).qtyText).toBe("× 0.125 EA");
    expect(repairSummary(repair({ quantity: 3.00001, unit: null }), []).qtyText).toBe("× 3 EA");
  });
});

describe("the close-out's Repairs section", () => {
  const src = readFileSync("src/components/service/closeout.tsx", "utf8");
  it("folds each repair to a row showing name, × qty, Before / After counts and an amber needs hint", () => {
    expect(src).toMatch(
      /import \{[\s\S]*?repairSummary,[\s\S]*?\} from "@\/lib\/closeout-repairs";/,
    );
    expect(src).toContain("function RepairRow({");
    expect(src).toContain("const s = repairSummary(repair, photos);");
    expect(src).toContain("{s.qtyText}");
    // Owner, Oct 9 (S6): the counts are on the row's own camera buttons, "Before (n)" /
    // "After (n)" (PhotoButtons, shared with the card), not plain text. Later that day the row
    // shows in two steps (closeout-steps.ts): step 2's Before button, step 3's After button,
    // each with that step's needs (closeout-repairs.ts needsFor).
    expect(src).toContain(
      "<PhotoButtons photos={photos} camera={camera} roles={PHASE_PHOTO_ROLES[phase]} compact />",
    );
    expect(src).toContain("const needs = needsFor(phase, s.needs);");
    expect(src).toContain('{count(role) ? ` (${count(role)})` : ""}');
    expect(src).toMatch(/text-amber-700 dark:text-amber-400">\s*needs: \{needs\.join\(", "\)\}/);
    expect(src).toContain('<ChevronDown className="h-5 w-5 shrink-0 text-muted-foreground" />');
  });
  it("one card open at a time; the only repair is always open; nothing remembered across reloads", () => {
    expect(src).toContain("const [expanded, setExpanded] = useState<string | null>(null);");
    expect(src).toContain("const openId = rows.length === 1 ? (rows[0]?.id ?? null) : expanded;");
    expect(src).toMatch(/openId === r\.id \? \(\s*<RepairCard/);
    expect(src).toContain("onCollapse={rows.length > 1 ? () => setExpanded(null) : null}");
    expect(src).toContain("onOpen={() => setExpanded(r.id)}");
    expect(src).not.toMatch(/localStorage[^\n]*expanded/);
  });
  it("the repair just added opens itself", () => {
    const onSuccess = src.slice(
      src.indexOf("toast.success(`Added ${row.name}`);"),
      src.indexOf('onError: (e) => loudError("Could not add the repair", e),'),
    );
    expect(onSuccess).toContain("setExpanded(row.id);");
  });
  it("Remove is a ghost button in the card's header (h-11, owner Oct 9), with its confirm step; the photo buttons are h-11", () => {
    const card = src.slice(src.indexOf("function RepairCard({"), src.indexOf("// (f) Signature"));
    const header = card.slice(
      card.indexOf("<article"),
      card.indexOf('<Label className="text-sm text-muted-foreground">Quantity</Label>'),
    );
    expect(header).toContain(
      'className="h-11 px-2 text-xs text-destructive hover:text-destructive"',
    );
    expect(header).toContain("onClick={() => setConfirmRemove(true)}");
    expect(header).toContain("Remove this repair and its photos?");
    expect(header).toContain("onClick={() => remove.mutate()}");
    expect(header).toContain('<ChevronUp className="h-5 w-5" />');
    expect(card).not.toContain("Remove repair");
    expect(card).not.toContain('<div className="flex justify-end">');
    // The card's camera buttons come from PhotoButtons (the form's one upload mutation), for
    // the step's role only.
    expect(card).toContain("<PhotoButtons photos={photos} camera={camera} roles={roles} />");
    expect(src).toMatch(
      /className=\{compact \? "h-10 px-3 text-sm" : "h-11 text-base"\}\s*disabled=\{uploading === role\}/,
    );
  });
});
