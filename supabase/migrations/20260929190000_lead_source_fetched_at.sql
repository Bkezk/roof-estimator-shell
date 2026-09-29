-- Per-source pull stamps so a source with a daily request budget (SAM.gov: a personal API
-- key allows only a handful of calls a day) is pulled at most once a day however often the
-- Leads page is refreshed. Owner, Sep 29: "I don't want to overdo their site".
alter table public.lead_settings
  add column if not exists source_fetched_at jsonb not null default '{}'::jsonb;
comment on column public.lead_settings.source_fetched_at is
  'Per-source time of the last pull attempt, e.g. {"sam_gov": "2026-09-29T17:44:00Z"}; SAM.gov is pulled at most once a day.';
