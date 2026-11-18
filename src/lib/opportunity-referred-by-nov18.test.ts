/**
 * "Referred by" on an opportunity (owner, Nov 18: "add a form on an opp shows who referred the
 * customer"). A request taken on site already filled the name of the person who took it
 * (request_additional_service); it was shown as a line and only when there was one. Now it is a
 * box on every opportunity: the office reads it, types it and corrects it.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { cleanReferredBy, REFERRED_BY_MAX } from "@/lib/opportunity-form";

const read = (p: string) => readFileSync(p, "utf8");
const flat = (s: string) => s.replace(/\s+/g, " ");

describe("what is saved", () => {
  it("the name, trimmed", () => {
    expect(cleanReferredBy("  Tyler Mitchell ")).toBe("Tyler Mitchell");
  });
  it("blank clears it", () => {
    expect(cleanReferredBy("")).toBeNull();
    expect(cleanReferredBy("   ")).toBeNull();
    expect(cleanReferredBy(null)).toBeNull();
  });
  it("left out is kept as it is: a caller that knows nothing of the box never wipes the credit", () => {
    expect(cleanReferredBy(undefined)).toBeUndefined();
  });
  it("the server saves it by that rule, and only when it was sent", () => {
    const fn = flat(read("src/lib/opportunities.functions.ts"));
    expect(fn).toContain(
      "referred_by: z .string() .trim() .max(REFERRED_BY_MAX) .nullable() .optional() .transform(cleanReferredBy),",
    );
    expect(fn).toContain(
      "...(fields.referred_by === undefined ? {} : { referred_by: fields.referred_by }),",
    );
    expect(REFERRED_BY_MAX).toBe(120);
  });
});

describe("the box on the opportunity", () => {
  const page = flat(read("src/components/opportunities-page.tsx"));
  it("is a box on every opportunity, new or saved, beside the lead source", () => {
    expect(page).toContain('const REFERRED_BY_LABEL = "Referred by";');
    expect(page).toContain('<Label htmlFor="opp-referred-by">{REFERRED_BY_LABEL}</Label>');
    expect(page).toContain('onChange={(e) => set("referred_by", e.target.value)}');
    expect(page).toContain("data-opp-referred-by");
    // No longer a line shown only when there is a name.
    expect(page).not.toContain("{opp?.referred_by && (");
    expect(page.indexOf('id="opp-referred-by"')).toBeGreaterThan(page.indexOf('id="opp-source"'));
  });
  it("opens with the saved name, starts blank on a new one, and is sent with the save", () => {
    expect(page).toContain('referred_by: o.referred_by ?? "",');
    expect(page).toContain('lead_source: "", referred_by: "", est_value: 0,');
    expect(page).toContain("referred_by: draft.referred_by,");
  });
  it("a change to it counts as an unsaved change", () => {
    // The key is the whole draft, so the new field is in it.
    expect(page).toContain("const draftKey = (d: Draft, saved: boolean) => JSON.stringify({ ...d,");
  });
  it("the list shows it on the opportunity's line, and the search finds it", () => {
    expect(page).toContain("o.referred_by ? `${REFERRED_BY_LABEL} ${o.referred_by}` : null,");
    expect(page).toContain("o.lead_source, o.referred_by, o.description, ]");
  });
  it("a request taken on site still fills it with the person who took it", () => {
    const sql = flat(read("supabase/migrations/20261118250000_additional_service_request.sql"));
    expect(sql).toContain("'open', 'On-site request', nullif(v_name, ''),");
  });
});
