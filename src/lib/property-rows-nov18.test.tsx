// @vitest-environment node
/**
 * More detail on a property's page (owner, Nov 18, with a picture of it: "can you include more
 * detail on the tickets and bids and opps here on the property?"). He chose a second, smaller
 * line on each row, and for tickets "type, technician, dates" and "what was found and done".
 *
 *  words    lib/property-rows.ts.
 *  server   getProperty: the technician's name, the repairs, the opportunity's and bid's facts.
 *  screens  crm/ticket-rows.tsx, the Opportunities section, the property's Bids.
 */
import { readFileSync } from "node:fs";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, className, ...rest }: { children: ReactNode; className?: string }) => (
    <a className={className} data-ticket-row={(rest as Record<string, string>)["data-ticket-row"]}>
      {children}
    </a>
  ),
}));

import { getProperty } from "@/lib/crm.functions";
import {
  bidFacts,
  NOBODY_ASSIGNED,
  opportunityDates,
  opportunityFacts,
  partsText,
  rowDay,
  ticketFacts,
  ticketWork,
} from "@/lib/property-rows";
import { fakeSupabase } from "@/test/fake-supabase";
import { TicketRows } from "@/components/crm/ticket-rows";

type Row = Record<string, unknown>;
const read = (p: string) => readFileSync(p, "utf8");
const flat = (s: string) => s.replace(/\s+/g, " ");
const TODAY = new Date(2026, 10, 18, 12);

describe("a day on a row", () => {
  it("this year without the year, another year with it", () => {
    expect(rowDay("2026-10-23", TODAY)).toBe("Oct 23");
    expect(rowDay("2025-10-23", TODAY)).toBe("Oct 23, 2025");
  });
  it("a plain day is that day, wherever the reader is", () => {
    expect(rowDay("2026-01-01", TODAY)).toBe("Jan 1");
  });
  it("nothing for nothing, or for a value that is not a day", () => {
    expect(rowDay(null, TODAY)).toBe("");
    expect(rowDay("", TODAY)).toBe("");
    expect(rowDay("soon", TODAY)).toBe("");
  });
});

describe("a ticket's second line", () => {
  it("what kind, who, and the day it was done", () => {
    expect(
      ticketFacts(
        { service_type: "repair", completed_at: "2026-10-23T15:00:00Z" },
        "Tyler Mitchell",
        TODAY,
      ),
    ).toBe("Repair · Tyler Mitchell · done Oct 23");
  });
  it("not done yet: no day. Nobody on it: said", () => {
    expect(ticketFacts({ service_type: "inspection", completed_at: null }, null, TODAY)).toBe(
      `Inspection · ${NOBODY_ASSIGNED}`,
    );
    expect(ticketFacts({ service_type: "warranty" }, "  ", TODAY)).toBe(
      "Warranty · Nobody assigned",
    );
  });
  it("carries no money", () => {
    const line = ticketFacts({ service_type: "repair", completed_at: null }, "Ty Tech", TODAY);
    expect(line).not.toMatch(/\$|invoice/i);
  });
});

const inspection = (flagged: string[]) => ({
  v: 1,
  items: [
    { id: "a", label: "Membrane condition", status: flagged.includes("a") ? "issue" : "ok" },
    { id: "b", label: "Seams", status: flagged.includes("b") ? "issue" : "ok" },
    { id: "c", label: "Drains", status: null },
  ],
});

describe("what was found and done", () => {
  it("an inspection: what it flagged, and what the office chose after it", () => {
    expect(
      ticketWork({
        service_type: "inspection",
        inspection: inspection(["a", "b"]),
        inspection_outcome: "repair_ticket",
      }),
    ).toEqual([
      { label: "Found", text: "Membrane condition, Seams" },
      { label: "Outcome", text: "Repair ticket" },
    ]);
  });
  it("an inspection that flagged nothing says so", () => {
    expect(
      ticketWork({
        service_type: "inspection",
        inspection: inspection([]),
        inspection_outcome: "none",
      }),
    ).toEqual([
      { label: "Found", text: "no issues" },
      { label: "Outcome", text: "No action needed" },
    ]);
  });
  it("a repair: what was done, repair by repair, else the repair's name; then the closing notes", () => {
    const parts = ticketWork(
      { service_type: "repair", closing_notes: "\nCustomer wants a quote on the north wing\nmore" },
      [
        { name: "Curb flashing", resolution_text: "Resealed the curb" },
        { name: "Drain replacement", resolution_text: "  " },
        { name: null, resolution_text: null },
      ],
    );
    expect(parts).toEqual([
      { label: "Repairs", text: "Resealed the curb; Drain replacement" },
      { label: "Notes", text: "Customer wants a quote on the north wing" },
    ]);
    expect(partsText(parts)).toBe(
      "Repairs: Resealed the curb; Drain replacement · Notes: Customer wants a quote on the north wing",
    );
  });
  it("nothing to say: no parts, so no third line", () => {
    expect(ticketWork({ service_type: "repair", closing_notes: "  " })).toEqual([]);
    // A repair ticket's saved checklist, if it has one, is not an inspection's finding.
    expect(ticketWork({ service_type: "repair", inspection: inspection(["a"]) })).toEqual([]);
  });
  it("a long note is cut", () => {
    const [notes] = ticketWork({ service_type: "repair", closing_notes: "x".repeat(400) });
    expect(notes!.text.length).toBe(200);
    expect(notes!.text.endsWith("…")).toBe(true);
  });
});

describe("an opportunity's two lines", () => {
  const o = {
    est_value: 18000,
    lead_source: "referral",
    assignee_name: "Mark Barger",
    expected_close: "2026-12-05",
    contacted_at: "2026-11-12T15:00:00Z",
    referred_by: "Tyler Mitchell",
  };
  it("what it is worth, where it came from, who follows it up", () => {
    expect(opportunityFacts(o)).toBe("$18,000 · Referral · Mark Barger");
  });
  it("no value and no source: only who, or Unassigned", () => {
    expect(opportunityFacts({ est_value: 0, lead_source: null, assignee_name: null })).toBe(
      "Unassigned",
    );
    expect(opportunityFacts({ est_value: null, lead_source: " ", assignee_name: "Mo" })).toBe("Mo");
  });
  it("its dates and the credit", () => {
    expect(opportunityDates(o, TODAY)).toBe(
      "expected close Dec 5 · last contact Nov 12 · brought in by Tyler Mitchell",
    );
    expect(opportunityDates({ expected_close: null, contacted_at: null }, TODAY)).toBe(
      "not contacted yet",
    );
  });
});

describe("a bid's second line", () => {
  it("a project bid: when it is due and whose it is", () => {
    expect(
      bidFacts({ kind: "roof", due_date: "2026-11-30", estimator_name: "Braden Keck" }, TODAY),
    ).toBe("Project bid · due Nov 30 · by Braden Keck");
  });
  it("a trade bid carries its number; with no estimator, whoever saved it last", () => {
    expect(
      bidFacts(
        { kind: "trade", trade_number: 1001, estimator_name: "", updated_by_name: "Mark Barger" },
        TODAY,
      ),
    ).toBe("Trade bid T-1001 · by Mark Barger");
  });
  it("when it went out, or when it was won", () => {
    expect(bidFacts({ kind: "roof", submitted_at: "2026-11-02T12:00:00Z" }, TODAY)).toBe(
      "Project bid · submitted Nov 2",
    );
    expect(
      bidFacts({ kind: "roof", submitted_at: "2026-11-02T12:00:00Z", won_on: "2026-11-09" }, TODAY),
    ).toBe("Project bid · won Nov 9");
  });
  it("an old bid with nothing else is still named", () => {
    expect(bidFacts({}, TODAY)).toBe("Project bid");
  });
});

// ── The read ───────────────────────────────────────────────────────────────────────────────

const OFFICE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TECH = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const ACC = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const S1 = "11111111-1111-4111-8111-111111111111";
const office = {
  id: OFFICE,
  role: "user",
  access: ["customers", "service", "estimate"],
  technician: false,
  full_name: "Pat Office",
  email: "pat@example.com",
};
const tech = { ...office, id: TECH, access: ["service"], technician: true, full_name: "Ty Tech" };
let env: ReturnType<typeof fakeSupabase>;
beforeEach(() => {
  // (The stand-in answers crm_user_options with every profile's name.)
  env = fakeSupabase({
    profiles: [office, tech],
    crm_accounts: [{ id: ACC, name: "Acme Roofing", deleted_at: null }],
    crm_sites: [{ id: S1, account_id: ACC, name: "Main St", deleted_at: null }],
    service_jobs: [
      {
        id: "j1",
        number: 7001,
        account_id: ACC,
        site_id: S1,
        stage: "closed",
        service_type: "repair",
        technician_id: TECH,
        completed_at: "2026-10-23T15:00:00Z",
        closing_notes: "All dry",
        deleted_at: null,
        updated_at: "2026-10-24T10:00:00.000Z",
      },
      {
        id: "j2",
        number: 7002,
        account_id: ACC,
        site_id: S1,
        stage: "open",
        service_type: "inspection",
        technician_id: null,
        deleted_at: null,
        updated_at: "2026-10-20T10:00:00.000Z",
      },
    ],
    service_job_repairs: [
      { id: "r2", service_job_id: "j1", name: "Drain", resolution_text: "Cleared it", sort: 2 },
      { id: "r1", service_job_id: "j1", name: "Curb", resolution_text: "Resealed it", sort: 1 },
      { id: "r9", service_job_id: "elsewhere", name: "Other", resolution_text: "No", sort: 1 },
    ],
    tasks: [],
    crm_opportunities: [
      {
        id: "o1",
        account_id: ACC,
        site_id: S1,
        title: "Coating",
        status: "contacted",
        assignee_id: OFFICE,
        expected_close: "2026-12-05",
        bid_id: null,
        deleted_at: null,
        updated_at: "2026-11-10T10:00:00.000Z",
        est_value: 18000,
        lead_source: "Referral",
        contacted_at: "2026-11-12T15:00:00Z",
        referred_by: "Ty Tech",
      },
    ],
    bids: [
      {
        id: "b1",
        name: "Reroof",
        kind: "trade",
        status: "draft",
        grand_total: 100,
        account_id: ACC,
        site_id: S1,
        deleted_at: null,
        updated_at: "2026-11-09T10:00:00.000Z",
        trade_number: 1001,
        due_date: "2026-11-30",
        updated_by_name: "Pat Office",
      },
    ],
  });
});
type Detail = Awaited<ReturnType<typeof getProperty>>;
const load = () =>
  (getProperty as unknown as (a: { data: Row; context: unknown }) => Promise<Detail>)({
    data: { id: S1 },
    context: { supabase: env.db, userId: OFFICE },
  });

describe("what the property's page is handed", () => {
  it("each ticket's technician by name, and its repairs in their order", async () => {
    const d = await load();
    expect(d.job_extras["j1"]).toEqual({
      technician_name: "Ty Tech",
      repairs: [
        { name: "Curb", resolution_text: "Resealed it" },
        { name: "Drain", resolution_text: "Cleared it" },
      ],
    });
    expect(d.job_extras["j2"]).toEqual({ technician_name: null, repairs: [] });
    expect(Object.keys(d.job_extras).sort()).toEqual(["j1", "j2"]);
  });
  it("the opportunity's value, source, last contact and credit; the bid's number, due day and who", async () => {
    const d = await load();
    expect(opportunityFacts(d.opportunities[0]!)).toBe("$18,000 · Referral · Pat Office");
    expect(opportunityDates(d.opportunities[0]!, TODAY)).toBe(
      "expected close Dec 5 · last contact Nov 12 · brought in by Ty Tech",
    );
    expect(bidFacts(d.bids[0]!, TODAY)).toBe("Trade bid T-1001 · due Nov 30 · by Pat Office");
  });
  it("asks for those columns, and for the people's names once", () => {
    const fn = flat(read("src/lib/crm.functions.ts"));
    const body = fn.slice(fn.indexOf("export const getProperty ="));
    expect(body).toContain("est_value, lead_source, contacted_at, referred_by");
    expect(body).toContain(
      "trade_number, due_date, updated_by_name, submitted_at, won_on, estimator_name:data->customer->>estimatorName",
    );
    expect(body).toContain('.from("service_job_repairs")');
    expect(body).toContain("accountOpportunities(sb, oppRows ?? [], names)");
    expect(body.split("peopleNames(sb)").length - 1).toBe(1);
  });
});

// ── The rows ───────────────────────────────────────────────────────────────────────────────

const jobRow = {
  id: "j1",
  number: 7001,
  stage: "closed",
  site_name: "Main St",
  description: "Leak over the gym",
  scheduled_date: "2026-10-22",
  updated_at: "2026-10-24T10:00:00.000Z",
  service_type: "repair",
  completed_at: "2026-10-23T15:00:00Z",
  inspection: null,
  inspection_outcome: null,
  closing_notes: "All dry",
};

describe("the ticket rows", () => {
  it("with the detail: a second line, then what was done, under the same first line", () => {
    const html = renderToString(
      <TicketRows
        jobs={[jobRow]}
        showSite={false}
        extras={{
          j1: {
            technician_name: "Ty Tech",
            repairs: [{ name: "Curb", resolution_text: "Resealed it" }],
          },
        }}
      />,
    );
    expect(html).toContain("#<!-- -->7001");
    expect(html).toContain("Leak over the gym");
    expect(html).toMatch(/data-row-facts="true">Repair · Ty Tech · done Oct 23(, 2026)?</);
    expect(html).toContain("data-row-work");
    expect(html).toContain("Resealed it");
    expect(html).toContain("All dry");
    expect(html).toContain("line-clamp-2");
    expect(html).not.toMatch(/\$\d/);
  });
  it("a ticket with nothing found or done has the second line and no third", () => {
    const html = renderToString(
      <TicketRows
        jobs={[{ ...jobRow, closing_notes: null, completed_at: null }]}
        showSite={false}
        extras={{}}
      />,
    );
    expect(html).toContain("Repair · Nobody assigned");
    expect(html).not.toContain("data-row-work");
  });
  it("without it, on the customer's page, a row is one line as before", () => {
    const html = renderToString(<TicketRows jobs={[jobRow]} />);
    expect(html).not.toContain("data-row-facts");
    expect(html).not.toContain("data-row-work");
    expect(html).toContain("Main St · ");
    const customers = flat(read("src/components/customers-page.tsx"));
    expect(customers).not.toMatch(/<TicketRows[^>]*extras=/);
  });
});

describe("the property's page", () => {
  const page = flat(read("src/components/property-page.tsx"));
  const customers = flat(read("src/components/customers-page.tsx"));
  it("asks for the detail on all three lists", () => {
    expect(page).toContain("<TicketRows jobs={jobs} showSite={false} extras={extras ?? {}} />");
    expect(page).toContain(
      '<OpportunitiesSection opportunities={d.opportunities} page="property" emptyText="No opportunities at this property." detail />',
    );
    expect(page).toContain("{bidFacts(b)}");
  });
  it("an opportunity's row there has two lines of detail, and says who once", () => {
    expect(customers).toContain("{opportunityFacts(o)}");
    expect(customers).toContain("{opportunityDates(o)}");
    expect(customers).toContain("{!detail && (");
    expect(customers).toContain("detail = false,");
  });
});
