-- Nov 4 (the Nov 3 review's bugs 3 and 12; owner: "fix the rest").
--
-- 3. service_job_events_insert let any Service login insert any timeline row on any ticket
--    (it was has_access('service') since 20260927130000). Now a row goes in only from someone who
--    works on that ticket — the office, a manager, an admin, the lead or a crew member
--    (works_on_ticket, 20261008190000) — and only of the kinds the app writes
--    (service-field.functions.ts AppEventKind). 'stage' rows are the trigger's
--    (service_jobs_stage_log, SECURITY DEFINER) and 'contact' copies stopped on Nov 3.
-- 12. save_service_materials: the material pricing list used to be saved row by row from the
--    server function; a failure halfway left half the list saved and the screen dirty. One
--    function, one transaction: every update and insert lands, or none does. The function only
--    writes; the server function still validates (names, ids) before calling it. A manager's or
--    an admin's, as service_materials_write says.

drop policy if exists service_job_events_insert on public.service_job_events;
create policy service_job_events_insert on public.service_job_events
  for insert to authenticated
  with check (
    public.works_on_ticket(service_job_id)
    and kind in ('field', 'note', 'assign', 'photo', 'signature', 'edit')
  );

create or replace function public.save_service_materials(p_updates jsonb, p_inserts jsonb, p_markup numeric default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v jsonb;
begin
  if not (public.is_admin() or public.is_manager()) then
    raise exception 'Only a manager changes material pricing' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_updates, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_inserts, '[]'::jsonb)) <> 'array' then
    raise exception 'The materials must be lists' using errcode = '22023';
  end if;
  if p_markup is not null then
    update public.service_settings set material_markup = p_markup, updated_at = now() where id = 1;
  end if;
  for v in select value from jsonb_array_elements(coalesce(p_updates, '[]'::jsonb)) loop
    update public.service_materials
       set name = v ->> 'name',
           unit = v ->> 'unit',
           cost = (v ->> 'cost')::numeric,
           active = (v ->> 'active')::boolean,
           category = v ->> 'category',
           updated_at = now()
     where id = (v ->> 'id')::uuid;
    if not found then
      raise exception 'That material is no longer on the list — reload' using errcode = 'P0002';
    end if;
  end loop;
  for v in select value from jsonb_array_elements(coalesce(p_inserts, '[]'::jsonb)) loop
    insert into public.service_materials (name, unit, cost, active, category, sort)
    values (v ->> 'name', v ->> 'unit', (v ->> 'cost')::numeric, (v ->> 'active')::boolean,
            v ->> 'category', coalesce((v ->> 'sort')::integer, 0));
  end loop;
end $$;
revoke all on function public.save_service_materials(jsonb, jsonb, numeric) from public, anon;
grant execute on function public.save_service_materials(jsonb, jsonb, numeric) to authenticated;
