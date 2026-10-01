import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  BID_NOTES_MAX,
  DEFAULT_CHECKLIST,
  DESCRIPTION_MAX,
  bidPrefillFromInspection,
  fromInspectionLabel,
  inspectionComplete,
  inspectionSchema,
  inspectionSummary,
  mergeChecklist,
  parseInspection,
  repairTicketText,
  type ChecklistItem,
  type Inspection,
  type InspectionItem,
} from "./inspection";
import { parseEstimateSearch } from "./estimate-search";

const checklist: ChecklistItem[] = DEFAULT_CHECKLIST.map((label, i) => ({
  id: `c${i + 1}`,
  label,
  sort: (i + 1) * 10,
}));

const item = (id: string, label: string, status: InspectionItem["status"], note = "") => ({
  id,
  label,
  status,
  note,
});

const done: Inspection = {
  v: 1,
  items: [
    item("c1", "Membrane condition", "ok"),
    item("c2", "Seams", "issue", "Open seam at the NE corner,\n about 6 ft"),
    item("c7", "Ponding", "issue"),
    item("c8", "Debris", "na"),
  ],
  notes: "Roof is 20+ years old. Owner asked about replacement.",
  saved_at: "2026-09-30T14:00:00.000Z",
  saved_by: "Tech Tom",
};

describe("the checklist on a ticket", () => {
  it("starts as the admin's checklist, in order, unanswered", () => {
    const rows = mergeChecklist(null, [...checklist].reverse());
    expect(rows.map((r) => r.label)).toEqual([...DEFAULT_CHECKLIST]);
    expect(rows.every((r) => r.status === null && r.note === "")).toBe(true);
  });
  it("keeps saved answers (and their labels) and adds items added since", () => {
    const renamed = checklist.map((c) => (c.id === "c2" ? { ...c, label: "Seams / laps" } : c));
    const rows = mergeChecklist(done, renamed);
    expect(rows.slice(0, 4)).toEqual(done.items);
    expect(rows[1]!.label).toBe("Seams");
    expect(rows).toHaveLength(4 + (checklist.length - 4));
    expect(rows.slice(4).every((r) => r.status === null)).toBe(true);
  });
  it("summarises the answers", () => {
    expect(inspectionSummary(done.items)).toBe("2 issues · 1 OK · 1 N/A");
    expect(inspectionSummary(mergeChecklist(null, checklist))).toBe("10 not checked");
    expect(inspectionSummary([])).toBe("nothing to check");
  });
  it("stores and reads back its JSON; anything else reads as none", () => {
    const stored = JSON.parse(JSON.stringify(done)) as unknown;
    expect(parseInspection(stored)).toEqual(done);
    expect(parseInspection(null)).toBeNull();
    expect(parseInspection({ v: 1, items: [item("x", "Seams", "maybe" as never)] })).toBeNull();
    expect(inspectionSchema.safeParse({ v: 1, items: [], notes: "" }).success).toBe(true);
  });
  it("is complete once the ticket is Done (or later)", () => {
    expect(["open", "scheduled"].map(inspectionComplete)).toEqual([false, false]);
    expect(["done", "invoiced", "closed"].map(inspectionComplete)).toEqual([true, true, true]);
  });
});

describe("repair ticket text from an inspection", () => {
  it("names the Issue items with their notes; the notes carry the full list", () => {
    const t = repairTicketText(6012, done);
    expect(t.description).toBe(
      "From inspection #6012: Seams — Open seam at the NE corner, about 6 ft; Ponding",
    );
    expect(t.notes).toBe(
      [
        "Issues found on inspection #6012:",
        "- Seams: Open seam at the NE corner,\n about 6 ft",
        "- Ponding",
        "",
        "Inspection notes:",
        "Roof is 20+ years old. Owner asked about replacement.",
      ].join("\n"),
    );
  });
  it("fits the ticket's 500-character description", () => {
    const many: Inspection = {
      ...done,
      items: Array.from({ length: 30 }, (_, i) =>
        item(`i${i}`, `Item ${i}`, "issue", "x".repeat(40)),
      ),
    };
    const t = repairTicketText(6012, many);
    expect(t.description.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
    expect(t.description.endsWith("…")).toBe(true);
  });
  it("with no issues, says where it came from (and the notes)", () => {
    expect(repairTicketText(6012, { items: [], notes: "" })).toEqual({
      description: "From inspection #6012",
      notes: "",
    });
    expect(repairTicketText(6012, { items: [], notes: "See roof" }).description).toBe(
      "From inspection #6012: See roof",
    );
    expect(fromInspectionLabel(6012)).toBe("From inspection #6012");
  });
});

describe("Create bid from an inspection", () => {
  const src = {
    number: 6012,
    customer_name: "Acme Storage",
    account_id: "7c3f8a4e-1b2d-4c5e-8f9a-0b1c2d3e4f5a",
    site_id: "1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d",
    site_name: "Warehouse 2",
    site: { address1: "123 Main St", address2: null, city: "Murray", state: "KY", zip: "42071" },
  };
  it("prefills the customer, site, address and findings — and the estimator keeps them", () => {
    const pf = bidPrefillFromInspection(src, done);
    expect(pf).toEqual({
      pfName: "Warehouse 2 — Acme Storage",
      pfOwner: "Acme Storage",
      pfAddr: "123 Main St",
      pfCity: "Murray",
      pfState: "KY",
      pfZip: "42071",
      pfAccount: src.account_id,
      pfSite: src.site_id,
      pfNotes: repairTicketText(6012, done).notes,
    });
    // Through the URL as /estimate reads it (validateSearch).
    const read = parseEstimateSearch(JSON.parse(JSON.stringify(pf)) as Record<string, unknown>);
    expect(read).toEqual(pf);
  });
  it("without a linked customer passes the typed name only; notes stay URL-sized", () => {
    const pf = bidPrefillFromInspection(
      { ...src, account_id: null, site_name: null, site: null },
      { items: [item("a", "Seams", "issue", "y".repeat(3000))], notes: "" },
    );
    expect(pf.pfAccount).toBeUndefined();
    expect(pf.pfSite).toBeUndefined();
    expect(pf.pfName).toBe("Acme Storage");
    expect(pf.pfNotes!.length).toBeLessThanOrEqual(BID_NOTES_MAX);
  });
});

describe("the migration", () => {
  const sql = readFileSync(
    new URL(
      "../../supabase/migrations/20260930092000_ticket_aerial_inspection.sql",
      import.meta.url,
    ),
    "utf8",
  );
  it("seeds the same default checklist, in the same order", () => {
    const seeded = [...sql.matchAll(/\('([^']+)', (\d+)\)/g)].map((m) => m[1]);
    expect(seeded).toEqual([...DEFAULT_CHECKLIST]);
  });
  it("lets a photo be an aerial, with its annotations, and links a ticket to its inspection", () => {
    expect(sql).toMatch(/check \(role in \('before','after','other','signature','aerial'\)\)/);
    expect(sql).toMatch(/add column if not exists annotations jsonb/);
    expect(sql).toMatch(/add column if not exists inspection jsonb/);
    expect(sql).toMatch(
      /add column if not exists from_job_id uuid references public\.service_jobs\(id\)/,
    );
  });
});
