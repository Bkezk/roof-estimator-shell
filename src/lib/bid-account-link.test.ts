import { describe, expect, it } from "vitest";

import {
  accountFromBid,
  applyProfileFill,
  fillConflicts,
  profileDifferences,
  profileFill,
} from "@/lib/bid-account-link";
import { emptyCustomer, type CustomerInfo } from "@/lib/proposal-bid";

const account = {
  id: "00000000-0000-4000-8000-000000000001",
  kind: "company",
  name: "Bell County BOE",
  contact_name: "Pat Jones",
  phone: "606-555-0100",
  email: null,
  address1: "PO Box 340",
  address2: null,
  city: "Pineville",
  state: "KY",
  zip: "40977",
  billing_instructions: "PO required",
  external_id: "C-12",
  notes: null,
};
const site = {
  address1: "1200 Yellow Creek Rd",
  address2: "",
  city: "Middlesboro",
  state: "KY",
  zip: "40965",
};
const bid = (over: Partial<CustomerInfo> = {}): CustomerInfo => ({ ...emptyCustomer(), ...over });

describe("profileFill", () => {
  it("fills client fields, and job-site fields only when a site was picked", () => {
    const a = profileFill(account);
    expect(a).toEqual({
      name: "Bell County BOE",
      contact: "Pat Jones",
      phone: "606-555-0100",
      clientAddress: "PO Box 340",
      clientCity: "Pineville",
      clientState: "KY",
      clientZip: "40977",
    });
    const s = profileFill(account, site);
    expect(s.projectAddress).toBe("1200 Yellow Creek Rd");
    expect(s.projectAddress2).toBeUndefined();
    expect(s.jobCityStZip).toBe("Middlesboro, KY 40965");
  });
});

describe("fillConflicts / applyProfileFill", () => {
  it("treats the typed search text in the name as nothing to keep", () => {
    const c = bid({ name: "bell cou" });
    const fill = profileFill(account, site);
    expect(fillConflicts(c, fill)).toEqual([]);
    const next = applyProfileFill(c, fill, false);
    expect(next.name).toBe("Bell County BOE");
    expect(next.jobCity).toBe("Middlesboro");
    expect(next.jobCityStZip).toBe("Middlesboro, KY 40965");
  });

  it("lists fields holding different text; Keep mine fills only blanks, Yes replaces", () => {
    const c = bid({ name: "Bell Co. Schools", phone: "606-555-9999", email: "x@y.org" });
    const fill = profileFill(account);
    expect(fillConflicts(c, fill)).toEqual(["name", "phone"]);
    const kept = applyProfileFill(c, fill, false);
    expect(kept.name).toBe("Bell Co. Schools");
    expect(kept.phone).toBe("606-555-9999");
    expect(kept.contact).toBe("Pat Jones");
    // The profile has no email: the bid's is never wiped.
    expect(kept.email).toBe("x@y.org");
    const replaced = applyProfileFill(c, fill, true);
    expect(replaced.name).toBe("Bell County BOE");
    expect(replaced.phone).toBe("606-555-0100");
    expect(replaced.email).toBe("x@y.org");
  });

  it("keeps a hand-edited job-site line when the estimator keeps theirs", () => {
    const c = bid({ jobCityStZip: "Middlesboro KY" });
    const fill = profileFill(account, site);
    expect(fillConflicts(c, fill)).toContain("jobCityStZip");
    expect(applyProfileFill(c, fill, false).jobCityStZip).toBe("Middlesboro KY");
    expect(applyProfileFill(c, fill, true).jobCityStZip).toBe("Middlesboro, KY 40965");
  });
});

describe("profileDifferences / accountFromBid", () => {
  it("compares the client fields trimmed, and pushes them back keeping the other columns", () => {
    const same = applyProfileFill(bid(), profileFill(account), true);
    expect(profileDifferences(same, account)).toEqual([]);
    const edited = { ...same, phone: " 606-555-0100 ", email: "pat@bell.kyschools.us" };
    expect(profileDifferences(edited, account)).toEqual(["email"]);
    const input = accountFromBid(edited, account);
    expect(input).toMatchObject({
      id: account.id,
      name: "Bell County BOE",
      kind: "company",
      email: "pat@bell.kyschools.us",
      phone: "606-555-0100",
      billing_instructions: "PO required",
      external_id: "C-12",
    });
  });
});
