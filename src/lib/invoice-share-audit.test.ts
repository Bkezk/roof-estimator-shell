/**
 * A customer's look at an invoice's share link is silent (owner, Oct 13): the view counters
 * share_views / share_last_viewed_at are bookkeeping, so 20261013150000_audit_skip_share_views.sql
 * adds them to audit_row()'s v_skip (the pinned-diff pattern of bid-notice-claim.test.ts) and
 * gives the invoices_updated_at trigger a WHEN clause so a view does not move "last changed".
 * Fails on the old tree: the migration did not exist, and a view wrote an audit row per look.
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : "");
const MIGRATION = "supabase/migrations/20261013150000_audit_skip_share_views.sql";
const PREV = "supabase/migrations/20261012180000_bid_notice_claim.sql";
const body = (p: string) => {
  const sql = read(p);
  return sql.slice(sql.indexOf("create or replace function public.audit_row()"));
};

describe("20261013150000_audit_skip_share_views.sql", () => {
  it("exists and adds exactly the two view columns to v_skip, nothing else changed in audit_row()", () => {
    const prev = body(PREV);
    const next = body(MIGRATION);
    expect(next).toContain(
      "'status_changed_at', 'data', 'notified_due_at', 'notify_failures', 'share_views', 'share_last_viewed_at'];",
    );
    expect(prev).not.toContain("'share_views'");
    // The function body: identical to the previous migration's but for the two entries; the
    // trailing trigger block is this migration's own.
    const nextFn = next.slice(0, next.indexOf("-- 2. ----"));
    expect(
      nextFn
        .replace(
          "'notified_due_at', 'notify_failures', 'share_views', 'share_last_viewed_at'];",
          "'notified_due_at', 'notify_failures'];",
        )
        .trimEnd(),
    ).toBe(prev.trimEnd());
  });
  it("the updated_at trigger skips an update that changes only the two view columns", () => {
    const sql = read(MIGRATION);
    expect(sql).toContain("create or replace trigger invoices_updated_at");
    expect(sql).toContain("before update on public.invoices");
    expect(sql).toContain("when (old.share_views is not distinct from new.share_views");
    expect(sql).toContain(
      "and old.share_last_viewed_at is not distinct from new.share_last_viewed_at)",
    );
    expect(sql).toContain("execute function public.update_updated_at_column();");
    expect(sql).not.toMatch(/disable trigger/i);
    expect(sql).not.toMatch(/drop trigger/i);
  });
  it("making or turning off a link stays audited (share_token is not skipped)", () => {
    expect(body(MIGRATION)).not.toContain("'share_token'");
  });
});
