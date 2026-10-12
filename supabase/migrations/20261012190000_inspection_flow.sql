-- The inspection close-out flow (owner, Oct 12): an Inspection ticket closes out through its own
-- six steps (src/lib/closeout-steps.ts closeoutSteps("inspection")) — crew, checklist, findings,
-- materials, time, signature — and the office records what came of it. Idempotent.
--
-- A. service_jobs.inspection_outcome*: what the office chose after the inspection — a repair
--    ticket, a bid, or no action needed (service-inspection.functions.ts: createRepairFromInspection
--    sets 'repair_ticket'; setInspectionOutcome sets 'bid' or 'none'). Who and when, for the
--    "Outcome: … — by <name>, <date>" line in the After the inspection panel.
-- B. service_job_photos.item_key: a close-out photo taken for one checklist item (role 'other',
--    repair_id null) names the item it belongs to (inspection_checklist_items.id as kept in the
--    ticket's inspection JSON). Null for a general photo.
--
-- The "Recommend repairs" checklist row the 20260930092000 seed inserted stays in the live table
-- untouched: the screen hides a row with that label and the findings step's "Recommend repairs"
-- switch (service_jobs.inspection.recommend_repairs) carries the answer instead.

-- ── A. Outcome ────────────────────────────────────────────────────────────────────────────

alter table public.service_jobs
  add column if not exists inspection_outcome text,
  add column if not exists inspection_outcome_at timestamptz,
  add column if not exists inspection_outcome_by uuid references public.profiles(id) on delete set null;

alter table public.service_jobs drop constraint if exists service_jobs_inspection_outcome_check;
alter table public.service_jobs add constraint service_jobs_inspection_outcome_check
  check (inspection_outcome is null or inspection_outcome in ('repair_ticket', 'bid', 'none'));

comment on column public.service_jobs.inspection_outcome is
  'What the office chose after an Inspection ticket was done: repair_ticket (a repair ticket was created from it), bid (a bid was started from it) or none (no action needed). Null until chosen; only on service_type = inspection.';
comment on column public.service_jobs.inspection_outcome_at is
  'When inspection_outcome was set.';
comment on column public.service_jobs.inspection_outcome_by is
  'Who set inspection_outcome (profiles.id).';

-- ── B. Photos per checklist item ──────────────────────────────────────────────────────────

alter table public.service_job_photos add column if not exists item_key text;
comment on column public.service_job_photos.item_key is
  'The inspection checklist item (inspection_checklist_items.id, as stored in service_jobs.inspection.items[].id) a close-out photo was taken for. Null for a repair''s photo or a general photo.';
create index if not exists service_job_photos_item_key_idx
  on public.service_job_photos (service_job_id, item_key) where item_key is not null;
