/**
 * "Refresh data" on the Variables tab (owner, Oct 28: "i did click that refresh data on
 * variables and its still showing this" — the Findings page stayed empty after a refresh).
 * Fails on the old code: the refresh handed the editor `displayVariables(...)`, which strips the
 * reserved `__inspection` key the Repair List reads, so the page could not show the findings
 * until a reload; and nothing said whether the ticket had findings at all.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { REFRESH_FINDINGS_NOTE, refreshFindings } from "@/lib/documents.functions";

const read = (p: string) => readFileSync(p, "utf8");

describe("Refresh data", () => {
  it("says what it found: stored findings, no checklist yet, not an inspection, a bid", () => {
    expect(refreshFindings("ticket", "inspection", true)).toBe("stored");
    expect(refreshFindings("ticket", "inspection", false)).toBe("no-checklist");
    expect(refreshFindings("ticket", "leak", false)).toBe("not-inspection");
    expect(refreshFindings("bid", undefined, false)).toBe("bid");
    expect(REFRESH_FINDINGS_NOTE.stored).toContain("findings are in");
    expect(REFRESH_FINDINGS_NOTE["no-checklist"]).toContain("no saved inspection checklist");
    expect(REFRESH_FINDINGS_NOTE["not-inspection"]).toContain("not an inspection");
    expect(REFRESH_FINDINGS_NOTE.bid).toBeNull();
  });
  it("hands the editor the variables as stored (reserved keys included) and verifies the write", () => {
    const fns = read("src/lib/documents.functions.ts");
    const body = fns.slice(fns.indexOf("export const refreshDocumentVariables"));
    const handler = body.slice(0, body.indexOf("export interface DocumentListItem"));
    expect(handler).not.toContain("displayVariables(variables)");
    expect(handler).toContain("        variables,\n        findings: refreshFindings(");
    expect(handler).toContain('.select("id")\n        .maybeSingle();');
    expect(handler).toContain("the document could not be updated");
    const route = read("src/routes/documents.tsx");
    expect(route).toContain("setVariables(r.variables);");
    expect(route).toContain("const note = REFRESH_FINDINGS_NOTE[r.findings];");
    expect(route).toContain("toast.warning(note)");
  });
});
