-- Bid Board fixes (Sep 30). Idempotent.
--
-- 1. What a planroom job page gave (read with the planroom login: the fields, plan holders and
--    page text, and when it was read) gets columns of its own. It was kept in `raw`, which
--    every refresh replaces, so each refresh dropped it and the job pages were read again. The
--    list refresh never sends these columns (leads.server.ts, saveLeadRows), so a read stays.
alter table public.leads
  add column if not exists details_read_at timestamptz,
  add column if not exists details jsonb;

-- Reads still in raw (none survive a refresh, but a row read since the last one may): move
-- them over. Only the three planroom sources were ever read; Louisville Metro's raw.details is
-- the portal's own and stays.
update public.leads
set details_read_at = (raw->>'details_read_at')::timestamptz,
    details = jsonb_build_object(
      'fields', raw->'details',
      'plan_holders', raw->'plan_holders',
      'page_text', raw->'page_text'
    ),
    raw = raw - 'details' - 'plan_holders' - 'page_text' - 'details_read_at'
where details_read_at is null
  and source in ('ky_planroom', 'lynn_bids', 'campus_planrooms')
  and raw ? 'details_read_at';

-- 2. The refresh's problems, stored apart from its note: the page's red line reads this list
--    instead of picking failures out of the note by their wording (which missed several).
alter table public.lead_settings add column if not exists last_fetch_problems text[];

-- stamp_lead_fetch takes the list too. `problems` null (the progress stamps) leaves the last
-- run's list as it is; the end of a run passes its list (empty when all went well). Same
-- security and grants as before (20260928200000_leads.sql).
drop function if exists public.stamp_lead_fetch(text);
create or replace function public.stamp_lead_fetch(note text, problems text[] default null)
returns void language sql security definer set search_path = public as $$
  update public.lead_settings
  set last_fetch_at = now(),
      last_fetch_note = note,
      last_fetch_problems = coalesce(problems, last_fetch_problems)
  where id = 1
    and (auth.role() = 'service_role' or public.has_access('prospect'));
$$;
revoke all on function public.stamp_lead_fetch(text, text[]) from public;
grant execute on function public.stamp_lead_fetch(text, text[]) to authenticated, service_role;

-- 6. Who can read the Bid Board: the same as the app's own check (leads.functions.ts
--    readAccess: Prospecting or Estimate). leads_read also let Customers access in, and the
--    settings row (with the fetch notes) was open to every signed-in user. Writes unchanged.
drop policy if exists leads_read on public.leads;
create policy leads_read on public.leads for select to authenticated
  using (public.has_access('prospect') or public.has_access('estimate'));
drop policy if exists lead_settings_read on public.lead_settings;
create policy lead_settings_read on public.lead_settings for select to authenticated
  using (public.has_access('prospect') or public.has_access('estimate'));

notify pgrst, 'reload schema';
