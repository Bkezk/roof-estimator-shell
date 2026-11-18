-- A count dated to an earlier day no longer corrects twice for what was typed in since (owner,
-- Nov 18, of the audit: "fix please").
--
-- A December 31 count typed in on January 3 is compared with what inventory held at the end of
-- December 31. Anything typed in on January 1 to 3 "stays on top". That is right for work done
-- in January. It is wrong for a use that happened in December and was typed in late: the count
-- already saw the shelf without it, so the count corrected for it and the late entry took it
-- off again. Tried on the live database: 10 in, 2 used typed late, a count of 8 dated two days
-- back. The ledger said 6. The shelf held 8.
--
-- Now the count sheet of an earlier day lists the entries typed in since for its items, and the
-- office ticks the ones that happened on or before the count day. Those are moved into that day
-- (one second before the count's own entries), with a line added to their note saying when
-- they were typed. The count then compares with a ledger that already has them.
--
--   1. inventory_move_into_count: the move. It runs only from inside inventory_save_count (a
--      transaction flag), because nobody may change the ledger's rows directly.
--   2. inventory_save_count: one more argument, p_before, the ids of the ticked entries. The
--      five-argument form is dropped so there is one function, and a call without p_before
--      (the older site) is answered by this one as before.
--
-- Safe to run twice.

create or replace function public.inventory_move_into_count(
  p_ids bigint[],
  p_at timestamptz,
  p_day date
)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if coalesce(current_setting('jbk.count_save', true), '') <> 'on' then
    raise exception 'Only saving a count moves an entry' using errcode = '42501';
  end if;
  update public.inventory_movements m
     set note = concat_ws(' — ', nullif(trim(coalesce(m.note, '')), ''),
           'Typed in ' || to_char(m.created_at at time zone 'America/New_York', 'Mon FMDD')
           || '. It happened by ' || to_char(p_day, 'Mon FMDD')
           || ' and is in that day''s count'),
         created_at = p_at
   where m.id = any(p_ids)
      -- The other half of a move between two places goes with it.
      or (m.pair_id is not null
          and m.pair_id in (select x.pair_id from public.inventory_movements x
                             where x.id = any(p_ids) and x.pair_id is not null));
end;
$function$;
revoke all on function public.inventory_move_into_count(bigint[], timestamptz, date) from public, anon;
grant execute on function public.inventory_move_into_count(bigint[], timestamptz, date) to authenticated, service_role;

drop function if exists public.inventory_save_count(text, date, boolean, text, jsonb);

create or replace function public.inventory_save_count(
  p_location text,
  p_counted_on date,
  p_opening boolean,
  p_note text,
  p_lines jsonb,
  p_before bigint[] default null
)
 returns uuid
 language plpgsql
 security invoker
 set search_path to 'public'
as $function$
declare
  v_id uuid;
  v_name text;
  l jsonb;
  v_expected numeric;
  v_counted numeric;
  v_delta numeric;
  v_mov bigint;
  v_cost numeric;
  v_today date := (now() at time zone 'America/New_York')::date;
  v_day date := coalesce(p_counted_on, (now() at time zone 'America/New_York')::date);
  v_at timestamptz;
begin
  if v_day > v_today then
    raise exception 'A count cannot be dated in the future';
  end if;
  v_at := case when v_day = v_today then now()
               else ((v_day + 1)::timestamp at time zone 'America/New_York') - interval '1 second' end;
  if not public.has_access('estimate') then
    raise exception 'Only an estimator or a manager saves a count' using errcode = '42501';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'A count needs at least one counted item';
  end if;
  if not exists (select 1 from public.inventory_locations where id = p_location and active) then
    raise exception 'That place was not found';
  end if;
  -- Entries typed in after the count day that the office says happened on or before it: they are
  -- moved into that day before anything is compared, so the count does not correct for them a
  -- second time. Each must be an entry at this place, typed after that day, not itself part of a
  -- count, for an item on this count.
  if p_before is not null and coalesce(array_length(p_before, 1), 0) > 0 then
    if v_day = v_today then
      raise exception 'Only a count of an earlier day takes entries typed in since';
    end if;
    if exists (
      select 1 from unnest(p_before) as b(id)
       where not exists (
         select 1 from public.inventory_movements m
          where m.id = b.id
            and m.location_id = p_location
            and m.created_at > v_at
            and m.count_id is null
            and exists (
              select 1 from jsonb_array_elements(p_lines) as pl(v)
               where pl.v->>'screen_id' = m.screen_id
                 and pl.v->>'row_label' = m.row_label
                 and pl.v->>'price_col' = m.price_col)))
    then
      raise exception 'An entry marked as before the count is not one typed in since that day for an item on this count';
    end if;
    perform set_config('jbk.count_save', 'on', true);
    perform public.inventory_move_into_count(p_before, v_at - interval '1 second', v_day);
    perform set_config('jbk.count_save', '', true);
  end if;
  select coalesce(nullif(trim(p.full_name), ''), p.email) into v_name
    from public.profiles p where p.id = auth.uid();
  insert into public.inventory_counts (location_id, counted_on, opening, note, created_by, created_by_name)
  values (p_location, v_day, coalesce(p_opening, false),
          nullif(trim(coalesce(p_note, '')), ''), auth.uid(), v_name)
  returning id into v_id;
  for l in select * from jsonb_array_elements(p_lines) loop
    v_counted := (l->>'counted')::numeric;
    if v_counted is null or v_counted < 0 then
      raise exception 'A count cannot be below zero';
    end if;
    if coalesce(l->>'screen_id', '') = '' or coalesce(l->>'row_label', '') = ''
       or coalesce(l->>'price_col', '') = '' or coalesce(l->>'unit', '') = '' then
      raise exception 'A counted line is missing its item';
    end if;
    select coalesce(sum(m.qty), 0) into v_expected
      from public.inventory_movements m
     where m.location_id = p_location
       and m.screen_id = l->>'screen_id'
       and m.row_label = l->>'row_label'
       and m.price_col = l->>'price_col'
       and m.created_at <= v_at;
    v_delta := round(v_counted - v_expected, 3);
    v_mov := null;
    if v_delta <> 0 then
      insert into public.inventory_movements
        (location_id, screen_id, row_label, price_col, item_no, qty, unit, reason, note,
         counted_note, created_by, created_by_name, count_id, created_at)
      values
        (p_location, l->>'screen_id', l->>'row_label', l->>'price_col', nullif(l->>'item_no', ''),
         v_delta, l->>'unit',
         case when coalesce(p_opening, false) and v_delta > 0 then 'opening' else 'adjustment' end,
         case when coalesce(p_opening, false) then 'Opening count on Inventory'
              else 'Counted on Inventory' end,
         nullif(l->>'counted_note', ''), auth.uid(), v_name, v_id, v_at)
      returning id into v_mov;
      v_cost := nullif(l->>'unit_cost', '')::numeric;
      if v_cost is not null and v_delta > 0 then
        insert into public.inventory_movement_costs (movement_id, unit_cost, source, set_by, set_by_name)
        values (v_mov, v_cost, case when coalesce(p_opening, false) then 'opening' else 'count' end,
                auth.uid(), v_name);
      end if;
    end if;
    insert into public.inventory_count_lines
      (count_id, screen_id, row_label, price_col, unit, expected, counted, movement_id)
    values
      (v_id, l->>'screen_id', l->>'row_label', l->>'price_col', l->>'unit', v_expected,
       v_counted, v_mov);
  end loop;
  return v_id;
end;
$function$;

revoke all on function public.inventory_save_count(text, date, boolean, text, jsonb, bigint[]) from public, anon;
grant execute on function public.inventory_save_count(text, date, boolean, text, jsonb, bigint[]) to authenticated, service_role;
