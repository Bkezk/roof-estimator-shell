-- A change on Setup leaves a History row (owner, Nov 10; re-check record finding 4: "A change on
-- Setup leaves no record of who made it").
--
-- Service rates, the settings beside them (authorizer, email wording, terms, tax, the confirm
-- stamp), the material markup, each material's price, and the inspection checklist now write
-- `audit_log` rows the way tickets and customers do: who, when, and the old and new value in
-- words. Three new entities, one per Setup tab, so the page reads its own tab's rows:
--   setup_rates      "Urgent Helper Travel bill rate 40 → 41"
--                    "Authorizer Brandon Keck → Admins and managers; email subject '…' → '…'"
--                    "Rates confirmed"
--   setup_materials  "Material markup 75 % → 76 %"
--                    "Quick Prime 1 Gal cost $54.35 → $55.00"   (entity_id = the material)
--   setup_checklist  "Checklist item “Flashing” added" / "removed" / "renamed “…”"
--                    "Checklist: “Seams” moved from 2 to 3"
-- A save that changes nothing (the rates form sends all twelve rows every time) writes nothing;
-- `updated_at` alone is never a row. Admins and managers read the rows (audit_log_read).
--
-- The checklist was saved row by row from the server function, so a reorder could not be
-- described (each row only knew its own sort number) and a failure halfway left half a list.
-- save_checklist_items does the whole save in one transaction and writes the "moved" line itself;
-- the row trigger writes added / removed / renamed, also for a change made straight in SQL.

alter table public.audit_log drop constraint if exists audit_log_entity_check;
alter table public.audit_log add constraint audit_log_entity_check
  check (entity in ('invoice', 'invoice_line', 'account', 'site', 'contact', 'purchase_order',
                    'vendor', 'ticket', 'ticket_time', 'task', 'opportunity', 'bid',
                    'setup_rates', 'setup_materials', 'setup_checklist'));

-- Who did it, as audit_row() says it, and the row itself. Called by the triggers below only.
create or replace function public.audit_setup_log(
  p_entity text, p_entity_id uuid, p_action text, p_summary text, p_changes jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_name text;
  v_role text;
begin
  if v_uid is null then
    v_name := 'system';
    v_role := null;
  else
    select coalesce(nullif(trim(p.full_name), ''), nullif(trim(p.email), ''), 'Unknown user'),
           case
             when p.role = 'admin' then 'admin'
             when p.role = 'manager' then 'manager'
             when public.is_sales_pm() then 'sales'
             when coalesce(p.technician, false) then 'technician'
             else 'user'
           end
      into v_name, v_role
      from public.profiles p where p.id = v_uid;
    if not found then
      v_name := 'Unknown user';
      v_role := 'user';
    end if;
  end if;
  insert into public.audit_log (by_user, by_name, by_role, entity, entity_id, action, summary, changes)
  values (v_uid, v_name, v_role, p_entity, p_entity_id, p_action, p_summary,
          nullif(p_changes, '{}'::jsonb));
end $$;
revoke all on function public.audit_setup_log(text, uuid, text, text, jsonb) from public, anon, authenticated;

-- "75 %" for 0.75; "$54.35" for 54.35; "—" for nothing.
create or replace function public.audit_setup_pct(v numeric)
returns text language sql immutable set search_path = public as $$
  select case when v is null then '—' else trim_scale(round(v * 100, 4))::text || ' %' end;
$$;
create or replace function public.audit_setup_money(v numeric)
returns text language sql immutable set search_path = public as $$
  select case when v is null then '—' else '$' || to_char(v, 'FM999,999,990.00') end;
$$;

-- ── service_rates ───────────────────────────────────────────────────────────────────────────
create or replace function public.audit_setup_rates()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_parts text[] := '{}';
  v_changes jsonb := '{}'::jsonb;
begin
  if new.bill_rate is distinct from old.bill_rate then
    v_parts := v_parts || ('bill rate ' || coalesce(trim_scale(old.bill_rate)::text, '—') || ' → '
                           || coalesce(trim_scale(new.bill_rate)::text, '—'));
    v_changes := v_changes || jsonb_build_object('bill_rate',
      jsonb_build_object('from', old.bill_rate, 'to', new.bill_rate));
  end if;
  if new.cost_rate is distinct from old.cost_rate then
    v_parts := v_parts || ('cost rate ' || coalesce(trim_scale(old.cost_rate)::text, '—') || ' → '
                           || coalesce(trim_scale(new.cost_rate)::text, '—'));
    v_changes := v_changes || jsonb_build_object('cost_rate',
      jsonb_build_object('from', old.cost_rate, 'to', new.cost_rate));
  end if;
  if cardinality(v_parts) = 0 then
    return null;
  end if;
  perform public.audit_setup_log('setup_rates', null, 'update',
    initcap(new.rate_kind) || ' ' || initcap(new.role) || ' ' || initcap(new.time_kind) || ' '
      || array_to_string(v_parts, '; '),
    v_changes);
  return null;
end $$;
drop trigger if exists service_rates_audit on public.service_rates;
create trigger service_rates_audit after update on public.service_rates
  for each row execute function public.audit_setup_rates();

-- ── service_settings ────────────────────────────────────────────────────────────────────────
create or replace function public.audit_setup_settings()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_parts text[] := '{}';
  v_changes jsonb := '{}'::jsonb;
  v_old jsonb := to_jsonb(old);
  v_new jsonb := to_jsonb(new);
  v_from text;
  v_to text;
  v_col text;
  v_line text;
begin
  if new.authorizer_id is distinct from old.authorizer_id then
    select coalesce(nullif(btrim(p.full_name), ''), nullif(btrim(p.email), '')) into v_from
      from public.profiles p where p.id = old.authorizer_id;
    select coalesce(nullif(btrim(p.full_name), ''), nullif(btrim(p.email), '')) into v_to
      from public.profiles p where p.id = new.authorizer_id;
    v_parts := v_parts || ('authorizer '
      || case when old.authorizer_id is null then 'Admins and managers' else coalesce(v_from, 'someone') end
      || ' → '
      || case when new.authorizer_id is null then 'Admins and managers' else coalesce(v_to, 'someone') end);
    v_changes := v_changes || jsonb_build_object('authorizer_id',
      jsonb_build_object('from', old.authorizer_id, 'to', new.authorizer_id));
  end if;
  foreach v_col in array array['email_subject', 'email_message', 'payment_terms', 'invoice_contact'] loop
    if (v_new -> v_col) is distinct from (v_old -> v_col) then
      v_parts := v_parts || (replace(v_col, '_', ' ') || ' ' || public.audit_fmt(v_old -> v_col)
                             || ' → ' || public.audit_fmt(v_new -> v_col));
      v_changes := v_changes || jsonb_build_object(v_col,
        jsonb_build_object('from', v_old -> v_col, 'to', v_new -> v_col));
    end if;
  end loop;
  if new.tax_rate is distinct from old.tax_rate then
    v_parts := v_parts || ('tax rate ' || public.audit_setup_pct(old.tax_rate) || ' → '
                           || public.audit_setup_pct(new.tax_rate));
    v_changes := v_changes || jsonb_build_object('tax_rate',
      jsonb_build_object('from', old.tax_rate, 'to', new.tax_rate));
  end if;
  if new.rates_confirmed_at is distinct from old.rates_confirmed_at then
    v_parts := v_parts || case when new.rates_confirmed_at is null
                               then 'rates confirmation cleared' else 'rates confirmed' end;
    v_changes := v_changes || jsonb_build_object('rates_confirmed_at',
      jsonb_build_object('from', old.rates_confirmed_at, 'to', new.rates_confirmed_at));
  end if;
  if cardinality(v_parts) > 0 then
    v_line := array_to_string(v_parts, '; ');
    perform public.audit_setup_log('setup_rates', null, 'update',
      upper(left(v_line, 1)) || substr(v_line, 2), v_changes);
  end if;
  -- The markup is the Material pricing tab's.
  if new.material_markup is distinct from old.material_markup then
    perform public.audit_setup_log('setup_materials', null, 'update',
      'Material markup ' || public.audit_setup_pct(old.material_markup) || ' → '
        || public.audit_setup_pct(new.material_markup),
      jsonb_build_object('material_markup',
        jsonb_build_object('from', old.material_markup, 'to', new.material_markup)));
  end if;
  return null;
end $$;
drop trigger if exists service_settings_audit on public.service_settings;
create trigger service_settings_audit after update on public.service_settings
  for each row execute function public.audit_setup_settings();

-- ── service_materials ───────────────────────────────────────────────────────────────────────
create or replace function public.audit_setup_materials()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_parts text[] := '{}';
  v_changes jsonb := '{}'::jsonb;
begin
  if tg_op = 'INSERT' then
    perform public.audit_setup_log('setup_materials', new.id, 'create',
      new.name || ' added: cost ' || public.audit_setup_money(new.cost)
        || coalesce(' per ' || nullif(btrim(new.unit), ''), ''),
      jsonb_build_object('name', jsonb_build_object('from', null, 'to', new.name),
                         'cost', jsonb_build_object('from', null, 'to', new.cost)));
    return null;
  elsif tg_op = 'DELETE' then
    perform public.audit_setup_log('setup_materials', old.id, 'delete', old.name || ' removed', null);
    return null;
  end if;
  if new.name is distinct from old.name then
    v_parts := v_parts || ('renamed “' || new.name || '”');
    v_changes := v_changes || jsonb_build_object('name', jsonb_build_object('from', old.name, 'to', new.name));
  end if;
  if new.cost is distinct from old.cost then
    v_parts := v_parts || ('cost ' || public.audit_setup_money(old.cost) || ' → '
                           || public.audit_setup_money(new.cost));
    v_changes := v_changes || jsonb_build_object('cost', jsonb_build_object('from', old.cost, 'to', new.cost));
  end if;
  if new.unit is distinct from old.unit then
    v_parts := v_parts || ('unit ' || public.audit_fmt(to_jsonb(old.unit)) || ' → '
                           || public.audit_fmt(to_jsonb(new.unit)));
    v_changes := v_changes || jsonb_build_object('unit', jsonb_build_object('from', old.unit, 'to', new.unit));
  end if;
  if new.category is distinct from old.category then
    v_parts := v_parts || ('group ' || public.audit_fmt(to_jsonb(old.category)) || ' → '
                           || public.audit_fmt(to_jsonb(new.category)));
    v_changes := v_changes || jsonb_build_object('category',
      jsonb_build_object('from', old.category, 'to', new.category));
  end if;
  if new.active is distinct from old.active then
    v_parts := v_parts || case when new.active then 'shown again' else 'hidden' end;
    v_changes := v_changes || jsonb_build_object('active',
      jsonb_build_object('from', old.active, 'to', new.active));
  end if;
  if new.stock_screen_id is distinct from old.stock_screen_id
     or new.stock_row_label is distinct from old.stock_row_label
     or new.stock_price_col is distinct from old.stock_price_col
     or new.stock_per_unit is distinct from old.stock_per_unit
     or new.piece_name is distinct from old.piece_name then
    v_parts := v_parts || 'stock link changed';
    v_changes := v_changes || jsonb_build_object('stock',
      jsonb_build_object(
        'from', jsonb_build_object('screen', old.stock_screen_id, 'row', old.stock_row_label,
                                   'col', old.stock_price_col, 'per_unit', old.stock_per_unit,
                                   'piece', old.piece_name),
        'to', jsonb_build_object('screen', new.stock_screen_id, 'row', new.stock_row_label,
                                 'col', new.stock_price_col, 'per_unit', new.stock_per_unit,
                                 'piece', new.piece_name)));
  end if;
  if cardinality(v_parts) = 0 then
    return null;
  end if;
  perform public.audit_setup_log('setup_materials', new.id, 'update',
    old.name || ' ' || array_to_string(v_parts, '; '), v_changes);
  return null;
end $$;
drop trigger if exists service_materials_audit on public.service_materials;
create trigger service_materials_audit after insert or update or delete on public.service_materials
  for each row execute function public.audit_setup_materials();

-- ── inspection_checklist_items ──────────────────────────────────────────────────────────────
create or replace function public.audit_setup_checklist()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.audit_setup_log('setup_checklist', new.id, 'create',
      'Checklist item “' || new.label || '” added',
      jsonb_build_object('label', jsonb_build_object('from', null, 'to', new.label)));
  elsif tg_op = 'DELETE' then
    perform public.audit_setup_log('setup_checklist', old.id, 'delete',
      'Checklist item “' || old.label || '” removed',
      jsonb_build_object('label', jsonb_build_object('from', old.label, 'to', null)));
  elsif new.label is distinct from old.label then
    perform public.audit_setup_log('setup_checklist', new.id, 'update',
      'Checklist item “' || old.label || '” renamed “' || new.label || '”',
      jsonb_build_object('label', jsonb_build_object('from', old.label, 'to', new.label)));
  end if;
  return null;
end $$;
drop trigger if exists inspection_checklist_items_audit on public.inspection_checklist_items;
create trigger inspection_checklist_items_audit
  after insert or update or delete on public.inspection_checklist_items
  for each row execute function public.audit_setup_checklist();

-- The whole checklist save in one transaction: rows left out are removed, the rest are updated
-- or added in the order given (sort 10, 20, …), and a changed order writes one "moved" line.
-- An admin's or Estimate Pricing's, as inspection_checklist_items_write says. The server function
-- (saveChecklistItems) still validates the labels before calling it.
create or replace function public.save_checklist_items(p_items jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v jsonb;
  i int := 0;
  k int;
  v_id uuid;
  v_keep uuid[];
  v_old_ids uuid[];
  v_old_labels text[];
  v_new_ids uuid[] := '{}';
  v_new_labels text[] := '{}';
  v_old_kept uuid[];
  v_new_kept uuid[];
  v_was int;
  v_d int;
  v_best uuid;
  v_best_d int := 0;
  v_best_down boolean := false;
  v_from int;
  v_to int;
  v_label text;
begin
  if not (public.is_admin() or public.has_access('pricing')) then
    raise exception 'Only an admin (or Estimate Pricing) edits the checklist' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' then
    raise exception 'The checklist must be a list' using errcode = '22023';
  end if;
  select coalesce(array_agg(c.id order by c.sort, c.label), '{}'),
         coalesce(array_agg(c.label order by c.sort, c.label), '{}')
    into v_old_ids, v_old_labels
    from public.inspection_checklist_items c;
  select coalesce(array_agg((t.value ->> 'id')::uuid), '{}') into v_keep
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) t
   where t.value ->> 'id' is not null;
  delete from public.inspection_checklist_items c where not (c.id = any (v_keep));
  for v in
    select t.value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) with ordinality t(value, o)
     order by t.o
  loop
    i := i + 1;
    if v ->> 'id' is not null then
      update public.inspection_checklist_items
         set label = v ->> 'label', sort = i * 10
       where id = (v ->> 'id')::uuid
      returning id into v_id;
      if not found then
        raise exception 'That checklist item is no longer on the list — reload' using errcode = 'P0002';
      end if;
    else
      insert into public.inspection_checklist_items (label, sort)
      values (v ->> 'label', i * 10)
      returning id into v_id;
    end if;
    v_new_ids := v_new_ids || v_id;
    v_new_labels := v_new_labels || (v ->> 'label');
  end loop;

  -- Moved: among the items that were there before and still are, did the order change? One line
  -- names the item that moved furthest (on a tie, one that moved down), with its place in the
  -- whole list before and after; the full old and new order ride in `changes`.
  select array_agg(t.x order by t.o) into v_old_kept
    from unnest(v_old_ids) with ordinality t(x, o) where t.x = any (v_new_ids);
  select array_agg(t.x order by t.o) into v_new_kept
    from unnest(v_new_ids) with ordinality t(x, o) where t.x = any (v_old_ids);
  if v_old_kept is distinct from v_new_kept then
    for k in 1 .. coalesce(array_length(v_new_kept, 1), 0) loop
      v_was := array_position(v_old_kept, v_new_kept[k]);
      v_d := abs(k - v_was);
      if v_d > v_best_d or (v_d = v_best_d and v_d > 0 and not v_best_down and k > v_was) then
        v_best := v_new_kept[k];
        v_best_d := v_d;
        v_best_down := k > v_was;
      end if;
    end loop;
    v_from := array_position(v_old_ids, v_best);
    v_to := array_position(v_new_ids, v_best);
    v_label := v_new_labels[v_to];
    perform public.audit_setup_log('setup_checklist', v_best, 'update',
      case when v_from is distinct from v_to
           then 'Checklist: “' || v_label || '” moved from ' || v_from || ' to ' || v_to
           else 'Checklist: the order changed around “' || v_label || '”' end,
      jsonb_build_object('order',
        jsonb_build_object('from', to_jsonb(v_old_labels), 'to', to_jsonb(v_new_labels))));
  end if;
end $$;
revoke all on function public.save_checklist_items(jsonb) from public, anon;
grant execute on function public.save_checklist_items(jsonb) to authenticated;
