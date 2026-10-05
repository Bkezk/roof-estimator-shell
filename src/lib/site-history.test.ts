/**
 * "Earlier at this site" on a ticket (service study M4, owner Oct 5).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  historyDay,
  historyDayText,
  historySnippet,
  SITE_HISTORY_LIMIT,
  SNIPPET_MAX,
} from "@/lib/site-history";

const read = (p: string) => readFileSync(p, "utf8");

describe("a row", () => {
  it("the snippet is the first line of the closing notes, else the description", () => {
    expect(
      historySnippet({
        closing_notes: "\n  Cleared condensate at the HVAC unit.\nMore later",
        description: "Leak in lobby",
      }),
    ).toBe("Cleared condensate at the HVAC unit.");
    expect(historySnippet({ closing_notes: "  ", description: "Leak in lobby" })).toBe(
      "Leak in lobby",
    );
    expect(historySnippet({ closing_notes: null, description: null })).toBe("");
  });
  it("a long first line is cut with …", () => {
    const s = historySnippet({ closing_notes: "x".repeat(200), description: null });
    expect(s).toHaveLength(SNIPPET_MAX);
    expect(s.endsWith("…")).toBe(true);
  });
  it("filed under the day it was done, else scheduled, else opened", () => {
    const base = { created_at: "2026-08-01T14:00:00Z" };
    expect(
      historyDay({ ...base, completed_at: "2026-09-22T16:02:00Z", scheduled_date: "2026-09-20" }),
    ).toBe("2026-09-22");
    expect(historyDay({ ...base, completed_at: null, scheduled_date: "2026-09-20" })).toBe(
      "2026-09-20",
    );
    expect(historyDay({ ...base, completed_at: null, scheduled_date: null })).toBe("2026-08-01");
    expect(historyDayText("2025-09-22")).toBe("Sep 22, 2025");
  });
});

describe("the server function", () => {
  const fns = read("src/lib/service-field.functions.ts");
  const body = fns.slice(fns.indexOf("export const listSiteHistory"));
  it("same site, not this ticket, not deleted, newest first, limited", () => {
    expect(SITE_HISTORY_LIMIT).toBe(10);
    expect(body).toContain('.eq("site_id", job.site_id)');
    expect(body).toContain('.neq("id", data.id)');
    expect(body).toContain('.is("deleted_at", null)');
    expect(body).toContain('.order("created_at", { ascending: false })');
    expect(body).toContain(".limit(SITE_HISTORY_LIMIT)");
    expect(body).toContain("if (!job?.site_id) return [];");
  });
});

describe("on the ticket page", () => {
  const src = read("src/components/service/ticket-field-sections.tsx");
  it("a folding section under the Timeline, for tickets with a site", () => {
    expect(src).toContain("{job.site_id && <EarlierAtSite jobId={job.id} />}");
    expect(src).toContain('title="Earlier at this site"');
    expect(src).toContain('storageKey="earlier"');
    expect(src).toContain("No earlier tickets at this site.");
  });
  it("each row opens that ticket", () => {
    expect(src).toMatch(/<Link\s+to="\/service"\s+search=\{\{ id: r\.id \}\}/);
  });
});
