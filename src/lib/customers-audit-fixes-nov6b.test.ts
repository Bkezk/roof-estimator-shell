/**
 * Customers audit, Nov 6, second pass (docs/qa/customers-audit-2026-11-06.md; owner: "fix all
 * three please"):
 * 8. a bid is moved to another customer, never unlinked (the estimator refuses to save a bid
 *    without a customer, owner Oct 26);
 * 9. the New takeoff dialog does not double the name when the property is named after the
 *    customer;
 * 10. the estimator's customer chip says when the customer was deleted.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { bidDataForCustomer } from "@/lib/bid-account-link";
import { BID_CUSTOMER_REQUIRED } from "@/lib/bid-status";
import type { CustomerInfo } from "@/lib/proposal-bid";
import { customerLabel, suggestionLabel } from "@/lib/takeoff/address-suggest";

const read = (p: string) => readFileSync(p, "utf8");
const page = read("src/components/customers-page.tsx");
const server = read("src/lib/crm.functions.ts");

describe("8. a bid is moved, never unlinked", () => {
  const section = page.slice(
    page.indexOf("function BidsSection("),
    page.indexOf("function DocumentsSection("),
  );
  it("the row's button opens Move to another customer; nothing sends account_id null", () => {
    expect(section).toContain('data-action="move-bid"');
    expect(section).toContain("aria-label={`Move ${b.name} to another customer`}");
    expect(section).toContain('id="move-bid-to"');
    expect(section).toContain("Every bid belongs to a customer");
    expect(section).not.toContain("accountId: null");
    expect(section).not.toContain("Unlink this bid");
    expect(section).not.toContain("Unlinked “");
  });
  it("the move names the customer it went to, and refreshes both customers' pages", () => {
    expect(section).toContain("toName: hit.account_name,");
    expect(section).toContain("`Moved “${v.bid.name}” to ${v.toName}`");
    expect(section).toContain('void qc.invalidateQueries({ queryKey: ["account"] });');
    // Picking the same customer again is a no-op, not a move.
    expect(section).toContain("if (hit && hit.account_id !== accountId)");
  });
  it("the server refuses to unlink, in the estimator's own words, before any write", () => {
    const fn = server.slice(
      server.indexOf("export const linkBidToAccount"),
      server.indexOf("export const listUnlinkedBids"),
    );
    expect(fn).toContain("if (!data.account_id) throw new Error(BID_CUSTOMER_REQUIRED);");
    expect(fn.indexOf("BID_CUSTOMER_REQUIRED")).toBeLessThan(fn.indexOf('.from("bids")'));
    expect(server).toContain('import { BID_CUSTOMER_REQUIRED } from "@/lib/bid-status";');
    expect(BID_CUSTOMER_REQUIRED).toMatch(/^Pick the customer before saving/);
  });
});

describe("9. the takeoff's customer label", () => {
  it("names the property only when it is not the customer's own name", () => {
    expect(customerLabel("Acme Foods", "Plant 2")).toBe("Acme Foods — Plant 2");
    expect(customerLabel("ZZ Linktest Claude", "ZZ Linktest Claude")).toBe("ZZ Linktest Claude");
    expect(customerLabel("Acme Foods", " acme foods ")).toBe("Acme Foods");
    expect(customerLabel("Acme Foods", null)).toBe("Acme Foods");
    expect(customerLabel("Acme Foods", "")).toBe("Acme Foods");
    expect(customerLabel(" Acme Foods ", undefined)).toBe("Acme Foods");
  });
  it("the address suggestions and the customer pick share the rule", () => {
    expect(
      suggestionLabel({
        account_id: "a",
        account_name: "Acme Foods",
        site_id: "s",
        site_name: "Acme Foods",
        address: "1 Main St",
        lat: null,
        lng: null,
      }),
    ).toBe("Acme Foods");
    expect(customerLabel("Acme Foods", "Plant 2", " · ")).toBe("Acme Foods · Plant 2");
    expect(customerLabel("Acme Foods", "Acme Foods", " · ")).toBe("Acme Foods");
    const dialog = read("src/components/takeoff-page.tsx");
    expect(dialog).toContain("label: customerLabel(hit.account_name, hit.site_name),");
    expect(dialog).not.toContain("`${hit.account_name} — ${hit.site_name}`");
  });
  it("the estimator's Linked to line follows it too (the pick and the loaded profile)", () => {
    const estimate = read("src/routes/estimate.tsx");
    expect(estimate).toContain('customerLabel(linkedDetail.account.name, linkedSite?.name, " · ")');
    expect(estimate).toContain('customerLabel(hit.account_name, hit.site_name, " · ")');
    expect(estimate).not.toContain('.filter(Boolean).join(" · ")');
  });
});

describe("10. the estimator's chip on a deleted customer", () => {
  it("says (deleted), with the way back", () => {
    const chip = read("src/components/crm/linked-account-chip.tsx");
    expect(chip).toContain("deleted?: boolean;");
    expect(chip).toContain('data-chip="deleted"');
    expect(chip).toContain("(deleted)");
    expect(chip).toContain("An admin or a manager can restore the customer from its page.");
    const estimate = read("src/routes/estimate.tsx");
    expect(estimate).toContain("deleted={!!linkedDetail?.account.deleted_at}");
  });
});

describe("11. a move fills the bid's fields from the new customer (owner, Nov 6)", () => {
  const account = {
    name: "New Customer LLC",
    contact_name: "",
    phone: "606-555-0200",
    email: "new@example.com",
    address1: "2 New St",
    address2: null,
    city: "London",
    state: "KY",
    zip: "40741",
  };
  const data = {
    customer: {
      name: "Old Customer",
      contact: "Pat Old",
      phone: "1",
      projectAddress: "",
      notes: "keep these",
    },
    items: [{ id: 1 }],
    grandTotal: 5,
  };
  it("replaces the client fields the new customer has, keeps what it lacks and the rest of the data", () => {
    const out = bidDataForCustomer(data, account) as typeof data;
    expect(out.customer).toMatchObject({
      name: "New Customer LLC",
      contact: "Pat Old",
      phone: "606-555-0200",
      email: "new@example.com",
      clientAddress: "2 New St",
      clientCity: "London",
      clientState: "KY",
      clientZip: "40741",
      notes: "keep these",
    });
    expect(out.items).toEqual([{ id: 1 }]);
    expect(out.grandTotal).toBe(5);
    expect(data.customer.name).toBe("Old Customer"); // the input is left alone
  });
  it("a property named on the move fills the job-site fields and the printed line", () => {
    const out = bidDataForCustomer(data, account, {
      address1: "9 Plant Rd",
      address2: "",
      city: "Corbin",
      state: "KY",
      zip: "40701",
    }) as { customer: CustomerInfo };
    expect(out.customer.projectAddress).toBe("9 Plant Rd");
    expect(out.customer.jobCity).toBe("Corbin");
    expect(out.customer.jobCityStZip).toBe("Corbin, KY 40701");
  });
  it("a bid with no customer block, or no data, gets one", () => {
    expect(
      (bidDataForCustomer(null, account) as { customer: { name: string } }).customer.name,
    ).toBe("New Customer LLC");
    expect((bidDataForCustomer({ x: 1 }, account) as { x: number }).x).toBe(1);
  });
  it("the server fills on a move or first link only, after the lock check, and stamps the contents", () => {
    const fn = server.slice(
      server.indexOf("export const linkBidToAccount"),
      server.indexOf("export const listUnlinkedBids"),
    );
    expect(fn).toContain("if (cur.account_id !== data.account_id) {");
    expect(fn).toContain("await liveLockHeldElsewhere(sb, cur.id, undefined);");
    expect(fn).toContain("has this bid open in the estimator; move it when they are done");
    expect(fn).toContain("patch.data = bidDataForCustomer(cur.data, acct, site) as Json;");
    expect(fn).toContain("patch.content_saved_at = new Date().toISOString();");
    expect(fn.indexOf("liveLockHeldElsewhere")).toBeLessThan(fn.indexOf("bidDataForCustomer("));
    expect(fn.indexOf("bidDataForCustomer(")).toBeLessThan(fn.indexOf(".update(patch)"));
    // The property must belong to the customer the bid goes to.
    expect(fn).toContain('.eq("account_id", data.account_id)');
  });
});
