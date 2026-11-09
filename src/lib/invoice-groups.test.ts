/**
 * The Invoices list in groups (owner, Nov 9: "like on bids where each status is a collapsible
 * row, the same for invoices … each row sorted by date", then "make awaiting invoice one of the
 * dropdowns, and have them start collapsed"): the grouping, the remembered open groups, and the
 * page's wiring.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  groupInvoicesByStatus,
  INVOICE_GROUP_ORDER,
  INVOICE_GROUPS_OPEN_KEY,
  isGroupOpen,
  readOpenInvoiceGroups,
  toggleOpenGroup,
  writeOpenInvoiceGroups,
} from "./invoice-groups";

const page = readFileSync("src/components/service/invoices-page.tsx", "utf8");

describe("groupInvoicesByStatus", () => {
  it("Draft → Final → Paid → Void, empty groups left out, the rows' order kept, totals summed", () => {
    const rows = [
      { id: "a", status: "paid", total: "100.25" },
      { id: "b", status: "final", total: 50 },
      { id: "c", status: "void", total: 7 },
      { id: "d", status: "paid", total: 0.5 },
      { id: "e", status: "final", total: null },
    ];
    const g = groupInvoicesByStatus(rows);
    expect(g.map((x) => x.status)).toEqual(["final", "paid", "void"]);
    expect(g[0]!.rows.map((r) => r.id)).toEqual(["b", "e"]);
    expect(g[1]!.rows.map((r) => r.id)).toEqual(["a", "d"]);
    expect(g.map((x) => x.total)).toEqual([50, 100.75, 7]);
    expect(INVOICE_GROUP_ORDER).toEqual(["draft", "final", "paid", "void"]);
    expect(groupInvoicesByStatus([])).toEqual([]);
  });
  it("a legacy 'sent' row sits in the Final group (statuses condensed Nov 9)", () => {
    expect(groupInvoicesByStatus([{ status: "sent", total: 1 }]).map((x) => x.status)).toEqual([
      "final",
    ]);
  });
});

describe("the open groups", () => {
  const store = () => {
    const m = new Map<string, string>();
    return {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => m.set(k, v),
      m,
    };
  };
  it("every group starts collapsed; the ones opened are written and read back; junk reads as none", () => {
    const st = store();
    expect(readOpenInvoiceGroups(st)).toEqual([]);
    writeOpenInvoiceGroups(st, ["void", "awaiting"]);
    expect(st.m.get(INVOICE_GROUPS_OPEN_KEY)).toBe('["void","awaiting"]');
    // Read back in the groups' order, unknown names dropped.
    expect(readOpenInvoiceGroups(st)).toEqual(["awaiting", "void"]);
    st.setItem(INVOICE_GROUPS_OPEN_KEY, '["sent","nope",3]');
    expect(readOpenInvoiceGroups(st)).toEqual([]);
    st.setItem(INVOICE_GROUPS_OPEN_KEY, "{not json");
    expect(readOpenInvoiceGroups(st)).toEqual([]);
    expect(readOpenInvoiceGroups(null)).toEqual([]);
    expect(() => writeOpenInvoiceGroups(null, ["draft"])).not.toThrow();
  });
  it("toggles one group; a narrowed list forces its group open", () => {
    expect(toggleOpenGroup([], "final")).toEqual(["final"]);
    expect(toggleOpenGroup(["final", "void"], "final")).toEqual(["void"]);
    expect(isGroupOpen([], "final")).toBe(false);
    expect(isGroupOpen(["final"], "final")).toBe(true);
    expect(isGroupOpen([], "final", true)).toBe(true);
    expect(isGroupOpen([], "awaiting", true)).toBe(true);
  });
});

describe("the page", () => {
  it("renders the Awaiting invoice group first, then one collapsible tbody per status from the sorted rows", () => {
    expect(page).toContain("const shown = sortInvoices(rows, sort.key, sort.dir);");
    expect(page).toContain("const groups = groupInvoicesByStatus(shown);");
    expect(page).toContain(
      '<tbody data-group="awaiting" data-open={awaitingOpen ? "" : undefined}>',
    );
    expect(page).toContain('const awaitingShown = status === "all" && waiting.length > 0;');
    expect(page).toContain('const awaitingOpen = isGroupOpen(openGroups, "awaiting", toInvoice);');
    expect(page).toContain("{awaitingOpen && waiting.map(renderTicketRow)}");
    expect(page).toContain(
      '<tbody key={g.status} data-group={g.status} data-open={open ? "" : undefined}>',
    );
    expect(page).toContain('const open = isGroupOpen(openGroups, g.status, status !== "all");');
    expect(page).toContain("onClick={() => toggleGroup(g.status)}");
    expect(page).toContain("{open && g.rows.map(renderRow)}");
    expect(page).toContain('{g.status === "void" ? "" : ` · ${money(g.total)}`}');
    // The headers stand out (owner, Nov 9: "the draft, final, paid, void etc just kind of blend
    // into the text"): a status-coloured badge on a tinted row, the count beside it.
    expect(page).toContain('<tr className="border-y bg-muted/70 dark:bg-muted/40">');
    expect(page).toContain(
      "className={`px-2 py-0.5 text-xs font-semibold uppercase tracking-wide ${STATUS_CLASS[g.status]}`}",
    );
    // Every group starts collapsed; the ones opened are remembered.
    expect(page).toContain("writeOpenInvoiceGroups(window.localStorage, next);");
    expect(page).toContain(
      'readOpenInvoiceGroups(typeof window === "undefined" ? null : window.localStorage)',
    );
    // The old flat body and the separate Awaiting table are gone.
    expect(page).not.toContain("{shown.map((r) => {");
    expect(page).not.toContain("function ToInvoiceTable(");
  });
  it("the chips: All and the four statuses; no Awaiting invoice chip, no Unpaid chip (an unpaid invoice is a final one); ?status=unpaid lights Final", () => {
    expect(page).not.toContain("Awaiting invoice{jobsQ.data");
    expect(page).not.toContain("> Unpaid </Chip>");
    expect(page).not.toContain("Unpaid\n          </Chip>");
    expect(page).toContain('const on = status === s || (s === "final" && status === "unpaid");');
  });
  it("a ticket row in the Awaiting group opens the ticket and says how long it has waited", () => {
    const row = page.slice(
      page.indexOf("const renderTicketRow = "),
      page.indexOf("const renderRow = "),
    );
    expect(row).toContain('search={{ id: j.id, from: "invoices" }}');
    expect(row).toContain("onClick={() => open(j.id)}");
    expect(row).toContain('`Waiting ${days} day${days === 1 ? "" : "s"}`');
    expect(row).toContain("Authorized");
  });
});
