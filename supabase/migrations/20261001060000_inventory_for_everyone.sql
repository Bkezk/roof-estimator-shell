-- Inventory is every signed-in user's (owner, Oct 1: "all should have access to inventory"),
-- tick or no tick. The app twin is EVERYONE_PAGES in src/lib/access.ts. Idempotent.
create or replace function public.has_access(page text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and (p.role in ('admin', 'manager') or page = 'inventory' or page = any(p.access))
  );
$$;
