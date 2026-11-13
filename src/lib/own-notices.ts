/**
 * Notices about your own changes (owner, Nov 13: "notifications should go out to myself even if
 * im the one who did it"). The rule everywhere was "never the person who made the change"; it
 * still is, unless that person has turned on "My own changes" on My account
 * (profiles.notify_own, off by default).
 *
 * Pure: no imports, no I/O. The database read is in own-notices.server.ts.
 */

/** The My account switch's label and its one line of help. */
export const OWN_NOTICES_LABEL = "My own changes";
export const OWN_NOTICES_HELP =
  "Also notify you about what you do yourself, like assigning a ticket to yourself. Off unless you want it.";

/**
 * The people to tell, with the one who made the change left out unless they asked to be told
 * about their own changes. The order is kept; nobody is added.
 */
export function withoutActor(
  ids: readonly string[],
  actorId: string | null | undefined,
  actorWantsOwn: boolean,
): string[] {
  if (!actorId || actorWantsOwn) return [...ids];
  return ids.filter((id) => id !== actorId);
}

/** Is the person who made the change told as well? Only when they are among those to tell. */
export const actorIsTold = (
  recipientId: string | null | undefined,
  actorId: string | null | undefined,
  actorWantsOwn: boolean,
): boolean => !!recipientId && (recipientId !== actorId || actorWantsOwn);
