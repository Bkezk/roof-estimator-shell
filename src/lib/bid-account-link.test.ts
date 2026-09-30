import { describe, expect, it } from "vitest";

import {
  accountFromBid,
  applyProfileFill,
  blankFieldsOnly,
  clientAddressForJobSite,
  fillConflicts,
  parseAddressTail,
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

  it("passes the profile's cell phone through (the bid has none), so it is never wiped", () => {
    const same = applyProfileFill(bid(), profileFill(account), true);
    const input = accountFromBid(
      { ...same, phone: "", email: "" },
      { ...account, phone: null, mobile: "606-555-0199" },
    );
    expect(input.mobile).toBe("606-555-0199");
  });
});

describe("blankFieldsOnly (a bid that arrives already linked)", () => {
  it("fills only blank fields and never replaces typed text, even a partial name", () => {
    const c = bid({ name: "Bell", phone: "606-555-9999", jobCityStZip: "Middlesboro KY" });
    const fill = blankFieldsOnly(c, profileFill(account, site));
    expect(fill.name).toBeUndefined();
    expect(fill.phone).toBeUndefined();
    expect(fill.jobCityStZip).toBeUndefined();
    const next = applyProfileFill(c, fill, false);
    expect(next.name).toBe("Bell");
    expect(next.phone).toBe("606-555-9999");
    expect(next.contact).toBe("Pat Jones");
    expect(next.clientCity).toBe("Pineville");
    expect(next.projectAddress).toBe("1200 Yellow Creek Rd");
    expect(next.jobCity).toBe("Middlesboro");
    expect(next.jobCityStZip).toBe("Middlesboro KY");
  });

  it("builds the job-site line from the parts when the bid has none", () => {
    const next = applyProfileFill(bid(), blankFieldsOnly(bid(), profileFill(account, site)), false);
    expect(next.jobCityStZip).toBe("Middlesboro, KY 40965");
  });
});

describe("parseAddressTail", () => {
  it.each([
    ["123 Main St, Corbin, KY 40701", "123 Main St", "Corbin", "KY", "40701"],
    ["123 Main St\nCorbin, KY 40701", "123 Main St", "Corbin", "KY", "40701"],
    ["123 Main St,\n Corbin KY 40701-1234", "123 Main St", "Corbin", "KY", "40701-1234"],
    [
      "PO Box 5, Suite 2\nMount Vernon, ky. 40456",
      "PO Box 5, Suite 2",
      "Mount Vernon",
      "KY",
      "40456",
    ],
    ["123 Main St\r\nCorbin, KY 40701", "123 Main St", "Corbin", "KY", "40701"],
    ["Corbin, KY 40701", "", "Corbin", "KY", "40701"],
  ])("%j", (text, rest, city, state, zip) => {
    expect(parseAddressTail(text)).toEqual({ rest, city, state, zip });
  });

  it.each(["123 Main St", "123 Main St, Corbin", "Corbin, Kentucky 40701", "Corbin, KY 4070", ""])(
    "%j does not parse",
    (text) => {
      expect(parseAddressTail(text)).toBeNull();
    },
  );
});

describe("clientAddressForJobSite", () => {
  it("copies the parts as they are when the client has a city, state or zip", () => {
    const c = bid({
      clientAddress: "123 Main St",
      clientAddress2: "Suite 4",
      clientCity: "Corbin",
      clientState: "KY",
      clientZip: "40701",
    });
    expect(clientAddressForJobSite(c)).toEqual({
      projectAddress: "123 Main St",
      projectAddress2: "Suite 4",
      jobCity: "Corbin",
      jobState: "KY",
      jobZip: "40701",
      jobCityStZip: "Corbin, KY 40701",
    });
  });

  it("splits a whole address held in Address 1", () => {
    const c = bid({ clientAddress: "123 Main St, Corbin, KY 40701", clientAddress2: "Suite 4" });
    expect(clientAddressForJobSite(c)).toEqual({
      projectAddress: "123 Main St",
      projectAddress2: "Suite 4",
      jobCity: "Corbin",
      jobState: "KY",
      jobZip: "40701",
      jobCityStZip: "Corbin, KY 40701",
    });
  });

  it("reads the city line from Address 2", () => {
    const c = bid({ clientAddress: "123 Main St", clientAddress2: "Corbin, KY 40701" });
    expect(clientAddressForJobSite(c)).toMatchObject({
      projectAddress: "123 Main St",
      projectAddress2: "",
      jobCity: "Corbin",
      jobCityStZip: "Corbin, KY 40701",
    });
  });

  it("copies as before when nothing parses (or Address 1 is only a city line)", () => {
    for (const clientAddress of ["123 Main St, Corbin", "Corbin, KY 40701"]) {
      expect(clientAddressForJobSite(bid({ clientAddress }))).toEqual({
        projectAddress: clientAddress,
        projectAddress2: "",
        jobCity: "",
        jobState: "",
        jobZip: "",
        jobCityStZip: "",
      });
    }
  });
});
