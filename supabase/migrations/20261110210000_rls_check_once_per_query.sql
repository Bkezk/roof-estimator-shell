-- Row security checks the person once per query, not once per row (owner, Nov 10; speed pass
-- findings 1, 2 and 10).
--
-- Every policy called its helper bare: `has_access('prospect')` ran for each of the 270,291
-- building rows, which was the whole 6 to 8 seconds of the Roofs & Storms county list and of a
-- building search. Written as `(select has_access('prospect'))` the planner runs it once (an
-- InitPlan) and reuses the answer for every row. The helpers are all STABLE and take no column,
-- so the answer is the same for every row of one query: who sees what does not change.
--
-- What is wrapped: has_access('<page>'), is_admin(), is_manager(), documents_access(),
-- is_technician(), is_sales_pm(), can_claim(), auth.uid(), auth.role().
-- What is left alone: a helper that takes a column (works_on_ticket(service_job_id),
-- ticket_open_for_tech(service_job_id), is_on_crew(id), tech_sees_account(id), …): that one
-- really is a per-row question.
--
-- ALTER POLICY keeps each policy's name, command and roles; only the expression text changes.
-- The block reads the live policies, so it also wraps any policy an earlier migration creates
-- bare, and it is safe to run again (a call that already follows SELECT is skipped).
--
-- NEW POLICIES: write the helper calls wrapped, `(select public.has_access('x'))`, or re-run this
-- block at the end of the migration (src/lib/rls-check-once-nov10b.test.ts pins both).

do $$
declare
  p record;
  pat constant text :=
    '(?<!SELECT )\m((?:public\.)?(?:has_access|is_admin|is_manager|documents_access|is_technician|is_sales_pm|can_claim)|auth\.(?:uid|role))\(((?:''[a-z_]+''::text)?)\)';
  nq text;
  nc text;
  stmt text;
begin
  for p in
    select schemaname, tablename, policyname, cmd, qual, with_check
      from pg_policies
     where schemaname = 'public'
     order by tablename, policyname
  loop
    nq := regexp_replace(p.qual, pat, '( SELECT \1(\2))', 'g');
    nc := regexp_replace(p.with_check, pat, '( SELECT \1(\2))', 'g');
    if nq is not distinct from p.qual and nc is not distinct from p.with_check then
      continue;
    end if;
    stmt := format('alter policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
    if nq is not null then
      stmt := stmt || format(' using (%s)', nq);
    end if;
    if nc is not null then
      stmt := stmt || format(' with check (%s)', nc);
    end if;
    execute stmt;
  end loop;
end $$;
