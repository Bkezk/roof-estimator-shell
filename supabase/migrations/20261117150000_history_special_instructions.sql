-- A ticket's History says "special instructions" for its instructions box (owner, Nov 17: "can
-- we also changes notes on service tickets to special instructions as we already have the
-- activity log").
--
-- The ticket page's box is now labelled "Special instructions"; a change to it was written to
-- History as "notes 'a' → 'b'", the column's name. It now reads "special instructions 'a' → 'b'".
-- Wording only: the column keeps its name (service_jobs.notes). Every other table's notes (a
-- customer's, a property's, a purchase order's) still read "notes".
--
-- New rows only: History already written is left as it is.
--
-- audit_row() is one long function shared by every audited table, so it is not restated here:
-- the one place it names a column is swapped in the function as it stands. Run twice, the second
-- run finds the new text and does nothing. If the function ever stops naming the column in
-- exactly that one place, this stops with an error and changes nothing.

do $$
declare
  v_def text := pg_get_functiondef('public.audit_row()'::regprocedure);
  v_old constant text := 'public.audit_col_name(v_col) || '' '' ||';
  v_new constant text :=
    'case when tg_table_name = ''service_jobs'' and v_col = ''notes'' then ''special instructions'' '
    || 'else public.audit_col_name(v_col) end || '' '' ||';
begin
  if position(v_new in v_def) > 0 then
    return;
  end if;
  if (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'audit_row: expected the column name in one place, found another count';
  end if;
  execute replace(v_def, v_old, v_new);
end $$;
