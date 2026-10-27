/**
 * The bid's three accessory groups (owner, Oct 26–27): "on the accessories page while making a
 * bid all the current options can be minimized under a label DL accessories. then we need two
 * additional options. Non DL TPO accessories, and EPDM accessories … all 3 always available."
 * Source pins on the estimator, the screens component, the proposal and the server assembly:
 * the groups, the collapsed DL label, the Other accessories screen, the engine-input
 * composition, the save/load keys and the frozen-snapshot notice. Fail on the old code.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const estimate = readFileSync("src/routes/estimate.tsx", "utf8");
const screens = readFileSync("src/components/accessories-screens.tsx", "utf8");
const proposal = readFileSync("src/routes/proposal.tsx", "utf8");
const serverFns = readFileSync("src/lib/engine.functions.ts", "utf8");
const savedState = readFileSync("src/lib/proposal-bid.ts", "utf8");
const summaryCard = readFileSync("src/components/accessory-summary-card.tsx", "utf8");
const bax = readFileSync("src/components/import-bax-dialog.tsx", "utf8");

const step5 = estimate.slice(
  estimate.indexOf('data-bid-step="accessories"'),
  estimate.indexOf('data-bid-step="metals"'),
);

describe("step 5 shows three collapsible accessory groups", () => {
  it("the DL group first, under its label, minimized by default; then Non-DL TPO and EPDM", () => {
    expect(step5).toContain('<Card data-accessory-group="duroLast">');
    expect(step5).toContain("{FAMILY_LABEL.duroLast}");
    expect(step5).toContain("{EXTRA_FAMILIES.map((family) => {");
    expect(step5).toContain("<Card data-accessory-group={family}>");
    expect(step5).toContain("{FAMILY_LABEL[family]}");
    expect(step5.indexOf('data-accessory-group="duroLast"')).toBeLessThan(
      step5.indexOf("data-accessory-group={family}"),
    );
    // Every group is a Collapsible whose trigger is the label.
    expect((step5.match(/<Collapsible\b/g) ?? []).length).toBe(2);
    expect((step5.match(/<CollapsibleTrigger asChild>/g) ?? []).length).toBe(2);
    expect(estimate).toMatch(
      /useState<Record<AccessoryFamily, boolean>>\(\{\s*duroLast: false,\s*nonDlTpo: false,\s*epdm: false,\s*\}\)/,
    );
    // The old single "Accessories" card title is gone.
    expect(step5).not.toContain('<CardTitle className="text-base">Accessories</CardTitle>');
  });
  it("each family group runs the same screens with its own state, ref and result", () => {
    expect(step5).toContain('family="duroLast"');
    expect(step5).toContain("refData={duroLastRefForBid(admin, roofSystem)}");
    expect(step5).toContain("family={family}");
    expect(step5).toContain("refData={admin?.accessoryFamilies?.refs[family]}");
    expect(step5).toContain("result={famResult}");
    expect(step5).toContain(
      'const famState = family === "nonDlTpo" ? accessoriesCalcTpo : accessoriesCalcEpdm;',
    );
    expect(step5).toContain(
      'family === "nonDlTpo" ? setAccessoriesCalcTpo : setAccessoriesCalcEpdm',
    );
    // Header figures per family: material, hours, labor cost.
    expect(step5).toContain("{money(famMaterial)}");
    expect(step5).toContain("{famHours.toFixed(2)} h");
    expect(step5).toContain("{money(famHours * laborRate)}");
  });
  it("each group carries its Other accessories picks", () => {
    expect(step5).toContain("otherItems={admin?.accessoryFamilies?.other.duroLast}");
    expect(step5).toContain("otherLines={otherAccessories.duroLast}");
    expect(step5).toContain("otherItems={admin?.accessoryFamilies?.other[family] ?? []}");
    expect(step5).toContain("otherLines={otherAccessories[family]}");
    expect(step5).toContain("setOtherAccessories((p) => ({ ...p, [family]: next }))");
  });
  it("a frozen snapshot without the families shows the notice in the two family groups", () => {
    expect(step5).toContain("{admin && !admin.accessoryFamilies ? (");
    expect(step5).toContain("{FAMILIES_MISSING_MESSAGE}");
  });
});

describe("the family results feed the engine input and the review", () => {
  it("the engine input accessories are composed from the flat lines, the family results and the Other picks", () => {
    expect(estimate).toContain(
      "accessories: composeAccessoryLines(accessories, familyResults, otherAccessories),",
    );
    expect(estimate).toMatch(/const familyResults = useMemo\(\s*\(\) =>\s*computeFamilyResults\(/);
    // The DL group prices with the ref for the bid's roof system (Duro-Tech TPO → the merge).
    expect(estimate).toContain("(b) => buildEstimateInputs(b, adminForBid(admin, b.roofSystem)),");
    // The review's accessory totals read the composed lines, not the old flat state alone.
    expect(estimate).toContain(
      "const accessoryTotal = bid.accessories.reduce((sum, a) => sum + a.price * a.quantity, 0);",
    );
    expect(estimate).toContain("const accessoryLaborHours = bid.accessories.reduce(");
  });
  it("the Accessories summary lists the family rows under their family label", () => {
    expect(estimate).toContain("...familyReviewLines(familyResults, otherAccessories),");
    // The card's hours include the extra rows' hours (the family rows carry theirs).
    expect(summaryCard).toContain(
      "const hours = (result?.manHours ?? 0) + extra.reduce((s, l) => s + l.hours, 0);",
    );
  });
  it("the proposal and the .bax import compose the same way", () => {
    expect(proposal).toContain(
      "const bidInput = withFamilyAccessories(buildBidInput(saved, cd.warranty), saved, cd.admin);",
    );
    expect(proposal).toContain(
      "(b) => buildEstimateInputs(b, adminForBid(cd.admin!, b.roofSystem)),",
    );
    expect(proposal).toContain(
      "bidInput.accessories.reduce((s, a) => s + a.price * a.quantity, 0)",
    );
    expect(bax).toContain("buildEstimateInputs(b, adminForBid(pricing.admin, b.roofSystem))");
  });
});

describe("saved bids round-trip the family state", () => {
  it("SavedBidState carries the two family states and the Other picks; the snapshot type carries the families", () => {
    expect(savedState).toContain("accessoriesCalcTpo?: Partial<AccessoriesState>;");
    expect(savedState).toContain("accessoriesCalcEpdm?: Partial<AccessoriesState>;");
    expect(savedState).toContain("otherAccessories?: OtherAccessoryLines;");
    expect(savedState).toContain("adminSnapshot?: AdminSnapshot;");
  });
  it("the estimator saves them and normalises them on load", () => {
    const saved = estimate.slice(
      estimate.indexOf("const saved: SavedBidState = {"),
      estimate.indexOf("const bid: BidInput = {"),
    );
    expect(saved).toContain(
      "accessoriesCalc,\n    accessoriesCalcTpo,\n    accessoriesCalcEpdm,\n    otherAccessories,",
    );
    expect(estimate).toContain(
      "setAccessoriesCalcTpo(normalizeAccessoriesState(d.accessoriesCalcTpo));",
    );
    expect(estimate).toContain(
      "setAccessoriesCalcEpdm(normalizeAccessoriesState(d.accessoriesCalcEpdm));",
    );
    expect(estimate).toContain(
      "setOtherAccessories(normalizeOtherAccessories(d.otherAccessories));",
    );
  });
});

describe("AccessoriesScreens: the family prop, hidden empty screens, the Other screen", () => {
  it("takes the family and Other props and marks its root", () => {
    expect(screens).toContain("family?: AccessoryFamily | undefined;");
    expect(screens).toContain("otherItems?: OtherAccessoryItem[] | undefined;");
    expect(screens).toContain("otherLines?: AccessoryLine[] | undefined;");
    expect(screens).toContain("onOtherChange?: ((next: AccessoryLine[]) => void) | undefined;");
    expect(screens).toContain('data-accessory-family={props.family ?? "duroLast"}');
  });
  it("hides the screens a family's ref carries nothing for, keeps every DL screen", () => {
    const fn = screens.slice(
      screens.indexOf("function hiddenAccessoryScreens("),
      screens.indexOf("export function AccessoriesScreens("),
    );
    expect(fn).toContain(
      'if (!refData || !props.family || props.family === "duroLast") return out;',
    );
    expect(fn).toContain('if (refData.vents.length === 0) out.add("vents");');
    expect(fn).toContain('if (refData.pipeStackSizes.length === 0) out.add("pipeStacks");');
    expect(fn).toContain('if (props.adhesiveNames.length === 0) out.add("adhesives");');
    expect(fn).toContain('if (props.otherItems === undefined) out.add("other");');
    expect(screens).toContain("{visibleTree.map((group) => (");
    expect(screens).toMatch(/const screenId: ScreenId = hidden\.has\(chosenScreen\)/);
  });
  it("the Other Accessories screen: a picker, blank quantity, editable hours and qty, delete per line", () => {
    const tree = screens.slice(
      screens.indexOf("const TREE:"),
      screens.indexOf("export interface AccessoriesScreensProps"),
    );
    expect(tree).toContain('items: [{ id: "other", label: "Other Accessories" }]');
    const other = screens.slice(
      screens.indexOf('case "other": {'),
      screens.indexOf('case "wood":'),
    );
    expect(other).toContain("<CatalogPicker");
    expect(other).toContain("setLines([...lines, otherAccessoryLine(it)])");
    expect(other).toContain('aria-label="Labor hours per unit"');
    expect(other).toContain('aria-label="Quantity"');
    expect(other).toContain("setLines(lines.filter((_, j) => j !== i))");
    expect(other).toContain("No Other Accessories items in this bid's pricing.");
  });
});

describe("the server snapshot carries the family refs", () => {
  it("getEngineAdminData selects the two family branches and builds accessoryFamilies", () => {
    expect(serverFns).toContain('.in("branch", [FAMILY_BRANCH.nonDlTpo, FAMILY_BRANCH.epdm])');
    expect(serverFns).toContain("if (familyScreensRes.error) throw familyScreensRes.error;");
    expect(serverFns).toContain("accessoryFamilies: buildFamilyAccessoryData({");
    expect(serverFns).toContain("Promise<AdminSnapshot>");
  });
});
