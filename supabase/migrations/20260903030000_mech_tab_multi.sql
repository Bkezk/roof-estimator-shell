-- Legacy MechTabMulti (tab spacing → labor multiplier per roof system), extracted VERBATIM from
-- the shipped BidAdvantage.DataAccess.SqlScript.xml (ManufacturerID dropped — 0 on every row;
-- CustomMulti kept as custom_multi). Consumed by assembleEngineAdminData to expand each
-- MECHANICAL combo's tab bands beyond the single screenshot-captured base row, so a section's
-- Field Tab Spacing selects its own labor multiplier (docs/legacy-consumption-rules.md §3).
-- Roof system ids per legacy_roof_system: 1 durolast, 2 durobond, 3 durotuff, 4 duroroof.
-- Seed-only; read access mirrors the other admin tables.

create table public.mech_tab_multi (
  roof_system_id int not null,
  tab_spacing int not null, -- inches (durobond's single 0 row is its catch-all)
  multiplier numeric not null,
  custom_multi numeric not null,
  primary key (roof_system_id, tab_spacing)
);
alter table public.mech_tab_multi enable row level security;
create policy "mech_tab_multi_read" on public.mech_tab_multi for select to authenticated using (true);

insert into public.mech_tab_multi (roof_system_id, tab_spacing, multiplier, custom_multi) values
  (1, 28, 1.5125, 0),
  (1, 60, 1, 0),
  (1, 64, 1, 0),
  (1, 120, 0.8, 0),
  (2, 0, 1, 0),
  (3, 30, 2.8, 0),
  (3, 60, 1.4, 0),
  (3, 120, 0.95, 0),
  (4, 57, 1.25, 0),
  (4, 64, 1.25, 0),
  (4, 87, 1.12, 0),
  (4, 120, 1, 0);
