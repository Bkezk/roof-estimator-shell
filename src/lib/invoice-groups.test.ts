/**
 * The Invoices list in status groups (owner, Nov 9: "like on bids where each status is a
 * collapsible row, the same for invoices … each row sorted by date"): the grouping, the
 * remembered collapse, and the page's wiring.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  groupInvoicesByStatus,
  INVOICE_GROUP_ORDER,
  INVOICE_GROUPS_COLLAPSED_KEY,
  readCollapsedInvoiceGroups,
  toggleCollapsedGroup,
  writeCollapsedInvoiceGroups,
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

describe("the remembered collapse", () => {
  const store = () => {
    const m = new Map<string, string>();
    return {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => m.set(k, v),
      m,
    };
  };
  it("writes and reads the collapsed groups; junk reads as none", () => {
    const st = store();
    expect(readCollapsedInvoiceGroups(st)).toEqual([]);
    writeCollapsedInvoiceGroups(st, ["void", "paid"]);
    expect(st.m.get(INVOICE_GROUPS_COLLAPSED_KEY)).toBe('["void","paid"]');
    // Read back in the statuses' order, unknown names dropped.
    expect(readCollapsedInvoiceGroups(st)).toEqual(["paid", "void"]);
    st.setItem(INVOICE_GROUPS_COLLAPSED_KEY, '["sent","nope",3]');
    expect(readCollapsedInvoiceGroups(st)).toEqual([]);
    st.setItem(INVOICE_GROUPS_COLLAPSED_KEY, "{not json");
    expect(readCollapsedInvoiceGroups(st)).toEqual([]);
    expect(readCollapsedInvoiceGroups(null)).toEqual([]);
    expect(() => writeCollapsedInvoiceGroups(null, ["draft"])).not.toThrow();
  });
  it("toggles one group", () => {
    expect(toggleCollapsedGroup([], "final")).toEqual(["final"]);
    expect(toggleCollapsedGroup(["final", "void"], "final")).toEqual(["void"]);
  });
});

describe("the page", () => {
  it("renders one collapsible tbody per group from the sorted rows; the header counts and sums; the rows keep their sort", () => {
    expect(page).toContain("const shown = sortInvoices(rows, sort.key, sort.dir);");
    expect(page).toContain("const groups = groupInvoicesByStatus(shown);");
    expect(page).toContain(
      '<tbody key={g.status} data-group={g.status} data-open={open ? "" : undefined}>',
    );
    expect(page).toContain("aria-expanded={open}");
    expect(page).toContain("onClick={() => toggleGroup(g.status)}");
    expect(page).toContain("{open && g.rows.map(renderRow)}");
    expect(page).toContain('{g.status === "void" ? "" : ` · ${money(g.total)}`}');
    expect(page).toContain("writeCollapsedInvoiceGroups(window.localStorage, next);");
    expect(page).toContain(
      'readCollapsedInvoiceGroups(typeof window === "undefined" ? null : window.localStorage)',
    );
    // The old flat body is gone.
    expect(page).not.toContain("{shown.map((r) => {");
  });
});
