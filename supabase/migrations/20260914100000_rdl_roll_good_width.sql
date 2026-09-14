-- Legacy RSRollGoodWidth: adhered roll-goods labor multiplier by roll width, per roof system
-- (RoofSystem.RollGoodWidthAdhesiveMulti(FieldLap) — AdheredField/PerimLaborRate multiply the
-- hours/1000 sq ft base by this when the section's sheet size is the roll-good layout).
-- Seeded verbatim from the shipped installer script (BidAdvantage.DataAccess.SqlScript.xml).
create table if not exists public.rdl_roll_good_width (
  roof_system_id int not null,      -- legacy RoofSystem id (1 Duro-Last, 3 Duro-Tuff, 4 Duro-Roof, 5 Duro-Fleece)
  width_in int not null,            -- roll width (the section's FieldLap on a roll-good sheet)
  multiplier numeric not null,      -- DefaultLaborMulti
  custom_multiplier numeric not null default 0, -- CustomLaborMulti (0 = none)
  primary key (roof_system_id, width_in)
);
alter table public.rdl_roll_good_width enable row level security;
revoke all on public.rdl_roll_good_width from anon;
drop policy if exists rdl_roll_good_width_read on public.rdl_roll_good_width;
create policy rdl_roll_good_width_read on public.rdl_roll_good_width for select to authenticated using (true);
drop policy if exists rdl_roll_good_width_write on public.rdl_roll_good_width;
create policy rdl_roll_good_width_write on public.rdl_roll_good_width for all to authenticated using (public.is_admin()) with check (public.is_admin());

insert into public.rdl_roll_good_width (roof_system_id, width_in, multiplier) values
  (1, 64, 1),
  (3, 30, 2.6),
  (3, 60, 1.3),
  (3, 120, 1),
  (4, 64, 1),
  (5, 60, 1.3),
  (5, 120, 1)
on conflict (roof_system_id, width_in) do nothing;
