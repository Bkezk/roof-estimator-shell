-- Tear-off type names: the captured 'tearoff_times' rows carried the legacy admin grid's
-- column-width truncations ("Ballasted Single ...", "Mechanically Fas... (1)"). The full names
-- are the legacy seed list (DataAccess.dll Management.DBLoadRefTables, ExistingRoofID 1..14,
-- category 1 Single Ply / 2 Built Up / 3 Urethane). Saved bids reference the type by NAME in
-- sections[].tearOffType and in their frozen adminSnapshot (tearoffTypes + lookup keys), so the
-- same rename runs over bids.data. Docs §22.52.
update public.rdl_labor_tables
set data = jsonb_set((replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(data::text, '"Ballasted Single ..."', '"Ballasted Single Ply(EPDM)"'), '"Fully Adhered Sin..."', '"Fully Adhered Single Ply"'), '"Mechanically Fas... (1)"', '"Mechanically Fastened Single Ply 7''"'), '"Mechanically Fas... (2)"', '"Mechanically Fastened SP 5'' centers"'), '"Single Ply Adhere..."', '"Single Ply Adhered over BUR < 2\""'), '"Single Ply M F 7'' ..."', '"Single Ply M F 7'' over BUR < 2\""'), '"Single Ply MF 5'' ..."', '"Single Ply MF 5'' over BUR < 2\""'), '"URET < 3\" BUR ..."', '"URET < 3\" BUR < 2\""'), '"URET < 6\" BUR ..."', '"URET < 6\" BUR < 2\""'), '"URET < 9\" BUR ..."', '"URET < 9\" BUR < 2\""'))::jsonb, '{description}', to_jsonb('Tearoff Times tab. Custom values entered in Hours per 100 sqft; a 0 value means Bid-Advantage uses its default (hover-to-view). All Labor(Hrs) cells are green/editable. Legacy screen is a flat list of Roof Deck x Tear Off Type x Labor(Hrs); pivoted here to tearoff_type rows x deck columns. Metal Retrofit and Purlin Fastened decks are all 0 (use default). Tear Off Type names are the full legacy names (DataAccess Management.DBLoadRefTables, ExistingRoofID 1-14; the legacy admin grid showed them truncated).'::text))
where id = 'tearoff_times';

-- Keep each bid's "Last saved" untouched: this is a data repair, not a save.
alter table public.bids disable trigger update_bids_updated_at;

update public.bids
set data = (replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(data::text, '"Ballasted Single ..."', '"Ballasted Single Ply(EPDM)"'), '"Fully Adhered Sin..."', '"Fully Adhered Single Ply"'), '"Mechanically Fas... (1)"', '"Mechanically Fastened Single Ply 7''"'), '"Mechanically Fas... (2)"', '"Mechanically Fastened SP 5'' centers"'), '"Single Ply Adhere..."', '"Single Ply Adhered over BUR < 2\""'), '"Single Ply M F 7'' ..."', '"Single Ply M F 7'' over BUR < 2\""'), '"Single Ply MF 5'' ..."', '"Single Ply MF 5'' over BUR < 2\""'), '"URET < 3\" BUR ..."', '"URET < 3\" BUR < 2\""'), '"URET < 6\" BUR ..."', '"URET < 6\" BUR < 2\""'), '"URET < 9\" BUR ..."', '"URET < 9\" BUR < 2\""'))::jsonb
where data::text like '%...%';

alter table public.bids enable trigger update_bids_updated_at;
