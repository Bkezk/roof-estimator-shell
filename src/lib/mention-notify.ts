/**
 * Tell the people a piece of text @mentions (owner, Oct 14: "Is the note the only place to tag
 * @'s?" — it was; now the contact log's note, an opportunity's Notes and a customer's Notes tell
 * people too). One helper so every box behaves the same way as the ticket note did since Oct 5:
 * the names are read back out of the saved text against the mention roster (mention_options),
 * the writer is never told, each person once, and delivery goes through notify() — inbox row
 * always, email and push by the person's own switches. A mention has no notice category, so the
 * Leads / Opportunities / Service / Bids / Storms switches never hide one.
 *
 * Never throws: a roster or delivery problem comes back as `mention_error` so the caller can
 * finish its own save and say loudly that the text is in but the people were not told.
 * Server only: handlers load it with a dynamic import (as addJobNote loads notify.server), so
 * the client bundle never carries notify.server's service-role client and web-push.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import { mentionRoster } from "@/lib/auth.functions";
import {
  type MentionOutcome,
  mentionBody,
  newMentionIds,
  NO_MENTIONS,
  type Person,
} from "@/lib/mentions";

type Client = SupabaseClient<Database>;
type Ctx = { supabase: Client; userId: string };

export interface SendMentionsArgs {
  /** The saved text. */
  text: string | null | undefined;
  /** The text as it was stored before this save (a Notes box); names already in it are not told again. */
  previous?: string | null | undefined;
  /** Who wrote it, for the notice's title. */
  writer: string;
  /** Where: "Ticket #6016 Bell County", 'opportunity "Courthouse roof"', "customer Bell County". */
  where: string;
  /** The link the notice opens. */
  url: string;
}

/** The two outside calls, replaceable in tests. */
export interface MentionDeps {
  roster: (sb: Client) => Promise<Person[]>;
  notify: (
    ids: string[],
    msg: { kind: string; title: string; body: string; url: string },
    sb: Client,
  ) => Promise<number>;
}

const realDeps: MentionDeps = {
  roster: mentionRoster,
  notify: async (ids, msg, sb) => {
    const { notify } = await import("@/lib/notify.server");
    return notify(ids, msg, sb);
  },
};

export async function sendMentions(
  ctx: Ctx,
  args: SendMentionsArgs,
  deps: MentionDeps = realDeps,
): Promise<MentionOutcome> {
  const text = (args.text ?? "").trim();
  if (!text.includes("@")) return NO_MENTIONS;
  try {
    const people = await deps.roster(ctx.supabase);
    const ids = newMentionIds(text, args.previous, people).filter((id) => id !== ctx.userId);
    if (!ids.length) return NO_MENTIONS;
    await deps.notify(
      ids,
      {
        kind: "mention",
        title: `${args.writer} mentioned you on ${args.where}`,
        body: mentionBody(text),
        url: args.url,
      },
      ctx.supabase,
    );
    return { mentioned: ids.length, mention_error: null };
  } catch (e) {
    return {
      mentioned: 0,
      mention_error: `The mentions were not sent: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}
