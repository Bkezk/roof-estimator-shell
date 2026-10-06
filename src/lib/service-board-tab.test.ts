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
  // Oct 6: CenterPoint's families (stage-colors.ts) — Open pink, Scheduled orange, not grey.
  it("Open has its own colour (pink), Scheduled orange — not grey beside it", () => {
    const tones = readFileSync("src/lib/stage-colors.ts", "utf8");
    expect(tones).toMatch(/open: tone\(\n\s*"[^"]*\bbg-pink-100\b[^"]*\bdark:bg-pink-950\b/);
    expect(tones).toMatch(/scheduled: tone\(\n\s*"[^"]*\bbg-orange-100\b/);
    expect(tones).not.toMatch(/open: tone\(\n\s*"[^"]*\bbg-muted\b/);
  });
  it("carries a legend of the board's colours, en route and on site among them", () => {
    expect(board).toMatch(
      /<Inbox className="h-4 w-4" \/> Unassigned[\s\S]*?<StageLegend\s+stages=\{\[\s*"open",\s*"scheduled",\s*"en_route",\s*"on_site",\s*"done",\s*"authorized",\s*"invoiced",\s*"closed",?\s*\]\}/,
    );
    expect(board).toMatch(
      /function StageLegend\(\{ stages \}: \{ stages: readonly StageToneKey\[\] \}\)/,
    );
    expect(board).toContain("${STAGE_TONES[s].chip}");
  });
  it("each rail chip names its stage on its detail line", () => {
    expect(board).toMatch(
      /\{props\.detail && \([\s\S]*?<span className="font-medium">\{STAGE_LABELS\[stage\]\}<\/span>/,
    );
  });
});
