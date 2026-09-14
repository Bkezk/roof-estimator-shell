-- Legacy SSAdheredMulti: adhered sheet-size labor multiplier keyed by roof system × sheet size ×
-- ADHESIVE (SheetSize.SmartSheetMulti on an adhered section reads m_dAdheredSheetMulti[adhesiveId]).
-- Seeded verbatim from the installer script (BidAdvantage.DataAccess.SqlScript.xml); the sheet size
-- id is carried as its RSSheetSize label so the engine can key it by the section's sheet label.
create table if not exists public.rdl_adhered_sheet_multi (
  roof_system_id int not null,   -- legacy RoofSystem id (1 Duro-Last, 3 Duro-Tuff, 5 Duro-Fleece)
  sheet_label text not null,     -- RSSheetSize.Description ("Roll Good", "500 sf", "1000 sf")
  adhesive_id int not null,      -- legacy Adhesive id (legacy_adhesive.adhesive_id)
  multiplier numeric not null,   -- DefaultLabor
  custom_multiplier numeric not null default 0, -- CustomLabor (0 = none)
  primary key (roof_system_id, sheet_label, adhesive_id)
);
alter table public.rdl_adhered_sheet_multi enable row level security;
revoke all on public.rdl_adhered_sheet_multi from anon;
drop policy if exists rdl_adhered_sheet_multi_read on public.rdl_adhered_sheet_multi;
create policy rdl_adhered_sheet_multi_read on public.rdl_adhered_sheet_multi for select to authenticated using (true);
drop policy if exists rdl_adhered_sheet_multi_write on public.rdl_adhered_sheet_multi;
create policy rdl_adhered_sheet_multi_write on public.rdl_adhered_sheet_multi for all to authenticated using (public.is_admin()) with check (public.is_admin());

insert into public.rdl_adhered_sheet_multi (roof_system_id, sheet_label, adhesive_id, multiplier) values
  (1, 'Roll Good', 1, 4), (1, '500 sf', 1, 2.4), (1, '1000 sf', 1, 1.2),
  (1, 'Roll Good', 2, 4), (1, '500 sf', 2, 2.4), (1, '1000 sf', 2, 1.2),
  (3, 'Roll Good', 1, 1), (3, 'Roll Good', 2, 1),
  (5, 'Roll Good', 1, 1), (5, 'Roll Good', 2, 1), (5, 'Roll Good', 3, 1), (5, 'Roll Good', 4, 1),
  (5, 'Roll Good', 5, 1), (5, 'Roll Good', 6, 1), (5, 'Roll Good', 7, 1), (5, 'Roll Good', 8, 1),
  (5, 'Roll Good', 9, 1)
on conflict (roof_system_id, sheet_label, adhesive_id) do nothing;
