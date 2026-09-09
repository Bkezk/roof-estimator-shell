-- The legacy NeedQuote underlayment entries (docs §10.1/§10.5): menu items that open the quote
-- flow instead of assigning a priced board. Names and tile placement are VERBATIM from the
-- captured tile menus (2026-08-31 estimator batch): ISO/Rigid Quote in their ISO/Rigid tiles,
-- the five Tapered/Other entries (SubType 6), and Flute Filler as its tile's single item
-- (SubType 4 — legacy performs a single-item menu directly, so the tile click opens the §10.5
-- quote dialog). They have no price rows; the estimator bills the QUOTED amounts.
-- underlayment_group_id (the adhesive axis) is a best-name assignment for these quote rows —
-- inert today: quote layers bill no auto adhesive (legacy uses manual QuoteAdhesiveUnits).
alter table public.underlayment_board_group
  add column if not exists need_quote boolean not null default false;

insert into public.underlayment_board_group
  (board_name, underlayment_group_id, sort, subtype, subtype_sort, need_quote) values
  ('ISO Quote 4''x 8''', 2, 99, 2, 10, true),
  ('Rigid Quote 4''x 8''', 4, 99, 3, 9, true),
  ('ISO Quote 4''x 4''', 3, 99, 7, 10, true),
  ('Rigid Quote 4''x 4''', 17, 99, 8, 10, true),
  ('Flute Filler', 5, 99, 4, 1, true),
  ('Tapered Perlite', 14, 99, 6, 1, true),
  ('Tapered Crickets', 19, 99, 6, 2, true),
  ('Other', 19, 99, 6, 3, true),
  ('Tapered ISO', 16, 99, 6, 4, true),
  ('Tapered EPS', 18, 99, 6, 5, true);
