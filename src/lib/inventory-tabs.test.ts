/**
 * Inventory, the owner's three asks of Oct 9 (after the batch):
 *   1  "is this box necessary here?" — the Settings (admin) › Opened box or bag card is gone, with
 *      its server functions; nothing ever converted a quantity with the rule.
 *   2  "make the history and reconcile different tabs within the inventory page and only visible
 *      to managers and owners" — ?tab=stock|history|reconcile, a tab row like the Service page's,
 *      History and Reconcile for seesEveryone, everyone else on Stock whatever the URL says.
 *   3  "make reconcile clearer? its a bit confusing on what its showing and what the buttons do" —
 *      the Reconcile tab's words: one plain sentence, three titled blocks, Save count.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { seesEveryone } from "@/lib/access";
import { placeWord } from "@/lib/inventory-reconcile";
import { INVENTORY_TABS, parseInventorySearch } from "@/lib/inventory-search";

const read = (p: string) => readFileSync(p, "utf8");
const page = read("src/components/inventory-page.tsx");
const fns = read("src/lib/inventory.functions.ts");
const route = read("src/routes/inventory.tsx");
const between = (src: string, from: string, to: string) =>
  src.slice(src.indexOf(from), src.indexOf(to, src.indexOf(from)));
const reconcile = between(page, "function ReconcileTab(", "function NegativeRow(");
const negativeRow = between(page, "function NegativeRow(", "function SetCountButton(");
const setCountButton = page.slice(page.indexOf("function SetCountButton("));
const dialog = between(page, "function RecordDialog(", "function LedgerTable(");

// ---------------------------------------------------------------------------------------------
describe("1 · the opened-box rule is gone", () => {
  it("no Settings card, no rule plumbing, no sentence in the dialog", () => {
    expect(page).not.toContain("SettingsCard");
    expect(page).not.toContain("OPENED_BOX_LABELS");
    expect(page).not.toContain("OpenedBoxRule");
    expect(page).not.toContain("getInventorySettings");
    expect(page).not.toContain("setOpenedBoxRule");
    expect(page).not.toContain("inventory-settings");
    expect(page).not.toContain("opened_box_rule");
    expect(dialog).not.toContain("rule");
    expect(dialog).toContain(
      '"Puts material in the shop or on a service vehicle — leftovers from a job, something bought or delivered, stock moved from the shop, or what came back off a vehicle."',
    );
  });
  it("the server functions are gone; the table is left alone (no migration)", () => {
    expect(fns).not.toContain("OpenedBoxRule");
    expect(fns).not.toContain("OPENED_BOX_LABELS");
    expect(fns).not.toContain("getInventorySettings");
    expect(fns).not.toContain("setOpenedBoxRule");
    expect(fns).not.toContain("inventory_settings");
    expect(read("src/integrations/supabase/types.ts")).toContain("inventory_settings");
  });
  it("the header comment says why", () => {
    expect(page.replace(/\n \* /g, " ")).toContain(
      'The opened-box rule (owner, Oct 9: "is this box necessary here?") is gone',
    );
  });
});

// ---------------------------------------------------------------------------------------------
describe("2 · ?tab= parsing (inventory-search.ts)", () => {
  it("knows the three views; Stock is the default and is left out of the search", () => {
    expect([...INVENTORY_TABS]).toEqual(["stock", "history", "reconcile"]);
    expect(parseInventorySearch({})).toEqual({});
    expect(parseInventorySearch({ tab: "stock" })).toEqual({});
    expect(parseInventorySearch({ tab: "history" })).toEqual({ tab: "history" });
    expect(parseInventorySearch({ tab: "reconcile" })).toEqual({ tab: "reconcile" });
  });
  it("junk is Stock, never an error", () => {
    expect(parseInventorySearch({ tab: "settings" })).toEqual({});
    expect(parseInventorySearch({ tab: "" })).toEqual({});
    expect(parseInventorySearch({ tab: 3 })).toEqual({});
    expect(parseInventorySearch({ tab: ["history"] })).toEqual({});
    expect(parseInventorySearch({ tab: null })).toEqual({});
  });
  it("keeps the bid and job links as before, with or without a tab", () => {
    expect(parseInventorySearch({ bid: "b1" })).toEqual({ bid: "b1" });
    expect(parseInventorySearch({ job: "j1" })).toEqual({ job: "j1" });
    expect(parseInventorySearch({ job: "j1", tab: "history" })).toEqual({
      tab: "history",
      job: "j1",
    });
    // An empty or non-string id is nothing (as the route did before).
    expect(parseInventorySearch({ bid: "" })).toEqual({});
    expect(parseInventorySearch({ bid: 7, job: {} })).toEqual({});
  });
  it("the route uses it and hands the tab to the page", () => {
    expect(route).toContain("validateSearch: parseInventorySearch,");
    expect(route).toContain("const { tab, bid, job } = Route.useSearch();");
    expect(route).toContain(
      "<InventoryPage tab={tab} initialBidId={bid} initialServiceJobId={job} />",
    );
  });
});

describe("2 · the tab row and its gate", () => {
  it("a nav of three links under the heading, the Service page's look; Stock's link carries no ?tab=", () => {
    expect(page).toContain(
      '<nav aria-label="Inventory views" className="flex flex-wrap gap-1 border-b">',
    );
    expect(page).toMatch(
      /const TABS[\s\S]*?\{ tab: "stock", title: "Stock", icon: Boxes \},\s*\{ tab: "history", title: "History", icon: History \},\s*\{ tab: "reconcile", title: "Reconcile", icon: Scale \},/,
    );
    expect(page).toContain('search={t.tab === "stock" ? {} : { tab: t.tab }}');
    expect(page).toContain('aria-current={tab === t.tab ? "page" : undefined}');
    expect(page).toContain(
      '"-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium"',
    );
    expect(read("src/components/service/service-tabs.tsx")).toContain(
      '"-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium"',
    );
  });
  it("History and Reconcile (and the row itself) only for seesEveryone; anyone else is on Stock whatever the URL says", () => {
    expect(page).toContain("const canSeeAll = seesEveryone(profile);");
    expect(page).toContain(
      'const tab: InventoryTab = canSeeAll ? (props.tab ?? "stock") : "stock";',
    );
    expect(page).toMatch(/\{canSeeAll && \(\s*<nav aria-label="Inventory views"/);
    expect(page).toContain('{tab === "history" && (');
    expect(page).toContain('{tab === "reconcile" && <ReconcileTab canSetCount={canSetCount} />}');
    // The gate itself: admins and managers, nobody else — not even an estimator.
    expect(seesEveryone({ role: "admin", access: [] })).toBe(true);
    expect(seesEveryone({ role: "manager", access: [] })).toBe(true);
    expect(seesEveryone({ role: "user", access: ["estimate", "inventory"] })).toBe(false);
    expect(seesEveryone({ role: "user", access: ["service"], technician: true })).toBe(false);
    expect(seesEveryone(null)).toBe(false);
  });
  it("Stock is the table with the header buttons; the two cards lost their collapse", () => {
    expect(page.match(/\{tab === "stock" && \(/g)).toHaveLength(2);
    expect(page).toMatch(
      /\{tab === "stock" && \(\s*<div className="flex flex-wrap gap-2">\s*<Button variant="outline" onClick=\{\(\) => open\("consumed"\)\}>/,
    );
    expect(page).not.toContain("historyOpen");
    expect(page).not.toContain("setHistoryOpen");
    expect(reconcile).not.toContain("setOpen(");
    expect(page).not.toContain('{open ? "Hide" : "Show"}');
    expect(page).not.toContain('{historyOpen ? "Hide" : "Show"}');
  });
  it("each tab's queries run only while it is shown; the keys are unchanged", () => {
    const moves = between(page, "const movesQ = useQuery({", "});");
    expect(moves).toContain('queryKey: ["inventory-movements"],');
    expect(moves).toContain('enabled: tab === "history",');
    // Reconcile's query lives in the tab's component, which only the tab mounts.
    expect(reconcile).toContain('queryKey: ["inventory-reconcile", weekStart],');
    expect(reconcile).not.toContain("enabled:");
    expect(page).toContain('queryKey: ["inventory-stock"]');
  });
  it("Vehicles & drivers stays on Setup", () => {
    expect(page).not.toContain("VehicleDriversCard");
    expect(read("src/routes/setup.tsx")).toContain("<VehicleDriversCard");
  });
});

// ---------------------------------------------------------------------------------------------
describe("3 · the Reconcile tab's words", () => {
  it("one plain sentence under the title", () => {
    expect(reconcile.replace(/\s+/g, " ")).toContain(
      "Counts inventory shows below zero, and where each one went wrong. Type what is really on the shelf or truck and save it — that is the only way a line leaves this list.",
    );
    expect(reconcile).not.toContain("admins and managers</span>");
  });
  it("three titled blocks, each with a one-line explanation and an empty line", () => {
    expect(reconcile).toContain('data-block="below-zero"');
    expect(reconcile).toContain('"Below zero now",');
    expect(reconcile).toContain("Nothing is below zero right now.");
    expect(reconcile).toContain('data-block="short"');
    expect(reconcile).toContain("<>Logged with none in inventory — {weekWord}</>,");
    expect(reconcile).toContain(
      '"A tech logged material inventory said was not there. The count at that place went below zero; fix it above or on the Stock tab.",',
    );
    expect(reconcile).toContain("Nothing was logged with none in inventory {weekWord}.");
    expect(reconcile).toContain('data-block="fixed"');
    expect(reconcile).toContain(
      '<>Fixed {weekWord}</>, "Counts that were below zero and were corrected."',
    );
    expect(reconcile).toContain("Nothing was fixed {weekWord}.");
    // "this week" while this week is shown; the picked week's days otherwise.
    expect(reconcile).toMatch(
      /const weekWord =\s*weekStart === thisWeek \? "this week" : r \? `the week of \$\{r\.weekLabel\}` : "that week";/,
    );
    // The week picker sits beside block b's title, ‹ › and "(this week)" kept.
    const short = between(reconcile, 'data-block="short"', 'data-block="fixed"');
    expect(short).toContain("data-week-picker");
    expect(short).toContain('aria-label="Previous week"');
    expect(short).toContain('aria-label="Next week"');
    expect(short).toContain("(this week)");
    // Block b's table: When · Who · Ticket · Where · Item · Change · Note.
    expect(short.replace(/\s+/g, " ")).toContain(
      "<TableHead>When</TableHead> <TableHead>Who</TableHead> <TableHead>Ticket</TableHead> <TableHead>Where</TableHead> <TableHead>Item</TableHead>",
    );
  });
  it("a cell below zero: bold 'inventory shows −2 boxes', when, 'What took it there' with the short badge, and the fix row", () => {
    expect(negativeRow).toContain(
      "inventory shows {fmtSigned(n.on_hand)} {packUnitLabel(n.on_hand, n.unit)}",
    );
    expect(negativeRow).toContain("Went below zero {fmtOfficeWhen(n.firstBelowZeroAt)}");
    expect(negativeRow).toContain("What took it there");
    expect(negativeRow.replace(/\s+/g, " ")).toContain(
      '<TableHead>When</TableHead> <TableHead>Who</TableHead> <TableHead>Ticket</TableHead> <TableHead className="text-right">Change</TableHead> <TableHead>Note</TableHead>',
    );
    expect(negativeRow).toContain("{fmtSigned(c.qty)} {packUnitLabel(c.qty, n.unit)}");
    expect(negativeRow).toContain("data-short-badge");
    expect(negativeRow).toContain("logged with none in inventory");
    expect(negativeRow).not.toContain(">SHORT<");
    // The fix row.
    expect(negativeRow).toContain("data-fix-row");
    expect(negativeRow).toContain("Really on the {place} now");
    expect(negativeRow).toContain("const place = placeWord(n.location_id);");
    expect(negativeRow).toContain("{packUnitLabel(2, n.unit)}</span>");
    expect(negativeRow).toMatch(/>\s*Save count\s*<\/Button>/);
    expect(negativeRow).not.toMatch(/>\s*Set count\s*</);
    expect(negativeRow).toContain("Records one adjustment so inventory matches your count.");
    // The same adjustment as before: reconcileAdjustment → addMovement.
    expect(negativeRow).toContain(
      "const payload = counted === null ? null : reconcileAdjustment(n, counted);",
    );
    expect(negativeRow).toContain("await addFn({ data: payload });");
  });
  it("placeWord: the shop is a shelf, every vehicle a truck", () => {
    expect(placeWord("shop")).toBe("shelf");
    expect(placeWord("truck-1")).toBe("truck");
    expect(placeWord("11111111-1111-4111-8111-111111111111")).toBe("truck");
  });
  it("the stock table's red count carries 'Fix on Reconcile' for seesEveryone (phone card and table)", () => {
    expect(page.match(/\{r\.on_hand < 0 && canSeeAll && <FixOnReconcile \/>\}/g)).toHaveLength(2);
    const link = between(page, "function FixOnReconcile(", "/**");
    expect(link).toContain('to="/inventory"');
    expect(link).toContain('search={{ tab: "reconcile" }}');
    expect(link).toContain("Fix on Reconcile");
  });
  it("the row's Set count popover says 'Really on the <place> now' and 'Save count'", () => {
    // The trigger keeps its name; the popover's button is Save count.
    expect(setCountButton).toContain("data-set-count>");
    expect(setCountButton).toMatch(/data-set-count>\s*Set count/);
    expect(setCountButton).toContain("Really on the {placeWord(r.location_id)} now");
    expect(setCountButton).toContain("{packUnitLabel(2, r.unit)}</span>");
    expect(setCountButton).toMatch(/onClick=\{\(\) => void setCount\(\)\}\s*>\s*Save count/);
    expect(setCountButton).not.toContain("Counted (");
    expect(setCountButton).toContain("Records one adjustment so inventory matches your count.");
  });
});
