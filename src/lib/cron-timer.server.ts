/**
 * The reminder timer's check against the database (see cron-timer.ts): is this the token the
 * database made for its own timer? Asked as the server (service role); the database function
 * answers nobody else, and answers only yes or no.
 */
import type { TimerCheck } from "./cron-timer";

export const databaseTimerCheck: TimerCheck = async (token) => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.rpc("cron_timer_ok", { p_token: token });
  if (error) throw new Error(error.message);
  return data === true;
};
