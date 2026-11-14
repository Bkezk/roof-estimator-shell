-- A notification leads to a page of this site, or nowhere (security audit, Nov 14; owner:
-- "Go with fixes for 1, 5").
--
-- Found: any signed-in person may write a notification to another person (the task notices and
-- the office's notices need that), and the link was whatever they wrote. On the published site a
-- link that was a script ran in the reader's page when clicked, and a link to another site took
-- the reader there. A technician could have used that to act as an admin.
--
-- Measured before this file: all 214 notifications have a link that starts with "/".
--
-- The rule, the same one the screens apply (src/lib/notification-link.ts): no link, or one "/"
-- first, never "//" or "/\" (browsers read both as another site), and no backslash or control
-- character anywhere (browsers drop tabs and line breaks from an address).
--
-- Idempotent. No data changes.
alter table public.notifications drop constraint if exists notifications_url_internal;
alter table public.notifications
  add constraint notifications_url_internal
  check (url is null or url ~ '^/([^/\\[:cntrl:]][^\\[:cntrl:]]*)?$');

comment on constraint notifications_url_internal on public.notifications is
  'A link is a page of this site: one "/" first, never "//" or "/\", no backslash or control character.';
