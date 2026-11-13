/**
 * Owner, Nov 13, with a picture of Bid Setup › General Info: "hide building type as its always
 * going to be commercial, move date created up to just below the job name form and then in the
 * empty white space there can we show the linked customers contact info, if no contact info on
 * file, the primary contacts info".
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { accountHasContact, bidCustomerContact } from "./bid-customer-contact";

const card = (
  o: Partial<{ contact_name: string; phone: string; mobile: string; email: string }>,
) => ({
  contact_name: o.contact_name ?? null,
  phone: o.phone ?? null,
  mobile: o.mobile ?? null,
  email: o.email ?? null,
});
const person = (
  name: string,
  o: Partial<{
    position: string;
    office_phone: string;
    mobile: string;
    email: string;
    is_primary: boolean;
  }> = {},
) => ({
  name,
  position: o.position ?? null,
  office_phone: o.office_phone ?? null,
  mobile: o.mobile ?? null,
  email: o.email ?? null,
  is_primary: o.is_primary ?? false,
});

describe("whose contact Bid Setup shows", () => {
  it("the customer's own, when its card has a number or an email", () => {
    const c = bidCustomerContact(
      card({ contact_name: "Pat Lee", phone: "606-555-0100", email: "pat@example.com" }),
      [person("Someone Else", { mobile: "606-555-0199", is_primary: true })],
    );
    expect(c).toEqual({
      source: "customer",
      heading: "Customer contact",
      name: "Pat Lee",
      role: null,
      office: "606-555-0100",
      cell: null,
      email: "pat@example.com",
    });
  });
  it("any one of office phone, cell or email is enough", () => {
    expect(bidCustomerContact(card({ phone: "1" }), [])?.source).toBe("customer");
    expect(bidCustomerContact(card({ mobile: "2" }), [])?.source).toBe("customer");
    expect(bidCustomerContact(card({ email: "a@b.c" }), [])?.source).toBe("customer");
  });
  it("the Primary contact's, when the card has none", () => {
    const c = bidCustomerContact(card({ contact_name: "Name Only" }), [
      person("A Billing", { email: "bill@example.com" }),
      person("Dana Roe", {
        position: "Facilities",
        office_phone: "606-555-0111",
        mobile: "606-555-0122",
        is_primary: true,
      }),
    ]);
    expect(c).toEqual({
      source: "primary",
      heading: "Primary contact",
      name: "Dana Roe",
      role: "Facilities",
      office: "606-555-0111",
      cell: "606-555-0122",
      email: null,
    });
  });
  it("a name alone is not contact info: blanks and spaces count as nothing", () => {
    expect(accountHasContact(card({ contact_name: "Only A Name" }))).toBe(false);
    expect(accountHasContact(card({ phone: "   ", email: "" }))).toBe(false);
    expect(accountHasContact(card({ mobile: " 5 " }))).toBe(true);
    expect(accountHasContact(null)).toBe(false);
  });
  it("a Primary contact with nothing to reach it by is passed over for one that has", () => {
    const c = bidCustomerContact(card({}), [
      person("Primary No Info", { is_primary: true }),
      person("Reachable", { email: "r@example.com" }),
    ]);
    expect(c?.source).toBe("contact");
    expect(c?.heading).toBe("Contact");
    expect(c?.name).toBe("Reachable");
  });
  it("nobody to show: null, with no card, no contacts, or contacts with nothing", () => {
    expect(bidCustomerContact(card({}), [])).toBeNull();
    expect(bidCustomerContact(card({}), null)).toBeNull();
    expect(bidCustomerContact(null, undefined)).toBeNull();
    expect(bidCustomerContact(card({}), [person("No Info", { is_primary: true })])).toBeNull();
  });
  it("values are trimmed", () => {
    const c = bidCustomerContact(card({ contact_name: "  Pat  ", phone: " 606 " }), []);
    expect(c?.name).toBe("Pat");
    expect(c?.office).toBe("606");
  });
});

describe("General Info on the estimator", () => {
  const page = readFileSync("src/routes/estimate.tsx", "utf8");
  const form = page.slice(
    page.indexOf('data-grid="general-info"'),
    page.indexOf('<LegacyGroup title="2. Labor'),
  );
  it("Date Created comes right after Job Name, in the right column under it", () => {
    const job = form.indexOf('<Field label="Job Name" className="sm:col-start-2 sm:row-start-1">');
    const date = form.indexOf(
      '<Field label="Date Created" className="sm:col-start-2 sm:row-start-2">',
    );
    const est = form.indexOf(`<Field label="Estimator's Name"`);
    expect(job).toBeGreaterThan(0);
    expect(date).toBeGreaterThan(job);
    expect(est).toBeGreaterThan(date);
  });
  it("the customer box is as tall as the two beside it; the rest run down the left", () => {
    expect(form).toContain('className="sm:col-start-1 sm:row-span-2 sm:row-start-1"');
    expect(form).toContain(
      `<Field label="Estimator's Name" className="sm:col-start-1 sm:row-start-3">`,
    );
    expect(form).toContain('<Field label="Status" className="sm:col-start-1 sm:row-start-4">');
    expect(form).toContain('<Field label="Folder" className="sm:col-start-1 sm:row-start-5">');
  });
  it("Building Type is hidden while it is Commercial, and only then", () => {
    expect(form).toContain('{buildingType !== "Commercial" && (');
    const hidden = form.slice(form.indexOf('{buildingType !== "Commercial" && ('));
    expect(hidden.indexOf('<Field label="Building Type"')).toBeGreaterThan(0);
    expect(form.match(/<Field label="Building Type"/g)).toHaveLength(1);
  });
  it("the bid still carries its building type, Commercial for a new one", () => {
    expect(page).toContain('useState<string>("Commercial");');
    expect(page).toContain('setBuildingType(d.buildingType ?? "Commercial");');
    expect(page).toMatch(/\n {4}buildingType,\n/);
  });
  it("the linked customer's contact fills the space beside Estimator, Status and Folder", () => {
    expect(form).toContain("<BidCustomerContact");
    expect(form).toContain("accountId={linkedAccountId}");
    expect(form).toContain("account={linkedDetail?.account ?? null}");
    expect(form).toContain('className="sm:col-start-2 sm:row-span-3 sm:row-start-3"');
  });
});

describe("the contact panel", () => {
  const panel = readFileSync("src/components/bid-customer-contact.tsx", "utf8");
  it("reads the contacts only when the card has no number and no email", () => {
    expect(panel).toContain(
      "const needContacts = !!props.accountId && !!props.account && !accountHasContact(props.account);",
    );
    expect(panel).toContain("enabled: needContacts,");
    expect(panel).toContain('queryKey: ["contacts", props.accountId],');
  });
  it("numbers call and the email writes; nothing is edited here", () => {
    expect(panel).toContain("href={telHref(card.office)}");
    expect(panel).toContain("href={telHref(card.cell)}");
    expect(panel).toContain("href={`mailto:${card.email}`}");
    expect(panel).not.toMatch(/<Input|<input|onChange=/);
  });
  it("says so plainly when there is no customer yet, or nobody to show", () => {
    expect(panel).toContain("Pick the customer from the list to see their contact here.");
    expect(panel).toContain("No phone or email on file for this customer.");
  });
});
