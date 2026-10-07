-- Work Overview layout (owner, Oct 7): "make it where you can click and drag them to customize
-- the layout and a little x in the corner to get rid of that category (also allow easy
-- restoration of that category)". Each user's column order and hidden columns follow them from
-- device to device, like their theme (20261002170000_theme.sql).
--
-- 1. profiles.work_layout: {"order": [bucket, …], "hidden": [bucket, …]} or null (the default
--    layout). The browser also caches it (src/lib/work-layout.ts) so the page lays out right
--    before the read comes back; after sign-in this value wins.
-- 2. set_my_work_layout(p_layout): the signed-in user writes their OWN layout and nothing else.
--    profiles has no self-update policy (see the theme migration for why one cannot be added);
--    the function is SECURITY DEFINER, keyed strictly on auth.uid(), and touches the one column.
--
-- Additive and idempotent; the app works before it is applied (the read answers "no saved
-- layout" and the write reports saved: false, leaving the browser's copy).

alter table public.profiles add column if not exists work_layout jsonb;
comment on column public.profiles.work_layout is
  'Owner, Oct 7: the user''s own Work Overview column order and hidden columns ({"order": [...], "hidden": [...]}); set only through set_my_work_layout().';

create or replace function public.set_my_work_layout(p_layout jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  if p_layout is not null and (jsonb_typeof(p_layout) <> 'object' or length(p_layout::text) > 2000) then
    raise exception 'Bad layout' using errcode = '22023';
  end if;
  update public.profiles set work_layout = p_layout where id = auth.uid();
end;
$$;

revoke all on function public.set_my_work_layout(jsonb) from public;
revoke all on function public.set_my_work_layout(jsonb) from anon;
grant execute on function public.set_my_work_layout(jsonb) to authenticated;
