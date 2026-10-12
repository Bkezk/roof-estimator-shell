/**
 * 20261012150000_audit_skip_bid_notice.sql: audit_row() is the Oct 12 bid-drives-opportunity
 * body with `notified_due_at` added to v_skip, nothing else — so the "Bid due tomorrow" stamp
 * (bids.notified_due_at) never writes a History line.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const fn = (file: string) => {
  const s = readFileSync(`supabase/migrations/${file}`, "utf8");
  const a = s.indexOf("create or replace function public.audit_row()");
  const b = s.indexOf("revoke all on function public.audit_row() from public;", a);
  return s.slice(a, b);
};

describe("audit_row() skips the bid due-notice stamp", () => {
  const prev = fn("20261012100000_bid_drives_opportunity.sql");
  const next = fn("20261012150000_audit_skip_bid_notice.sql");
  it("adds notified_due_at to v_skip", () => {
    expect(next).toContain("'status_changed_at', 'data', 'notified_due_at'];");
    expect(prev).not.toContain("'notified_due_at'");
  });
  it("changes nothing else in the body", () => {
    expect(next.replace("'data', 'notified_due_at'];", "'data'];")).toBe(prev);
  });
  it("re-revokes execute from public after the body", () => {
    const s = readFileSync("supabase/migrations/20261012150000_audit_skip_bid_notice.sql", "utf8");
    expect(s.trimEnd().endsWith("revoke all on function public.audit_row() from public;")).toBe(
      true,
    );
  });
});
