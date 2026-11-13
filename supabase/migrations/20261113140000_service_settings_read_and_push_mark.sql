-- Two access rules that let too many people through (owner, Nov 13, after Lovable's security
-- check flagged every `using (true)` / `with check (true)` rule: "yes techinicians shouldnt see
-- those pricing number and fix the push notifications button").
--
-- 1. service_settings_read was `using (true)`: any signed-in token, a technician's included, read
--    the material markup, the tax rate, the payment terms and the invoice email's words. The
--    Oct 20 narrowing left it out on purpose ("invoices read it, and the owner did not flag it").
--    The owner's rule since Oct 8 is "technician who cant see the pricing of anything". The row
--    is read by Setup › Service rates and Setup › Material pricing (an admin or a manager) and
--    by the invoice paths (seesInvoices: an admin, a manager, or a user with the Invoices tick),
--    so the read becomes exactly that: the same three helpers as the invoices' own policies.
--    A technician's session never reads the row itself: ticket_authorizers(),
--    default_authorizer_on_profile() and save_service_materials() are SECURITY DEFINER.
--
-- 2. push_subscriptions_dispatch_update let anyone with Customers, Service or Estimate access
--    UPDATE any person's device row, with `with check (true)`: every column, the endpoint and
--    its keys included, so one person's notifications could be pointed at another device. The
--    sender only ever needs two stamps: "sent just now" and "this device is gone". The policy is
--    dropped; push_subscription_mark(id, ok) does those two stamps and nothing else. The
--    person's own rule (push_subscriptions_own: their rows only) and the sender's read
--    (push_subscriptions_dispatch) are untouched. The published site sends with the server key,
--    which no policy applies to; the function is for a pass that runs as the signed-in user.
--
-- Idempotent: drop policy if exists + create policy; create or replace.

-- ── 1. Service settings: managers and invoicers only ─────────────────────────────────────────
drop policy if exists service_settings_read on public.service_settings;
create policy service_settings_read on public.service_settings for select to authenticated
  using (
    (select public.is_admin()) or (select public.is_manager()) or (select public.is_sales_pm())
  );

-- ── 2. Push devices: the sender stamps, it does not edit ─────────────────────────────────────
create or replace function public.push_subscription_mark(p_id bigint, p_ok boolean)
returns void language sql security definer set search_path = public as $$
  update public.push_subscriptions s
     set last_used_at = case when p_ok then now() else s.last_used_at end,
         failed_at = case when p_ok then s.failed_at else now() end
   where s.id = p_id
     and (public.followup_is_system()
          or s.user_id = auth.uid()
          or public.has_access('customers')
          or public.has_access('service')
          or public.has_access('estimate'));
$$;
revoke all on function public.push_subscription_mark(bigint, boolean) from public, anon;
grant execute on function public.push_subscription_mark(bigint, boolean)
  to authenticated, service_role;
comment on function public.push_subscription_mark(bigint, boolean) is
  'The notice sender''s two stamps on a device row: sent just now (ok), or the device is gone (not ok). Nothing else on the row can be changed through it.';

drop policy if exists push_subscriptions_dispatch_update on public.push_subscriptions;
