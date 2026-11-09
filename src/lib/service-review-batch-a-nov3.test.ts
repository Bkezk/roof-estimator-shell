/**
 * Service review, Nov 3 (owner: "go with 9, 11, 12 … 15, 38, 40, 41, 48, 39"), batch A — the
 * office pages. Each test fails on the code before the change.
 *
 *   9   Tech Board: finished tickets with no technician are listed under the rail
 *   11  Invoices list: the chip, dates, search and sort live in the URL; Back keeps them
 *   12  Invoices list: a Due column, with "N days late" on a late open invoice
 *   15  PDF and Sage CSV money formats match the screen
 *   38  the ticket page reads one county code by id, not the whole list
 *   39  the list, board, queue and Recently deleted read the list's columns, not every column
 *   40  the Invoices tab badge is a count alone
 *   41  city and state are the ticket's own columns (migration + save), no second query
 *   48  an index for the Board's week read
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { readGeneratedTypes } from "@/test/generated-types";

import { csvMoney, csvNumber, pctLabel, pdfMoney } from "@/lib/invoice-format";
import { invoiceDue, sortInvoices } from "@/lib/invoice-list";
import { invoiceListSearch, invoiceSearch } from "@/lib/invoice-search";
import {
  finishedUnassigned,
  FINISHED_UNASSIGNED_STAGES,
  inStageSince,
} from "@/lib/service-schedule";
import { LIST_JOB_COLUMNS } from "@/lib/service.functions";

const read = (p: string) => readFileSync(p, "utf8");
const svc = read("src/lib/service.functions.ts");
const board = read("src/components/service/board-page.tsx");
const invoices = read("src/components/service/invoices-page.tsx");
const tabs = read("src/components/service/service-tabs.tsx");
const migration = read("supabase/migrations/20261103170000_service_list_reads.sql");

describe("9. Tech Board: finished tickets with no technician", () => {
  const t = (over: Record<string, unknown>) => ({
    id: "",
    stage: "done",
    technician_id: null,
    stage_changed_at: "2026-10-15T10:00:00Z",
    updated_at: "2026-10-20T10:00:00Z",
    ...over,
  });
  it("Done, Authorized and Invoiced with nobody's name; Closed and assigned left out; longest waiting first", () => {
    expect(FINISHED_UNASSIGNED_STAGES).toEqual(["done", "authorized", "invoiced"]);
    const rows = finishedUnassigned([
      t({ id: "closed", stage: "closed" }),
      t({ id: "newer", stage: "authorized", stage_changed_at: "2026-10-26T10:00:00Z" }),
      t({ id: "assigned", technician_id: "tech" }),
      t({ id: "open", stage: "open" }),
      t({ id: "older", stage: "invoiced", stage_changed_at: "2026-10-14T10:00:00Z" }),
      t({ id: "no-stamp", stage_changed_at: null, updated_at: "2026-10-01T10:00:00Z" }),
    ]);
    expect(rows.map((r) => r.id)).toEqual(["no-stamp", "older", "newer"]);
  });
  it("the server reads them for the board (a fourth read), and the rail shows the group", () => {
    const fn = svc.slice(
      svc.indexOf("export const listBoardJobs"),
      svc.indexOf("export interface AwaitingInvoice"),
    );
    expect(fn).toContain('.is("technician_id", null)');
    expect(fn).toContain('.in("stage", [...FINISHED_UNASSIGNED_STAGES])');
    expect(board).toContain('data-rail="finished-unassigned"');
    expect(board).toContain("Finished, no technician");
    expect(board).toContain("const finished = finishedUnassigned(jobs)");
  });
  it("the chip prints the date the group is ordered by — when the ticket entered its stage (owner, Nov 6), not its scheduled date", () => {
    expect(
      inStageSince({
        stage_changed_at: "2026-10-14T10:00:00Z",
        updated_at: "2026-11-03T10:00:00Z",
      }),
    ).toBe("2026-10-14T10:00:00Z");
    expect(inStageSince({ stage_changed_at: null, updated_at: "2026-11-03T10:00:00Z" })).toBe(
      "2026-11-03T10:00:00Z",
    );
    expect(board).toContain("`since ${openedOn(inStageSince(j))} · no technician`");
    const rail = board.slice(
      board.indexOf('data-rail="finished-unassigned"'),
      board.indexOf("Week grid"),
    );
    expect(rail).toMatch(/detail\s+since\s+week=/);
  });
});

describe("11. Invoices list: the filters live in the URL", () => {
  it("parses status, from, to, q and sort; drops junk", () => {
    expect(
      invoiceSearch({
        status: "unpaid",
        from: "2026-10-01",
        to: "2026-10-31",
        q: "  bell ",
        sort: "due:asc",
      }),
    ).toEqual({
      status: "unpaid",
      from: "2026-10-01",
      to: "2026-10-31",
      q: "bell",
      sort: "due:asc",
    });
    expect(invoiceSearch({ from: "Oct 1", to: 5, q: "", sort: "due" })).toEqual({});
    expect(invoiceSearch({ sort: "nope:asc" })).toEqual({});
    expect(invoiceSearch({ sort: "total:down" })).toEqual({});
    expect(invoiceSearch({ q: "x".repeat(200) }).q).toHaveLength(120);
  });
  it("the list's filters are the search without the id", () => {
    expect(invoiceListSearch({ id: "a", status: "paid", q: "x" })).toEqual({
      status: "paid",
      q: "x",
    });
  });
  it("the page reads them from the URL, writes changes in place, and rows and Back carry them", () => {
    expect(invoices).toContain('const status: StatusFilter = filters.status ?? "all";');
    expect(invoices).toContain(
      'void navigate({ to: "/service/invoices", search: next, replace: true });',
    );
    expect(invoices).toContain("search={{ ...filters, id: r.id }}");
    expect(invoices).not.toContain("useState<StatusFilter>");
    expect(read("src/components/service/invoice-editor.tsx")).toMatch(
      /to="\/service\/invoices"\s+search=\{listSearch\}/,
    );
  });
});

describe("12. Invoices list: Due and how late", () => {
  it("an open invoice past its due date is late by whole days; one with no due date is late 30 days after its date", () => {
    expect(
      invoiceDue(
        { status: "final", invoice_date: "2026-10-01", due_date: "2026-10-31" },
        "2026-11-03",
      ),
    ).toEqual({
      due: "2026-10-31",
      lateDays: 3,
      open: true,
    });
    expect(
      invoiceDue({ status: "sent", invoice_date: "2026-10-01", due_date: null }, "2026-11-03"),
    ).toEqual({
      due: null,
      lateDays: 3,
      open: true,
    });
    expect(
      invoiceDue({ status: "sent", invoice_date: "2026-11-01", due_date: null }, "2026-11-03")
        .lateDays,
    ).toBe(0);
  });
  it("a draft, a paid and a void invoice are never late", () => {
    for (const status of ["draft", "paid", "void"])
      expect(
        invoiceDue({ status, invoice_date: "2026-01-01", due_date: "2026-01-02" }, "2026-11-03"),
      ).toEqual({
        due: "2026-01-02",
        lateDays: 0,
        open: false,
      });
  });
  it("sorts by due date; the column and the late tint are on the page", () => {
    const base = {
      label: "1",
      customer_name: "",
      site_name: null,
      po_number: null,
      job_code: null,
      invoice_date: "2026-10-01",
      total: 1,
      status: "final",
      sent_at: null,
    };
    const rows = sortInvoices(
      [
        { ...base, label: "b", due_date: "2026-10-20" },
        { ...base, label: "a", due_date: "2026-10-10" },
        { ...base, label: "none", due_date: null },
      ],
      "due",
      "asc",
    );
    expect(rows.map((r) => r.label)).toEqual(["a", "b", "none"]);
    expect(invoices).toContain('<SortHead label="Due" k="due" sort={sort} onSort={sortBy} />');
    expect(invoices).toContain("const due = invoiceDue(r, today);");
    expect(invoices).toContain("data-late={late ? due.lateDays : undefined}");
  });
  it("the table scrolls inside its box instead of widening the page on a phone", () => {
    // One table since Nov 9: the Awaiting invoice queue is its first group.
    expect(invoices.match(/className="min-w-0 overflow-x-auto rounded-lg border"/g)?.length).toBe(
      1,
    );
    // The shell's flex column must not grow to the table either (measured: an iPhone laid the
    // page out 1,168 px wide and zoomed out until the two min-w-0 below).
    const gate = read("src/components/auth-gate.tsx");
    expect(gate).toContain('<div className="flex min-w-0 flex-1 flex-col">');
    expect(gate).toContain('<SidebarInset className="min-w-0 p-4 sm:p-6">');
  });
});

describe("15. PDF and Sage CSV money formats match the screen", () => {
  it("pdfMoney: thousands, a credit with the sign first", () => {
    expect(pdfMoney(1234.5)).toBe("$1,234.50");
    expect(pdfMoney(-25)).toBe("-$25.00");
    expect(pdfMoney("0")).toBe("$0.00");
  });
  it("pctLabel: no trailing zeros", () => {
    expect(pctLabel(0.075)).toBe("7.5%");
    expect(pctLabel(0.06)).toBe("6%");
    expect(pctLabel("0.0725")).toBe("7.25%");
  });
  it("csvMoney two decimals; csvNumber as typed up to four", () => {
    expect(csvMoney(1234.5)).toBe("1234.50");
    expect(csvMoney(null)).toBe("0.00");
    expect(csvNumber(40)).toBe("40");
    expect(csvNumber(3.25)).toBe("3.25");
    expect(csvNumber(0.03125)).toBe("0.0313");
  });
  it("the server uses them", () => {
    const server = read("src/lib/invoices.server.ts");
    expect(server).toContain("const money = (n: number) => pdfMoney(n);");
    expect(server).toContain("`Tax (${pctLabel(invoice.tax_rate)})`");
    expect(server).toContain("csvMoney(invoice.total)");
    expect(server).toContain("csvNumber(l.rate)");
    expect(server).not.toContain("String(invoice.subtotal)");
  });
});

describe("38. one county code by id on the ticket page", () => {
  it("getCountyCode exists; useCountyCode reads one row and falls back to a loaded list", () => {
    expect(read("src/lib/county-codes.functions.ts")).toContain(
      "export const getCountyCode = createServerFn",
    );
    const hook = read("src/components/crm/use-county-codes.ts");
    expect(hook).toContain('queryKey: ["county-code", id]');
    expect(hook).toContain("enabled: !!session && !!id && !fromList,");
    expect(hook).not.toContain("const list = useCountyCodes().data;");
  });
});

describe("39 + 41. the lists read the list's columns, with city and state on the ticket", () => {
  it("LIST_JOB_COLUMNS leaves out the checklist, notes, closing notes and signature", () => {
    for (const heavy of [
      "inspection",
      "notes",
      "closing_notes",
      "signature_path",
      "signed_by",
      "checked_in_with",
    ])
      expect(LIST_JOB_COLUMNS.split(", ")).not.toContain(heavy);
    for (const shown of [
      "number",
      "stage",
      "site_city",
      "site_state",
      "stage_changed_at",
      "completed_at",
      "updated_by_name",
    ])
      expect(LIST_JOB_COLUMNS.split(", ")).toContain(shown);
  });
  it("every list read selects them; the ticket page still reads the whole row", () => {
    const names = [
      "listServiceJobs",
      "listBoardJobs",
      "listAwaitingInvoice",
      "listDeletedServiceJobs",
    ];
    for (const n of names) {
      const start = svc.indexOf(`export const ${n} =`);
      const body = svc.slice(start, svc.indexOf("\nexport ", start + 1));
      expect(body, n).toContain(".select(LIST_JOB_COLUMNS");
      expect(body, n).not.toContain('.select("*")');
    }
    const one = svc.slice(
      svc.indexOf("export const getServiceJob ="),
      svc.indexOf("export const getServiceJob =") + 600,
    );
    expect(one).toContain('.select("*")');
    expect(svc).not.toContain("withPlaces");
  });
  it("the migration adds the columns, fills them, keeps them in step and adds the week index", () => {
    expect(migration).toContain("add column if not exists site_city text");
    expect(migration).toContain("add column if not exists site_state text");
    expect(migration).toContain("set site_city = s.city, site_state = s.state");
    expect(migration).toContain(
      "create trigger crm_sites_place_to_tickets after update of city, state on public.crm_sites",
    );
    expect(migration).toContain(
      "create index if not exists service_jobs_week_idx\n  on public.service_jobs (scheduled_date) where deleted_at is null and technician_id is not null;",
    );
    const types = readGeneratedTypes();
    expect(types).toContain("site_city: string | null;");
  });
});

describe("40. the Invoices tab badge is a count alone", () => {
  it("the tabs read countAwaitingInvoice under its own key; the queue page keeps the rows", () => {
    expect(tabs).toContain("useServerFn(countAwaitingInvoice)");
    expect(tabs).toContain("queryKey: AWAITING_INVOICE_COUNT_KEY,");
    expect(tabs).not.toContain("listAwaitingInvoice");
    expect(svc).toContain(
      'export const AWAITING_INVOICE_COUNT_KEY = ["service-jobs", "awaiting-invoice", "count"] as const;',
    );
    expect(invoices).toContain("useServerFn(listAwaitingInvoice)");
  });
});
