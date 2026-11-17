-- History at this property shows what the technician found and wrote (owner, Nov 17: a
-- technician-only login opened the history and saw a date, a description and an outcome: "its
-- honestly not very useful. what would be useful for the techs would be something that shows
-- history as far as the previous tickets tech notes and photos").
--
-- The photos were already handed over, every one. Two things were not:
--
-- 1. tech_notes: what a technician typed in the earlier ticket's Activity: a Note, or the words
--    typed with Called / Texted / Emailed / Visited. Written by a person ticked Technician, by
--    the ticket's technician or by someone on its crew. The office's own notes are not handed
--    over: a technician reads another ticket's notes only as far as this (the Nov 14 rule), and
--    an office note can be about money. Left out as well: the lines the site writes by itself
--    ("Date moved from ...", method note) and the close-out's own summary (method service),
--    which repeats the repairs and the closing notes already in the row.
-- 2. inspection_notes: the inspection's own notes box.
--
-- (What was flagged on an inspection was already handed over, in inspection_items; the screen
-- did not show it. That is the screen's change, not this one.)
--
-- Who may ask is unchanged (site_history_allowed). The function is
-- 20261103190000_closeout_marks_thumbs_history.sql's exactly, plus the two keys. The
-- two-argument form (the newest N) calls this one and is untouched.

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
        'inspection_notes', nullif(trim(j.inspection->>'notes'), ''),
        'tech_notes', coalesce((
          select jsonb_agg(jsonb_build_object(
                   'id', l.id, 'method', l.method, 'note', l.note,
                   'by_name', coalesce(nullif(trim(l.by_name), ''),
                                       nullif(trim(w.full_name), ''), w.email),
                   'at', l.at)
                 order by l.at, l.id)
            from public.crm_contact_log l
            join public.profiles w on w.id = l.by_user
           where l.kind = 'ticket' and l.item_id = j.id
             and l.method not in ('note', 'service')
             and nullif(trim(l.note), '') is not null
             and (coalesce(w.technician, false)
                  or l.by_user = j.technician_id
                  or exists (select 1 from public.service_job_crew c
                              where c.service_job_id = j.id and c.technician_id = l.by_user))
          ), '[]'::jsonb),
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
