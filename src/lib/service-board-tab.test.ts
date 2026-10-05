/**
 * Owner, Oct 5: "have the list of tickets and search that sits directly above the list of tickets
 * moved to a tab between the tickets and invoices tab", then "make the tech board the first tab" —
 * the Tech Board (with its Unassigned list and search) is the first tab of the Service page, not a
 * fold above the list — "also the
 * list of unassigned tickets on the tech board can we have them color coded by status".
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(p, "utf8");
const tabs = read("src/components/service/service-tabs.tsx");
const list = read("src/components/service-page.tsx");
const board = read("src/components/service/board-page.tsx");

describe("the Service tabs", () => {
  it("are Tech Board, Tickets, Invoices — in that order (owner, Oct 5: the board first)", () => {
    const order = ['title: "Tech Board"', 'title: "Tickets"', 'title: "Invoices"'].map((t) =>
      tabs.indexOf(t),
    );
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
  it("show the board to managers / admins only, invoices by seesInvoices, tickets to all", () => {
    expect(tabs).toMatch(
      /\{ title: "Tech Board", to: "\/service\/board", icon: CalendarDays, show: managesTickets \}/,
    );
    expect(tabs).toMatch(
      /\{ title: "Invoices", to: "\/service\/invoices", icon: Receipt, show: seesInvoices \}/,
    );
    expect(tabs).toMatch(/\{ title: "Tickets", to: "\/service", icon: Wrench, show: everyone \}/);
    expect(tabs).toContain("const tabs = TABS.filter((t) => t.show(profile));");
  });
  it("the board route exists and renders the tabs row", () => {
    expect(read("src/routes/service.board.tsx")).toContain('createFileRoute("/service/board")');
    expect(board).toContain("<ServiceTabs />");
  });
  it("the Invoices count shows on every page with the tabs, not only the ticket list (owner, Oct 5)", () => {
    // The tabs read it themselves; no page passes it in.
    expect(tabs).toContain("const toInvoice = awaiting.data?.count ?? 0;");
    expect(tabs).toContain("export function ServiceTabs() {");
    for (const f of [list, board, read("src/components/service/invoices-page.tsx")])
      expect(f).toContain("<ServiceTabs />");
    expect(tabs).toContain('{t.to === "/service/invoices" && toInvoice ? (');
  });
});

describe("the ticket list page", () => {
  it("no longer folds the board above the list", () => {
    expect(list).not.toContain("EmbeddedBoard");
    expect(list).not.toContain('aria-label="Tech Board"');
    expect(list).not.toContain("service-board-open");
    expect(board).not.toContain("export function EmbeddedBoard");
    expect(board).not.toContain("embedded");
  });
  it("keeps the search and filter row directly above the tickets", () => {
    expect(list).toContain("<ServiceTabs />");
    const filters = list.indexOf("Search\n");
    const groups = list.indexOf("aria-label={`${STAGE_LABELS[stage]} tickets`}");
    expect(filters).toBeGreaterThan(0);
    expect(groups).toBeGreaterThan(filters);
  });
});

describe("the Unassigned rail is colour-coded by stage", () => {
  it("Open has its own colour (amber), Scheduled blue — not grey beside blue", () => {
    const chip = board.slice(board.indexOf("const STAGE_CHIP"), board.indexOf("const movable"));
    expect(chip).toMatch(/open:\s*"[^"]*\bbg-amber-100\b[^"]*\bdark:bg-amber-950\b/);
    expect(chip).toMatch(/scheduled:\s*"[^"]*\bbg-blue-100\b/);
    expect(chip).not.toMatch(/open:\s*"[^"]*\bbg-muted\b/);
  });
  it("carries a legend of the two stages it can hold", () => {
    expect(board).toMatch(
      /<Inbox className="h-4 w-4" \/> Unassigned[\s\S]*?<StageLegend stages=\{\["open", "scheduled"\]\} \/>/,
    );
    expect(board).toMatch(
      /function StageLegend\(\{ stages \}: \{ stages: readonly ServiceStage\[\] \}\)/,
    );
    expect(board).toContain("${STAGE_CHIP[s]}");
  });
  it("each rail chip names its stage on its detail line", () => {
    expect(board).toMatch(
      /\{props\.detail && \([\s\S]*?<span className="font-medium">\{STAGE_LABELS\[stage\]\}<\/span>/,
    );
  });
});
