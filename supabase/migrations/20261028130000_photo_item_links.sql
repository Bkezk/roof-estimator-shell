-- One ticket photo on several inspection checklist items (owner, Oct 28: "when associating photos
-- on the ticket to the inspection checklist you should be able to associate one photo to multiple
-- inspection checklist items"). Until now service_job_photos.item_key held ONE item per photo
-- (20261012190000_inspection_flow.sql). Idempotent.
--
-- 1. public.service_job_photo_items: the join table — one row per (photo, checklist item), the
--    item as inspection_checklist_items.id the way the ticket's inspection JSON keeps it. RLS
--    mirrors service_job_photos: a link is readable where its photo is readable
--    (service_job_photos_read, 20261021110000_site_history.sql) and writable where its photo is
--    writable (service_job_photos_write, 20261006192000_field_edit_lock.sql) — the same predicates,
--    reached through the photo row (p.service_job_id). Pinned by src/lib/photo-item-links.test.ts.
-- 2. Backfill: every photo with an item_key gets that one link.
-- 3. service_job_photos.item_key stays as the FIRST / primary item for older readers (the invoice
--    photo picker, the site-history JSON's `item_key`, older clients) and is kept in sync by a
--    trigger on the links (photo_item_links_sync_primary): the photo keeps its item_key while that
--    item is still linked, else takes the earliest link, else null. A second trigger on the photos
--    (photo_item_key_sync_links) keeps a direct write of item_key honest — an insert or update with
--    item_key set links that item (a change unlinks the old one), null unlinks all — so a writer
--    that still speaks item_key alone (the close-out camera's registerJobPhoto, a hand edit) lands
--    in the links too. The server functions (service-field.functions.ts setJobPhotoItems) write
--    the links and the primary together; the triggers are the guarantee.
-- 4. site_history(): each photo in the JSON gains `item_keys` (every item it is on, earliest
--    first); `item_key` stays. Same body as 20261021110000 otherwise.

-- ── 1. The join table ────────────────────────────────────────────────────────────────────

create table if not exists public.service_job_photo_items (
  photo_id uuid not null references public.service_job_photos(id) on delete cascade,
  item_key text not null check (char_length(item_key) between 1 and 60),
  created_at timestamptz not null default now(),
  primary key (photo_id, item_key)
);
comment on table public.service_job_photo_items is
  'A ticket photo on an inspection checklist item (inspection_checklist_items.id as kept in service_jobs.inspection.items[].id); one photo may be on several items (Oct 28). service_job_photos.item_key mirrors the first of them.';
create index if not exists service_job_photo_items_item_idx
  on public.service_job_photo_items (item_key, photo_id);

alter table public.service_job_photo_items enable row level security;

-- Read where the photo is readable: service_job_photos_read's predicate, through the photo row.
drop policy if exists service_job_photo_items_read on public.service_job_photo_items;
create policy service_job_photo_items_read on public.service_job_photo_items for select to authenticated
  using (exists (
    select 1 from public.service_job_photos p
     where p.id = photo_id
       and (public.has_access('customers')
            or (public.has_access('service') and not public.is_technician())
            or exists (
              select 1 from public.service_jobs j
               where j.id = p.service_job_id and j.deleted_at is null
                 and (j.technician_id = auth.uid() or public.is_on_crew(j.id))))));

-- Write where the photo is writable: service_job_photos_write's predicate, through the photo row.
drop policy if exists service_job_photo_items_write on public.service_job_photo_items;
create policy service_job_photo_items_write on public.service_job_photo_items for all to authenticated
  using (exists (
    select 1 from public.service_job_photos p
     where p.id = photo_id
       and public.works_on_ticket(p.service_job_id) and public.ticket_open_for_tech(p.service_job_id)))
  with check (exists (
    select 1 from public.service_job_photos p
     where p.id = photo_id
       and public.works_on_ticket(p.service_job_id) and public.ticket_open_for_tech(p.service_job_id)));

-- ── 2. Backfill from item_key ────────────────────────────────────────────────────────────

insert into public.service_job_photo_items (photo_id, item_key)
select id, item_key from public.service_job_photos where item_key is not null
on conflict do nothing;

-- ── 3. item_key kept as the primary item ─────────────────────────────────────────────────

-- Links → photo: the photo's item_key stays while still linked, else the earliest link, else null.
create or replace function public.photo_item_links_sync_primary()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_photo uuid := coalesce(new.photo_id, old.photo_id);
  v_primary text;
begin
  select coalesce(
           (select l.item_key from public.service_job_photo_items l
             where l.photo_id = p.id and l.item_key = p.item_key),
           (select l.item_key from public.service_job_photo_items l
             where l.photo_id = p.id order by l.created_at, l.item_key limit 1))
    into v_primary
    from public.service_job_photos p where p.id = v_photo;
  update public.service_job_photos
     set item_key = v_primary
   where id = v_photo and item_key is distinct from v_primary;
  return null;
end $$;
revoke all on function public.photo_item_links_sync_primary() from public;

drop trigger if exists photo_item_links_sync_primary on public.service_job_photo_items;
create trigger photo_item_links_sync_primary
  after insert or update or delete on public.service_job_photo_items
  for each row execute function public.photo_item_links_sync_primary();

-- Photo → links: a direct write of item_key (an older writer) links that item; a change unlinks
-- the old one; null unlinks all. Skipped when fired by the links trigger above (depth > 1).
create or replace function public.photo_item_key_sync_links()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if pg_trigger_depth() > 1 then
    return null;
  end if;
  if tg_op = 'UPDATE' and old.item_key is not null and old.item_key is distinct from new.item_key then
    if new.item_key is null then
      delete from public.service_job_photo_items where photo_id = new.id;
    else
      delete from public.service_job_photo_items where photo_id = new.id and item_key = old.item_key;
    end if;
  end if;
  if new.item_key is not null then
    insert into public.service_job_photo_items (photo_id, item_key)
    values (new.id, new.item_key)
    on conflict do nothing;
  end if;
  return null;
end $$;
revoke all on function public.photo_item_key_sync_links() from public;

drop trigger if exists photo_item_key_sync_links on public.service_job_photos;
create trigger photo_item_key_sync_links
  after insert or update of item_key on public.service_job_photos
  for each row execute function public.photo_item_key_sync_links();

-- ── 4. site_history(): photos carry item_keys ────────────────────────────────────────────

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
  ) t;
  return v_out;
end $$;
revoke all on function public.site_history(uuid) from public;
grant execute on function public.site_history(uuid) to authenticated, service_role;
comment on function public.site_history(uuid) is
  'The earlier tickets at this ticket''s property, newest first, with their repairs, photos (with mark-ups; item_keys = every checklist item a photo is on, Oct 28) and inspection items; no money, no customer contacts. Refuses (42501) a caller who may not see the ticket (Oct 21).';
