/**
 * Sending the "Each step" notices — SERVER ONLY (words: ticket-watch.ts, work-steps.ts; who:
 * alert-rules.ts, the type's "Each step" line on Admin › Reminders).
 *
 * Best effort, always: the change itself is already saved, so a notice that cannot be sent is
 * logged and never fails the save. The person who made the change is told only with "My own
 * changes" on, as everywhere else. A line with nobody on it (opportunities and bids until
 * someone picks people) costs one settings read and sends nothing.
 */
import type { AlertKey } from "@/lib/alert-rules";
import { loadAlertContext, personName, recipientsFor } from "@/lib/alert-who.server";
import { notify, serverClient, type Client } from "@/lib/notify.server";
import { exceptActor } from "@/lib/own-notices.server";

export async function tellStep(input: {
  /** The line: "ticket.steps", "opportunity.steps" or "bid.steps". */
  key: AlertKey;
  kind: string;
  /** The words, or a function that builds them once the people's names are known. */
  notice:
    | { title: string; body: string }
    | null
    | ((nameOf: (id: string | null | undefined) => string | null) => {
        title: string;
        body: string;
      } | null);
  url: string;
  actorId: string;
  /** People this same change already tells another way (a ticket's technician). */
  skip?: readonly string[];
  sb: Client;
}): Promise<void> {
  if (!input.notice) return;
  let title = "";
  try {
    const admin = await serverClient(input.sb);
    const ctx = await loadAlertContext(admin);
    const left = new Set(input.skip ?? []);
    const listed = recipientsFor(ctx, input.key, null).filter((id) => !left.has(id));
    if (!listed.length) return;
    const notice =
      typeof input.notice === "function" ? input.notice((id) => personName(ctx, id)) : input.notice;
    if (!notice) return;
    title = notice.title;
    const ids = await exceptActor(listed, input.actorId, admin);
    if (!ids.length) return;
    await notify(
      ids,
      { kind: input.kind, title: notice.title, body: notice.body, url: input.url },
      admin,
    );
  } catch (e) {
    console.error(
      `tellStep: the ${input.key} notice${title ? ` "${title}"` : ""} was not sent: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}
