-- Indexes for the lookups the server code makes that had none (owner, Oct 19: "is the
-- database indexed properly so that as it expands it'll still be efficient to query"). Every
-- business table is small today; these keep the same queries fast at tens of thousands of rows.
-- Each matches a filter / order the code applies (see the Oct 19 audit); partial where the
-- code always adds `deleted_at is null` or a not-null test, so the index stays small.

-- Tickets: the property page (site_id), the Tech Board / Service list / Work Overview
-- (stage + scheduled_date), finished tickets by completion day, and the Unassigned column.
create index if not exists service_jobs_site_idx
  on public.service_jobs (site_id) where deleted_at is null and site_id is not null;
create index if not exists service_jobs_stage_date_idx
  on public.service_jobs (stage, scheduled_date) where deleted_at is null;
create index if not exists service_jobs_completed_idx
  on public.service_jobs (completed_at) where deleted_at is null and completed_at is not null;
create index if not exists service_jobs_unassigned_idx
  on public.service_jobs (scheduled_date) where deleted_at is null and technician_id is null;

-- Tasks: Work Overview and the Owner view (assignee + status), the RLS creator clause, the
-- property page, and "Done this week".
create index if not exists tasks_assignee_status_idx on public.tasks (assignee, status);
create index if not exists tasks_created_by_idx on public.tasks (created_by);
create index if not exists tasks_site_idx on public.tasks (site_id) where site_id is not null;
create index if not exists tasks_done_at_idx
  on public.tasks (status, done_at) where done_at is not null;

-- Bids: Work Overview (created_by), the customer and property pages.
create index if not exists bids_created_by_idx
  on public.bids (created_by) where deleted_at is null;
create index if not exists bids_account_idx
  on public.bids (account_id) where deleted_at is null and account_id is not null;
create index if not exists bids_site_idx
  on public.bids (site_id) where deleted_at is null and site_id is not null;

-- Opportunities: the overdue lists (open past their expected close).
create index if not exists crm_opportunities_status_close_idx
  on public.crm_opportunities (status, expected_close) where deleted_at is null;

-- Inventory ledger: read whole in time order (Stock, Reconcile, Export).
create index if not exists inventory_movements_created_idx
  on public.inventory_movements (created_at, id);
