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
import {
  listContactLog,
  setContactTechVisible,
  type ContactLogRow,
} from "@/lib/contact-log.functions";
import { choosesTechVisible, TECH_VISIBLE_HELP, TECH_VISIBLE_LABEL } from "@/lib/tech-visible";
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
import {
  errText,
  FIELD_READ,
  FIELD_SEEDED_MS,
  fieldKeys,
  whenShort,
} from "@/components/service/field-utils";

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
  const { session, profile } = useAuth();
  const qc = useQueryClient();
  const contactsFn = useServerFn(listContactLog);
  const shareFn = useServerFn(setContactTechVisible);
  const contactsKey = ["contact-log", "ticket", jobId];
  // "Viewable to technicians" on an entry already written (owner, Nov 17; lib/tech-visible.ts):
  // the office ticks or unticks it. The row changes at once and goes back if the save fails.
  const share = useMutation({
    mutationFn: (v: { id: number; on: boolean }) => shareFn({ data: v }),
    onMutate: (v) => {
      const before = qc.getQueryData<ContactLogRow[]>(contactsKey);
      qc.setQueryData<ContactLogRow[]>(contactsKey, (old) =>
        old?.map((r) => (r.id === v.id ? { ...r, tech_visible: v.on } : r)),
      );
      return { before };
    },
    onError: (e, _v, ctx) => {
      if (ctx?.before) qc.setQueryData(contactsKey, ctx.before);
      toast.error(`Could not change who sees that entry: ${errText(e)}`, { duration: 12_000 });
    },
    onSuccess: (r) =>
      toast.success(
        r.tech_visible ? "Technicians can see that entry" : "Technicians can no longer see it",
      ),
    onSettled: () => void qc.invalidateQueries({ queryKey: contactsKey }),
  });
  const eventsFn = useServerFn(listJobEvents);
  const contacts = useQuery({
    queryKey: contactsKey,
    queryFn: () => contactsFn({ data: { kind: "ticket", item_id: jobId } }),
    enabled: !!session,
    // The ticket's one read brought these (Nov 10): no second ask as the block mounts.
    staleTime: FIELD_SEEDED_MS,
  });
  // The same query (and cache) as the stage strip under the header (service-page.tsx).
  const events = useQuery({
    queryKey: fieldKeys.events(jobId),
    queryFn: () => eventsFn({ data: { id: jobId } }),
    enabled: !!session,
    ...FIELD_READ,
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
        onShare={choosesTechVisible(profile) ? (id, on) => share.mutate({ id, on }) : undefined}
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
  onShare,
}: {
  entries: readonly TimelineEntry[] | null;
  error?: unknown;
  loading?: boolean | undefined;
  /**
   * The office's "Viewable to technicians" checkbox on each entry a person made (Nov 17). Left
   * out for a technician-only login, who is shown no checkbox.
   */
  onShare?: ((id: number, on: boolean) => void) | undefined;
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
                {/* One entry, not a run of look-alikes: a run has no single tick to show. */}
                {onShare && r.share && r.count === 1 && (
                  <label
                    className="mt-0.5 flex w-fit cursor-pointer items-center gap-1.5 text-[11px] text-muted-foreground"
                    title={TECH_VISIBLE_HELP}
                    data-share={r.share.id}
                  >
                    <input
                      type="checkbox"
                      className="h-3.5 w-3.5 accent-primary"
                      checked={r.share.on}
                      onChange={(e) => onShare(r.share!.id, e.target.checked)}
                    />
                    {TECH_VISIBLE_LABEL}
                  </label>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
