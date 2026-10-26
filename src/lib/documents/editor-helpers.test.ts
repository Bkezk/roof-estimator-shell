/**
 * The Documents editor's pure helpers: the route's search params, the Variables tab filter and
 * grouping, chip text, the pricing table rebuilt from a variable snapshot, saved-module chips,
 * the sheet geometry and the small text formats.
 */
import { describe, expect, it } from "vitest";

import {
  backHref,
  chipText,
  clampPageBreak,
  dataUrlBase64,
  documentSearch,
  emailDefaults,
  filterVariables,
  groupVariables,
  moduleFingerprint,
  newDocumentTitle,
  pageBreakPx,
  pageRowText,
  pageTabLabel,
  parseMoney,
  parsePageBreak,
  parseSections,
  pricingSourceFromVariables,
  SAMPLE_SECTIONS,
  savedModuleNamesOnPage,
  SECTIONS_VARIABLE,
  SHEET,
  sheetScale,
  stampText,
  variableNodeJson,
  variableRowValue,
  versionLine,
  packIntoSheets,
  sheetContentLimit,
  continuedTabLabel,
} from "./editor-helpers";
import { cloneModule, newModule, newPage, VARIABLE_NODE } from "./model";
import { pricingRows, sampleVariables, VARIABLE_GROUPS, variableDefs } from "./variables";

const UUID = "0b4d7c2e-1b2c-4d3e-8f90-123456789abc";

describe("documentSearch", () => {
  it("keeps a document id, a template id or 'new', and a kind", () => {
    expect(documentSearch({ id: UUID })).toEqual({ id: UUID });
    expect(documentSearch({ template: UUID })).toEqual({ template: UUID });
    expect(documentSearch({ template: "new", kind: "ticket" })).toEqual({
      template: "new",
      kind: "ticket",
    });
  });
  it("drops anything malformed", () => {
    expect(documentSearch({ id: "abc", template: "x", kind: "letter" })).toEqual({});
    expect(documentSearch({})).toEqual({});
  });
});

describe("filterVariables", () => {
  const defs = variableDefs("bid");
  it("returns everything for a blank query", () => {
    expect(filterVariables("", defs)).toHaveLength(defs.length);
    expect(filterVariables("   ", defs)).toHaveLength(defs.length);
  });
  it("matches label, key or group, any case, every word", () => {
    const keys = (q: string) => filterVariables(q, defs).map((d) => d.key);
    expect(keys("total price")).toEqual(["opportunity.price"]);
    expect(keys("COMPANY.NAME")).toEqual(["company.name"]);
    expect(keys("account manager")).toEqual(
      expect.arrayContaining(["account_manager.name", "account_manager.email"]),
    );
    expect(keys("zip")).toEqual(["account.zip", "company.zip", "property.zip"]);
    expect(keys("nothing like this")).toEqual([]);
  });
  it("only offers the kind's variables (a ticket has no bid price)", () => {
    expect(filterVariables("price", variableDefs("ticket"))).toEqual([]);
    expect(filterVariables("ticket number", variableDefs("bid"))).toEqual([]);
  });
});

describe("groupVariables", () => {
  it("follows VARIABLE_GROUPS order and leaves empty groups out", () => {
    const groups = groupVariables(variableDefs("bid"));
    const names = groups.map((g) => g.group);
    expect(names).not.toContain("Ticket");
    expect(names).toEqual(VARIABLE_GROUPS.filter((g) => names.includes(g)));
    expect(groups.every((g) => g.defs.length > 0)).toBe(true);
    expect(groupVariables(variableDefs("ticket")).map((g) => g.group)).toContain("Ticket");
  });
});

describe("chipText / variableRowValue / variableNodeJson", () => {
  it("prints the value, or the label in brackets when blank", () => {
    expect(chipText("company.name", { "company.name": "City of Corbin" })).toBe("City of Corbin");
    expect(chipText("company.name", { "company.name": "" })).toBe("[Company Name]");
    expect(chipText("company.name", {})).toBe("[Company Name]");
    expect(chipText("made.up", {})).toBe("[made.up]");
  });
  it("the Variables tab shows a dash for a blank", () => {
    expect(variableRowValue("")).toBe("—");
    expect(variableRowValue(undefined)).toBe("—");
    expect(variableRowValue("x")).toBe("x");
  });
  it("the chip node", () => {
    expect(variableNodeJson("today")).toEqual({ type: VARIABLE_NODE, attrs: { key: "today" } });
  });
});

describe("the pricing table from a variable snapshot", () => {
  it("parseMoney reads the Total Price text", () => {
    expect(parseMoney("$242,879.61")).toBe(242879.61);
    expect(parseMoney("1200")).toBe(1200);
    expect(parseMoney("-$5.00")).toBe(-5);
    expect(parseMoney("")).toBeNull();
    expect(parseMoney(undefined)).toBeNull();
    expect(parseMoney("n/a")).toBeNull();
  });
  it("parseSections is defensive", () => {
    expect(parseSections(undefined)).toEqual([]);
    expect(parseSections("not json")).toEqual([]);
    expect(parseSections('{"a":1}')).toEqual([]);
    expect(
      parseSections(
        JSON.stringify([
          { name: "A", lengthFt: 100, widthFt: 50, system: "DL" },
          { name: "bad", lengthFt: "x" },
          null,
        ]),
      ),
    ).toEqual([{ name: "A", lengthFt: 100, widthFt: 50, system: "DL" }]);
  });
  it("builds rows pricingRows accepts: sections then the total", () => {
    const vars = {
      "opportunity.price": "$10,000.00",
      [SECTIONS_VARIABLE]: JSON.stringify([
        { name: "Main", lengthFt: 100, widthFt: 50, system: "Duro-Last" },
      ]),
    };
    const src = pricingSourceFromVariables(vars);
    const { rows } = pricingRows(src, "total", true);
    expect(rows).toEqual([
      ["Main", "50 × 100 ft", "5,000", "Duro-Last"],
      ["Total", "", "", "$10,000.00"],
    ]);
    expect(pricingRows(src, "none", true).rows).toHaveLength(1);
  });
  it("template mode falls back to the sample sections; a document never does", () => {
    const vars = sampleVariables("bid");
    expect(pricingSourceFromVariables(vars, true).bid?.sections).toEqual(SAMPLE_SECTIONS);
    expect(pricingSourceFromVariables(vars).bid?.sections).toEqual([]);
    expect(pricingSourceFromVariables(vars).bid?.total).toBe(242879.61);
  });
});

describe("saved module chips", () => {
  it("fingerprints ignore the id, so a clone matches its saved module", () => {
    const m = newModule("signature");
    expect(moduleFingerprint(cloneModule(m))).toBe(moduleFingerprint(m));
    const other = { ...newModule("signature"), lines: ["Owner"] };
    expect(moduleFingerprint(other)).not.toBe(moduleFingerprint(m));
  });
  it("names each saved module on the page once, in page order", () => {
    const sig = newModule("signature");
    const hr = newModule("hr");
    const saved = [
      { name: "Sustainability_Sheet", module: sig },
      { name: "Rule", module: hr },
    ];
    const page = newPage([cloneModule(hr), newModule("body"), cloneModule(sig), cloneModule(sig)]);
    expect(savedModuleNamesOnPage(page, saved)).toEqual(["Rule", "Sustainability_Sheet"]);
    expect(savedModuleNamesOnPage(page, [])).toEqual([]);
    expect(savedModuleNamesOnPage(newPage([newModule("body")]), saved)).toEqual([]);
  });
});

describe("the sheet", () => {
  it("is US Letter at 96 dpi with a 0.75 in pad", () => {
    expect(SHEET).toEqual({ width: 816, height: 1056, pad: 72 });
  });
  it("the page-break guide sits at pageBreakIn inches when the footer is on", () => {
    expect(pageBreakPx({ footer: true, pageBreakIn: 8.8 })).toBe(845);
    expect(pageBreakPx({ footer: false, pageBreakIn: 8.8 })).toBeNull();
    expect(pageBreakPx({ footer: true, pageBreakIn: 20 })).toBe(1008);
  });
  it("the page-break box: blank keeps 8.8, out of range clamps to 5–10.5", () => {
    expect(parsePageBreak("")).toBe(8.8);
    expect(parsePageBreak("7.5")).toBe(7.5);
    expect(parsePageBreak("2")).toBe(5);
    expect(parsePageBreak("12")).toBe(10.5);
    expect(parsePageBreak("abc")).toBe(8.8);
    expect(clampPageBreak(Number.NaN)).toBe(8.8);
  });
  it("shrinks to the canvas but never grows past 1:1", () => {
    expect(sheetScale(2000)).toBe(1);
    expect(sheetScale(848)).toBe(1);
    expect(sheetScale(440)).toBeCloseTo(0.5);
    expect(sheetScale(0)).toBe(1);
    expect(sheetScale(100)).toBe(0.3);
  });
  it("labels", () => {
    expect(pageTabLabel(0)).toBe("Page 1");
    expect(pageRowText(0, 1)).toBe("1 Page · 1 module");
    expect(pageRowText(2, 4)).toBe("3 Page · 4 modules");
  });
});

describe("text bits", () => {
  it("stampText prints the office's clock", () => {
    expect(stampText("2026-10-26T14:19:00Z")).toBe("Oct 26, 10:19 AM");
    expect(stampText(null)).toBe("");
    expect(stampText("garbage")).toBe("");
  });
  it("versionLine", () => {
    expect(
      versionLine({ version: 3, updated_at: "2026-10-26T14:19:00Z", updated_by_name: "Brian" }),
    ).toBe("v3 · Oct 26, 10:19 AM by Brian");
    expect(
      versionLine({ version: 1, updated_at: "2026-10-26T14:19:00Z", updated_by_name: "" }),
    ).toBe("v1 · Oct 26, 10:19 AM");
  });
  it("a new document's title: template — record; Blank reads Document", () => {
    expect(newDocumentTitle("Proposal", { kind: "bid", label: "4344" })).toBe("Proposal — 4344");
    expect(newDocumentTitle(null, { kind: "bid", label: "4344" })).toBe("Document — 4344");
    expect(newDocumentTitle("  ", { kind: "ticket", label: "Ticket 6012" })).toBe(
      "Document — Ticket 6012",
    );
  });
  it("email defaults: every contact email once, the title as subject", () => {
    const d = emailDefaults("Proposal — 4344", [
      { name: "Jason", email: "j@x.gov" },
      { name: "Dup", email: "j@x.gov" },
      { name: "No email", email: "" },
      { name: "Ann", email: " ann@x.gov " },
    ]);
    expect(d.to).toBe("j@x.gov, ann@x.gov");
    expect(d.subject).toBe("Proposal — 4344 — JBK, Inc.");
    expect(d.text).toContain("Proposal — 4344");
  });
  it("backHref joins the record's search", () => {
    expect(backHref({ to: "/estimate", search: { id: "abc", tab: "summary" } })).toBe(
      "/estimate?id=abc&tab=summary",
    );
    expect(backHref({ to: "/bids", search: {} })).toBe("/bids");
    expect(backHref(null)).toBe("/");
  });
  it("dataUrlBase64 strips the prefix", () => {
    expect(dataUrlBase64("data:image/png;base64,AAAA")).toBe("AAAA");
    expect(dataUrlBase64("AAAA")).toBe("AAAA");
  });
});

describe("the screen breaks pages where the PDF does (owner, Oct 26: 'the page breaks should start a new page')", () => {
  it("sheetContentLimit: up to the dotted line with the footer on, else the padded sheet", () => {
    expect(sheetContentLimit({ footer: true, pageBreakIn: 8.8 })).toBe(Math.round(8.8 * 96) - 72);
    expect(sheetContentLimit({ footer: false, pageBreakIn: 8.8 })).toBe(1056 - 72 - 72);
  });
  it("packIntoSheets: a module that does not fit starts the next sheet; a giant one gets its own", () => {
    const items = [
      { id: "a", height: 300 },
      { id: "b", height: 300 },
      { id: "c", height: 300 },
      { id: "d", height: 2000 },
      { id: "e", height: 10 },
    ];
    expect(packIntoSheets(items, 700, 12)).toEqual([["a", "b"], ["c"], ["d"], ["e"]]);
    // Unmeasured modules weigh nothing, so the first paint is one sheet.
    expect(
      packIntoSheets(
        [
          { id: "a", height: undefined },
          { id: "b", height: undefined },
        ],
        700,
        12,
      ),
    ).toEqual([["a", "b"]]);
    expect(packIntoSheets([], 700, 12)).toEqual([[]]);
  });
  it("tab labels", () => {
    expect(continuedTabLabel(0, 0)).toBe("Page 1");
    expect(continuedTabLabel(1, 2)).toBe("Page 2 · continued");
  });
});
