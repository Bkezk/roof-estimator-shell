/**
 * The Oct 9 ticket batch (owner approved):
 *   B1  the Awaiting invoice queue was always empty (it filtered Done, the server returned
 *       Authorized) — toInvoice keeps Authorized, the copy says so, the Owner tile's "Done"
 *       count links to the Done tickets;
 *   B2  a new ticket no longer assigns itself to its creator;
 *   B3  the Overdue chip is a toggle the list can switch on;
 *   B4  a failed background refetch keeps the ticket on screen;
 *   S7  the Done ticket's "Needs authorization" card leads the right column (two steps kept);
 *   S8  the Board's cell "+" is always visible; the Unassigned rail reads by day;
 *   S9  the Tickets list keeps its filters in the URL; Back returns where you came from;
 *   S10 a chip dropped on Prev / Next moves a week in one write, the stage stays Scheduled;
 *   and the property added from the ticket form (SiteSelect allowAdd, address prefilled).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { BUSINESS_HREFS, TO_INVOICE_STAGES } from "@/lib/owner-business";
import { AWAITING_INVOICE_TITLE } from "@/lib/invoice-search";
import { SERVICE_TYPES } from "@/lib/service.functions";
import {
  assignedStage,
  AWAITING_INVOICE_STAGE,
  shiftDays,
  sortUnassigned,
  toInvoice,
  waitingSince,
} from "@/lib/service-schedule";
import { parseServiceSearch, TICKET_FROM, TYPE_VALUES } from "@/lib/service-search";

const read = (p: string) => readFileSync(p, "utf8");
const page = read("src/components/service-page.tsx");
const board = read("src/components/service/board-page.tsx");
const invoices = read("src/components/service/invoices-page.tsx");
const block = read("src/components/service/invoice-block.tsx");
const svc = read("src/lib/service.functions.ts");

// ---------------------------------------------------------------------------------------------
describe("B1. the Awaiting invoice queue lists the Authorized tickets", () => {
  const rows = [
    {
      id: 1,
      stage: "authorized",
      completed_at: "2026-09-20T10:00:00Z",
      updated_at: "2026-09-26T00:00:00Z",
      stage_changed_at: "2026-09-25T00:00:00Z",
    },
    {
      id: 2,
      stage: "done",
      completed_at: "2026-09-01T10:00:00Z",
      updated_at: "2026-09-02T00:00:00Z",
      stage_changed_at: null,
    },
    {
      id: 3,
      stage: "authorized",
      completed_at: null,
      updated_at: "2026-09-10T00:00:00Z",
      stage_changed_at: null,
    },
    {
      id: 4,
      stage: "invoiced",
      completed_at: null,
      updated_at: "2026-09-10T00:00:00Z",
      stage_changed_at: null,
    },
  ];
  it("toInvoice keeps Authorized (not Done), longest waiting first", () => {
    expect(AWAITING_INVOICE_STAGE).toBe("authorized");
    expect(toInvoice(rows).map((r) => r.id)).toEqual([3, 1]);
    expect(
      toInvoice([{ stage: "done", completed_at: null, updated_at: "2026-09-10T00:00:00Z" }]),
    ).toEqual([]);
  });
  it("waitingSince: since the ticket entered the stage, else since the work was done", () => {
    expect(waitingSince(rows[0]!)).toBe("2026-09-25T00:00:00Z");
    expect(waitingSince(rows[2]!)).toBe("2026-09-10T00:00:00Z");
    expect(
      waitingSince({ stage: "authorized", completed_at: "2026-09-01T00:00:00Z", updated_at: "x" }),
    ).toBe("2026-09-01T00:00:00Z");
  });
  it("the server, the page filter and the copy agree on Authorized", () => {
    const fn = svc.slice(svc.indexOf("export const listAwaitingInvoice"));
    expect(fn.slice(0, 900)).toContain('.eq("stage", "authorized")');
    expect(invoices).toContain("toInvoiceRows(jobsQ.data?.rows ?? [])");
    expect(invoices).toContain(
      "Authorized tickets waiting for their invoice, longest waiting first.",
    );
    expect(invoices).toContain("Nothing waiting: every Authorized ticket has been invoiced.");
    expect(invoices).toContain('<th className="px-3 py-2 font-medium">Authorized</th>');
    expect(invoices).not.toContain('<th className="px-3 py-2 font-medium">Done</th>');
    expect(invoices).toContain("const since = waitingSince(j);");
    expect(AWAITING_INVOICE_TITLE).toBe("Tickets marked Authorized with no finalised invoice yet");
  });
  it("the Owner tile still counts Done tickets with no invoice, and now links to them", () => {
    expect([...TO_INVOICE_STAGES]).toEqual(["done"]);
    expect(BUSINESS_HREFS.toInvoice).toBe("/service?stage=done");
    expect(parseServiceSearch({ stage: "done" })).toEqual({ stage: "done" });
    // The query behind it reads open / scheduled / done rows only (owner-business.functions.ts).
    expect(read("src/lib/owner-business.functions.ts")).toContain(
      '.in("stage", ["open", "scheduled", "done"])',
    );
  });
});

describe("B2. a new ticket starts unassigned", () => {
  it("draftFrom takes no 'me'; the blank draft has no technician; the Board's prefill stays", () => {
    expect(page).toContain("const draftFrom = (job: ServiceJobWithTech | null): Draft =>");
    expect(page).not.toContain("meId");
    expect(page).not.toContain("profile?.technician ? profile.id : null");
    const blank = page.slice(page.indexOf("const draftFrom ="), page.indexOf("interface Seed"));
    expect(blank).toContain('technician_id: "",');
    expect(page).toContain("technician_id: prefill.tech ?? d.technician_id,");
    expect(page).toContain("scheduled_date: prefill.date ?? d.scheduled_date,");
  });
});

describe("B3. the Overdue chip is a toggle", () => {
  it("renders always, destructive with × when on, outline when off", () => {
    expect(page).not.toContain("{overdueOnly && (\n                  <Button");
    expect(page).toContain('variant={overdueOnly ? "destructive" : "outline"}');
    expect(page).toContain("aria-pressed={overdueOnly}");
    expect(page).toContain("onClick={() => setOverdueOnly(!overdueOnly)}");
    expect(page).toMatch(/\{overdueOnly && \(\s*<>\s*<X className="ml-1 h-3 w-3" aria-hidden \/>/);
  });
});

describe("B4. a failed background refetch keeps the ticket on screen", () => {
  const loader = page.slice(
    page.indexOf("function TicketLoader("),
    page.indexOf("function NewFromTicket("),
  );
  it("the error replaces the page only when there is no data; otherwise one inline line", () => {
    expect(loader).toMatch(/if \(!job\.data\) \{\s*if \(job\.error\)/);
    expect(loader).toContain('data-line="refresh-failed"');
    expect(loader).toContain("Could not refresh: {errText(job.error)}");
    expect(loader).toMatch(/\{stale\}\s*<TicketEditor key=\{job\.data\.id\} job=\{job\.data\} \/>/);
    expect(loader).toMatch(
      /\{stale\}\s*<CloseoutScreen key=\{job\.data\.id\} job=\{job\.data\} \/>/,
    );
    // The old shape: the error first, whatever is cached (the error branch now sits inside
    // `if (!job.data)`).
    expect(loader.indexOf("if (!job.data) {")).toBeLessThan(loader.indexOf("if (job.error)"));
    expect(loader).not.toMatch(/\n {2}if \(job\.error\)\n/);
  });
});

describe("S7. at Done the Needs authorization card leads the right column; two steps stay apart", () => {
  const aside = page.slice(page.indexOf('aria-label="Ticket sections"'), page.indexOf("</aside>"));
  it("InvoiceBlock first while Done, last otherwise", () => {
    const first = aside.indexOf('{jobStage === "done" && <InvoiceBlock job={job} />}');
    const last = aside.indexOf('{jobStage !== "done" && <InvoiceBlock job={job} />}');
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(aside.indexOf("<AerialSection"));
    expect(last).toBeGreaterThan(aside.indexOf("<TicketFieldSections"));
  });
  it("Mark authorized (AuthorizeCard) and Make the invoice (InvoiceCard) are separate buttons in separate cards", () => {
    expect(block).toContain(
      'if (job.stage === "done" && !job.invoice_id) return <AuthorizeCard job={job} />;',
    );
    const auth = block.slice(
      block.indexOf("function AuthorizeCard("),
      block.indexOf("function InvoiceCard("),
    );
    expect(auth).toContain("Mark authorized");
    expect(auth).not.toContain("Make the invoice");
    const card = block.slice(block.indexOf("function InvoiceCard("));
    expect(card).toContain("Make the invoice");
    expect(card).not.toContain("Mark authorized");
    expect(block).toContain("never one combined button");
  });
});

describe("S8. the Board: the cell + is always visible; the Unassigned rail reads by day", () => {
  it("no hover-only opacity on the +", () => {
    const plus = board.slice(
      board.indexOf("search={{ new: 1, tech: r.id, date: d }}"),
      board.indexOf('<Plus className="h-3.5 w-3.5" />'),
    );
    expect(plus).not.toContain("md:opacity-0");
    expect(plus).not.toContain("group-hover:opacity-100");
    expect(plus).toContain("h-6 w-6");
  });
  it("sortUnassigned: dated by day (overdue, today, later), undated last, oldest created first within a day", () => {
    const rows = [
      { id: "undated-new", scheduled_date: null, created_at: "2026-10-08T00:00:00Z" },
      { id: "later", scheduled_date: "2026-10-20", created_at: "2026-09-01T00:00:00Z" },
      { id: "today-b", scheduled_date: "2026-10-09", created_at: "2026-10-05T00:00:00Z" },
      { id: "undated-old", scheduled_date: null, created_at: "2026-09-15T00:00:00Z" },
      { id: "overdue", scheduled_date: "2026-10-01", created_at: "2026-10-07T00:00:00Z" },
      { id: "today-a", scheduled_date: "2026-10-09", created_at: "2026-10-02T00:00:00Z" },
    ];
    expect(sortUnassigned(rows).map((r) => r.id)).toEqual([
      "overdue",
      "today-a",
      "today-b",
      "later",
      "undated-old",
      "undated-new",
    ]);
    expect(rows[0]!.id).toBe("undated-new"); // the input is not reordered
    expect(sortUnassigned([])).toEqual([]);
  });
  it("the rail renders the sorted rows and no longer sorts by created_at alone", () => {
    expect(board).toContain("const rail = sortUnassigned(unassigned);");
    expect(board).toContain("rail.map((j) => (");
    expect(board).not.toContain(".sort((a, b) => a.created_at.localeCompare(b.created_at));");
  });
});

describe("S9. the list's filters live in the URL; Back returns where you came from", () => {
  it("parseServiceSearch round-trips the list's filters and drops defaults and junk", () => {
    expect([...TYPE_VALUES]).toEqual([...SERVICE_TYPES]);
    const full = {
      stage: "scheduled" as const,
      overdue: 1 as const,
      q: "gym",
      tech: "unassigned",
      type: "leak" as const,
    };
    expect(parseServiceSearch(full)).toEqual(full);
    expect(parseServiceSearch({ q: "  bell  ", tech: "all", type: "bogus" })).toEqual({
      q: "bell",
    });
    expect(parseServiceSearch({ q: "", tech: "", type: "" })).toEqual({});
    expect(parseServiceSearch({ q: 5, tech: 7 })).toEqual({});
    expect(parseServiceSearch({ q: "x".repeat(300) })).toEqual({ q: "x".repeat(200) });
    // A new ticket and a ticket ignore the list's filters.
    expect(parseServiceSearch({ new: 1, q: "a", type: "leak" })).toEqual({ new: 1 });
    expect(parseServiceSearch({ id: "x", q: "a", type: "leak" })).toEqual({ id: "x" });
  });
  it("a ticket carries where it was opened from, and the Board's week only with from=board", () => {
    expect([...TICKET_FROM]).toEqual(["board", "invoices"]);
    expect(parseServiceSearch({ id: "x", from: "board", week: "2026-10-05" })).toEqual({
      id: "x",
      from: "board",
      week: "2026-10-05",
    });
    expect(parseServiceSearch({ id: "x", from: "invoices", week: "2026-10-05" })).toEqual({
      id: "x",
      from: "invoices",
    });
    expect(parseServiceSearch({ id: "x", from: "board", week: "Oct 5" })).toEqual({
      id: "x",
      from: "board",
    });
    expect(parseServiceSearch({ id: "x", from: "elsewhere" })).toEqual({ id: "x" });
    expect(parseServiceSearch({ id: "x", closeout: 1, from: "board" })).toEqual({
      id: "x",
      closeout: 1,
      from: "board",
    });
  });
  it("the route hands the list its q, tech and type; the list is no longer keyed on the presets", () => {
    const route = read("src/routes/service.tsx");
    for (const line of ["q={search.q}", "tech={search.tech}", "type={search.type}"])
      expect(route).toContain(line);
    expect(page).not.toContain('key={`${stage ?? ""}|${overdue ? 1 : 0}`}');
    expect(page).toContain("function ServiceList({ filters }: { filters: ListFilters })");
  });
  it("the list writes every filter change into the URL in place; the search box a moment later", () => {
    const list = page.slice(
      page.indexOf("function ServiceList("),
      page.indexOf("function TicketListRow("),
    );
    expect(list).toContain('void navigate({ to: "/service", search: next, replace: true });');
    expect(list).toContain('const stageFilter: StageFilter = filters.stage ?? "all";');
    expect(list).toContain('const typeFilter: TypeFilter = filters.type ?? "all";');
    expect(list).toContain("const techFilter: TechFilter = filters.tech ?? TECH_ALL;");
    expect(list).toContain("const overdueOnly = filters.overdue === 1;");
    expect(list).toContain("}, SEARCH_URL_DELAY_MS);");
    expect(page).toContain("const SEARCH_URL_DELAY_MS = 300;");
    // Clear filters empties the URL too.
    expect(list).toMatch(/const clearFilters = \(\) => \{[\s\S]*?writeFilters\(\{\}\);/);
    // No local filter state left behind.
    expect(list).not.toContain("useState<StageFilter>");
    expect(list).not.toContain("useState<TypeFilter>");
    expect(list).not.toContain("useState<TechFilter>");
  });
  it("BackToList honours from=board (with its week) and from=invoices", () => {
    const back = page.slice(
      page.indexOf("function BackToList("),
      page.indexOf("interface Draft {"),
    );
    expect(back).toMatch(
      /from === "board" \? \(\s*<Link to="\/service\/board" search=\{week \? \{ week \} : \{\}\}>/,
    );
    expect(back).toContain("Tech Board");
    expect(back).toMatch(
      /from === "invoices" \? \(\s*<Link to="\/service\/invoices" search=\{\{ tab: "to-invoice" \}\}>/,
    );
    expect(back).toContain("Awaiting invoice");
    expect(back).toMatch(
      /<Link to="\/service" search=\{\{\}\}>\s*<ArrowLeft className="mr-1 h-4 w-4" \/> Tickets/,
    );
  });
  it("the Board's chips and the Awaiting queue's rows link with from", () => {
    expect(board).toContain('search={{ id: j.id, from: "board", week: props.week }}');
    expect(board.match(/week=\{(days|props\.days)\[0\]!\}/g)?.length).toBe(2);
    expect(invoices).toContain('search={{ id: j.id, from: "invoices" }}');
    expect(invoices).toContain(
      'void navigate({ to: "/service", search: { id: serviceJobId, from: "invoices" } });',
    );
  });
});

describe("S10. cross-week reschedule in one drag", () => {
  it("shiftDays: ±7 across month and year ends, no time zone", () => {
    expect(shiftDays("2026-10-05", 7)).toBe("2026-10-12");
    expect(shiftDays("2026-10-05", -7)).toBe("2026-09-28");
    expect(shiftDays("2026-12-29", 7)).toBe("2027-01-05");
    expect(shiftDays("2026-03-01", -7)).toBe("2026-02-22");
  });
  it("assignedStage: a date-only move of a Scheduled ticket stays Scheduled; Open ↔ Scheduled; later stages untouched", () => {
    expect(assignedStage("scheduled", "t1", "2026-10-12")).toBe("scheduled");
    expect(assignedStage("scheduled", "t1", "2026-10-19")).toBe("scheduled");
    expect(assignedStage("open", "t1", "2026-10-12")).toBe("scheduled");
    expect(assignedStage("scheduled", null, "2026-10-12")).toBe("open");
    expect(assignedStage("scheduled", "t1", null)).toBe("open");
    for (const s of ["done", "authorized", "invoiced", "closed"])
      expect(assignedStage(s, "t1", "2026-10-12")).toBe(s);
  });
  it("assignServiceJob uses it, in a single update, and the Board's optimistic view agrees", () => {
    const fn = svc.slice(
      svc.indexOf("export const assignServiceJob"),
      svc.indexOf("export const claimServiceJob"),
    );
    expect(fn).toContain(
      "const stage = assignedStage(cur.stage, data.technician_id, data.scheduled_date);",
    );
    expect(fn.match(/\.update\(/g)?.length).toBe(1);
    expect(fn).not.toMatch(/cur\.stage === "open" \|\| cur\.stage === "scheduled"\s*\?/);
    expect(board).toContain("assignedStage(j.stage, tech, date);");
  });
  it("Prev / Next take a drop: same technician, the date ±7 days, through the same assign mutation", () => {
    expect(board).toMatch(
      /const dropWeek = \(e: DragEvent, weeks: -1 \| 1\) => \{[\s\S]*?if \(!dispatch\) return;[\s\S]*?if \(!job \|\| !movable\(job\) \|\| !job\.technician_id \|\| !job\.scheduled_date\) return;[\s\S]*?scheduled_date: shiftDays\(job\.scheduled_date, weeks \* 7\),/,
    );
    expect(board).toMatch(
      /aria-label="Previous week"[\s\S]*?onDragOver=\{\(e\) => allowDrop\(e, "prev-week"\)\}[\s\S]*?onDrop=\{\(e\) => dropWeek\(e, -1\)\}/,
    );
    expect(board).toMatch(
      /aria-label="Next week"[\s\S]*?onDragOver=\{\(e\) => allowDrop\(e, "next-week"\)\}[\s\S]*?onDrop=\{\(e\) => dropWeek\(e, 1\)\}/,
    );
    expect(board).toContain('className={weekDropClass("prev-week")}');
    expect(board).toContain('className={weekDropClass("next-week")}');
  });
});

describe("the property added from the ticket form (owner, Oct 9)", () => {
  it("the ticket's property box allows Add property", () => {
    const cb = page.slice(
      page.indexOf("function CustomerBlock("),
      page.indexOf("function BillingNote("),
    );
    expect(cb).toMatch(
      /<SiteSelect\s+id="ticket-site"[\s\S]*?required[\s\S]*?allowAdd[\s\S]*?invalid=\{!!props\.siteMessage\}/,
    );
    expect(cb).toContain("go with the property added from ticket form add");
  });
  it("SiteSelect prefills the new property's address from the customer's and makes the button prominent", () => {
    const sel = read("src/components/crm/site-select.tsx");
    expect(sel).toMatch(
      /const prefill: SiteAddressPrefill \| undefined =\s*account && \(account\.address1 \|\| account\.city \|\| account\.zip\)/,
    );
    expect(sel).toContain("prefill={prefill}");
    expect(sel).toMatch(
      /<Button\s+type="button"\s+size="sm"\s+disabled=\{props\.disabled\}\s+onClick=\{\(\) => setAdding\(true\)\}\s*>/,
    );

    expect(sel).not.toMatch(/variant="outline"[\s\S]{0,200}Add property/);
    const form = read("src/components/crm/site-form.tsx");
    expect(form).toContain("prefill?: SiteAddressPrefill | undefined;");
    expect(form).toContain("useState<SiteFields>(() => siteFields(props.site, props.prefill));");
    expect(form).toContain('address1: s?.address1 ?? prefill?.address1 ?? "",');
    expect(form).toContain('state: s ? (s.state ?? "") : prefill?.state || "KY",');
  });
  it("the quick-add's Sep 30 note is reversed", () => {
    const picker = read("src/components/crm/account-picker.tsx");
    expect(picker).not.toContain("owner, Sep 30: its sites are added on the account");
    expect(picker).toContain("go with the property added from ticket form add");
    expect(picker).toContain("not typed twice");
  });
});
