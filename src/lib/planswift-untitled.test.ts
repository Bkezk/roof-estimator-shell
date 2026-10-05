/**
 * Owner, Oct 5: "when you import a planswift plan it requires a customer name can you get rid of
 * that for now and just have the imported planswift file make an untitled bid?" The customer box
 * on the import dialog is optional; without one the bid starts as "Untitled bid", unlinked.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { planSwiftBidName } from "@/lib/planswift/to-seed";

describe("planSwiftBidName", () => {
  it("is 'Untitled bid' when no customer is picked and nothing is typed", () => {
    expect(planSwiftBidName("", null, "Lexington Gym.xlsx")).toBe("Untitled bid");
    expect(planSwiftBidName("   ", undefined, "roof.xlsx")).toBe("Untitled bid");
    expect(planSwiftBidName("", "", "roof.xlsx")).toBe("Untitled bid");
  });
  it("is '<customer> · <file>' when a customer is picked", () => {
    expect(planSwiftBidName("", "Acme Storage", "Lexington Gym.xlsx")).toBe(
      "Acme Storage · Lexington Gym",
    );
  });
  it("a typed name wins either way", () => {
    expect(planSwiftBidName("  Gym reroof ", null, "x.xlsx")).toBe("Gym reroof");
    expect(planSwiftBidName("Gym reroof", "Acme", "x.xlsx")).toBe("Gym reroof");
  });
});

describe("the import dialog", () => {
  const src = readFileSync("src/components/import-planswift-dialog.tsx", "utf8");
  it("no longer requires a customer: no star, no refusal, Create bid not held back", () => {
    expect(src).not.toContain("missingCustomer");
    expect(src).not.toContain("Pick the customer this bid is for");
    expect(src).toContain('<Label htmlFor="planswift-customer">Customer (optional)</Label>');
    expect(src).toContain("<Button onClick={create} disabled={busy || !preview?.seed}>");
  });
  it("leaves the name box blank until a customer is picked (no file-name prefill)", () => {
    expect(src).toContain('customerLabel ? suggestPlanSwiftBidName(customerLabel, fileName) : "";');
    expect(src).toContain("if (!nameTouched) setBidName(prefillName(account?.label, file.name));");
    expect(src).toContain("if (!nameTouched) setBidName(prefillName(v?.label ?? null, fileName));");
    expect(src).not.toMatch(/setBidName\(suggestPlanSwiftBidName\(/);
  });
  it("names the bid with planSwiftBidName and hands an unlinked bid to the estimator", () => {
    expect(src).toContain("const name = planSwiftBidName(bidName, account?.label, fileName);");
    expect(src).toContain("bidName: name,");
    expect(src).toMatch(/account: account\s*\?\s*\{ id: account\.account_id[\s\S]*?\}\s*:\s*null,/);
    expect(src).toContain('account ? "Starts as the customer and the file name" : "Untitled bid"');
  });
  it("the estimator accepts a hand-off with no customer (an unlinked new bid)", () => {
    const est = readFileSync("src/routes/estimate.tsx", "utf8");
    expect(est).toMatch(
      /if \(account\) linkFromTakeoff\(account\.id, account\.label, account\.siteId\);\s*else setLink\(null, null, "", false\);/,
    );
  });
});
