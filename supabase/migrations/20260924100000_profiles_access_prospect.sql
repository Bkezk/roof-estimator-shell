-- The Prospecting page flag: the access check on profiles still listed only the first three
-- pages, so granting Prospecting to a user failed with "profiles_access_check". Keep this list
-- in step with PAGES in src/lib/access.ts.
alter table public.profiles drop constraint if exists profiles_access_check;
alter table public.profiles add constraint profiles_access_check
  check (access <@ array['estimate','pricing','inventory','prospect']::text[]);
