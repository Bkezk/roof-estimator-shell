/**
 * The ticket's Activity block, in the form (owner, Oct 27: one full stream — "cap the amount of
 * lines the timeline can grow, then make it scrollable after that line amount"). Top to bottom:
 * the contact buttons (Called / Texted / Emailed / Visited / Note with their note and "They asked
 * to try again on", crm/contact-log.tsx), the "N entries" line and the list — the contact log merged with the
 * ticket's events (lib/ticket-timeline.ts), newest first, about eight rows tall and scrolling
 * inside its own box after that.
 *
 * Owner, Oct 28: "Note" is one of the buttons beside Called / Texted / Emailed / Visited — no
 * separate box; it writes a contact-log comment (logContact, method "comment"; @mentions tell
 * people), the path every viewer of the ticket already had.
 */
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  CalendarDays,
  Camera,
  CheckCircle2,
  History,
  Loader2,
  Mail,
  MapPin,
  MessageSquare,
  MessageSquarePlus,
  PenLine,
  Phone,
  PhoneCall,
  Truck,
  Users,
} from "lucide-react";

import { useAuth } from "@/lib/auth-store";
import { listContactLog } from "@/lib/contact-log.functions";
import { listJobEvents } from "@/lib/service-field.functions";
import {
  ACTIVITY_EMPTY,
  entriesLine,
  groupLabel,
  groupTimeline,
  groupWhen,
  mergeTimeline,
  TIMELINE_LIST_CLASS,
  type TimelineEntry,
  type TimelineIcon,
} from "@/lib/ticket-timeline";
import { LogContactButtons } from "@/components/crm/contact-log";
import { errText, fieldKeys, whenShort } from "@/components/service/field-utils";

const ICONS: Record<TimelineIcon, typeof Phone> = {
  called: Phone,
  texted: MessageSquare,
  emailed: Mail,
  visited: MapPin,
  other: PhoneCall,
  note: MessageSquare,
  comment: MessageSquarePlus,
  service: CheckCircle2,
  stage: CheckCircle2,
  field: Truck,
  date: CalendarDays,
  photo: Camera,
  signature: PenLine,
  crew: Users,
  edit: History,
};

/** The whole block: heading, the contact buttons, the note box, the list. */
export function TicketActivity({ jobId }: { jobId: string }) {
  const { session } = useAuth();
  const contactsFn = useServerFn(listContactLog);
  const eventsFn = useServerFn(listJobEvents);
  const contacts = useQuery({
    queryKey: ["contact-log", "ticket", jobId],
    queryFn: () => contactsFn({ data: { kind: "ticket", item_id: jobId } }),
    enabled: !!session,
  });
  // The same query (and cache) as the stage strip under the header (service-page.tsx).
  const events = useQuery({
    queryKey: fieldKeys.events(jobId),
    queryFn: () => eventsFn({ data: { id: jobId } }),
    enabled: !!session,
  });
  const entries = contacts.data && events.data ? mergeTimeline(contacts.data, events.data) : null;
  return (
    <section className="space-y-2 rounded-lg border p-3 text-sm" aria-label="Activity">
      <p className="flex items-center gap-1.5 font-medium">
        <History className="h-3.5 w-3.5 text-muted-foreground" /> Activity
      </p>
      <LogContactButtons kind="ticket" itemId={jobId} />
      <ActivityList
        entries={entries}
        error={contacts.error ?? events.error}
        loading={!entries && (contacts.isLoading || events.isLoading)}
      />
    </section>
  );
}

/**
 * The merged stream, newest first: "N entries", then the list in a box about eight rows tall
 * that scrolls after that (TIMELINE_LIST_CLASS), so what matters is in view without scrolling.
 * Presentational: rendered to a string in ticket-activity.test.tsx.
 */
export function ActivityList({
  entries,
  error,
  loading,
}: {
  entries: readonly TimelineEntry[] | null;
  error?: unknown;
  loading?: boolean | undefined;
}) {
  if (error)
    return (
      <p className="text-xs text-destructive">Could not load the activity: {errText(error)}</p>
    );
  if (loading || !entries)
    return (
      <p className="flex items-center gap-1 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading the activity…
      </p>
    );
  if (entries.length === 0)
    return <p className="text-xs text-muted-foreground">{ACTIVITY_EMPTY}</p>;
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground" data-line="activity-count">
        {entriesLine(entries.length)}
      </p>
      <ol className={`space-y-1 text-xs ${TIMELINE_LIST_CLASS}`} data-list="activity">
        {groupTimeline(entries).map((r) => {
          const Icon = ICONS[r.icon];
          return (
            <li
              key={r.key}
              data-source={r.source}
              data-count={r.count > 1 ? r.count : undefined}
              className={`flex gap-1.5 ${r.done ? "rounded-sm bg-emerald-50 px-1.5 py-1 dark:bg-emerald-950/40" : ""}`}
            >
              <Icon
                className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${r.done ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}`}
                aria-hidden
              />
              <div className="min-w-0">
                <span className="font-medium">{groupLabel(r.label, r.count)}</span>
                <span className="text-muted-foreground">
                  {" "}
                  · {groupWhen(r, whenShort)}
                  {r.byName ? ` · ${r.byName}` : ""}
                </span>
                {r.text ? <span className="whitespace-pre-line"> — {r.text}</span> : null}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
