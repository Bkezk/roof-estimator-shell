-- Warranties per site (service study M5, owner Oct 5: "build M1 through M9"). CenterPoint's
-- property card shows the roof warranty on every ticket ("DURO-LAST 15 NDL" and a WARRANTY
-- watermark); it holds 47. The portal keeps them on the site (Customers › a customer › Sites)
-- and shows a badge on the ticket and the technician's Today card while one is in force.
-- Reads and writes follow the site's own policies (crm_sites_read / crm_sites_write). Idempotent.

create table if not exists public.site_warranties (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.crm_sites(id) on delete cascade,
  manufacturer text not null check (length(btrim(manufacturer)) between 1 and 80),
  kind text check (kind is null or length(kind) <= 120),
  number text check (number is null or length(number) <= 80),
  start_date date,
  end_date date,
  notes text check (notes is null or length(notes) <= 1000),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  constraint site_warranties_dates check (start_date is null or end_date is null or end_date >= start_date)
);
comment on table public.site_warranties is
  'A roof warranty on a site: manufacturer, kind ("15 NDL"), number, start / end. Shown as a badge on its tickets while in force.';

create index if not exists site_warranties_site_idx on public.site_warranties (site_id);

drop trigger if exists site_warranties_updated_at on public.site_warranties;
create trigger site_warranties_updated_at before update on public.site_warranties
  for each row execute function public.update_updated_at_column();

alter table public.site_warranties enable row level security;
drop policy if exists site_warranties_read on public.site_warranties;
create policy site_warranties_read on public.site_warranties for select to authenticated
  using (public.has_access('customers') or public.has_access('service') or public.has_access('estimate'));
drop policy if exists site_warranties_write on public.site_warranties;
create policy site_warranties_write on public.site_warranties for all to authenticated
  using (public.has_access('customers') or public.has_access('service'))
  with check (public.has_access('customers') or public.has_access('service'));
