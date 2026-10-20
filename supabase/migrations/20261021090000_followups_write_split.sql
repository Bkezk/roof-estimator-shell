-- crm_followups_write (20260927100000_crm_followups.sql) is `for all to authenticated` with
-- `has_access('customers') or has_access('service') or assignee_id = auth.uid()`. In Postgres a
-- FOR ALL policy also grants SELECT: its USING clause is OR-ed with the SELECT policy's, so
-- crm_followups_read (`customers or assignee_id = auth.uid()`) decided nothing for a Service
-- token — every Service user, a technician-only one included, read every follow-up (proved live,
-- Oct 20: 35 of 35 rows as the technician-only test login, 2 of them their own). The sixth
-- audit, Oct 21 (owner approved item 3).
--
-- Split it into insert / update / delete with the SAME rule (customers or service or
-- assignee_id = auth.uid()); a FOR INSERT / UPDATE / DELETE policy grants no SELECT, so reads are
-- crm_followups_read's alone: Customers access, or the caller's own rows.
--
-- What a technician still reads of crm_followups: their OWN follow-ups, by
-- `assignee_id = auth.uid()` — the ticket timer (followups.server.ts syncFollowup, through
-- followup_sync_upsert) is assigned to the ticket's technician, so logContact's "the item's open
-- follow-up" read for a hold on their ticket, Work Overview's own-rows read and the Follow-ups
-- list (followups.functions.ts listFollowups, which now scopes a caller without Customers access
-- to assignee_id = me on the server as well) all keep working. The ticket page itself
-- (service-page.tsx) reads no crm_followups row; followupForItem is the opportunity page's strip.
-- Nothing technician-side writes crm_followups directly: followup_sync_upsert /
-- followup_sync_close (20261002140000) and hold_followup (20261009150000) are SECURITY DEFINER,
-- and followups.server.ts writes through the admin client.
--
-- Idempotent: every policy is dropped if it exists before it is created, so a replay leaves the
-- same three policies and no FOR ALL one. Pinned by src/lib/followups-write-split.test.ts.
drop policy if exists crm_followups_write on public.crm_followups;

drop policy if exists crm_followups_insert on public.crm_followups;
create policy crm_followups_insert on public.crm_followups for insert to authenticated
  with check (public.has_access('customers') or public.has_access('service') or assignee_id = auth.uid());

drop policy if exists crm_followups_update on public.crm_followups;
create policy crm_followups_update on public.crm_followups for update to authenticated
  using (public.has_access('customers') or public.has_access('service') or assignee_id = auth.uid())
  with check (public.has_access('customers') or public.has_access('service') or assignee_id = auth.uid());

drop policy if exists crm_followups_delete on public.crm_followups;
create policy crm_followups_delete on public.crm_followups for delete to authenticated
  using (public.has_access('customers') or public.has_access('service') or assignee_id = auth.uid());
