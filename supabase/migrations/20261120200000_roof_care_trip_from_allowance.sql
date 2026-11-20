-- Roof Care: a charged return trip takes what is left of the plan's minor repairs first (owner,
-- Nov 20, of the trip charge after a visit we could not do: "it comes out of the allocation if
-- there is allocation left").
--
-- The rule itself is the invoice's (lib/roof-care-allowance.functions.ts): on the inspection's
-- invoice the plan's minor repairs line goes toward the return trip. Here the screen is told
-- what to say before No access is pressed: everyone, that the plan includes minor repairs; the
-- office, what is left of them today.

create or replace function public.roof_care_no_access_preview(p_job uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  s jsonb := public.roof_care_no_access_state(p_job);
  v_known boolean := (s->>'amount') is not null;
  v_plan uuid := (s->>'plan_id')::uuid;
  v_allow numeric;
  v_used numeric;
begin
  select coalesce(p.repair_allowance, 0) into v_allow
    from public.roof_care_plans p where p.id = v_plan;
  s := s || jsonb_build_object('has_allowance', coalesce(v_allow, 0) > 0);
  if public.is_technician() then
    s := s || jsonb_build_object('amount', null);
  elsif coalesce(v_allow, 0) > 0 and v_known then
    -- What the plan's invoices took so far. A void one gives its amount back.
    select coalesce(sum(-l.total), 0) into v_used
      from public.invoice_lines l
      join public.invoices i on i.id = l.invoice_id
     where l.source = 'roof-care-allowance:' || v_plan::text and i.status <> 'void';
    s := s || jsonb_build_object(
      'allowance_left', greatest(v_allow - greatest(v_used, 0), 0));
  end if;
  return s || jsonb_build_object('amount_known', v_known);
end;
$function$;

revoke all on function public.roof_care_no_access_preview(uuid) from public, anon;
grant execute on function public.roof_care_no_access_preview(uuid) to authenticated;

notify pgrst, 'reload schema';
