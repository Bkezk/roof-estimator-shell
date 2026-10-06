/**
 * Owner, Oct 6: "on the bid board can you get rid of Louisville and Nashville, they apparently
 * don't do work there. and also change Bids to Project Bids". The four Louisville / Nashville
 * sources are retired everywhere the board reads them (lib/leads-retired.ts); Chattanooga stays.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { applyLeadFilters, LEAD_SOURCES, SOURCE_LABELS } from "./leads.functions";
import {
  isRetiredLeadSource,
  RETIRED_LEAD_SOURCES,
  RETIRED_LEAD_SOURCES_IN,
} from "./leads-retired";

const read = (p: string) => readFileSync(p, "utf8");

describe("the retired sources", () => {
  it("are the two Louisville and two Nashville feeds, no more", () => {
    expect([...RETIRED_LEAD_SOURCES]).toEqual([
      "louisville_permits",
      "louisville_bids",
      "nashville_permits",
      "nashville_bids",
    ]);
    expect(isRetiredLeadSource("chattanooga_permits")).toBe(false);
    expect(isRetiredLeadSource("chattanooga_bids")).toBe(false);
    expect(isRetiredLeadSource("ky_planroom")).toBe(false);
    expect(RETIRED_LEAD_SOURCES_IN).toBe(
      "(louisville_permits,louisville_bids,nashville_permits,nashville_bids)",
    );
  });
  it("are off the Source picker; everything else is still on it", () => {
    for (const s of RETIRED_LEAD_SOURCES) expect(LEAD_SOURCES).not.toContain(s);
    for (const s of ["ky_planroom", "chattanooga_permits", "chattanooga_bids", "bidnet", "sam_gov"])
      expect(LEAD_SOURCES).toContain(s);
    expect(LEAD_SOURCES).toHaveLength(Object.keys(SOURCE_LABELS).length - 4);
  });
  it("their rows are left out of the list and the counts unless asked for by name", () => {
    const calls: string[] = [];
    const q = {
      eq: (...a: unknown[]) => (calls.push(`eq${JSON.stringify(a)}`), q),
      or: (...a: unknown[]) => (calls.push(`or${JSON.stringify(a)}`), q),
      not: (...a: unknown[]) => (calls.push(`not${JSON.stringify(a)}`), q),
    };
    applyLeadFilters(q, { state: "TN" });
    expect(calls).toEqual([
      'not["source","in","(louisville_permits,louisville_bids,nashville_permits,nashville_bids)"]',
      'eq["state","TN"]',
    ]);
    calls.length = 0;
    applyLeadFilters(q, { source: "nashville_bids" }); // an old link still answers
    expect(calls).toEqual(['eq["source","nashville_bids"]']);
  });
});

describe("nothing pulls them any more", () => {
  it("the refresh has no Louisville or Nashville permit attempt; Chattanooga's stays", () => {
    const server = read("src/lib/leads.server.ts");
    expect(server).not.toMatch(/attempt\("louisville_permits"/);
    expect(server).not.toMatch(/attempt\("nashville_permits"/);
    expect(server).toMatch(/attempt\("chattanooga_permits", "Chattanooga permits"/);
    expect(server).not.toContain("${louisvilleCount} Louisville");
    expect(server).not.toContain('${counts["nashville_permits"] ?? 0} Nashville');
  });
  it("the nightly browser job skips the two city portals, and the server would not take their rows", () => {
    expect(read("scripts/browser-bids.ts")).toMatch(
      /BROWSER_SOURCES\.filter\(\s*\(s\) => !isRetiredLeadSource\(s\) && \(!only \|\| s === only\),?\s*\)/,
    );
    const imp = read("src/lib/leads-import.server.ts");
    expect(imp).toContain("if (isRetiredLeadSource(parsed.data.source))");
    expect(imp).toContain("is retired — rows not saved");
  });
});

describe("the Bid Board page and its settings", () => {
  const page = read("src/components/leads-page.tsx");
  const settings = read("src/components/prospect/lead-settings.tsx");
  it("no longer describes or promises Louisville or Nashville", () => {
    const about = page.slice(
      page.indexOf("const ABOUT ="),
      page.indexOf('"The app checks the rest'),
    );
    expect(about).not.toMatch(/Louisville|Nashville/);
    expect(about).toContain("Chattanooga city bids: the city's own solicitations");
    expect(page).toContain(
      "Projects out for bid across Kentucky and Tennessee, and Chattanooga commercial",
    );
    expect(page).toContain("Chattanooga city bids come in nightly from a browser job");
    expect(page).toContain("BROWSER_SOURCES.filter((k) => !isRetiredLeadSource(k))");
  });
  it("the settings form has no Louisville or Nashville fields; the saved values ride along", () => {
    const form = settings.slice(settings.indexOf("return ("));
    expect(form).not.toMatch(
      /Louisville permit types|Nashville permit types|Min building size|Permit window/,
    );
    expect(form).toContain("Min construction cost for Chattanooga permits");
    expect(settings).toContain("louisville_types: s.louisville_types,");
    expect(settings).toContain("nashville_types: s.nashville_types,");
  });
});

describe('"Bids" is "Project Bids"', () => {
  it("in the sidebar, the page title and the access help; the URL stays /bids", () => {
    expect(read("src/components/app-sidebar.tsx")).toMatch(
      /\{ title: "Project Bids", url: "\/bids", icon: FileText, page: "estimate" as const \}/,
    );
    const bids = read("src/routes/bids.tsx");
    expect(bids).toContain('<h1 className="text-2xl font-bold tracking-tight">Project Bids</h1>');
    expect(bids).toContain('{ title: "Project Bids — JBK Portal" }');
    expect(bids).not.toContain("Saved Bids");
    expect(read("src/lib/access.ts")).toContain("Project Bids and the estimator");
  });
});
