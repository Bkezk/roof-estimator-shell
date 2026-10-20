import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * Owner, Oct 19: "is the database indexed properly so that as it expands it'll still be
 * efficient to query". The audit matched every filter / order the server code applies against
 * pg_indexes; these are the lookups that had none. Applied live on Oct 20 (all 13 valid).
 */
const sql = readFileSync("supabase/migrations/20261020090000_growth_indexes.sql", "utf8");
const indexes: Record<string, string> = {
  service_jobs_site_idx:
    "on public.service_jobs (site_id) where deleted_at is null and site_id is not null",
  service_jobs_stage_date_idx:
    "on public.service_jobs (stage, scheduled_date) where deleted_at is null",
  service_jobs_completed_idx:
    "on public.service_jobs (completed_at) where deleted_at is null and completed_at is not null",
  service_jobs_unassigned_idx:
    "on public.service_jobs (scheduled_date) where deleted_at is null and technician_id is null",
  tasks_assignee_status_idx: "on public.tasks (assignee, status)",
  tasks_created_by_idx: "on public.tasks (created_by)",
  tasks_site_idx: "on public.tasks (site_id) where site_id is not null",
  tasks_done_at_idx: "on public.tasks (status, done_at) where done_at is not null",
  bids_created_by_idx: "on public.bids (created_by) where deleted_at is null",
  bids_account_idx:
    "on public.bids (account_id) where deleted_at is null and account_id is not null",
  bids_site_idx: "on public.bids (site_id) where deleted_at is null and site_id is not null",
  crm_opportunities_status_close_idx:
    "on public.crm_opportunities (status, expected_close) where deleted_at is null",
  inventory_movements_created_idx: "on public.inventory_movements (created_at, id)",
};
const flat = sql.replace(/\s+/g, " ");

describe("growth indexes (owner, Oct 19)", () => {
  it("creates each index once, idempotently, with the partial clause the code's filters imply", () => {
    for (const [name, def] of Object.entries(indexes)) {
      expect(flat, name).toContain(`create index if not exists ${name} ${def};`);
    }
    expect((flat.match(/create index/g) ?? []).length).toBe(Object.keys(indexes).length);
    expect(flat).not.toMatch(/concurrently/i); // migrations run inside a transaction
    expect(flat).not.toMatch(/drop |alter table|create table/i);
  });
  it("matches the filters the server code applies", () => {
    const jobs = readFileSync("src/lib/service.functions.ts", "utf8");
    expect(jobs).toContain('.gte("completed_at"');
    expect(jobs).toContain('.in("stage"');
    const crm = readFileSync("src/lib/crm.functions.ts", "utf8");
    expect(crm).toContain('.eq("site_id"');
    const work = readFileSync("src/lib/my-work.functions.ts", "utf8");
    expect(work).toContain('.in("created_by"');
    expect(work).toContain('.in("assignee"');
    const inv = readFileSync("src/lib/inventory-reconcile.functions.ts", "utf8");
    expect(inv).toContain('.order("created_at")');
  });
});
