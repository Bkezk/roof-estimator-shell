/**
 * The database side of "My own changes" (own-notices.ts): does the person who made a change
 * want to be told about it? One small read of their own profile row, made only when they are
 * actually among the people a notice would go to. The switch is on for everyone unless they
 * turned it off (the column's default). A read that fails outright (no row, the column not
 * there yet, an error) is a "no", the old rule, so a fault can never send extra notices.
 */
import type { Client } from "@/lib/notify.server";
import { withoutActor } from "@/lib/own-notices";

export async function wantsOwnNotices(
  sb: Client,
  userId: string | null | undefined,
): Promise<boolean> {
  if (!userId) return false;
  try {
    const { data, error } = await sb
      .from("profiles")
      .select("notify_own")
      .eq("id", userId)
      .maybeSingle();
    if (error) return false;
    return data?.notify_own === true;
  } catch {
    return false;
  }
}

/** The people to tell: the one who made the change stays only if they asked for their own. */
export async function exceptActor(
  ids: readonly string[],
  actorId: string | null | undefined,
  sb: Client,
): Promise<string[]> {
  if (!actorId || !ids.includes(actorId)) return [...ids];
  return withoutActor(ids, actorId, await wantsOwnNotices(sb, actorId));
}
