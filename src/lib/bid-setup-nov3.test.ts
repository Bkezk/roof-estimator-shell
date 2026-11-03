/**
 * Owner, Nov 3, on the estimator's Setup step:
 *  - "the job name really shouldn't search the customer list as it does now, only the customer
 *    name should do that" — Job Name is a plain box; Customer Name is the one customer search.
 *  - "and it should be required if not already" — it already was (owner, Oct 26); pinned here.
 *  - "we really don't need the client and job site tabs now that we have it integrated into the
 *    customers pages" — the Setup card is Bid Info alone; the bid's client and job-site fields
 *    are filled from the linked customer and site, replacing what was there (no "Replace?"
 *    question for fields nobody can see), and the proposal reads them from the bid as before.
 * Fails on the old code.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { bidCustomerProblem } from "@/lib/bid-status";

const page = readFileSync("src/routes/estimate.tsx", "utf8");
const setup = page.slice(
  page.indexOf('data-bid-step="setup"'),
  page.indexOf("<CardTitle>Defaults"),
);

describe("Job Name and Customer Name", () => {
  it("Job Name is a plain box that keeps the blank-title rule; it does not search customers", () => {
    const job = setup.slice(
      setup.indexOf('<Field label="Job Name">'),
      setup.indexOf('<Field label="Estimator\'s Name">'),
    );
    expect(job).toContain('id="bid-name"');
    expect(job).toContain("onChange={(e) => setBidName(e.target.value)}");
    expect(job).toContain('toast.error("Bid Title cannot be left blank.");');
    expect(job).not.toContain("AccountPicker");
    expect(job).not.toContain("pickAccount");
  });
  it("Customer Name is the one customer search on Setup, and a bid needs one to save", () => {
    expect(setup.match(/<AccountPicker/g)).toHaveLength(1);
    expect(setup).toMatch(
      /<Field label="Customer Name">[\s\S]{0,300}<AccountPicker[\s\S]{0,100}id="bid-customer"/,
    );
    expect(page).toContain("const customerProblem = bidCustomerProblem({");
    expect(bidCustomerProblem({ accountId: null, storedAccountId: null })).toBeTruthy();
    expect(bidCustomerProblem({ accountId: "a", storedAccountId: null })).toBeNull();
  });
});

describe("the Setup card without the Client and Job Site tabs", () => {
  it("is Bid Info alone: no tabs, no Client Information, no Copy Client Address", () => {
    expect(setup).toContain('data-panel="bid-info"');
    expect(setup).not.toContain("<Tabs");
    expect(setup).not.toContain("TabsTrigger");
    expect(setup).not.toContain("Client Information");
    expect(setup).not.toContain("Copy Client Address");
    expect(setup).not.toContain('<Field label="Ship Via">');
    expect(page).not.toContain('from "@/components/ui/tabs"');
  });
  it("a picked customer fills the bid's client and job-site fields from the profile, replacing; no Replace? question", () => {
    expect(page).toContain(
      "setCustomer((c) => applyProfileFill(c, profileFill(detail.account, site), true));",
    );
    expect(page).not.toContain("pendingFill");
    expect(page).not.toContain("Replace the client and job-site fields");
    expect(page).not.toContain("fillConflicts");
  });
  it("the proposal still reads the bid's client and job-site fields", () => {
    const proposal = readFileSync("src/lib/proposal-bid.ts", "utf8");
    for (const k of ["contact", "clientAddress", "projectAddress", "jobCityStZip", "jobNumber"])
      expect(proposal).toContain(k);
  });
});
