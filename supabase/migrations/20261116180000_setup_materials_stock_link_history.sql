-- Setup › History: changing a material's link to stock failed (found Nov 16, while changing three
-- plates to cost per plate at the owner's request).
--
-- Found: audit_setup_materials (20261110214000_setup_history.sql) adds a word to its list of
-- changes with   v_parts := v_parts || 'stock link changed';   The bare quoted word has no type,
-- so Postgres reads it as a whole list to join on, cannot parse it, and the UPDATE itself fails:
--   malformed array literal: "stock link changed"
-- Seen on the live database in a run that was rolled back. Every other line of the function
-- adds a typed value (an expression in brackets, or a CASE), so only this one failed: changing
-- which catalog item a service material is counted against, its units per stock unit or its
-- piece name could not be saved at all, from Setup or anywhere else.
--
-- Fix: the word is given its type. Nothing else in the function changes; no data changes.

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
    v_parts := v_parts || 'stock link changed'::text;
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
