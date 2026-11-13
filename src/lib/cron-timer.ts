/**
 * The database's reminder timer (owner, Nov 13: "if moving the timers to the database itself
 * helps and doesn't negatively effect things then yes go for it").
 *
 * GitHub was asked to call /api/cron/reminders twice an hour and did so about twice a day. The
 * database now keeps the time itself (pg_cron) and makes the call (pg_net); see
 * supabase/migrations/20261113190000_reminder_timer.sql. The endpoint must know the caller, and
 * the database must not hold CRON_SECRET, so the timer signs with a token of its own:
 *
 *   - made inside the database from 32 random bytes and kept in its vault; nobody is shown it,
 *     and it is in no file, no setting and no chat;
 *   - shaped `dbt_` + 64 hex digits, so only a token that looks like one is ever put to the
 *     database (a stray caller cannot make the server ask on every request);
 *   - checked by the database itself (public.cron_timer_ok, server only), which answers yes or
 *     no and never gives the token back.
 *
 * Pure: no imports, no I/O. The database call lives in cron-timer.server.ts.
 */

/** What the timer's token looks like. */
export const TIMER_TOKEN_SHAPE = /^dbt_[0-9a-f]{64}$/;

/** Asks whoever holds the token whether this is it. */
export type TimerCheck = (token: string) => Promise<boolean>;

/** The request's bearer token when it has the timer's shape, else null. */
export function timerTokenOf(request: Request): string | null {
  const token = /^Bearer ([^\s,]+)$/.exec(request.headers.get("authorization") ?? "")?.[1];
  return token && TIMER_TOKEN_SHAPE.test(token) ? token : null;
}
