/**
 * The CenterPoint customer import (owner, Oct 13): the CSV reader, the normalisers, twin
 * folding, matching against the live portal, the report, the migration, the admin page and the
 * "No contact info" badge. Fixtures are small and made up; never rows from the real export.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  COMPANY_HEADERS,
  CONTACT_HEADERS,
  CP_SERVICE_TYPE_MAP,
  PROPERTY_HEADERS,
  addressKey,
  confirmText,
  cpServiceType,
  decodeEntities,
  formatImportReport,
  isPlaceholderName,
  matchCounty,
  normalizeCountyName,
  normalizeEmail,
  normalizePhone,
  normalizeState,
  parseCpDate,
  parseCsv,
  planCenterpointImport,
  planSummary,
  readCompanies,
  readContacts,
  readProperties,
  textsKey,
  withExtension,
  type ImportLookups,
} from "@/lib/centerpoint-import";

// ---- Fixtures -------------------------------------------------------------------------------

const csvLine = (cells: readonly string[]) =>
  cells.map((c) => (/[",\n\r]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(",");
const csv = (headers: readonly string[], rows: Record<string, string>[], eol = "\r\n") =>
  "﻿" +
  [csvLine(headers), ...rows.map((r) => csvLine(headers.map((h) => r[h] ?? "")))].join(eol) +
  eol;

type Co = Partial<Record<(typeof COMPANY_HEADERS)[number], string>>;
type Pr = Partial<Record<(typeof PROPERTY_HEADERS)[number], string>>;
type Ct = Partial<Record<(typeof CONTACT_HEADERS)[number], string>>;

const company = (id: string, name: string, more: Co = {}): Record<string, string> => ({
  ID: id,
  Company: name,
  Address: "100 Main Street",
  City: "London",
  County: "Laurel County",
  State: "KY",
  Zip: "40741",
  "Recent Activity": "01/02/2026 10:00:00 AM",
  ...more,
});
const property = (id: string, name: string, co: string, more: Pr = {}): Record<string, string> => ({
  ID: id,
  Property: name,
  Address: "5 Oak Ave",
  City: "London",
  "Zip Code": "40741",
  County: "Laurel County",
  State: "KY",
  Company: co,
  "Recent Activity": "01/02/2026 10:00:00 AM",
  ...more,
});
const contact = (id: string, name: string, co: string, more: Ct = {}): Record<string, string> => ({
  ID: id,
  Name: name,
  Company: co,
  "Created At": "03/04/2024 09:00:00 AM",
  ...more,
});

const files = (
  co: Record<string, string>[],
  pr: Record<string, string>[],
  ct: Record<string, string>[],
) => ({
  companies: csv(COMPANY_HEADERS, co),
  properties: csv(PROPERTY_HEADERS, pr),
  contacts: csv(CONTACT_HEADERS, ct),
});

const lookups = (over: Partial<ImportLookups> = {}): ImportLookups => ({
  profiles: [
    { id: "u-garry", full_name: "Garry Peters" },
    { id: "u-mark", full_name: "Mark Barger" },
  ],
  county_codes: [
    { id: "cc-laurel", code: "0001", county: "Laurel", state: "KY" },
    { id: "cc-fayette", code: "0002", county: "Fayette", state: "KY" },
    { id: "cc-knox-tn", code: "0003", county: "Knox", state: "TN" },
  ],
  accounts: [],
  sites: [],
  contacts: [],
  ...over,
});

const acct = (
  id: string,
  name: string,
  more: Partial<ImportLookups["accounts"][number]> = {},
): ImportLookups["accounts"][number] => ({
  id,
  name,
  centerpoint_company_id: null,
  deleted_at: null,
  ...more,
});

// ---- CSV ------------------------------------------------------------------------------------

describe("parseCsv", () => {
  it("strips the BOM, splits CRLF and keeps quoted commas, quotes and newlines", () => {
    const rows = parseCsv('﻿A,B,C\r\n1,"x, y","say ""hi"""\r\n2,"two\nlines",\r\n');
    expect(rows).toEqual([
      ["A", "B", "C"],
      ["1", "x, y", 'say "hi"'],
      ["2", "two\nlines", ""],
    ]);
  });
  it("accepts LF files without a trailing newline and skips blank lines", () => {
    expect(parseCsv("A,B\n1,2\n\n3,4")).toEqual([
      ["A", "B"],
      ["1", "2"],
      ["3", "4"],
    ]);
  });
  it("decodes CenterPoint's HTML entities in cells", () => {
    expect(decodeEntities("C&amp;R &quot;Co&quot;")).toBe('C&R "Co"');
  });
});

describe("the readers", () => {
  it("name the missing header", () => {
    const rows = parseCsv(
      csv(
        COMPANY_HEADERS.filter((h) => h !== "Manager"),
        [],
      ),
    );
    expect(() => readCompanies(rows)).toThrow('Companies CSV is missing the "Manager" column');
    expect(() => readProperties(parseCsv("ID,Property\n1,x\n"))).toThrow(
      'Properties CSV is missing the "Building Number" column',
    );
    expect(() => readContacts(parseCsv("ID\n1\n"))).toThrow(
      'Contacts CSV is missing the "Name" column',
    );
    expect(() => readContacts([])).toThrow("Contacts CSV is empty");
  });
  it("read by header name, trimmed, in any column order", () => {
    const text = csv([...COMPANY_HEADERS].reverse(), [
      company("7", "  Acme &amp; Co ", { "External Identifier": " 123456 " }),
    ]);
    const [c] = readCompanies(parseCsv(text));
    expect(c?.id).toBe("7");
    expect(c?.name).toBe("Acme & Co");
    expect(c?.externalId).toBe("123456");
    expect(c?.county).toBe("Laurel County");
  });
  it("read the property and contact columns the import uses", () => {
    const [p] = readProperties(
      parseCsv(
        csv(PROPERTY_HEADERS, [
          property("1", "Plant", "Acme", { "Account Manager": "Mark Barger" }),
        ]),
      ),
    );
    expect(p).toMatchObject({
      id: "1",
      name: "Plant",
      company: "Acme",
      manager: "Mark Barger",
      zip: "40741",
    });
    const [c] = readContacts(
      parseCsv(
        csv(CONTACT_HEADERS, [
          contact("2", "Ann", "Acme", { Office: "6065551234", Ext: "12", Email: "A@B.co" }),
        ]),
      ),
    );
    expect(c).toMatchObject({
      id: "2",
      name: "Ann",
      office: "6065551234",
      ext: "12",
      email: "A@B.co",
    });
  });
});

// ---- Normalisers ----------------------------------------------------------------------------

describe("normalizeState", () => {
  it("maps names and odd spellings to the two-letter code", () => {
    expect(normalizeState("Kentucky").state).toBe("KY");
    expect(normalizeState("Ky").state).toBe("KY");
    expect(normalizeState("KE").state).toBe("KY");
    expect(normalizeState("Illinois").state).toBe("IL");
    expect(normalizeState("Oh").state).toBe("OH");
    expect(normalizeState("tn").state).toBe("TN");
  });
  it("blank is null without a flag; nonsense is null with the text", () => {
    expect(normalizeState("  ")).toEqual({ state: null, bad: null });
    expect(normalizeState("ZZ")).toEqual({ state: null, bad: "ZZ" });
    expect(normalizeState("Kentuck")).toEqual({ state: null, bad: "Kentuck" });
  });
});

describe("counties", () => {
  const codes = lookups().county_codes;
  it("strips County and CenterPoint's -0004 suffix", () => {
    expect(normalizeCountyName("Laurel County")).toBe("Laurel");
    expect(normalizeCountyName("Fayette -0004")).toBe("Fayette");
    expect(normalizeCountyName(" Knox ")).toBe("Knox");
  });
  it("matches (county, state) case-insensitively", () => {
    expect(matchCounty("laurel county", "KY", codes)).toEqual({
      id: "cc-laurel",
      status: "matched",
    });
    expect(matchCounty("Fayette -0004", "KY", codes)).toEqual({
      id: "cc-fayette",
      status: "matched",
    });
    expect(matchCounty("Knox County", "TN", codes).id).toBe("cc-knox-tn");
    // Knox KY has no code here: unknown, not the TN one.
    expect(matchCounty("Knox County", "KY", codes)).toEqual({ id: null, status: "unknown" });
  });
  it("a city, blank, or a county outside KY / TN gets no code", () => {
    expect(matchCounty("Middlesboro", "KY", codes).status).toBe("unknown");
    expect(matchCounty("", "KY", codes).status).toBe("blank");
    expect(matchCounty("Cook County", "IL", codes).status).toBe("outside");
    expect(matchCounty("Laurel County", null, codes).status).toBe("outside");
  });
});

describe("normalizePhone", () => {
  it("formats ten digits and drops a leading 1 on eleven", () => {
    expect(normalizePhone("+16065266992").phone).toBe("(606) 526-6992");
    expect(normalizePhone("606-526-6992").phone).toBe("(606) 526-6992");
    expect(normalizePhone("(606) 526.6992 ").phone).toBe("(606) 526-6992");
  });
  it("too short is null and kept as typed in `odd`; blank is simply null", () => {
    expect(normalizePhone("+1")).toEqual({ phone: null, odd: "+1" });
    expect(normalizePhone("526-6992")).toEqual({ phone: null, odd: "526-6992" });
    expect(normalizePhone("")).toEqual({ phone: null, odd: null });
  });
  it("appends an extension to an office phone", () => {
    expect(withExtension("(606) 526-6992", "12")).toBe("(606) 526-6992 x12");
    expect(withExtension("(606) 526-6992", "x 12")).toBe("(606) 526-6992 x12");
    expect(withExtension("(606) 526-6992", "")).toBe("(606) 526-6992");
    expect(withExtension(null, "12")).toBeNull();
  });
});

describe("normalizeEmail", () => {
  it("lower-cases and trims, and never drops a wrong-looking one", () => {
    expect(normalizeEmail(" Ann@Example.COM ")).toEqual({
      email: "ann@example.com",
      looksWrong: false,
    });
    expect(normalizeEmail("hondo@funeralhome")).toEqual({
      email: "hondo@funeralhome",
      looksWrong: true,
    });
    expect(normalizeEmail("a b@c.com").looksWrong).toBe(true);
    expect(normalizeEmail("a,b@c,d").looksWrong).toBe(true);
    expect(normalizeEmail("")).toEqual({ email: null, looksWrong: false });
  });
});

describe("addressKey and placeholder names", () => {
  it("compares addresses loosely", () => {
    expect(addressKey("100 Main Street")).toBe(addressKey("100  MAIN St."));
    expect(addressKey("12 Oak Avenue, Suite 3")).toBe(addressKey("12 Oak Ave Ste 3"));
    expect(addressKey("100 Main St")).not.toBe(addressKey("200 Main St"));
  });
  it("knows a contact that is no contact", () => {
    for (const n of ["N/A", "n/a", "NA", "None", "-", ""]) expect(isPlaceholderName(n)).toBe(true);
    expect(isPlaceholderName("Nan Adams")).toBe(false);
  });
});

describe("parseCpDate", () => {
  it("reads CenterPoint's US stamps as Eastern time", () => {
    // EDT (UTC-4) in October, EST (UTC-5) in January.
    expect(parseCpDate("10/07/2026 07:23:00 PM")).toBe("2026-10-07T23:23:00.000Z");
    expect(parseCpDate("01/15/2026 12:30:00 AM")).toBe("2026-01-15T05:30:00.000Z");
    expect(parseCpDate("01/15/2026 12:30:00 PM")).toBe("2026-01-15T17:30:00.000Z");
    expect(parseCpDate("03/04/2024")).toBe("2024-03-04T05:00:00.000Z");
  });
  it("passes ISO stamps through and rejects the rest", () => {
    expect(parseCpDate("2024-09-05T14:58:00+00:00")).toBe("2024-09-05T14:58:00.000Z");
    expect(parseCpDate("")).toBeNull();
    expect(parseCpDate("yesterday")).toBeNull();
    expect(parseCpDate("13/40/2026 01:00:00 PM")).toBeNull();
  });
});

describe("CP_SERVICE_TYPE_MAP", () => {
  it("maps CenterPoint's service types, anything else to other", () => {
    expect(CP_SERVICE_TYPE_MAP).toEqual({
      leak: "leak",
      scope: "scope",
      warranty: "warranty",
      inspection: "inspection",
    });
    expect(cpServiceType("Leak")).toBe("leak");
    expect(cpServiceType(" SCOPE ")).toBe("scope");
    expect(cpServiceType("Warranty")).toBe("warranty");
    expect(cpServiceType("Inspection")).toBe("inspection");
    for (const t of ["Non-Billable", "Rooftop Maintenance", "Snow Removal", "", "Gutters"])
      expect(cpServiceType(t)).toBe("other");
  });
});

// ---- The plan -------------------------------------------------------------------------------

describe("planCenterpointImport: companies", () => {
  it("folds exact twins into the most recent one and keeps the other ID as an alias", () => {
    const plan = planCenterpointImport(
      files(
        [
          company("10", "First Church", { "Recent Activity": "01/01/2025 10:00:00 AM" }),
          company("11", "First Church", {
            Address: "100 Main St.",
            "Recent Activity": "06/01/2025 10:00:00 AM",
          }),
        ],
        [property("50", "Sanctuary", "First Church")],
        [contact("90", "Pat", "First Church", { Email: "pat@church.org" })],
      ),
      lookups(),
    );
    expect(plan.accountsToInsert).toHaveLength(1);
    expect(plan.accountsToInsert[0]).toMatchObject({
      centerpoint_company_id: "11",
      centerpoint_alias_ids: ["10"],
      name: "First Church",
      kind: "company",
      source: "import",
      address1: "100 Main St.",
    });
    expect(plan.report.counts.companies).toMatchObject({ rows: 2, new: 1, folded: 1 });
    expect(plan.report.flags["companies folded into a twin (same name and address)"]).toEqual([
      { id: "10", name: "First Church", issue: "folded into 11; its ID is kept as an alias" },
    ]);
    // The property and the contact attach to the kept company.
    expect(plan.sitesToInsert[0]?.companyCpId).toBe("11");
    expect(plan.contactsToInsert[0]?.companyCpId).toBe("11");
  });
  it("breaks a tie on Recent Activity by External Identifier, then the lower ID", () => {
    const plan = planCenterpointImport(
      files(
        [
          company("20", "Twin"),
          company("19", "Twin", { "External Identifier": "123456" }),
          company("30", "Other"),
          company("31", "Other"),
        ],
        [],
        [],
      ),
      lookups(),
    );
    const kept = plan.accountsToInsert.map((a) => [
      a.centerpoint_company_id,
      a.centerpoint_alias_ids,
    ]);
    expect(kept).toEqual([
      ["19", ["20"]],
      ["30", ["31"]],
    ]);
  });
  it("imports same-name companies at different addresses twice and flags both", () => {
    const plan = planCenterpointImport(
      files(
        [
          company("1", "Boyd Cat", { City: "Louisville", Address: "1 River Rd" }),
          company("2", "Boyd Cat", { City: "Corbin", Address: "9 Hill St" }),
        ],
        [
          property("5", "Shop", "Boyd Cat", { City: "Corbin" }),
          property("6", "Yard", "Boyd Cat", { City: "Nowhere" }),
        ],
        [],
      ),
      lookups(),
    );
    expect(plan.accountsToInsert.map((a) => a.centerpoint_company_id)).toEqual(["1", "2"]);
    expect(plan.report.counts.companies.sameNameDifferentAddress).toBe(2);
    expect(
      plan.report.flags[
        "companies with the same name but a different address (both imported)"
      ]?.map((f) => f.id),
    ).toEqual(["1", "2"]);
    // A property in the same city goes to that company; one in neither goes to the first and is flagged.
    expect(plan.sitesToInsert.find((s) => s.row.name === "Shop")?.companyCpId).toBe("2");
    expect(plan.sitesToInsert.find((s) => s.row.name === "Yard")?.companyCpId).toBe("1");
    expect(plan.report.counts.properties.ambiguousCompany).toBe(1);
  });
  it("takes the account's contact info from the earliest contact that has any", () => {
    const plan = planCenterpointImport(
      files(
        [company("1", "Acme")],
        [],
        [
          contact("3", "Late Larry", "Acme", {
            Email: "larry@acme.com",
            "Created At": "05/05/2025 09:00:00 AM",
          }),
          contact("1", "Empty Ed", "Acme", { "Created At": "01/01/2020 09:00:00 AM" }),
          contact("2", "Early Erin", "Acme", {
            Office: "6065551234",
            Ext: "7",
            Mobile: "+16065559999",
            "Created At": "02/02/2021 09:00:00 AM",
          }),
        ],
      ),
      lookups(),
    );
    expect(plan.accountsToInsert[0]).toMatchObject({
      contact_name: "Early Erin",
      phone: "(606) 555-1234 x7",
      mobile: "(606) 555-9999",
      email: null,
    });
    expect(plan.contactsToInsert.map((c) => c.row.name)).toEqual([
      "Empty Ed",
      "Early Erin",
      "Late Larry",
    ]);
    expect(plan.contactsToInsert[1]?.row.created_at).toBe("2021-02-02T14:00:00.000Z");
  });
  it("imports a company with no contact info at all and counts it", () => {
    const plan = planCenterpointImport(
      files([company("1", "Lonely")], [], [contact("9", "Nobody", "Lonely")]),
      lookups(),
    );
    expect(plan.accountsToInsert[0]).toMatchObject({
      email: null,
      phone: null,
      mobile: null,
      source: "import",
    });
    expect(plan.report.counts.companies.noContactInfo).toBe(1);
    expect(
      plan.report.flags["companies imported with no email or phone (badge on the Customers page)"],
    ).toHaveLength(1);
  });
  it("uses an N/A contact's phone for the company when no named contact has one, without a name", () => {
    const plan = planCenterpointImport(
      files([company("1", "Plant")], [], [contact("9", "N/A", "Plant", { Office: "6065550000" })]),
      lookups(),
    );
    expect(plan.contactsToInsert).toHaveLength(0);
    expect(plan.report.counts.contacts.skippedNames).toBe(1);
    expect(plan.accountsToInsert[0]).toMatchObject({ contact_name: null, phone: "(606) 555-0000" });
    expect(plan.report.counts.companies).toMatchObject({
      noContactInfo: 0,
      contactInfoFromPlaceholder: 1,
    });
  });
  it("maps managers by full name; CP SUPPORT and unknown names are null and reported once", () => {
    const plan = planCenterpointImport(
      files(
        [
          company("1", "A", { Manager: "garry peters " }),
          company("2", "B", { Manager: "CP SUPPORT" }),
          company("3", "C", { Manager: "CP SUPPORT" }),
          company("4", "D", { Manager: "Somebody Else" }),
          company("5", "E"),
        ],
        [property("50", "P", "E", { "Account Manager": "Mark Barger" })],
        [],
      ),
      lookups(),
    );
    const by = Object.fromEntries(plan.accountsToInsert.map((a) => [a.name, a.account_manager_id]));
    expect(by).toEqual({ A: "u-garry", B: null, C: null, D: null, E: "u-mark" });
    expect(plan.report.unmatchedManagers).toEqual([
      { name: "CP SUPPORT", count: 2 },
      { name: "Somebody Else", count: 1 },
    ]);
    expect(plan.report.counts.companies.managerFromProperties).toBe(1);
  });
  it("normalises state, keeps the customer number as typed and reports non-6-digit ones", () => {
    const plan = planCenterpointImport(
      files(
        [
          company("1", "A", { State: "Kentucky", "External Identifier": "123456" }),
          company("2", "B", { State: "KE", "External Identifier": "NOTonExport" }),
          company("3", "C", { State: "Ohio", "External Identifier": "KCBOE" }),
          company("4", "D", { State: "XX" }),
        ],
        [],
        [],
      ),
      lookups(),
    );
    expect(plan.accountsToInsert.map((a) => a.state)).toEqual(["KY", "KY", "OH", null]);
    expect(plan.accountsToInsert.map((a) => a.external_id)).toEqual([
      "123456",
      "NOTonExport",
      "KCBOE",
      null,
    ]);
    expect(plan.report.nonSixDigitExternalIds).toEqual([
      { id: "2", name: "B", issue: 'customer number "NOTonExport" (CenterPoint\'s placeholder)' },
      { id: "3", name: "C", issue: 'customer number "KCBOE"' },
    ]);
    expect(plan.report.counts.companies.outsideKyTn).toBe(1);
    expect(plan.report.flags["companies with a state that is not a US state"]).toEqual([
      { id: "4", name: "D", issue: 'state "XX"' },
    ]);
  });
});

describe("planCenterpointImport: properties", () => {
  it("folds twins within a company, keeps same-name different-address pairs, maps counties", () => {
    const plan = planCenterpointImport(
      files(
        [company("1", "Uni"), company("2", "Shop")],
        [
          property("10", "Hall", "Uni", { "Recent Activity": "" }),
          property("11", "Hall", "Uni", {
            Address: "5 Oak Avenue",
            "Recent Activity": "02/02/2026 10:00:00 AM",
          }),
          property("12", "Hall", "Uni", { Address: "77 Elm St", County: "Fayette -0004" }),
          property("13", "Hall", "Shop", { County: "Middlesboro" }),
          property("14", "Barn", "Shop", { State: "IL", County: "Cook County" }),
        ],
        [],
      ),
      lookups(),
    );
    expect(
      plan.sitesToInsert.map((s) => [
        s.row.centerpoint_property_id,
        s.row.centerpoint_alias_ids,
        s.companyCpId,
      ]),
    ).toEqual([
      ["11", ["10"], "1"],
      ["12", [], "1"],
      ["13", [], "2"],
      ["14", [], "2"],
    ]);
    expect(plan.report.counts.properties).toMatchObject({
      rows: 5,
      new: 4,
      folded: 1,
      sameNameDifferentAddress: 2,
      outsideKyTn: 1,
    });
    const county = Object.fromEntries(
      plan.sitesToInsert.map((s) => [s.row.centerpoint_property_id, s.row.county_code_id]),
    );
    expect(county).toEqual({ "11": "cc-laurel", "12": "cc-fayette", "13": null, "14": null });
    expect(plan.report.unmatchedCounties).toEqual([{ name: "Middlesboro", count: 1 }]);
  });
  it("does not import a property whose company is missing, and says so", () => {
    const plan = planCenterpointImport(
      files([company("1", "A")], [property("9", "Lost", "Nobody")], []),
      lookups(),
    );
    expect(plan.sitesToInsert).toHaveLength(0);
    expect(plan.report.counts.properties.noCompany).toBe(1);
  });
});

describe("planCenterpointImport: contacts", () => {
  it("skips N/A names, folds same name + same email or phone, keeps same name different details", () => {
    const plan = planCenterpointImport(
      files(
        [company("1", "Acme")],
        [],
        [
          contact("1", "N/A", "Acme"),
          contact("2", "NA", "Acme"),
          contact("3", "Sam Hill", "Acme", { Email: "Sam@acme.com" }),
          contact("4", "sam hill", "Acme", { Email: "sam@ACME.com", Mobile: "6065551111" }),
          contact("5", "Sam Hill", "Acme", { Mobile: "6065552222" }),
          contact("6", "Sam Hill", "Acme", { Office: "+16065552222" }),
        ],
      ),
      lookups(),
    );
    expect(plan.contactsToInsert.map((c) => c.row.centerpoint_contact_id)).toEqual(["3", "5"]);
    expect(plan.report.counts.contacts).toMatchObject({
      rows: 6,
      new: 2,
      skippedNames: 2,
      folded: 2,
    });
    expect(
      plan.report.flags["contacts folded into a twin (same company, name and email or phone)"],
    ).toEqual([
      { id: "4", name: "sam hill", issue: "same as 3; not imported" },
      { id: "6", name: "Sam Hill", issue: "same as 5; not imported" },
    ]);
  });
  it("lists wrong-looking emails and unusable phones without dropping the email", () => {
    const plan = planCenterpointImport(
      files(
        [company("1", "Acme")],
        [],
        [contact("7", "Jo", "Acme", { Email: "jo@acme", Office: "+1", Mobile: "6065551234" })],
      ),
      lookups(),
    );
    expect(plan.contactsToInsert[0]?.row).toMatchObject({
      email: "jo@acme",
      office_phone: null,
      mobile: "(606) 555-1234",
    });
    expect(plan.report.badEmails).toEqual([{ id: "7", name: "Jo", issue: 'email "jo@acme"' }]);
    expect(plan.report.oddPhones).toEqual([{ id: "7", name: "Jo", issue: 'office phone "+1"' }]);
  });
});

describe("planCenterpointImport: matching the live portal", () => {
  const live = lookups({
    accounts: [
      acct("a-done", "Done Co", { centerpoint_company_id: "1" }),
      acct("a-alias", "Alias Co", { centerpoint_company_id: "900", centerpoint_alias_ids: ["2"] }),
      acct("a-name", "Named Co", { external_id: "" }),
      acct("a-gone", "Ghost Co", { deleted_at: "2026-01-01T00:00:00Z" }),
      acct("a-gone-id", "Ghost Two", {
        centerpoint_company_id: "5",
        deleted_at: "2026-01-01T00:00:00Z",
      }),
    ],
    sites: [
      { id: "s-done", account_id: "a-done", name: "Roof A", centerpoint_property_id: "10" },
      { id: "s-name", account_id: "a-name", name: "Main Plant", centerpoint_property_id: null },
    ],
    contacts: [
      { id: "c-done", account_id: "a-done", name: "Zed", centerpoint_contact_id: "20" },
      {
        id: "c-name",
        account_id: "a-name",
        name: "Kim Lee",
        centerpoint_contact_id: null,
        email: "KIM@named.com",
      },
      {
        id: "c-other",
        account_id: "a-name",
        name: "Kim Lee",
        centerpoint_contact_id: null,
        mobile: "6065550000",
      },
    ],
  });
  const plan = planCenterpointImport(
    files(
      [
        company("1", "Done Co"),
        company("2", "Alias Co"),
        company("3", "named co", { "External Identifier": "654321" }),
        company("4", "Ghost Co"),
        company("5", "Ghost Two"),
        company("6", "Brand New"),
      ],
      [
        property("10", "Roof A", "Done Co"),
        property("11", "Roof B", "Done Co"),
        property("12", "MAIN PLANT", "named co"),
        property("13", "Annex", "named co"),
      ],
      [
        contact("20", "Zed", "Done Co"),
        contact("21", "Kim Lee", "named co", { Email: "kim@named.com" }),
        contact("22", "Kim Lee", "named co", { Mobile: "(606) 555-0000" }),
        contact("23", "Kim Lee", "named co", { Email: "other@named.com" }),
      ],
    ),
    live,
  );
  it("skips companies already imported by id or alias, links by name, ignores deleted ones", () => {
    expect(plan.report.counts.companies).toMatchObject({ rows: 6, already: 2, linked: 1, new: 3 });
    expect(plan.accountsToInsert.map((a) => a.name)).toEqual([
      "Ghost Co",
      "Ghost Two",
      "Brand New",
    ]);
    expect(plan.accountsToLink).toEqual([
      {
        id: "a-name",
        name: "named co",
        centerpoint_company_id: "3",
        set: { centerpoint_company_id: "3", external_id: "654321" },
      },
    ]);
    expect(plan.existingAccountIds).toEqual({ "1": "a-done", "2": "a-alias", "3": "a-name" });
  });
  it("skips properties by id, links by name under the same customer, adds the rest", () => {
    expect(plan.report.counts.properties).toMatchObject({ already: 1, linked: 1, new: 2 });
    expect(plan.sitesToLink).toEqual([
      { id: "s-name", name: "MAIN PLANT", set: { centerpoint_property_id: "12" } },
    ]);
    expect(plan.sitesToInsert.map((s) => [s.row.name, s.companyCpId])).toEqual([
      ["Roof B", "1"],
      ["Annex", "3"],
    ]);
  });
  it("skips contacts by id, links by name plus email or phone, adds the rest", () => {
    expect(plan.report.counts.contacts).toMatchObject({ already: 1, linked: 2, new: 1 });
    expect(plan.contactsToLink).toEqual([
      { id: "c-name", name: "Kim Lee", set: { centerpoint_contact_id: "21" } },
      { id: "c-other", name: "Kim Lee", set: { centerpoint_contact_id: "22" } },
    ]);
    expect(plan.contactsToInsert.map((c) => c.row.centerpoint_contact_id)).toEqual(["23"]);
  });
  it("does not fill a customer number the portal already has", () => {
    const p = planCenterpointImport(
      files([company("3", "Named Co", { "External Identifier": "654321" })], [], []),
      lookups({ accounts: [acct("a-name", "Named Co", { external_id: "111111" })] }),
    );
    expect(p.accountsToLink[0]?.set).toEqual({ centerpoint_company_id: "3" });
  });
});

describe("the report and determinism", () => {
  const input = files(
    [
      company("2", "Zeta", { Manager: "CP SUPPORT" }),
      company("1", "Alpha", { "External Identifier": "ABC" }),
    ],
    [property("9", "Site", "Zeta", { County: "Middlesboro" })],
    [
      contact("5", "N/A", "Alpha"),
      contact("4", "Bo", "Alpha", { Email: "bo@alpha", Office: "+1" }),
    ],
  );
  it("formatImportReport has the key lines", () => {
    const plan = planCenterpointImport(input, lookups());
    const text = formatImportReport(plan);
    expect(text).toContain("CenterPoint import — dry run report");
    expect(text).toContain("2 rows in the file");
    expect(text).toContain("2 new customers to create");
    expect(text).toContain("1 named N/A (skipped)");
    expect(text).toContain("Account managers not found (set to none)");
    expect(text).toContain("  CP SUPPORT: 1 company");
    expect(text).toContain("Counties not in county_codes (left blank)");
    expect(text).toContain("  Middlesboro: 1 property");
    expect(text).toContain("Customer numbers that are not 6 digits (kept as typed)");
    expect(text).toContain('  1  Alpha  — customer number "ABC"');
    expect(text).toContain("Emails that look wrong (kept as typed)");
    expect(text).toContain('  4  Bo  — email "bo@alpha"');
    expect(text).toContain("Phones that could not be read (left blank)");
    expect(text).toContain('  4  Bo  — office phone "+1"');
    expect(text).toContain("Nothing is deleted or overwritten");
    expect(planSummary(plan)).toEqual({
      accounts: 2,
      accountLinks: 0,
      sites: 1,
      siteLinks: 0,
      contacts: 1,
      contactLinks: 0,
    });
  });
  it("gives the same JSON for the same input, whatever the row order", () => {
    const a = JSON.stringify(planCenterpointImport(input, lookups()));
    const b = JSON.stringify(planCenterpointImport(input, lookups()));
    expect(a).toBe(b);
    const shuffled = files(
      [
        company("1", "Alpha", { "External Identifier": "ABC" }),
        company("2", "Zeta", { Manager: "CP SUPPORT" }),
      ],
      [property("9", "Site", "Zeta", { County: "Middlesboro" })],
      [
        contact("4", "Bo", "Alpha", { Email: "bo@alpha", Office: "+1" }),
        contact("5", "N/A", "Alpha"),
      ],
    );
    expect(JSON.stringify(planCenterpointImport(shuffled, lookups()))).toBe(a);
  });
});

// ---- Migration, server functions, page, sidebar, badge --------------------------------------

describe("20261013120000_centerpoint_import.sql", () => {
  const sql = readFileSync("supabase/migrations/20261013120000_centerpoint_import.sql", "utf8");
  it("adds the alias columns to customers and properties", () => {
    expect(sql).toMatch(
      /alter table public\.crm_accounts\s+add column if not exists centerpoint_alias_ids text\[\] not null default '\{\}'/,
    );
    expect(sql).toMatch(
      /alter table public\.crm_sites\s+add column if not exists centerpoint_alias_ids text\[\] not null default '\{\}'/,
    );
  });
  it("relaxes crm_accounts_contact_required for source = 'import', still NOT VALID", () => {
    expect(sql).toContain("drop constraint if exists crm_accounts_contact_required");
    const check = sql.slice(sql.indexOf("add constraint crm_accounts_contact_required"));
    expect(check).toContain("deleted_at is not null");
    expect(check).toContain("or source = 'import'");
    expect(check).toContain("or nullif(btrim(email), '') is not null");
    expect(check).toContain("or nullif(btrim(phone), '') is not null");
    expect(check).toContain("or nullif(btrim(mobile), '') is not null");
    expect(check).toMatch(/\)\s*not valid;/);
  });
  it("adds one live row per CenterPoint ID on the three tables", () => {
    for (const [idx, table, col] of [
      ["crm_accounts_centerpoint_company_id_key", "crm_accounts", "centerpoint_company_id"],
      ["crm_sites_centerpoint_property_id_key", "crm_sites", "centerpoint_property_id"],
      ["crm_contacts_centerpoint_contact_id_key", "crm_contacts", "centerpoint_contact_id"],
    ]) {
      expect(sql).toMatch(
        new RegExp(
          `create unique index if not exists ${idx}\\s+on public\\.${table} \\(${col}\\)\\s+where ${col} is not null and deleted_at is null;`,
        ),
      );
    }
  });
  it("does not rewrite audit_row() (its skip list is a hard-coded constant)", () => {
    expect(sql).not.toContain("create or replace function public.audit_row()");
    expect(sql).not.toContain("v_skip constant");
  });
  it("is known to the generated types", () => {
    const types = readFileSync("src/integrations/supabase/types.ts", "utf8");
    const accounts = types.slice(
      types.indexOf("      crm_accounts: {"),
      types.indexOf("      crm_contacts: {"),
    );
    const sites = types.slice(
      types.indexOf("      crm_sites: {"),
      types.indexOf("      crm_sites: {") + 3000,
    );
    expect(accounts).toContain("centerpoint_alias_ids: string[];");
    expect(sites).toContain("centerpoint_alias_ids: string[];");
  });
});

describe("the server functions", () => {
  const src = readFileSync("src/lib/centerpoint-import.functions.ts", "utf8");
  it("are admin only, plan on the server for both calls, and cap each CSV at 5 MB", () => {
    expect(src).toContain("export const MAX_CSV_CHARS = 5 * 1024 * 1024;");
    expect(src).toMatch(
      /planCenterpointImport = createServerFn\(\{ method: "POST" \}\)\s*\.middleware\(\[requireSupabaseAuth\]\)\s*\.validator\(\(d: unknown\) => parseInput\(importInputSchema, d\)\)\s*\.handler\(async \(\{ data, context \}\): Promise<PlanResult> => \{\s*await assertAdmin\(context\.supabase, context\.userId\);/,
    );
    expect(src).toMatch(
      /applyCenterpointImport = createServerFn\(\{ method: "POST" \}\)\s*\.middleware\(\[requireSupabaseAuth\]\)\s*\.validator\(\(d: unknown\) => parseInput\(importInputSchema, d\)\)\s*\.handler\(async \(\{ data, context \}\): Promise<ApplyResult> => \{\s*const admin = await assertAdmin\(context\.supabase, context\.userId\);/,
    );
    // The apply step never takes a plan from the client.
    expect(src).toContain(
      "const plan = buildPlan(data, await loadLookups(context.supabase));\n    return writePlan(",
    );
    expect(src).toContain("export const BATCH = 200;");
    expect(src).toContain('.select("id, centerpoint_company_id")');
  });
});

describe("Admin › Import from CenterPoint", () => {
  const page = readFileSync("src/components/centerpoint-import-page.tsx", "utf8");
  const route = readFileSync("src/routes/admin.centerpoint-import.tsx", "utf8");
  const nav = readFileSync("src/components/app-sidebar.tsx", "utf8");
  const access = readFileSync("src/lib/access.ts", "utf8");
  it("has its route and sidebar entry, admins only", () => {
    expect(route).toContain('createFileRoute("/admin/centerpoint-import")');
    expect(route).toContain("component: CenterpointImportPage");
    expect(nav).toMatch(
      /\{\s*title: "Import from CenterPoint",\s*url: "\/admin\/centerpoint-import",\s*icon: Upload,\s*adminOnly: true,?\s*\}/,
    );
    expect(access).toContain('pathname.startsWith("/admin/centerpoint-import")');
  });
  it("takes three CSV files, runs a dry run, and only then offers Import", () => {
    expect(page.match(/type="file"/g)).toHaveLength(1);
    expect(page).toContain('accept=".csv,text/csv"');
    expect(page).toContain("{FILES.map((f) =>");
    expect(page).toContain(">Dry run</");
    expect(page).toContain("disabled={!input || busy !== null}");
    expect(page).toContain("const dryRunMatches = !!plan && plan.key === currentKey;");
    expect(page).toMatch(/\{dryRunMatches && summary && \(\s*<Button/);
    expect(page).toContain("Download report");
    expect(page).toContain('new Blob([plan.result.report], { type: "text/plain;charset=utf-8" })');
  });
  it("confirms with the counts and the no-overwrite promise", () => {
    expect(page).toContain("<DialogTitle>Import from CenterPoint?</DialogTitle>");
    expect(page).toContain('{summary ? confirmText(summary) : ""}');
    expect(
      confirmText({
        accounts: 2,
        accountLinks: 0,
        sites: 1,
        siteLinks: 0,
        contacts: 1,
        contactLinks: 0,
      }),
    ).toBe("This writes 2 customers, 1 property, 1 contact. Nothing is deleted or overwritten.");
    expect(
      confirmText({
        accounts: 1200,
        accountLinks: 0,
        sites: 1,
        siteLinks: 0,
        contacts: 0,
        contactLinks: 0,
      }),
    ).toBe(
      "This writes 1,200 customers, 1 property, 0 contacts. Nothing is deleted or overwritten.",
    );
    // The Import button is tied to the dry run's files.
    expect(textsKey({ companies: "a", properties: "b", contacts: "c" })).toBe(
      textsKey({ companies: "a", properties: "b", contacts: "c" }),
    );
    expect(textsKey({ companies: "a", properties: "b", contacts: "c" })).not.toBe(
      textsKey({ companies: "a", properties: "b", contacts: "d" }),
    );
  });
});

describe("the Customers page", () => {
  const src = readFileSync("src/components/customers-page.tsx", "utf8");
  it("shows a muted No contact info badge in the list row and the header", () => {
    expect(src).toContain('data-badge="no-contact-info"');
    expect(src).toContain(">\n      No contact info\n    </Badge>");
    expect(src).toContain("text-muted-foreground");
    expect(
      src.match(/\{!a\.deleted_at && !hasContactMethod\(a\) && <NoContactInfoBadge \/>\}/g),
    ).toHaveLength(2);
  });
});
