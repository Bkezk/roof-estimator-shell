-- Opportunities audit, Nov 4 (owner: "fix all"). crm_followups_read was `customers or
-- assignee_id = auth.uid()`, so a user with Estimate access but not Customers — who reads every
-- opportunity (crm_opportunities_read: customers or estimate or assignee) — read none of their
-- follow-ups: their Opportunities list said "Overdue" where the office sees "On hold until …",
-- with no next reminder, and the page's follow-up strip was empty. Reads only: the write
-- policies (20261021090000_followups_write_split.sql: customers or service or assignee) are
-- unchanged, and nothing writes crm_followups directly from the app (followup_sync_* and
-- hold_followup are SECURITY DEFINER). Nobody is affected today — every user with Estimate also
-- has Customers — this is the rule for when one is made.
--
-- Idempotent: the policy is dropped if it exists before it is created.
drop policy if exists crm_followups_read on public.crm_followups;
create policy crm_followups_read on public.crm_followups for select to authenticated
  using (public.has_access('customers') or public.has_access('estimate') or assignee_id = auth.uid());
