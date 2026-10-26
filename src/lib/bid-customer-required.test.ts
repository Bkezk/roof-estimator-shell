/**
 * Owner, Oct 26: "bids should be required to have a customer as well, if the customer isnt in
 * the system it prompts them to make one." Every save leaves the bid linked to a customer
 * record; the estimator says so (and the Customer Name picker offers "Add … as a new customer"),
 * and saveBid refuses as the final guard. One rule, both sides (bid-status.ts).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { BID_CUSTOMER_REQUIRED, bidCustomerProblem } from "./bid-status";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

describe("bidCustomerProblem", () => {
  it("a new bid needs a customer; one linked saves", () => {
    expect(bidCustomerProblem({ accountId: null, storedAccountId: null })).toBe(
      BID_CUSTOMER_REQUIRED,
    );
    expect(bidCustomerProblem({ accountId: undefined, storedAccountId: null })).toBe(
      BID_CUSTOMER_REQUIRED,
    );
    expect(bidCustomerProblem({ accountId: "a1", storedAccountId: null })).toBeNull();
  });
  it("an existing bid keeps its stored link unless the save changes it; unlinking is refused", () => {
    expect(bidCustomerProblem({ accountId: undefined, storedAccountId: "a1" })).toBeNull();
    expect(bidCustomerProblem({ accountId: "a2", storedAccountId: "a1" })).toBeNull();
    expect(bidCustomerProblem({ accountId: null, storedAccountId: "a1" })).toBe(
      BID_CUSTOMER_REQUIRED,
    );
    // A legacy bid never linked (Summit, Knox County tests) is held until it is.
    expect(bidCustomerProblem({ accountId: undefined, storedAccountId: null })).toBe(
      BID_CUSTOMER_REQUIRED,
    );
  });
  it("the message says where to pick and that the picker adds a missing customer", () => {
    expect(BID_CUSTOMER_REQUIRED).toContain("Setup › Customer Name");
    expect(BID_CUSTOMER_REQUIRED).toContain("Add … as a new customer");
  });
});

describe("the wiring", () => {
  it("saveBid guards both the insert and the update, reading the stored link", () => {
    const src = read("./bids.functions.ts");
    expect(src).toContain('status_changed_at, deleted_at, account_id",');
    expect(src).toContain("accountId: data.accountId,\n        storedAccountId: cur.account_id,");
    expect(src).toContain("accountId: data.accountId ?? null,\n      storedAccountId: null,");
    const guard = src.indexOf(
      "const customerProblem = bidCustomerProblem({\n      accountId: data.accountId ?? null",
    );
    const insert = src.indexOf(".insert({\n        ...payload,\n        status,");
    expect(guard).toBeGreaterThan(0);
    expect(insert).toBeGreaterThan(guard);
  });
  it("the estimator refuses first, rings the Customer Name picker and goes to Setup", () => {
    const src = read("../routes/estimate.tsx");
    expect(src).toMatch(
      /bidCustomerProblem\(\{\s*accountId: linkedAccountId,\s*storedAccountId: null,\s*\}\)/,
    );
    expect(src).toContain("setCustomerMissing(true);");
    expect(src).toContain('id="bid-customer"');
    expect(src).toContain("{customerMissing && (");
  });
});
