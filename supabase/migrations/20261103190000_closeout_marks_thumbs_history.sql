-- Service review batch B (owner, Nov 3): the close-out, its photos and the history reads.
--
-- 24  "Nothing used on this ticket" and "Skip — nothing to add" were marks on the phone alone
--     (localStorage): switch devices and the steps locked again; the office could not tell a
--     skipped step from a forgotten one. The ticket now carries them.
alter table public.service_jobs add column if not exists nothing_used_at timestamptz;
alter table public.service_jobs add column if not exists notes_skipped_at timestamptz;
comment on column public.service_jobs.nothing_used_at is
  'The technician said no material was used on this ticket (the close-out''s Materials step), when.';
comment on column public.service_jobs.notes_skipped_at is
  'The technician skipped the closing notes ("nothing to add"), when.';

-- 34  A small copy of each ticket photo, made on the phone when the picture goes up (the full
--     picture is untouched): the thumbnails read this instead of the 0.8 MB original.
alter table public.service_job_photos add column if not exists thumb_path text;
comment on column public.service_job_photos.thumb_path is
  'The small copy''s object in the service bucket (made at upload, or later by the first viewer who may); null = none yet.';

-- 46  History at this property, capped: the newest p_limit tickets (null = every one). The
--     fold shows ten with "Show more"; the full read used to sign every photo of every earlier
--     ticket on every open. The body is 20261102170000's with the photo's thumb_path added.
create or replace function public.site_history(p_job_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_site uuid;
  v_out jsonb;
begin
  if not exists (select 1 from public.service_jobs where id = p_job_id and deleted_at is null) then
    raise exception 'That ticket was not found' using errcode = 'P0002';
  end if;
  if not public.site_history_allowed(p_job_id) then
    raise exception 'You can see the history of a property only from a ticket assigned to you'
      using errcode = '42501';
  end if;
  select site_id into v_site from public.service_jobs where id = p_job_id;
  if v_site is null then
    return '[]'::jsonb;
  end if;
  select coalesce(jsonb_agg(t.doc order by t.sort_at desc, t.number desc), '[]'::jsonb)
    into v_out
  from (
    select
      j.number,
      coalesce(j.completed_at, j.scheduled_date::timestamptz, j.created_at) as sort_at,
      jsonb_build_object(
        'id', j.id,
        'number', j.number,
        'service_type', j.service_type,
        'description', j.description,
        'scheduled_date', j.scheduled_date,
        'completed_at', j.completed_at,
        'created_at', j.created_at,
        'stage', j.stage,
        'location_id', j.location_id,
        'location_name', j.location_name,
        'closing_notes', j.closing_notes,
        'inspection_outcome', j.inspection_outcome,
        'technician_name', (
          select coalesce(nullif(trim(p.full_name), ''), p.email)
            from public.profiles p where p.id = j.technician_id),
        'inspection_items', coalesce((
          select jsonb_agg(jsonb_build_object(
                   'id', i->>'id', 'label', i->>'label', 'status', i->>'status', 'note', i->>'note'))
            from jsonb_array_elements(
                   case when jsonb_typeof(j.inspection->'items') = 'array'
                        then j.inspection->'items' else '[]'::jsonb end) i), '[]'::jsonb),
        'repairs', coalesce((
          select jsonb_agg(jsonb_build_object(
                   'id', r.id, 'name', r.name, 'problem_text', r.problem_text,
                   'resolution_text', r.resolution_text, 'completed_on', r.completed_on)
                 order by r.sort, r.created_at)
            from public.service_job_repairs r where r.service_job_id = j.id), '[]'::jsonb),
        'photos', coalesce((
          select jsonb_agg(jsonb_build_object(
                   'id', ph.id, 'storage_path', ph.storage_path, 'thumb_path', ph.thumb_path,
                   'file_name', ph.file_name,
                   'role', ph.role, 'repair_id', ph.repair_id, 'item_key', ph.item_key,
                   'item_keys', coalesce((
                     select jsonb_agg(l.item_key order by l.created_at, l.item_key)
                       from public.service_job_photo_items l where l.photo_id = ph.id), '[]'::jsonb),
                   'taken_at', ph.taken_at, 'created_at', ph.created_at,
                   'annotations', ph.annotations)
                 order by ph.created_at)
            from public.service_job_photos ph
           where ph.service_job_id = j.id and ph.role <> 'signature'), '[]'::jsonb)
      ) as doc
    from public.service_jobs j
    where j.site_id = v_site and j.id <> p_job_id and j.deleted_at is null
      and public.ticket_is_history(j.stage, j.scheduled_date)
  ) t;
  return v_out;
end $$;

create or replace function public.site_history(p_job_id uuid, p_limit integer)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(t.elem order by t.n), '[]'::jsonb)
    from jsonb_array_elements(public.site_history(p_job_id)) with ordinality as t(elem, n)
   where p_limit is null or t.n <= p_limit;
$$;
revoke all on function public.site_history(uuid, integer) from public;
grant execute on function public.site_history(uuid, integer) to authenticated, service_role;
comment on function public.site_history(uuid, integer) is
  'site_history(p_job_id) capped to the newest p_limit tickets (null = all). Same access rule.';

-- 45  My tickets asked for one history summary per card; one call for all of them.
create or replace function public.site_history_summaries(p_job_ids uuid[])
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_id uuid;
  v_out jsonb := '[]'::jsonb;
begin
  foreach v_id in array coalesce(p_job_ids, '{}'::uuid[]) loop
    v_out := v_out || jsonb_build_object('job_id', v_id, 'summary', public.site_history_summary(v_id));
  end loop;
  return v_out;
end $$;
revoke all on function public.site_history_summaries(uuid[]) from public;
grant execute on function public.site_history_summaries(uuid[]) to authenticated, service_role;
comment on function public.site_history_summaries(uuid[]) is
  'site_history_summary for several tickets in one call (My tickets''s cards). Same access rule per ticket.';
