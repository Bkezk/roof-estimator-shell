-- The inspection checklist's labels (owner, Oct 28: "change flashings to perimeter flashings …
-- there also needs to be a gutter/downspouts section"). The rows live in
-- public.inspection_checklist_items (20260930092000_ticket_aerial_inspection.sql); saved
-- inspections reference a row by its id, so a relabel changes nothing in the saved JSON and the
-- next save picks the new label up (src/lib/inspection.ts mergeChecklist). Idempotent: the
-- rename matches the old label only; the new row is inserted once, between Drains/scuppers (40)
-- and Penetrations (50). Mirrored in src/lib/inspection.ts DEFAULT_CHECKLIST.

update public.inspection_checklist_items
   set label = 'Perimeter flashings'
 where label = 'Flashings';

insert into public.inspection_checklist_items (label, sort)
select 'Gutters/downspouts', 45
 where not exists (
   select 1 from public.inspection_checklist_items where label = 'Gutters/downspouts');
