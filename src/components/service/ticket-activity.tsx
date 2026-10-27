/**
 * The ticket's Activity block, in the form (owner, Oct 27: one full stream — "cap the amount of
 * lines the timeline can grow, then make it scrollable after that line amount"). Top to bottom:
 * the contact buttons (Called / Texted / Emailed / Visited with their note and "They asked to try
 * again on", crm/contact-log.tsx), ONE note box (the Comment button and the Work fold's "Add
 * note" box until Oct 27), the "N entries" line and the list — the contact log merged with the
 * ticket's events (lib/ticket-timeline.ts), newest first, about eight rows tall and scrolling
 * inside its own box after that.
 *
 * The note saves as a contact-log comment (logContact, method "comment"): the path every viewer
 * of the block already had through the Comment button — a technician on their own ticket or on
 * its crew included (crm_contact_log's insert rule is "the ticket is one you can see"), where
 * addJobNote (service_job_events) takes only the lead technician or the office. Its @mentions
 * tell people the same way (lib/mention-notify.ts sendMentions; a problem rides back as
 * `mention_error`, never losing the note) and a comment is not copied to the events, so the
 * merged list shows it once. Rendered the same for the office and a technician; the server
 * decides what each may do, as before.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
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
import { COMMENT_METHOD, listContactLog, logContact } from "@/lib/contact-log.functions";
import { toldSuffix } from "@/lib/mentions";
import { listJobEvents } from "@/lib/service-field.functions";
import {
  ACTIVITY_EMPTY,
  entriesLine,
  mergeTimeline,
  TIMELINE_LIST_CLASS,
  type TimelineEntry,
  type TimelineIcon,
} from "@/lib/ticket-timeline";
import { Button } from "@/components/ui/button";
import { MENTION_HINT, MentionTextarea } from "@/components/mention-textarea";
import { LogContactButtons } from "@/components/crm/contact-log";
import { errText, fieldKeys, loudError, whenShort } from "@/components/service/field-utils";

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
      <ActivityNoteBox jobId={jobId} />
      <ActivityList
        entries={entries}
        error={contacts.error ?? events.error}
        loading={!entries && (contacts.isLoading || events.isLoading)}
      />
    </section>
  );
}

/** The one note box: a comment on the ticket's timeline; @ tells someone; Ctrl/⌘+Enter saves. */
function ActivityNoteBox({ jobId }: { jobId: string }) {
  const qc = useQueryClient();
  const logFn = useServerFn(logContact);
  const [note, setNote] = useState("");
  const add = useMutation({
    mutationFn: () =>
      logFn({
        data: { kind: "ticket", item_id: jobId, method: COMMENT_METHOD, note: note.trim() },
      }),
    onSuccess: (row) => {
      setNote("");
      toast.success(`Note added${toldSuffix(row.mentioned)}`);
      // The note is on record; say loudly when the people named in it were not told.
      if (row.mention_error) toast.error(row.mention_error, { duration: 12_000 });
      void qc.invalidateQueries({ queryKey: ["contact-log", "ticket", jobId] });
      void qc.invalidateQueries({ queryKey: fieldKeys.events(jobId) });
    },
    onError: (e) => loudError("Could not add the note", e),
  });
  const save = () => {
    if (note.trim() && !add.isPending) add.mutate();
  };
  return (
    <form
      className="space-y-1.5"
      data-box="activity-note"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <MentionTextarea
        rows={2}
        value={note}
        maxLength={2000}
        placeholder={`Add a note — ${MENTION_HINT}`}
        aria-label="Note"
        onValueChange={setNote}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            save();
          }
        }}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" className="h-8" disabled={!note.trim() || add.isPending}>
          {add.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
          Add note
        </Button>
        <span className="text-xs text-muted-foreground">
          Type @ to tell someone. Ctrl+Enter saves.
        </span>
      </div>
    </form>
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
        {entries.map((r) => {
          const Icon = ICONS[r.icon];
          return (
            <li
              key={r.key}
              data-source={r.source}
              className={`flex gap-1.5 ${r.done ? "rounded-sm bg-emerald-50 px-1.5 py-1 dark:bg-emerald-950/40" : ""}`}
            >
              <Icon
                className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${r.done ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}`}
                aria-hidden
              />
              <div className="min-w-0">
                <span className="font-medium">{r.label}</span>
                <span className="text-muted-foreground">
                  {" "}
                  · {whenShort(r.at)}
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
