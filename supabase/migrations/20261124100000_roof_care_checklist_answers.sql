-- Roof Care: every row of the checklist is answered before a plan's inspection is finished
-- (owner, Nov 23: "3 go").
--
-- Since Oct 26 a checklist row may be left blank and reads as OK. The customer's Care plan
-- report prints "Not checked" for a blank row (Nov 23), so a row a technician looked at and did
-- not mark told the customer nobody checked it.
--
-- The rule lives here, where every way of writing a stage ends up, beside the plan's cleaning
-- questions (service_jobs_cleaning_rule): a ticket that is a plan's own inspection does not
-- move into Done, Authorized, Invoiced or Closed from a stage before them while a checklist row
-- has no answer (OK, Issue or N/A). It binds everybody.
--
-- Only the MOVE is checked, and only on a plan's inspection: an ordinary inspection keeps its
-- rule (a blank row reads as OK). The rows are the saved answers, then any checklist item added
-- since; the old "Recommend repairs" row is never counted (the screen hides it).

create or replace function public.service_jobs_checklist_rule()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_items jsonb;
  v_open text;
begin
  if new.roof_care_visit_id is null
     or new.service_type is distinct from 'inspection'
     or new.stage not in ('done', 'authorized', 'invoiced', 'closed')
     or coalesce(old.stage, '') in ('done', 'authorized', 'invoiced', 'closed')
  then
    return new;
  end if;
  v_items := case when jsonb_typeof(new.inspection -> 'items') = 'array'
                  then new.inspection -> 'items' else '[]'::jsonb end;
  select string_agg(r.label, ', ' order by r.grp, r.ord, r.label) into v_open
    from (
      select 0 as grp, i.ord::int as ord, i.item ->> 'label' as label, i.item ->> 'status' as status
        from jsonb_array_elements(v_items) with ordinality as i(item, ord)
      union all
      select 1, c.sort, c.label, null
        from public.inspection_checklist_items c
       where not exists (
               select 1 from jsonb_array_elements(v_items) s where s ->> 'id' = c.id::text)
    ) r
   where coalesce(r.status, '') not in ('ok', 'issue', 'na')
     and lower(btrim(coalesce(r.label, ''))) <> 'recommend repairs';
  if v_open is not null then
    raise exception 'Not answered yet on the checklist: %. This is a Roof Care plan inspection, and the customer''s Care plan report prints "Not checked" for a row left blank. Press Open ticket, mark each row OK, Issue or N/A in the Checklist step, then finish the ticket.', v_open;
  end if;
  return new;
end;
$function$;

revoke all on function public.service_jobs_checklist_rule() from public, anon, authenticated;

drop trigger if exists service_jobs_checklist_rule on public.service_jobs;
create trigger service_jobs_checklist_rule
  before update of stage on public.service_jobs
  for each row execute function public.service_jobs_checklist_rule();

notify pgrst, 'reload schema';
