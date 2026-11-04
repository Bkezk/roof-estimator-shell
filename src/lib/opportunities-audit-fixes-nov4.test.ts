/**
 * The Opportunities audit's six findings (docs/qa/opportunities-audit-2026-11-04.md; owner:
 * "fix all please"):
 *  1. Save refreshes the timeline too (an expected-close move is logged as a note).
 *  2. The header's tags line is a div on the opportunity and the ticket page (the badges are
 *     divs; a p logged React's hydration warning).
 *  3. Global search says "Lost" / "Won" / "Paid", not the stored key.
 *  4. "From opportunity: …" shows on the bid as soon as the first save links it.
 *  5. The write rule on the page: a user without Customers access may only assign to
 *     themselves (assigneeChoices), and an opportunity that is not theirs opens read-only with a
 *     line saying so; the follow-up read policy admits Estimate access (migration
 *     20261104200000), so their list shows holds and next reminders like the office's.
 *  6. The page's header comment says the deleted view's status select is disabled, not gone.
 * Fails on the old code.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { searchStatusLabel } from "@/lib/global-search";
import {
  ASSIGNEE_ONLY_SELF,
  assigneeChoices,
  mayWriteOpportunity,
  OPP_READ_ONLY,
} from "@/lib/opportunity-form";

const read = (p: string) => readFileSync(p, "utf8");
const page = read("src/components/opportunities-page.tsx");
const ticket = read("src/components/service-page.tsx");

describe("1. Save refreshes the timeline", () => {
  it("the page's invalidate covers the contact log", () => {
    const inv = page.slice(page.indexOf("const invalidate = (id: string) =>"));
    expect(inv.slice(0, 600)).toContain(
      'void qc.invalidateQueries({ queryKey: ["contact-log", "opportunity", id] });',
    );
  });
});

describe("2. the tags line is a div, both pages", () => {
  const line =
    /<div\s+className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground"\s+data-line="tags"\s*>/;
  it("opportunity", () => {
    expect(page).toMatch(line);
    expect(page).not.toMatch(/<p[^>]*data-line="tags"/);
  });
  it("ticket", () => {
    expect(ticket).toMatch(line);
    expect(ticket).not.toMatch(/<p[^>]*data-line="tags"/);
  });
});

describe("3. global search status labels", () => {
  it("opportunities, bids and invoices in words; an unknown key as it is; blank stays blank", () => {
    expect(searchStatusLabel("opportunity", "lost")).toBe("Lost");
    expect(searchStatusLabel("opportunity", "no_response")).toBe("No response");
    expect(searchStatusLabel("bid", "won")).toBe("Won");
    expect(searchStatusLabel("bid", "submitted")).toBe("Submitted");
    expect(searchStatusLabel("invoice", "paid")).toBe("Paid");
    expect(searchStatusLabel("opportunity", "odd")).toBe("odd");
    expect(searchStatusLabel("bid", "")).toBe("");
  });
  it("the server uses it for the three kinds", () => {
    const fns = read("src/lib/global-search.functions.ts");
    expect(fns).toContain('searchStatusLabel("opportunity", s(r["status"]))');
    expect(fns).toContain('searchStatusLabel("bid", s(r["status"]))');
    expect(fns).toContain('searchStatusLabel("invoice", s(r["status"]))');
    expect(fns).not.toContain('joinParts(nameOf(r), s(r["status"]))');
  });
});

describe("4. From opportunity shows after the first save", () => {
  it("the estimator keeps the id it linked until the row carries it", () => {
    const est = read("src/routes/estimate.tsx");
    expect(est).toContain("const fromOpportunityId = loadedBid?.opportunity_id ?? linkedOppId;");
    expect(est).toMatch(
      /linkBidFn\(\{ data: \{ opportunityId, bidId: newBidId \} \}\)\s*\.then\(\(\) => \{[\s\S]*?setLinkedOppId\(opportunityId\);/,
    );
  });
});

describe("5. the write rule on the page", () => {
  const ME = "me-1";
  const options = [
    { id: "a-1", name: "Ann" },
    { id: ME, name: "Me" },
    { id: "b-2", name: "Bob" },
  ];
  it("assigneeChoices: Customers access offers everyone; without it, me (and the current assignee)", () => {
    expect(assigneeChoices(options, { me: ME, mayAssignOthers: true })).toEqual(options);
    expect(assigneeChoices(options, { me: ME, mayAssignOthers: false })).toEqual([options[1]]);
    expect(
      assigneeChoices(options, { me: ME, mayAssignOthers: false, current: "b-2" }).map((o) => o.id),
    ).toEqual([ME, "b-2"]);
    expect(assigneeChoices(options, { me: null, mayAssignOthers: false })).toEqual([]);
  });
  it("mayWriteOpportunity: a new one always; a saved one with Customers access, or as its assignee", () => {
    expect(mayWriteOpportunity({ id: ME, hasCustomers: false }, null)).toBe(true);
    expect(mayWriteOpportunity({ id: ME, hasCustomers: true }, { assignee_id: "b-2" })).toBe(true);
    expect(mayWriteOpportunity({ id: ME, hasCustomers: false }, { assignee_id: ME })).toBe(true);
    expect(mayWriteOpportunity({ id: ME, hasCustomers: false }, { assignee_id: "b-2" })).toBe(
      false,
    );
    expect(mayWriteOpportunity({ id: ME, hasCustomers: false }, { assignee_id: null })).toBe(false);
  });
  it("the page: read-only fieldset, status select and Save; the line; the box's hint", () => {
    expect(page).toContain('const hasCustomers = canAccess(profile, "customers");');
    expect(page).toContain(
      "const mayWrite = mayWriteOpportunity({ id: profile?.id, hasCustomers }, opp);",
    );
    expect(page).toContain("const readOnly = deleted || !mayWrite;");
    expect(page).toContain("disabled={readOnly}");
    expect(page).toContain("disabled={statusMut.isPending || readOnly}");
    expect(page).toContain("if (!readOnly) submit();");
    expect(page).toMatch(/data-banner="read-only"[\s\S]{0,120}\{OPP_READ_ONLY\}/);
    expect(page).toMatch(/data-hint="assignee-self"[\s\S]{0,60}\{ASSIGNEE_ONLY_SELF\}/);
    expect(page).toMatch(
      /return assigneeChoices\(all, \{\s*me: profile\?\.id,\s*mayAssignOthers: hasCustomers,\s*current: opp\?\.assignee_id,\s*\}\);/,
    );
    expect(ASSIGNEE_ONLY_SELF).toBe("Without Customers access you can only assign it to yourself.");
    expect(OPP_READ_ONLY).toBe(
      "Only Customers access or the assignee can change this opportunity.",
    );
  });
  it("the follow-up read policy admits Estimate access (the migration, applied live Nov 4)", () => {
    const sql = read("supabase/migrations/20261104200000_followups_read_estimate.sql").replace(
      /\s+/g,
      " ",
    );
    expect(sql).toContain("drop policy if exists crm_followups_read on public.crm_followups;");
    expect(sql).toContain(
      "create policy crm_followups_read on public.crm_followups for select to authenticated using (public.has_access('customers') or public.has_access('estimate') or assignee_id = auth.uid());",
    );
  });
});

describe("6. the header comment", () => {
  it("says the deleted view's status select is disabled", () => {
    expect(page).toContain("the form and the status select are disabled");
    expect(page).not.toContain("the status select, Start a bid, Delete, the follow-up strip");
  });
});
