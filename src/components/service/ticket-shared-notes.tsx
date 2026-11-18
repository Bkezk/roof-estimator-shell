/**
 * Activity entries ticked "Viewable to technicians" (lib/tech-visible.ts), as a list to READ.
 *
 *  * SharedNotesList: the entries, drawn as the ticket's own Activity draws them. Under an
 *    earlier ticket in History at this property (owner, Nov 17) and in the box below.
 *  * TicketSharedNotes: THIS ticket's ticked entries in a box (owner, Nov 18), at the top of
 *    the workflow and at the top of the history's pop-up. A technician works a ticket in the
 *    workflow only, so without this box the ticket's own entries were on no screen of theirs.
 *    Nothing is drawn when the ticket has none. The read is the Activity's own (listContactLog,
 *    the same cache), limited by the database to what the reader may see.
 */
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Mail, MapPin, MessageSquare, MessageSquarePlus, Phone, PhoneCall } from "lucide-react";

import { useAuth } from "@/lib/auth-store";
import { listContactLog } from "@/lib/contact-log.functions";
import { historyNoteLabel } from "@/lib/service-history";
import {
  choosesTechVisible,
  techVisibleEntries,
  THIS_TICKET_ACTIVITY_OFFICE,
  THIS_TICKET_ACTIVITY_TITLE,
} from "@/lib/tech-visible";
import { errText, FIELD_SEEDED_MS, whenShort } from "@/components/service/field-utils";

/** The icon of a shared Activity entry, as the ticket's own Activity draws it. */
const NOTE_ICONS: Record<string, typeof Phone> = {
  called: Phone,
  texted: MessageSquare,
  emailed: Mail,
  visited: MapPin,
  comment: MessageSquarePlus,
};

export interface SharedNote {
  id: number | string;
  method: string;
  note: string | null;
  by_name: string | null;
  at: string;
}

/** "Called · Nov 10, 2:15 PM · Mark Office — gate code 4471", one line per entry. */
export function SharedNotesList({
  notes,
  where,
  className = "",
}: {
  notes: readonly SharedNote[];
  /** "shared-notes" under an earlier ticket, "this-ticket-notes" in this ticket's box. */
  where: "shared-notes" | "this-ticket-notes";
  className?: string;
}) {
  return (
    <ol className={`space-y-1 text-xs ${className}`} data-history={where}>
      {notes.map((n) => {
        const Icon = NOTE_ICONS[n.method] ?? PhoneCall;
        return (
          <li key={n.id} className="flex gap-1.5">
            <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <div className="min-w-0">
              <span className="font-medium">{historyNoteLabel(n.method)}</span>
              <span className="text-muted-foreground">
                {" "}
                · {whenShort(n.at)}
                {n.by_name ? ` · ${n.by_name}` : ""}
              </span>
              {n.note ? <span className="whitespace-pre-line break-words"> — {n.note}</span> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** This ticket's ticked entries, newest first, in a box. Nothing when there are none. */
export function TicketSharedNotes({
  jobId,
  where,
  enabled = true,
  className = "",
}: {
  jobId: string;
  /** Which screen it is on, for the tests and the browser checks. */
  where: "history" | "closeout";
  enabled?: boolean;
  className?: string;
}) {
  const { session, profile } = useAuth();
  const fn = useServerFn(listContactLog);
  const q = useQuery({
    // The Activity's own key (ticket-activity.tsx): a new entry refreshes both.
    queryKey: ["contact-log", "ticket", jobId],
    queryFn: () => fn({ data: { kind: "ticket", item_id: jobId } }),
    enabled: !!session && enabled,
    staleTime: FIELD_SEEDED_MS,
  });
  if (q.error)
    return (
      <p className={`text-sm text-destructive ${className}`} data-this-ticket-activity-error>
        Could not load this ticket’s activity: {errText(q.error)}
      </p>
    );
  const notes = techVisibleEntries(q.data);
  if (!notes.length) return null;
  return (
    <section
      className={`rounded-md border bg-muted/30 px-3 py-2 ${className}`}
      aria-label={THIS_TICKET_ACTIVITY_TITLE}
      data-this-ticket-activity={where}
    >
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {THIS_TICKET_ACTIVITY_TITLE}
      </h3>
      <SharedNotesList
        notes={notes}
        where="this-ticket-notes"
        className="mt-1 max-h-56 overflow-y-auto"
      />
      {choosesTechVisible(profile) && (
        <p className="mt-1 text-xs text-muted-foreground" data-this-ticket-activity-office>
          {THIS_TICKET_ACTIVITY_OFFICE}
        </p>
      )}
    </section>
  );
}
