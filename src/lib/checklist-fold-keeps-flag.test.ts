/**
 * Owner, Oct 28: "if you minimize a category in the inspection checklist it gets rid of the red
 * issue and the flag even though its still there when you open it". There was no minimize:
 * pressing Issue (or the label) on a flagged row set its status back to nothing — the row then
 * counted as OK in the report (isFlagged false) while its note and pictures stayed, so a second
 * press looked like "opening" it. Now that press folds the row and keeps the flag; only OK or N/A
 * take the flag off.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isFlagged, pressStatus } from "@/lib/inspection";

const section = readFileSync(
  new URL("../components/service/inspection-section.tsx", import.meta.url),
  "utf8",
);

describe("pressStatus: what a press on a row does", () => {
  it("Issue on a flagged row folds it and keeps the flag — the old code cleared the status", () => {
    const r = pressStatus("issue", "issue");
    expect(r).toEqual({ status: "issue", fold: true });
    expect(isFlagged({ status: r.status })).toBe(true);
  });
  it("Issue on any other row flags it", () => {
    expect(pressStatus(null, "issue")).toEqual({ status: "issue", fold: false });
    expect(pressStatus("ok", "issue")).toEqual({ status: "issue", fold: false });
    expect(pressStatus("na", "issue")).toEqual({ status: "issue", fold: false });
  });
  it("OK and N/A take the flag off, and clear themselves when pressed again", () => {
    expect(pressStatus("issue", "ok")).toEqual({ status: "ok", fold: false });
    expect(pressStatus("issue", "na")).toEqual({ status: "na", fold: false });
    expect(pressStatus("ok", "ok")).toEqual({ status: null, fold: false });
    expect(pressStatus("na", "na")).toEqual({ status: null, fold: false });
    expect(pressStatus(null, "ok")).toEqual({ status: "ok", fold: false });
  });
});

describe("the rows: a folded flagged row keeps its red, its flag and its Issue button", () => {
  const rows = section.slice(
    section.indexOf("export function ChecklistRows("),
    section.indexOf("export function InspectionDetails("),
  );
  it("a press goes through pressStatus; a fold never writes a status", () => {
    expect(rows).toContain("const r = pressStatus(item.status, pressed);");
    expect(rows).toMatch(
      /if \(r\.fold\) toggleFold\(item\.id\);\s*else if \(r\.status !== item\.status\) onChange\(item\.id, \{ status: r\.status \}\);/,
    );
    expect(rows).not.toContain("item.status === status ? null : status");
  });
  it("the red border, the flag icon and the red Issue button follow `flagged`, not the fold", () => {
    expect(rows).toContain("const closed = flagged && folded.has(item.id);");
    expect(rows).toMatch(/data-row=\{flagged \? "issue"/);
    expect(rows).toMatch(/\$\{flagged \? "border-red-300 bg-red-50\/40/);
    expect(rows).toMatch(/\{flagged \? \(\s*<Flag/);
    expect(rows).toMatch(/\$\{flagged \? "border-transparent bg-red-600 text-white/);
    // Only the note box and the pictures hide; the note's first line stays, on one line.
    expect(rows).toMatch(/\{flagged && !closed \? \(\s*<div[^>]*>\s*<Input/);
    expect(rows).toContain('${closed ? "truncate" : "whitespace-pre-line"}');
    // The label says what the next press does, and a chevron shows the fold.
    expect(rows).toContain("aria-expanded={flagged ? !closed : undefined}");
    expect(rows).toMatch(/closed \? \(\s*<ChevronDown/);
  });
  it("screen state only: folds live in the component, nothing saved", () => {
    expect(rows).toContain(
      "const [folded, setFolded] = useState<ReadonlySet<string>>(() => new Set());",
    );
    expect(rows).not.toContain("localStorage");
  });
});
