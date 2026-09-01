-- Phase 2 (part 2b): Parapet labor grid (10 deck types x 5 wall-height bands).
-- Idempotent. RLS: authenticated read, admin-only write.

create table if not exists public.labor_parapet (
  id uuid primary key default gen_random_uuid(),
  deck_type text not null, wall_height_band text not null,
  no_drill_no_cant numeric not null default 0, no_drill_canted numeric not null default 0,
  predrill_no_cant numeric not null default 0, predrill_canted numeric not null default 0,
  sort integer not null default 0
);
alter table public.labor_parapet enable row level security;
revoke all on public.labor_parapet from anon;
drop policy if exists labor_parapet_read on public.labor_parapet;
create policy labor_parapet_read on public.labor_parapet for select to authenticated using (true);
drop policy if exists labor_parapet_write on public.labor_parapet;
create policy labor_parapet_write on public.labor_parapet for all to authenticated using (public.is_admin()) with check (public.is_admin());
insert into public.labor_parapet (deck_type, wall_height_band, no_drill_no_cant, no_drill_canted, predrill_no_cant, predrill_canted, sort)
select * from (values
  ('Wood','0"-30"',2.25,3.375,3.5,5.25,0),
  ('Wood','31"-48"',4.5,6.75,7,10.5,1),
  ('Wood','49"-72"',6.75,10.13,10.5,15.75,2),
  ('Wood','73"-99"',9,11.475,14,17.85,3),
  ('Wood','100"+',9,11.475,14,17.85,4),
  ('Structural Metal','0"-30"',2.5,3.75,3.55,5.325,5),
  ('Structural Metal','31"-48"',5,7.5,7.1,10.65,6),
  ('Structural Metal','49"-72"',7.5,11.25,10.65,15.98,7),
  ('Structural Metal','73"-99"',10,12.75,14.2,18.105,8),
  ('Structural Metal','100"+',10,12.75,14.2,18.105,9),
  ('Metal Retrofit','0"-30"',2.6,3.9,3.55,5.325,10),
  ('Metal Retrofit','31"-48"',5.2,7.8,7.1,10.65,11),
  ('Metal Retrofit','49"-72"',7.8,11.7,10.65,15.98,12),
  ('Metal Retrofit','73"-99"',10.4,13.26,14.2,18.105,13),
  ('Metal Retrofit','100"+',10.4,13.26,14.2,18.105,14),
  ('Concrete','0"-30"',4,6,5.25,7.875,15),
  ('Concrete','31"-48"',8,12,10.5,15.75,16),
  ('Concrete','49"-72"',12,18,15.75,23.625,17),
  ('Concrete','73"-99"',16,20.4,21,26.775,18),
  ('Concrete','100"+',16,20.4,21,26.775,19),
  ('Gypsum','0"-30"',3.5,5.25,5.25,7.875,20),
  ('Gypsum','31"-48"',7,10.5,10.5,15.75,21),
  ('Gypsum','49"-72"',10.5,15.75,15.75,23.625,22),
  ('Gypsum','73"-99"',14,17.85,21,26.775,23),
  ('Gypsum','100"+',14,17.85,21,26.775,24),
  ('LWC over Steel','0"-30"',3,4.5,5.25,7.875,25),
  ('LWC over Steel','31"-48"',6,9,10.5,15.75,26),
  ('LWC over Steel','49"-72"',9,13.5,15.75,23.625,27),
  ('LWC over Steel','73"-99"',12,15.3,21,26.775,28),
  ('LWC over Steel','100"+',12,15.3,21,26.775,29),
  ('LWC over Concrete','0"-30"',4.5,6.75,5.65,8.475,30),
  ('LWC over Concrete','31"-48"',9,13.5,11.3,16.95,31),
  ('LWC over Concrete','49"-72"',13.5,20.25,16.95,25.425,32),
  ('LWC over Concrete','73"-99"',18,22.95,22.6,28.815,33),
  ('LWC over Concrete','100"+',18,22.95,22.6,28.815,34),
  ('LWC over Other','0"-30"',4,6,5,7.5,35),
  ('LWC over Other','31"-48"',8,12,10,15,36),
  ('LWC over Other','49"-72"',12,18,15,22.5,37),
  ('LWC over Other','73"-99"',16,20.4,20,25.5,38),
  ('LWC over Other','100"+',16,20.4,20,25.5,39),
  ('Tectum','0"-30"',3,4.5,4.5,6.75,40),
  ('Tectum','31"-48"',6,9,9,13.5,41),
  ('Tectum','49"-72"',9,13.5,13.5,20.25,42),
  ('Tectum','73"-99"',12,15.3,18,22.95,43),
  ('Tectum','100"+',12,15.3,18,22.95,44),
  ('Purlin Fastened','0"-30"',2.6,3.9,4.5,6.75,45),
  ('Purlin Fastened','31"-48"',5.2,7.8,9,13.5,46),
  ('Purlin Fastened','49"-72"',7.8,11.7,13.5,20.25,47),
  ('Purlin Fastened','73"-99"',10.4,13.26,18,22.95,48),
  ('Purlin Fastened','100"+',10.4,13.26,18,22.95,49)
) v(a,b,c,d,e,f,g)
where not exists (select 1 from public.labor_parapet);
