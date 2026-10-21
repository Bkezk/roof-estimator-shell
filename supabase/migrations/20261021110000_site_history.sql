-- History at this property for technicians (owner, Oct 21; approved as proposed, with one
-- change: every photo, not three). A technician working a ticket sees what happened at the
-- property before — the earlier tickets, their repairs (problem → work completed), the closing
-- notes, the inspection outcome and ALL their photos with the saved mark-ups — on the ticket
-- page's "History at this property" fold, as one line on My tickets, and as "Last time: …" under
-- an inspection checklist item an earlier photo was taken for.
--
-- Why a SECURITY DEFINER function: a technician-only login (is_technician(), 20261008190000)
-- reads only the tickets assigned to them (service_jobs_read, 20260930093000 + the crew clause
-- of 20260930091000), so the earlier tickets at the property — other technicians' — are
-- unreadable to their token, as are those tickets' repairs and photos once the two policies
-- below are narrowed. The history therefore comes through ONE definer read that checks the
-- caller may see the ticket it starts from and then hands back the earlier tickets of the SAME
-- site, and nothing else: no prices, no invoices, no crew rates, no customer contact details.
--
-- 1. site_history_allowed(p_job_id): may the caller see this ticket's history? Customers
--    access, or Service access without the technician kind (the office, managers and owners
--    ticked Technician keep full visibility, owner Oct 8), or the ticket is a live one the
--    caller leads or is on the crew of — the shape of tech_sees_site (20261020122000).
-- 2. site_history(p_job_id) returns jsonb: the earlier tickets at the same site_id (not this
--    ticket, not deleted), newest first, each with id, number, service_type, description,
--    scheduled_date, completed_at, created_at, stage, location_id, location_name,
--    closing_notes, inspection_outcome, the technician's name (profiles full_name / email, read
--    under the definer), the inspection's items (id, label, status, note — the "Last time" line
--    under a checklist item), the repairs (id, name, problem_text, resolution_text,
--    completed_on) and the photos (id, storage_path, file_name, role, repair_id, item_key,
--    taken_at, created_at, annotations; never the signature). Raises 42501 in plain English
--    when the caller may not see the ticket, P0002 when there is no such live ticket.
-- 3. site_history_summary(p_job_id) returns jsonb: the one-line strip — count, photo_count and
--    the last ticket (id, number, completed_at, scheduled_date, created_at, description, the
--    first repair's work completed else the closing notes, each cut to 200 characters). My
--    tickets calls it once per card, so it is three small reads. Same access rule.
-- 4. Two read policies narrowed (the lead's finding, Oct 21): service_job_photos_read and
--    service_job_repairs_read (20260927130000_service_field.sql:196 / :171, never re-created
--    since) were `has_access('service') or has_access('customers')`, so a technician-only login
--    read every ticket's photos and repairs directly. Now: Customers access, or Service access
--    without the technician kind, or the row's ticket is a live one the caller leads or is on
--    the crew of. The technician's own tickets' rows, and the history through site_history only.
--    The `_write` policies of both tables are FOR ALL (20261006192000_field_edit_lock.sql), and a
--    FOR ALL policy also grants SELECT — but their USING is works_on_ticket(service_job_id) and
--    ticket_open_for_tech(service_job_id), which for a technician-only login is already only the
--    tickets they lead or crew (and only while Open / Scheduled / Done), so they open nothing the
--    narrowed read policies close. Left as they are.
--
--    Every technician path that reads photos or repairs still passes — each reads rows of a
--    ticket the technician leads or is on the crew of, admitted by the third clause:
--      * the ticket page's Repairs section (ticket-field-sections.tsx RepairsReadOnly →
--        listJobRepairs / listJobPhotos .eq service_job_id = their ticket);
--      * the close-out (closeout.tsx: listJobRepairs / listJobPhotos / registerJobPhoto /
--        savePhotoAnnotations / deleteJobPhoto on their ticket; the inspection close-out's
--        per-item photos are the same listJobPhotos rows);
--      * the inspection section on the ticket page (inspection-section.tsx reads no photo rows
--        itself; the "Last time" line comes through site_history);
--      * My tickets (service-field.functions.ts myDay reads no photo or repair rows; the strip
--        comes through site_history_summary);
--      * the Aerial section (aerial-markup.tsx listJobPhotos; service-aerial.functions.ts reads
--        service_job_photos .eq service_job_id = the ticket, role 'aerial') — their ticket;
--      * recentRepairsForJob (the close-out's "usual" repair chips): service_job_repairs
--        .in service_job_id = the earlier tickets at the site the CALLER CAN READ (service_jobs
--        RLS already hands a technician only their own) — their own tickets' rows, admitted;
--        the chips were never wider than that for a technician.
--    The office's paths — the invoice's Work Completed photo picker (invoice-photos.tsx →
--    invoice-photos.functions.ts, photos and repairs .eq service_job_id = the invoice's
--    ticket), the invoice PDF's photos (invoices.server.ts), the Repairs section and the history
--    for any ticket — are Service without the technician kind or Customers access: the first
--    two clauses, as before. restore.ts writes with the service key (no policy).
--
-- Idempotent: create or replace, drop policy if exists before each create. The app twin:
-- src/lib/service-history.functions.ts (siteHistory / siteHistorySummary call the two
-- functions and sign the photo paths). Pinned by src/lib/site-history-fence.test.ts.

-- 1. ------------------------------------------------------------------------------------------
create or replace function public.site_history_allowed(p_job_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_access('customers')
      or (public.has_access('service') and not public.is_technician())
      or exists (
        select 1 from public.service_jobs j
         where j.id = p_job_id and j.deleted_at is null
           and (j.technician_id = auth.uid() or public.is_on_crew(j.id))
      );
$$;
revoke all on function public.site_history_allowed(uuid) from public;
grant execute on function public.site_history_allowed(uuid) to authenticated, service_role;
comment on function public.site_history_allowed(uuid) is
  'May the caller see this ticket''s history at its property? Customers access, Service access without the technician kind, or a live ticket the caller leads or is on the crew of (Oct 21).';

-- 2. ------------------------------------------------------------------------------------------
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
                   'taken_at', ph.taken_at, 'created_at', ph.created_at,
                   'annotations', ph.annotations)
                 order by ph.created_at)
            from public.service_job_photos ph
           where ph.service_job_id = j.id and ph.role <> 'signature'), '[]'::jsonb)
      ) as doc
    from public.service_jobs j
    where j.site_id = v_site and j.id <> p_job_id and j.deleted_at is null
  ) t;
  return v_out;
end $$;
revoke all on function public.site_history(uuid) from public;
grant execute on function public.site_history(uuid) to authenticated, service_role;
comment on function public.site_history(uuid) is
  'The earlier tickets at this ticket''s property, newest first, with their repairs, photos (with mark-ups) and inspection items; no money, no customer contacts. Refuses (42501) a caller who may not see the ticket (Oct 21).';

-- 3. ------------------------------------------------------------------------------------------
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
   where j.site_id = v_site and j.id <> p_job_id and j.deleted_at is null;
  if v_count = 0 then
    return jsonb_build_object('count', 0, 'photo_count', 0, 'last', null);
  end if;
  select count(*) into v_photos
    from public.service_job_photos ph
    join public.service_jobs j on j.id = ph.service_job_id
   where j.site_id = v_site and j.id <> p_job_id and j.deleted_at is null
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
   order by coalesce(j.completed_at, j.scheduled_date::timestamptz, j.created_at) desc, j.number desc
   limit 1;
  return jsonb_build_object('count', v_count, 'photo_count', v_photos, 'last', v_last);
end $$;
revoke all on function public.site_history_summary(uuid) from public;
grant execute on function public.site_history_summary(uuid) to authenticated, service_role;
comment on function public.site_history_summary(uuid) is
  'The one-line history strip: how many earlier tickets at this ticket''s property, how many photos, and the last one''s day and gist. Same access rule as site_history (Oct 21).';

-- 4. ------------------------------------------------------------------------------------------
drop policy if exists service_job_photos_read on public.service_job_photos;
create policy service_job_photos_read on public.service_job_photos for select to authenticated
  using (public.has_access('customers')
         or (public.has_access('service') and not public.is_technician())
         or exists (
           select 1 from public.service_jobs j
            where j.id = service_job_id and j.deleted_at is null
              and (j.technician_id = auth.uid() or public.is_on_crew(j.id))));

drop policy if exists service_job_repairs_read on public.service_job_repairs;
create policy service_job_repairs_read on public.service_job_repairs for select to authenticated
  using (public.has_access('customers')
         or (public.has_access('service') and not public.is_technician())
         or exists (
           select 1 from public.service_jobs j
            where j.id = service_job_id and j.deleted_at is null
              and (j.technician_id = auth.uid() or public.is_on_crew(j.id))));
