-- Inventory for year-end (owner, Nov 16: "as far as reporting for EOY stuff, is it as efficient
-- and good as it could be especially with the reconciliation part" … "Go with all 6").
--
-- Until now the ledger kept quantities only. Nothing recorded stock coming in at a price, no
-- count of a whole shelf or truck was kept as a record, and a dollar value was always today's
-- Setup cost times what is on hand right now.
--
-- What this adds (idempotent; no existing row is changed):
--   1. Two entry types: "received" (stock bought or added, with the price paid) and "opening"
--      (the opening count).
--   2. inventory_movement_costs: the price paid per stock unit on an entry that brought stock
--      in. Dollars are an admin's and a manager's (owner, Oct 15: "include the value in dollars
--      for managers and admins only"), and the ledger itself is readable by every signed-in
--      person, so the price lives in its own table that only they read and write. Every other
--      cost (what a taking entry cost, the average, the value on a day) is worked out from the
--      ledger and these prices in src/lib/inventory-cost.ts; nothing else is stored.
--   3. inventory_counts and inventory_count_lines: a count of one place on one day, kept as a
--      record — every line with what inventory expected and what was counted, whether or not
--      they differed. No dollars are stored on a count.
--   4. inventory_movements.count_id: the correcting entries a count made.
--   5. inventory_save_count: saves a whole count in one transaction, so a count is never half
--      saved. It runs under the caller's own rights (security invoker).

-- 1 ── entry types ─────────────────────────────────────────────────────────────────────────
alter table public.inventory_movements drop constraint if exists inventory_movements_reason_check;
alter table public.inventory_movements
  add constraint inventory_movements_reason_check
  check (reason = any (array[
    'leftover', 'adjustment', 'damaged', 'allocated', 'released', 'consumed',
    'transfer_out', 'transfer_in', 'vehicle_used', 'received', 'opening'
  ]));

-- "Bought or delivered (no job)" on the Put in inventory form is a Received entry, and that form
-- is everyone's: whoever may record a leftover may record stock that was bought. (It was saved
-- as a leftover with no job until now, so this opens nothing new.) The rest of the rule is as
-- it stood: Estimate access records anything.
alter policy inventory_movements_insert on public.inventory_movements with check (
  (select public.has_access('estimate'))
  or (
    ((select public.has_access('inventory')) or (select public.has_access('service')))
    and (
      reason = any (array['leftover', 'received', 'consumed', 'transfer_out', 'transfer_in'])
      or (reason = 'released' and service_job_id is not null)
    )
  )
);

-- 3 ── counts ──────────────────────────────────────────────────────────────────────────────
create table if not exists public.inventory_counts (
  id uuid primary key default gen_random_uuid(),
  location_id text not null references public.inventory_locations(id),
  counted_on date not null default current_date,
  opening boolean not null default false,
  note text,
  created_by uuid default auth.uid(),
  created_by_name text,
  created_at timestamptz not null default now()
);
create index if not exists inventory_counts_when_idx
  on public.inventory_counts (counted_on desc, created_at desc);

-- 4 ── the entries a count made (before the lines, which point at entries) ─────────────────
alter table public.inventory_movements
  add column if not exists count_id uuid references public.inventory_counts(id) on delete set null;
create index if not exists inventory_movements_count_idx
  on public.inventory_movements (count_id) where count_id is not null;

create table if not exists public.inventory_count_lines (
  id bigint generated always as identity primary key,
  count_id uuid not null references public.inventory_counts(id) on delete cascade,
  screen_id text not null,
  row_label text not null,
  price_col text not null,
  unit text not null,
  expected numeric not null,
  counted numeric not null check (counted >= 0),
  movement_id bigint references public.inventory_movements(id) on delete set null,
  unique (count_id, screen_id, row_label, price_col)
);

alter table public.inventory_counts enable row level security;
alter table public.inventory_count_lines enable row level security;

drop policy if exists inventory_counts_read on public.inventory_counts;
create policy inventory_counts_read on public.inventory_counts
  for select to authenticated using ((select public.has_access('estimate')));
drop policy if exists inventory_counts_insert on public.inventory_counts;
create policy inventory_counts_insert on public.inventory_counts
  for insert to authenticated with check ((select public.has_access('estimate')));
drop policy if exists inventory_counts_delete on public.inventory_counts;
create policy inventory_counts_delete on public.inventory_counts
  for delete to authenticated using ((select public.is_admin()));

drop policy if exists inventory_count_lines_read on public.inventory_count_lines;
create policy inventory_count_lines_read on public.inventory_count_lines
  for select to authenticated using ((select public.has_access('estimate')));
drop policy if exists inventory_count_lines_insert on public.inventory_count_lines;
create policy inventory_count_lines_insert on public.inventory_count_lines
  for insert to authenticated with check ((select public.has_access('estimate')));

revoke all on public.inventory_counts from anon, public, authenticated;
revoke all on public.inventory_count_lines from anon, public, authenticated;
grant select, insert, delete on public.inventory_counts to authenticated;
grant select, insert on public.inventory_count_lines to authenticated;
grant all on public.inventory_counts to service_role;
grant all on public.inventory_count_lines to service_role;

-- 2 ── the price paid ──────────────────────────────────────────────────────────────────────
create table if not exists public.inventory_movement_costs (
  movement_id bigint primary key references public.inventory_movements(id) on delete cascade,
  unit_cost numeric not null check (unit_cost >= 0),
  source text not null default 'paid' check (source in ('paid', 'opening', 'count', 'set')),
  set_by uuid default auth.uid(),
  set_by_name text,
  set_at timestamptz not null default now()
);

alter table public.inventory_movement_costs enable row level security;

drop policy if exists inventory_movement_costs_managers on public.inventory_movement_costs;
create policy inventory_movement_costs_managers on public.inventory_movement_costs
  for all to authenticated
  using ((select public.is_admin()) or (select public.is_manager()))
  with check ((select public.is_admin()) or (select public.is_manager()));

revoke all on public.inventory_movement_costs from anon, public, authenticated;
grant select, insert, update, delete on public.inventory_movement_costs to authenticated;
grant all on public.inventory_movement_costs to service_role;

-- 5 ── a whole count, in one transaction ───────────────────────────────────────────────────
-- p_lines: [{ screen_id, row_label, price_col, unit, item_no, counted, counted_note, unit_cost }].
-- What inventory expected is read here, inside the transaction, never taken from the caller.
-- A line that matches gets no entry; one that differs gets one correcting entry. unit_cost is
-- kept only on a line that brought stock in, and only an admin or a manager can send one (the
-- price table's own policy refuses anyone else).
-- A count dated before today (a December 31 count typed in on January 3) is compared with what
-- inventory held at the end of that day, office time, and its correcting entries are dated then,
-- so stock as of that day includes them. Entries made since stay on top. Never a future date.
create or replace function public.inventory_save_count(
  p_location text,
  p_counted_on date,
  p_opening boolean,
  p_note text,
  p_lines jsonb
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

revoke all on function public.inventory_save_count(text, date, boolean, text, jsonb) from public, anon;
grant execute on function public.inventory_save_count(text, date, boolean, text, jsonb) to authenticated, service_role;
