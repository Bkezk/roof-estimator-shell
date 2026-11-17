-- History at this property: a short list, a pop-up per earlier ticket, and Activity entries
-- the office marks "Viewable to technicians" (owner, Nov 17: "when the tech clicks history at
-- this property i just want them to see this and then they can click the ticket and itll pop up
-- its photos and notes from the tickets and on the activity log have a check box that says
-- viewable to technicians and anything with that check box should also show").
--
-- 1. crm_contact_log.tech_visible (boolean, not null, default false): the checkbox. An Activity
--    entry on a ticket (a Note, or Called / Texted / Emailed / Visited) with it ticked shows in
--    the pop-up of that ticket wherever the property's history is read. Nothing already written
--    is ticked: every existing entry stays as private as it was.
-- 2. contact_log_set_tech_visible(p_id, p_on): tick or untick an entry that is already there.
--    The office's: an admin, a manager, or a Service user who is not technician-only. Only an
--    entry a person made on a ticket; never the lines the site writes itself (method note) nor
--    the close-out's summary (method service). SECURITY DEFINER because nobody may update the
--    log directly (it has no update rule), and it changes this one column and nothing else.
-- 3. site_history(p_job_id) hands three more things over for each earlier ticket:
--    special_instructions (the ticket's own box), inspection_notes (the inspection's notes box)
--    and shared_notes (the ticked Activity entries, oldest first). The function is
--    20261103190000_closeout_marks_thumbs_history.sql's exactly, plus the three keys. Who may
--    ask is unchanged (site_history_allowed); no price, rate or invoice is handed over. The
--    two-argument form (the newest N) calls this one and is untouched.
--
-- Idempotent: add column if not exists, create or replace. Additive to the data.

alter table public.crm_contact_log
  add column if not exists tech_visible boolean not null default false;

comment on column public.crm_contact_log.tech_visible is
  'Owner, Nov 17: Viewable to technicians. A ticked ticket entry shows in the history pop-up of its ticket for technicians on later tickets at the property; off by default';

create or replace function public.contact_log_set_tech_visible(p_id bigint, p_on boolean)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_on boolean;
begin
  if auth.uid() is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  if p_on is null then
    raise exception 'on or off is required' using errcode = '22004';
  end if;
  if not (public.is_admin() or public.is_manager()
          or (public.has_access('service') and not public.is_technician())) then
    raise exception 'Only the office chooses what technicians can see'
      using errcode = '42501';
  end if;
  update public.crm_contact_log as l
     set tech_visible = p_on
   where l.id = p_id
     and l.kind = 'ticket'
     and l.method not in ('note', 'service')
  returning l.tech_visible into v_on;
  if not found then
    raise exception 'That entry was not found' using errcode = 'P0002';
  end if;
  return v_on;
end $$;

revoke all on function public.contact_log_set_tech_visible(bigint, boolean) from public, anon;
grant execute on function public.contact_log_set_tech_visible(bigint, boolean) to authenticated;

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
        'special_instructions', nullif(trim(j.notes), ''),
        'inspection_notes', nullif(trim(j.inspection->>'notes'), ''),
        'shared_notes', coalesce((
          select jsonb_agg(jsonb_build_object(
                   'id', l.id, 'method', l.method, 'note', l.note,
                   'by_name', coalesce(nullif(trim(l.by_name), ''),
                                       nullif(trim(w.full_name), ''), w.email),
                   'at', l.at)
                 order by l.at, l.id)
            from public.crm_contact_log l
            left join public.profiles w on w.id = l.by_user
           where l.kind = 'ticket' and l.item_id = j.id and l.tech_visible
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
