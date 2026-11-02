-- History at this property counts only what has happened (owner, Nov 2, My tickets audit
-- finding 1: a card read "History here: 2 earlier tickets, last Nov 5 (… — coming up)" — the
-- "earlier ticket" was booked three days ahead). site_history and site_history_summary
-- (20261021110000, the photo items of 20261028…) counted every other live ticket at the site
-- whatever its stage or day, so two tickets booked the same week each called the other history.
--
-- The one rule, ticket_is_history(stage, scheduled_date): a ticket is history unless it is still
-- Open / Scheduled and booked for today or later, or not yet given a day. A finished ticket (Done
-- and past) always counts; an Open one whose day has passed counts too (it was due here). "Today"
-- is the office's day, Eastern, the same day the server stamps field actions with (field-day.ts).
-- Both functions keep their bodies; only the four where-clauses gain the rule.
create or replace function public.ticket_is_history(p_stage text, p_scheduled_date date)
returns boolean language sql stable set search_path = public as $$
  select not (
    p_stage in ('open', 'scheduled')
    and (p_scheduled_date is null or p_scheduled_date >= (now() at time zone 'America/New_York')::date)
  );
$$;
revoke all on function public.ticket_is_history(text, date) from public;
grant execute on function public.ticket_is_history(text, date) to authenticated, service_role;
comment on function public.ticket_is_history(text, date) is
  'Does a ticket belong to a property''s history? Not while it is Open / Scheduled for today or later, or undated (Nov 2).';

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
                   'id', ph.id, 'storage_path', ph.storage_path, 'file_name', ph.file_name,
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
comment on function public.site_history(uuid) is
  'The earlier tickets at this ticket''s property (ticket_is_history: finished, or past their day), newest first, with their repairs, photos (with mark-ups) and inspection items; no money, no customer contacts. Refuses (42501) a caller who may not see the ticket (Oct 21; Nov 2).';

create or replace function public.site_history_summary(p_job_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_site uuid;
  v_count integer;
  v_photos integer;
  v_last jsonb;
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
    return jsonb_build_object('count', 0, 'photo_count', 0, 'last', null);
  end if;
  select count(*) into v_count
    from public.service_jobs j
   where j.site_id = v_site and j.id <> p_job_id and j.deleted_at is null
     and public.ticket_is_history(j.stage, j.scheduled_date);
  if v_count = 0 then
    return jsonb_build_object('count', 0, 'photo_count', 0, 'last', null);
  end if;
  select count(*) into v_photos
    from public.service_job_photos ph
    join public.service_jobs j on j.id = ph.service_job_id
   where j.site_id = v_site and j.id <> p_job_id and j.deleted_at is null
     and public.ticket_is_history(j.stage, j.scheduled_date)
     and ph.role <> 'signature';
  select jsonb_build_object(
           'id', j.id,
           'number', j.number,
           'completed_at', j.completed_at,
           'scheduled_date', j.scheduled_date,
           'created_at', j.created_at,
           'description', left(j.description, 200),
           'resolution', left(coalesce((
             select r.resolution_text from public.service_job_repairs r
              where r.service_job_id = j.id and nullif(trim(r.resolution_text), '') is not null
              order by r.sort, r.created_at limit 1), j.closing_notes), 200))
    into v_last
    from public.service_jobs j
   where j.site_id = v_site and j.id <> p_job_id and j.deleted_at is null
     and public.ticket_is_history(j.stage, j.scheduled_date)
   order by coalesce(j.completed_at, j.scheduled_date::timestamptz, j.created_at) desc, j.number desc
   limit 1;
  return jsonb_build_object('count', v_count, 'photo_count', v_photos, 'last', v_last);
end $$;
comment on function public.site_history_summary(uuid) is
  'The one-line history strip: how many earlier tickets at this ticket''s property (ticket_is_history), how many photos, and the last one''s day and gist. Same access rule as site_history (Oct 21; Nov 2).';
