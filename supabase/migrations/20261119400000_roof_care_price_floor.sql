-- Roof Care: a floor under the price (owner, Nov 19: "lets make it to where the minimum roof size
-- pricing is always priced at ... so its never not profitable, thats the floor similarly to where
-- drive time is minimum of 2 hrs no matter what").
--
-- A roof smaller than the floor pays the price of the floor size. The floor is a number of the
-- price setup (roof_care_settings, "min_price_sqft"), typed on the setup page like the rest; none
-- typed means no floor. The roof's own size is still what the plan keeps and what decides a
-- custom quote. Only the line that works the list price changes.
do $mig$
declare
  d text;
begin
  select pg_get_functiondef('public.roof_care_price(numeric, numeric, numeric)'::regprocedure) into d;
  if position('min_price_sqft' in d) > 0 then
    return;
  end if;
  if position('v_list := v_base + v_per * p_sqft;' in d) = 0 then
    raise exception 'roof_care_price is not as this change expects';
  end if;
  execute replace(d,
    'v_list := v_base + v_per * p_sqft;',
    'v_list := v_base + v_per * greatest(p_sqft, coalesce((d->>''min_price_sqft'')::numeric, 0));');
end $mig$;

-- The floor is not lost to a page that does not know it. Until the site is published, and in a
-- tab left open across a publish, the price setup page saves the setup whole and without the
-- floor: that save keeps the floor already there. The current page always sends it (a number, or
-- blank for no floor), so the floor is still changed and removed on the setup page.
create or replace function public.roof_care_settings_keep_floor()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.data is not null
     and not (new.data ? 'min_price_sqft')
     and old.data ? 'min_price_sqft' then
    new.data := new.data || jsonb_build_object('min_price_sqft', old.data -> 'min_price_sqft');
  end if;
  return new;
end $$;

drop trigger if exists roof_care_settings_keep_floor on public.roof_care_settings;
create trigger roof_care_settings_keep_floor
  before update on public.roof_care_settings
  for each row execute function public.roof_care_settings_keep_floor();
