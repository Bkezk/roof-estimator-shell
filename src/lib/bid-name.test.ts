/**
 * Untitled bids are named after their customer (owner, Nov 9: "on a bid if there is no bid title
 * name it after the customer; if there is already one named after the customer make it that name
 * (1); ensure it doesn't mess with copying a bid"). Red on the old code: bid-name.ts did not
 * exist, saveBid stored "Untitled bid" as sent, and the estimator kept its own name after a save.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  BID_NAME_MAX,
  customerBidName,
  customerNamePrefix,
  isUntitledBid,
  UNTITLED_BID,
} from "@/lib/bid-name";
import { copyBidName, duplicateBidName } from "@/lib/duplicate-bid";

describe("isUntitledBid", () => {
  it("is blank or the placeholder, whatever the case or spacing", () => {
    for (const n of ["", "   ", "Untitled bid", "untitled bid", " UNTITLED BID ", null, undefined])
      expect(isUntitledBid(n)).toBe(true);
    for (const n of ["Senture", "Untitled bid (copy)", "Untitled", "Gym reroof"])
      expect(isUntitledBid(n)).toBe(false);
  });
});

describe("customerBidName", () => {
  it("is the customer's name when no live bid has it", () => {
    expect(customerBidName("Senture", [])).toBe("Senture");
    expect(customerBidName("  Legacy   Auto  Network ", ["Other bid"])).toBe("Legacy Auto Network");
  });
  it("adds (1), then the next free number, case not mattering", () => {
    expect(customerBidName("Senture", ["senture"])).toBe("Senture (1)");
    expect(customerBidName("Senture", ["Senture", "Senture (1)"])).toBe("Senture (2)");
    expect(customerBidName("Senture", ["Senture", "Senture (2)"])).toBe("Senture (1)");
    // A bid named "Senture (copy)" is not the customer's name: no number needed.
    expect(customerBidName("Senture", ["Senture (copy)", "Senture 2026"])).toBe("Senture");
  });
  it("is null with no customer to name after", () => {
    expect(customerBidName("", [])).toBeNull();
    expect(customerBidName("   ", ["x"])).toBeNull();
    expect(customerBidName(null, [])).toBeNull();
  });
  it("keeps inside the job name's limit, suffix included", () => {
    const long = "C".repeat(BID_NAME_MAX + 20);
    expect(customerBidName(long, [])).toHaveLength(BID_NAME_MAX);
    const numbered = customerBidName(long, ["C".repeat(BID_NAME_MAX)])!;
    expect(numbered.endsWith(" (1)")).toBe(true);
    expect(numbered.length).toBeLessThanOrEqual(BID_NAME_MAX);
  });
  it("the lookup pattern escapes the like wildcards", () => {
    expect(customerNamePrefix("Senture")).toBe("Senture%");
    expect(customerNamePrefix("A_B 100% \\ Co")).toBe("A\\_B 100\\% \\\\ Co%");
  });
});

describe("copies are left alone", () => {
  it("a copy's name comes from the source, never from the customer", () => {
    expect(duplicateBidName("Senture")).toBe("Senture (copy)");
    expect(duplicateBidName("Untitled bid")).toBe("Untitled bid (copy)");
    expect(copyBidName("Senture", "")).toBe("Senture (copy)");
    expect(isUntitledBid(duplicateBidName(""))).toBe(false);
  });
});

describe("the wiring", () => {
  it("saveBid names an untitled save after the customer, new and existing bids alike", () => {
    const fns = readFileSync("src/lib/bids.functions.ts", "utf8");
    expect(fns).toContain("const name = isUntitledBid(data.name)");
    expect(fns).toContain("? await nameAfterCustomer(context.supabase, data)");
    expect(fns).toContain("      name,\n      data: data.data as Json,");
    // The taken names: live bids starting with the customer's name, this bid excluded.
    expect(fns).toContain('.ilike("name", customerNamePrefix(customer))');
    expect(fns).toContain('if (data.id) q = q.neq("id", data.id);');
    expect(fns.replace(/\s+/g, " ")).toContain(
      "return ( customerBidName( customer, (rows ?? []).map((r) => r.name), ) ?? UNTITLED_BID );",
    );
    // The copy keeps its own naming (duplicateBidRow), untouched by this.
    expect(fns).toContain("duplicateBidRow");
  });
  it("the estimator adopts the name the row comes back with and says so", () => {
    const est = readFileSync("src/routes/estimate.tsx", "utf8");
    expect(est).toContain(
      "const renamed = !!row && row.name !== (bidName.trim() || UNTITLED_BID);",
    );
    expect(est).toContain("if (row && renamed) setBidName(row.name);");
    expect(est).toContain('`${savedToastText(kept)} — named "${row.name}" after the customer`');
    expect(est).toContain("lastSavedBody.current = bodyJsonOf(row?.name ?? bidName);");
    expect(UNTITLED_BID).toBe("Untitled bid");
    // The legacy blur handler that refused a blank title and put "Untitled bid" back is gone.
    expect(est).not.toContain("Bid Title cannot be left blank.");
    expect(est).toContain('placeholder="Named after the customer when saved"');
  });
});
