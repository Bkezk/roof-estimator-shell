-- JBK county codes (owner, Sep 30 item 4, answered Oct 1): a custom county code per site, picked
-- from a list that filters as you type. Idempotent.
--
-- A code is NOT unique: the owner's list gives 0106 twice (Cumberland, TN and Putman, TN), and
-- both are kept as given, so the key is a uuid and `code` has a plain index. Any signed-in user
-- reads the list (the site form, the ticket); admins and Estimate Pricing edit it
-- (Settings › General › County codes). A site points at one code; deleting a code clears it on
-- the site (the app refuses the delete while a site still uses it).

create table if not exists public.county_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null check (length(btrim(code)) > 0),
  county text not null check (length(btrim(county)) > 0),
  state text not null check (state in ('KY', 'TN')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists county_codes_code_idx on public.county_codes (code);
create index if not exists county_codes_state_county_idx on public.county_codes (state, county);

drop trigger if exists county_codes_updated_at on public.county_codes;
create trigger county_codes_updated_at before update on public.county_codes
  for each row execute function public.update_updated_at_column();

alter table public.county_codes enable row level security;
drop policy if exists county_codes_read on public.county_codes;
create policy county_codes_read on public.county_codes for select to authenticated
  using (true);
drop policy if exists county_codes_write on public.county_codes;
create policy county_codes_write on public.county_codes for all to authenticated
  using (public.is_admin() or public.has_access('pricing'))
  with check (public.is_admin() or public.has_access('pricing'));

alter table public.crm_sites
  add column if not exists county_code_id uuid references public.county_codes(id) on delete set null;
create index if not exists crm_sites_county_code_idx on public.crm_sites (county_code_id);

-- How many sites (removed ones too) use a code, for the "in use" refusal on delete. SECURITY
-- DEFINER so an Estimate Pricing user without Customers access still gets the true count.
create or replace function public.county_code_site_count(p_id uuid)
returns integer language sql stable security definer set search_path = public as $$
  select count(*)::integer from public.crm_sites where county_code_id = p_id;
$$;
revoke all on function public.county_code_site_count(uuid) from public;
grant execute on function public.county_code_site_count(uuid) to authenticated;

-- The owner's list (src/lib/county-codes.ts COUNTY_CODE_SEED, county in Title Case, spelling as
-- given). Only codes not already present are added, so a re-run, or a code an admin has since
-- renamed, adds nothing; both 0106 rows go in on the first run (the check reads the table as it
-- was before this insert).
insert into public.county_codes (code, county, state)
select v.code, v.county, v.state
  from (values
  ('0022', 'Anderson', 'TN'),
  ('0043', 'Bledsoe', 'TN'),
  ('0023', 'Blount', 'TN'),
  ('0044', 'Bradley', 'TN'),
  ('0024', 'Campbell', 'TN'),
  ('0034', 'Carter', 'TN'),
  ('0025', 'Claiborne', 'TN'),
  ('0035', 'Cocke', 'TN'),
  ('0106', 'Cumberland', 'TN'),
  ('0121', 'Davidson', 'TN'),
  ('0102', 'Fentress', 'TN'),
  ('0026', 'Grainger', 'TN'),
  ('0036', 'Greene', 'TN'),
  ('0037', 'Hamblen', 'TN'),
  ('0045', 'Hamilton', 'TN'),
  ('0038', 'Hancock', 'TN'),
  ('0039', 'Hawkins', 'TN'),
  ('0027', 'Jefferson', 'TN'),
  ('0040', 'Johnson', 'TN'),
  ('0016', 'Knox', 'TN'),
  ('0028', 'Loudon', 'TN'),
  ('0047', 'Marion', 'TN'),
  ('0117', 'Maury', 'TN'),
  ('0046', 'McMinn', 'TN'),
  ('0048', 'Meigs', 'TN'),
  ('0029', 'Monroe', 'TN'),
  ('0109', 'Montgomery', 'TN'),
  ('0030', 'Morgan', 'TN'),
  ('0049', 'Polk', 'TN'),
  ('0106', 'Putman', 'TN'),
  ('0050', 'Rhea', 'TN'),
  ('0011', 'Roane', 'TN'),
  ('0124', 'Robertson', 'TN'),
  ('0132', 'Rutherford', 'TN'),
  ('0031', 'Scott', 'TN'),
  ('0051', 'Sequatchie', 'TN'),
  ('0032', 'Sevier', 'TN'),
  ('0118', 'Shelby', 'TN'),
  ('0012', 'Sullivan', 'TN'),
  ('0041', 'Unicoi', 'TN'),
  ('0033', 'Union', 'TN'),
  ('0116', 'Warren', 'TN'),
  ('0042', 'Washington', 'TN'),
  ('0060', 'Adair', 'KY'),
  ('0056', 'Anderson', 'KY'),
  ('0115', 'Barren', 'KY'),
  ('0073', 'Bath', 'KY'),
  ('0015', 'Bell', 'KY'),
  ('0099', 'Boone', 'KY'),
  ('0071', 'Bourbon', 'KY'),
  ('0111', 'Boyd', 'KY'),
  ('0063', 'Boyle', 'KY'),
  ('0087', 'Breathitt', 'KY'),
  ('0101', 'Bullitt', 'KY'),
  ('0098', 'Campbell', 'KY'),
  ('0126', 'Carroll', 'KY'),
  ('0091', 'Carter', 'KY'),
  ('0062', 'Casey', 'KY'),
  ('0070', 'Clark', 'KY'),
  ('0020', 'Clay', 'KY'),
  ('0061', 'Clinton', 'KY'),
  ('0018', 'Cumberland', 'KY'),
  ('0125', 'Daviess', 'KY'),
  ('0112', 'Edmonson', 'KY'),
  ('0090', 'Elliot', 'KY'),
  ('0076', 'Estill', 'KY'),
  ('0004', 'Fayette', 'KY'),
  ('0082', 'Fleming', 'KY'),
  ('0089', 'Floyd', 'KY'),
  ('0053', 'Franklin', 'KY'),
  ('0130', 'Gallatin', 'KY'),
  ('0067', 'Garrard', 'KY'),
  ('0131', 'Grayson', 'KY'),
  ('0097', 'Green', 'KY'),
  ('0092', 'Greenup', 'KY'),
  ('0100', 'Hardin', 'KY'),
  ('0005', 'Harlan', 'KY'),
  ('0055', 'Harrison', 'KY'),
  ('0107', 'Hart', 'KY'),
  ('0103', 'Hickman', 'KY'),
  ('0021', 'Jackson', 'KY'),
  ('0095', 'Jefferson', 'KY'),
  ('0066', 'Jessamine', 'KY'),
  ('0110', 'Johnson', 'KY'),
  ('0108', 'Kenton', 'KY'),
  ('0088', 'Knott', 'KY'),
  ('0002', 'Knox', 'KY'),
  ('0133', 'Larue', 'KY'),
  ('0001', 'Laurel', 'KY'),
  ('0104', 'Lawrence', 'KY'),
  ('0079', 'Lee', 'KY'),
  ('0077', 'Leslie', 'KY'),
  ('0014', 'Letcher', 'KY'),
  ('0084', 'Lewis', 'KY'),
  ('0068', 'Lincoln', 'KY'),
  ('0006', 'Madison', 'KY'),
  ('0086', 'Magoffin', 'KY'),
  ('0058', 'Marion', 'KY'),
  ('0105', 'Martin', 'KY'),
  ('0083', 'Mason', 'KY'),
  ('0069', 'McCreary', 'KY'),
  ('0081', 'Menifee', 'KY'),
  ('0064', 'Mercer', 'KY'),
  ('0119', 'Metcalfe', 'KY'),
  ('0113', 'Monroe', 'KY'),
  ('0074', 'Montgomery', 'KY'),
  ('0013', 'Morgan', 'KY'),
  ('0007', 'Nelson', 'KY'),
  ('0072', 'Nicholas', 'KY'),
  ('0120', 'Ohio', 'KY'),
  ('0123', 'Oldham', 'KY'),
  ('0078', 'Owsley', 'KY'),
  ('0127', 'Penleton', 'KY'),
  ('0008', 'Perry', 'KY'),
  ('0009', 'Pike', 'KY'),
  ('0075', 'Powell', 'KY'),
  ('0010', 'Pulaski', 'KY'),
  ('0096', 'Putnam', 'KY'),
  ('0094', 'Robertson', 'KY'),
  ('0017', 'Rockcastle', 'KY'),
  ('0085', 'Rowan', 'KY'),
  ('0019', 'Russell', 'KY'),
  ('0054', 'Scott', 'KY'),
  ('0052', 'Shelby', 'KY'),
  ('0134', 'Simpson', 'KY'),
  ('0059', 'Taylor', 'KY'),
  ('0114', 'Todd', 'KY'),
  ('0122', 'Warren', 'KY'),
  ('0057', 'Washington', 'KY'),
  ('0093', 'Wayne', 'KY'),
  ('0003', 'Whitley', 'KY'),
  ('0080', 'Wolfe', 'KY'),
  ('0065', 'Woodford', 'KY')
  ) as v (code, county, state)
 where not exists (select 1 from public.county_codes c where c.code = v.code);
