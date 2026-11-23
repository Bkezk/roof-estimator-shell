-- The public Roof Care page can work out a price (Nov 23, 2026).
--
-- The owner tried https://jbkbid.com/care and pressed Show my price: "That did not go through".
-- The page's price needs the drive from the office to the visitor's building, and the drive
-- starts by finding both addresses on the map. The two map lookups below let a caller through
-- only when a signed-in person has Service, Customers, Prospecting or Estimate access. On the
-- public page nobody is signed in: the site's own server asks, with its own key. The lookups
-- answered "Forbidden: Service access required", so no public visitor ever got a price. The
-- page was built on Nov 21 and could only be tried once it was published.
--
-- Both lookups now also answer the site's own server, the same way roof_care_price and
-- google_route_take already do. A visitor still reaches them only through the public page's
-- own functions, which count every request against the connection. A signed-in person without
-- one of the four kinds of access is refused as before, and so is anyone not signed in.
--
-- Both bodies are the live ones (20260930092000) with only this guard changed.

create or replace function public.service_aerial_address_candidates(
  p_house text, p_street_word text, p_limit integer default 60
)
returns table (
  source text, id uuid, address text, city text, zip text, state text,
  lat double precision, lng double precision, building_id uuid
)
language plpgsql stable security definer set search_path = public as $$
begin
  -- The site's own server asks too (Nov 23): the public Roof Care page works out the drive to a
  -- visitor's building with nobody signed in.
  if coalesce(auth.role(), '') <> 'service_role'
     and not (public.has_access('service') or public.has_access('customers')
              or public.has_access('prospect') or public.has_access('estimate')) then
    raise exception 'Forbidden: Service access required';
  end if;
  if coalesce(p_house, '') !~ '^[0-9]{1,7}[A-Za-z]?$'
     or coalesce(p_street_word, '') !~ '^[A-Za-z0-9]{2,40}$' then
    return;
  end if;
  return query
    (select 'building'::text, b.id, b.address1, b.city, b.zip, b.state,
            b.centroid_lat, b.centroid_lng, b.id
       from public.buildings b
      where b.deleted_at is null
        and upper(b.address1) like upper(p_house) || ' %'
        and upper(b.address1) like '%' || upper(p_street_word) || '%'
      limit greatest(1, least(p_limit, 200)))
    union all
    (select 'point'::text, a.id, a.address, a.city, a.zip, null::text,
            a.lat, a.lng, a.building_id
       from public.address_points a
      where upper(a.address) like upper(p_house) || ' %'
        and upper(a.address) like '%' || upper(p_street_word) || '%'
      limit greatest(1, least(p_limit, 200)));
end;
$$;

create or replace function public.service_aerial_buildings_near(
  p_lat double precision, p_lng double precision, p_radius_m double precision default 300
)
returns table (
  id uuid, address1 text, city text, state text, zip text,
  centroid_lat double precision, centroid_lng double precision,
  roof_sqft numeric, footprint jsonb
)
language plpgsql stable security definer set search_path = public as $$
declare
  r double precision := greatest(10, least(coalesce(p_radius_m, 300), 1000));
  dlat double precision := r / 111320.0;
  dlng double precision := r / (111320.0 * greatest(cos(radians(p_lat)), 0.01));
begin
  -- The site's own server asks too (Nov 23): the public Roof Care page works out the drive to a
  -- visitor's building with nobody signed in.
  if coalesce(auth.role(), '') <> 'service_role'
     and not (public.has_access('service') or public.has_access('customers')
              or public.has_access('prospect') or public.has_access('estimate')) then
    raise exception 'Forbidden: Service access required';
  end if;
  if p_lat is null or p_lng is null or abs(p_lat) > 90 or abs(p_lng) > 180 then
    return;
  end if;
  return query
    select b.id, b.address1, b.city, b.state, b.zip, b.centroid_lat, b.centroid_lng,
           b.roof_sqft::numeric, b.footprint::jsonb
      from public.buildings b
     where b.deleted_at is null
       and b.centroid_lat between p_lat - dlat and p_lat + dlat
       and b.centroid_lng between p_lng - dlng and p_lng + dlng
     limit 200;
end;
$$;
