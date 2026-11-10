-- Building search under a second, and the eight missing foreign-key indexes (owner, Nov 10; speed
-- pass finding 2 and "Indexes").
--
-- 1. The search box on Roofs & Storms matches `ilike '%text%'` on eight columns. A trigram index
--    answers that without reading every row.
-- 2. The index alone is not enough: under row security Postgres will not use a non-leakproof
--    operator (ilike) as an index condition ahead of the policy's own check, so the search still
--    walked all 270,291 rows (2.3 s). `buildings_search` is a read-only twin of the table with the
--    SAME access rule as `buildings_read` written into it (Roofs & Storms or Estimate access; it
--    does not depend on the row, so nothing can leak). Through it the index is used: 3 to 111 ms.
--    listBuildings reads it when there is search text (src/lib/prospect.functions.ts); every write
--    and every other read still goes through the table and its policies.
--    A two-letter search ("ky") has no trigram to use and stays about a second.
-- 3. Foreign keys on growing tables that had no index.
--
-- Applied live on Nov 10 with CREATE INDEX CONCURRENTLY (no lock); the plain form below is the
-- same index for a fresh database.

create extension if not exists pg_trgm with schema extensions;

create index if not exists buildings_search_trgm_idx on public.buildings using gin (
  name extensions.gin_trgm_ops,
  address1 extensions.gin_trgm_ops,
  city extensions.gin_trgm_ops,
  owner_name extensions.gin_trgm_ops,
  parcel_id extensions.gin_trgm_ops,
  county extensions.gin_trgm_ops,
  state extensions.gin_trgm_ops,
  zip extensions.gin_trgm_ops
) where deleted_at is null;

create or replace view public.buildings_search as
  select b.*
    from public.buildings b
   where (select public.has_access('prospect')) or (select public.has_access('estimate'));

revoke all on public.buildings_search from public, anon;
grant select on public.buildings_search to authenticated, service_role;

comment on view public.buildings_search is
  'Read-only twin of buildings for the text search: same access rule as buildings_read, written in the view so the trigram index can be used (a non-leakproof ilike cannot be an index condition under row security).';

create index if not exists service_job_photos_repair_idx on public.service_job_photos (repair_id);
create index if not exists notifications_followup_idx on public.notifications (followup_id);
create index if not exists service_time_entries_technician_idx on public.service_time_entries (technician_id);
create index if not exists crm_followups_account_idx on public.crm_followups (account_id);
create index if not exists service_jobs_contact_idx on public.service_jobs (contact_id);
create index if not exists service_jobs_location_idx on public.service_jobs (location_id);
create index if not exists documents_template_idx on public.documents (template_id);
create index if not exists leads_building_idx on public.leads (building_id);
