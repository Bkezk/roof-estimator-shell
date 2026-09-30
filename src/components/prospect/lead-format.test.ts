import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { LeadCard } from "@/components/prospect/lead-card";
import {
  fetchProblem,
  isNewLead,
  joinProblems,
  lastCheckProblem,
} from "@/components/prospect/lead-format";
import type { LeadRow } from "@/lib/leads.functions";

/* ---- 2. The red line on the Bid Board ------------------------------------------------------ */

// A refresh's note as it read on Sep 30, before the problems were stored apart.
const HEAD =
  "98 planroom, 13 Louisville, 25 Lynn, 0 Bowling Green, 3 Paducah, 7 Lexington, 9 campus, SAM.gov not pulled (once a day; next after Oct 1, 6:45 AM ET), BidNet (TN+KY; 2 closing times read), TN: 6 STREAM, 14 UT, 64 Nashville, 39 Chattanooga, 7 Knox County, 13 TN universities, 0 new (0 roof), 0 gone, 0 job pages read";
// The four failures the old regex let through without a red line.
const MISSED = [
  "State planroom: sign-in refused — The login attempt was not successful.",
  "Lynn planroom: login form not found (page layout changed?)",
  "Metro Nashville re-roof permits → 503",
  "Re-roof marking Could not find the table 'public.reroof_permits' in the schema cache",
];

describe("the red line", () => {
  it("shows every stored problem, whatever it starts with", () => {
    for (const p of MISSED)
      expect(lastCheckProblem({ last_fetch_note: HEAD, last_fetch_problems: [p] }, null)).toBe(p);
    expect(lastCheckProblem({ last_fetch_note: HEAD, last_fetch_problems: MISSED }, null)).toBe(
      MISSED.join("; "),
    );
    // A clean run: no red line, even if the note happens to say "failed".
    expect(
      lastCheckProblem({ last_fetch_note: "0 failed attempts", last_fetch_problems: [] }, null),
    ).toBeNull();
  });

  it("reads an older note (no stored list) for the same failures", () => {
    for (const p of MISSED) {
      expect(fetchProblem(`${HEAD}; ${p}`)).toBe(p);
      expect(
        lastCheckProblem({ last_fetch_note: `${HEAD}; ${p}`, last_fetch_problems: null }, null),
      ).toBe(p);
    }
    expect(fetchProblem(`${HEAD}, 2 buildings marked re-roofed; BidNet TN → 503`)).toBe(
      "BidNet TN → 503",
    );
    // "(TN+KY; 2 closing times read)" is part of the summary, not a problem.
    expect(fetchProblem(HEAD)).toBeNull();
    expect(fetchProblem("running since 2026-09-30T10:00:00Z: pulling 31 lists…")).toBeNull();
  });

  it("keeps the refresh's own error when the job-page reads fail too", () => {
    const settings = { last_fetch_note: HEAD, last_fetch_problems: ["Paducah bids → 503"] };
    const refreshError = "Paducah bids → 503";
    const pages = "State planroom: sign-in refused — bad password";
    expect(lastCheckProblem(settings, refreshError, pages)).toBe(`${refreshError}; ${pages}`);
    // No refresh this visit: the stored problems plus the page reads.
    expect(lastCheckProblem(settings, null, pages)).toBe(`Paducah bids → 503; ${pages}`);
    expect(joinProblems(null, "a")).toBe("a");
    expect(joinProblems("a", "a")).toBe("a");
    expect(joinProblems("a; b", "b; c")).toBe("a; b; c");
    expect(joinProblems(null, null)).toBeNull();
  });
});

/* ---- 5. The New badge ------------------------------------------------------------------------ */

const now = Date.now();
const base: LeadRow = {
  id: "00000000-0000-0000-0000-000000000001",
  source: "ky_planroom",
  external_id: "1",
  title: "RFB-86-27 FSS - Jackson SOB Roof Replacement",
  agency: null,
  location: "Jackson",
  county: null,
  address: null,
  city: null,
  lat: null,
  lng: null,
  project_type: null,
  sqft: null,
  project_cost: null,
  contractor: null,
  prebid_at: null,
  bid_at: null,
  issued_on: null,
  url: "https://www.stateofkyplanroom.com/View/ViewJob.aspx?job_id=1",
  is_roof: true,
  building_id: null,
  note: null,
  raw: null,
  contact: null,
  details: null,
  details_read_at: null,
  state: "KY",
  first_seen_at: new Date(now - 86400000).toISOString(),
  last_seen_at: new Date(now).toISOString(),
  gone_at: null,
  status: "new",
  status_by_name: null,
  status_at: null,
};
const cardText = (lead: LeadRow) =>
  renderToStaticMarkup(
    createElement(LeadCard, { lead, canWrite: true, busy: false, onStatus: () => undefined }),
  )
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");

describe("the New badge", () => {
  it("shows on a fresh lead nobody has touched", () => {
    expect(cardText(base)).toMatch(/\bNew\b/);
    expect(isNewLead(base, now)).toBe(true);
  });

  it("does not come back after Unwatch or Restore (status new, but someone acted)", () => {
    const unwatched = { ...base, status_by_name: "Braden", status_at: new Date(now).toISOString() };
    const text = cardText(unwatched);
    expect(text).toMatch(/Marked new — Braden/);
    expect(text.replace(/Marked new/g, "")).not.toMatch(/\bNew\b/);
    expect(isNewLead(unwatched, now)).toBe(false);
  });

  it("goes after three days", () => {
    expect(
      isNewLead({ ...base, first_seen_at: new Date(now - 4 * 86400000).toISOString() }, now),
    ).toBe(false);
  });
});

/* ---- 1. A campus row's issuer, now that the job page owns the contact ----------------------- */

describe("campus planroom card", () => {
  it("names the plan issuer when there is no contact yet", () => {
    const text = cardText({
      ...base,
      source: "campus_planrooms",
      agency: "WKU",
      contractor: "Messer Construction Co.",
    });
    expect(text).toMatch(/Plans issued by Messer Construction Co\. — bid the roofing to them/);
  });
  it("the job page's contact wins", () => {
    const text = cardText({
      ...base,
      source: "campus_planrooms",
      agency: "WKU",
      contractor: "Messer Construction Co.",
      contact: "Owner: Jane Doe — jane@wku.edu",
    });
    expect(text).toMatch(/Owner: Jane Doe/);
    expect(text).not.toMatch(/Plans issued by/);
  });
});
