/**
 * History at this property (owner, Oct 21; approved as proposed, with one change: every photo,
 * not three). A technician working a ticket sees, with no extra taps, what happened at this
 * property before, and can open the earlier tickets' details and every photo.
 *
 *  * HistoryStrip — one line under the property on the ticket page: "History here: 3 earlier
 *    tickets, last Jun 12 (leak at HVAC curb, patched). 7 photos." A tap opens the fold below.
 *    "First ticket at this property." (muted) when there is none.
 *  * HistoryLink — the same line as a button that opens the history on its own, in a pop-up
 *    (Nov 17: it was a link to the whole ticket page): on My tickets under the address (left
 *    out when there is none — the card stays short) and on the close-out's header.
 *  * HistoryFold — "History at this property (N)", a folding section that starts closed; the
 *    strip is its header summary. A TIMELINE (owner, Nov 17), one entry per earlier ticket at
 *    the same property, newest first, the same named spot first with a "same spot" tag: its
 *    line (date, type, number, stage, technician), the description, what the inspection found,
 *    the repairs and the closing notes, and under it the Activity entries the office ticked
 *    "Viewable to technicians" (lib/tech-visible.ts), drawn as the ticket's Activity draws them.
 *    A tap on the ticket's line opens its photos and nothing else (HistoryPhotos): ALL its
 *    photos as thumbnails, each opening the ticket's own viewer (photo-markup.tsx
 *    PhotoLightbox) read-only, with arrows / a swipe between them. "Open the ticket" only for
 *    someone who can read it — a technician-only user sees no link. The earlier ticket's
 *    Special instructions are not shown.
 *  * LastTimeLine — under an inspection checklist item: "Last time: Jun 12 — Issue: cracked
 *    sealant" with the photo taken for that item on the earlier ticket (photos carry item_key,
 *    the checklist item's id, which is the same across tickets).
 *
 * The rows come through service-history.functions.ts (the database decides who may ask; the
 * photo links are signed there). The fold asks when it opens, not on page load; the summary is
 * one small read shared by the strip and the fold's header.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import {
  Camera,
  ChevronRight,
  History,
  Loader2,
  Mail,
  MapPin,
  MapPinned,
  MessageSquare,
  MessageSquarePlus,
  PenLine,
  Phone,
  PhoneCall,
} from "lucide-react";

import { useAuth } from "@/lib/auth-store";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { isFieldOnly } from "@/lib/access";
import { OUTCOME_LABELS, type InspectionOutcome } from "@/lib/inspection";
import { marksSummary, parsePhotoMarkup, photoOrdinals } from "@/lib/photo-annotations";
import type { JobPhotoRow } from "@/lib/service-field.functions";
import type { SiteHistorySummary } from "@/lib/service-history";
import {
  FIRST_TICKET,
  HISTORY_NO_PHOTOS,
  dayText,
  flaggedHistoryItems,
  historyNoteLabel,
  historyPhotosHint,
  historyFoldSummary,
  historyFoldTitle,
  historyStrip,
  historyWhen,
  isSameSpot,
  itemHistoryText,
  lastTimeForItem,
  lastTimeText,
  orderHistory,
  type HistoryPhoto,
  type SiteHistoryTicket,
} from "@/lib/service-history";
import {
  HISTORY_FIRST_TICKETS,
  siteHistory,
  siteHistorySummary,
} from "@/lib/service-history.functions";
import {
  STAGE_LABELS,
  TYPE_LABELS,
  type ServiceStage,
  type ServiceType,
} from "@/lib/service.functions";
import { Box } from "@/components/service/field-shared";
import { PhotoLightbox, RotatedPhoto } from "@/components/service/photo-markup";
import {
  errText,
  fieldKeys,
  useSignedUrl,
  useStableLink,
  whenShort,
} from "@/components/service/field-utils";

/** The fold's element id: the strip scrolls to it, and so does ?open=history. */
export const HISTORY_FOLD_ID = "history-at-property";
/** The signed links last an hour; past this the viewer asks for fresh ones before opening. */
const LINKS_FRESH_MS = 50 * 60_000;

const ROLE_LABEL: Record<string, string> = {
  before: "Before",
  after: "After",
  other: "Photo",
  aerial: "Aerial",
};

// ── The reads ──────────────────────────────────────────────────────────────────────────────

function useHistorySummary(jobId: string, enabled = true) {
  const { session } = useAuth();
  const fn = useServerFn(siteHistorySummary);
  return useQuery({
    queryKey: fieldKeys.historySummary(jobId),
    queryFn: () => fn({ data: { id: jobId } }),
    enabled: !!session && enabled,
    staleTime: 5 * 60_000,
  });
}

/**
 * The fold's rows: the newest HISTORY_FIRST_TICKETS at first (Nov 3, review item 46), every
 * ticket once "Show more" is pressed (`all`). Two cache entries, so going back to the short
 * list costs nothing.
 */
function useHistory(jobId: string, enabled: boolean, all = false) {
  const { session } = useAuth();
  const fn = useServerFn(siteHistory);
  return useQuery({
    queryKey: all ? [...fieldKeys.history(jobId), "all"] : fieldKeys.history(jobId),
    queryFn: () => fn({ data: all ? { id: jobId } : { id: jobId, limit: HISTORY_FIRST_TICKETS } }),
    enabled: !!session && enabled,
    // The photo links are signed for an hour: fresh enough until then, re-read after.
    staleTime: 45 * 60_000,
    gcTime: LINKS_FRESH_MS,
  });
}

// ── The strip ──────────────────────────────────────────────────────────────────────────────

/**
 * The one line under the property on the ticket page. A tap opens the History fold (onOpen).
 * Nothing while loading; "First ticket at this property." muted when there is none.
 */
export function HistoryStrip({ jobId, onOpen }: { jobId: string; onOpen: () => void }) {
  const q = useHistorySummary(jobId);
  if (q.error)
    return (
      <p className="text-xs text-destructive" data-line="history-strip">
        History here: could not load — {errText(q.error)}
      </p>
    );
  if (!q.data) return null;
  if (q.data.count === 0)
    return (
      <p
        className="flex items-center gap-1.5 text-sm text-muted-foreground"
        data-line="history-strip"
      >
        <History className="h-4 w-4 shrink-0" aria-hidden /> {FIRST_TICKET}
      </p>
    );
  return (
    <button
      type="button"
      className="-mx-1 flex min-h-10 w-full items-center gap-1.5 rounded-md px-1 text-left text-sm hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      title="Open the history at this property"
      onClick={onOpen}
      data-line="history-strip"
    >
      <History className="h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" aria-hidden />
      <span>{historyStrip(q.data)}</span>
    </button>
  );
}

/**
 * The strip as a button that opens the history ON ITS OWN, in a pop-up (owner, Nov 17, with a
 * picture of the whole ticket page a technician landed on: "id really just like them to see the
 * 'history at this property' part not the aerial, materials, etc. since theyre already seeing
 * that in the ticket workflow"). It was a link to the ticket with its History fold open, so a
 * tap from My tickets or from the close-out left the work and showed the ticket's every
 * section. Now nothing is left: the history timeline opens over the page and closes back to it.
 * My tickets (whenNone "hide": the card stays short when there is nothing before) and the
 * close-out's header (whenNone "say": the muted first-ticket line).
 */
export function HistoryLink({
  jobId,
  whenNone,
  summary,
  locationId,
}: {
  jobId: string;
  whenNone: "hide" | "say";
  /** The numbers when the page already has them (My tickets reads them with the day, Nov 3). */
  summary?: SiteHistorySummary | null | undefined;
  /** The ticket's named spot, when the page knows it: the same spot's tickets come first. */
  locationId?: string | null | undefined;
}) {
  const own = useHistorySummary(jobId, !summary);
  const data = summary ?? own.data;
  const [open, setOpen] = useState(false);
  if (!data) return null;
  if (data.count === 0) {
    if (whenNone === "hide") return null;
    return (
      <p
        className="flex items-center gap-1.5 text-sm text-muted-foreground"
        data-line="history-strip"
      >
        <History className="h-4 w-4 shrink-0" aria-hidden /> {FIRST_TICKET}
      </p>
    );
  }
  return (
    <>
      <button
        type="button"
        className="-mx-1 flex min-h-10 w-full items-center gap-1.5 rounded-md px-1 text-left text-sm hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        title="See the history at this property"
        aria-haspopup="dialog"
        data-line="history-strip"
        onClick={() => setOpen(true)}
      >
        <History className="h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" aria-hidden />
        <span>{historyStrip(data)}</span>
      </button>
      {open && (
        <HistoryDialog
          jobId={jobId}
          locationId={locationId ?? null}
          count={data.count}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

/** The history by itself, over whatever page the technician is on: the timeline and Close. */
function HistoryDialog({
  jobId,
  locationId,
  count,
  onClose,
}: {
  jobId: string;
  locationId: string | null;
  count: number;
  onClose: () => void;
}) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="flex max-h-[90svh] w-[calc(100vw-1rem)] max-w-2xl flex-col gap-0 p-0"
        data-history-dialog={jobId}
      >
        <DialogHeader className="space-y-1 border-b px-4 py-3 text-left">
          <DialogTitle>{historyFoldTitle(count)}</DialogTitle>
          <DialogDescription>
            Earlier tickets here, newest first. Tap a ticket to see its photos.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          <HistoryTimeline jobId={jobId} locationId={locationId} enabled />
        </div>
        <DialogFooter className="flex-row items-center justify-end border-t px-4 py-3">
          <Button
            type="button"
            className="h-10 min-w-24"
            data-history-dialog-close
            onClick={onClose}
          >
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── The fold ───────────────────────────────────────────────────────────────────────────────

/**
 * The timeline itself: the newest ten earlier tickets, "Show all" for the rest. The body of the
 * History fold on the ticket page and of the pop-up the strip opens elsewhere (Nov 17), so both
 * read the same rows from the same cache. It asks for the rows only once `enabled`.
 */
function HistoryTimeline({
  jobId,
  locationId,
  enabled,
}: {
  jobId: string;
  locationId: string | null;
  enabled: boolean;
}) {
  const { profile } = useAuth();
  // A technician-only user cannot read another technician's ticket: no Open link, nothing said.
  // Nor until the profile is known (Oct 21: isFieldOnly(null) is false, and the link showed
  // while it loaded).
  const canOpen = !!profile && !isFieldOnly(profile);
  const summary = useHistorySummary(jobId);
  // The newest ten first; "Show more" reads every earlier ticket (Nov 3, review item 46).
  const [all, setAll] = useState(false);
  const q = useHistory(jobId, enabled, all);
  const rows = useMemo(
    () => (q.data ? orderHistory(q.data, locationId) : []),
    [q.data, locationId],
  );
  const more = !all && (summary.data?.count ?? 0) > rows.length && rows.length > 0;
  // The viewer asks for fresh links when the signed ones are near their end.
  const refresh = () => {
    if (q.data && Date.now() - q.dataUpdatedAt > LINKS_FRESH_MS) void q.refetch();
  };
  return q.error ? (
    <p className="text-sm text-destructive">Could not load the history here: {errText(q.error)}</p>
  ) : q.isLoading || !q.data ? (
    <p className="flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" /> Loading…
    </p>
  ) : rows.length === 0 ? (
    <p className="text-sm text-muted-foreground">{FIRST_TICKET}</p>
  ) : (
    <>
      {/* A timeline (owner, Nov 17): the line down the left, a dot per earlier ticket. */}
      <ol
        className="ml-1.5 space-y-4 border-l"
        aria-label="Earlier tickets at this property"
        data-history="timeline"
      >
        {rows.map((t) => (
          <HistoryRow
            key={t.id}
            ticket={t}
            sameSpot={isSameSpot(t, locationId)}
            canOpen={canOpen}
            refresh={refresh}
          />
        ))}
      </ol>
      {more && (
        <Button
          type="button"
          variant="outline"
          className="mt-3 h-11 w-full"
          data-line="history-more"
          onClick={() => setAll(true)}
        >
          Show all {summary.data?.count} earlier tickets
        </Button>
      )}
    </>
  );
}

/**
 * "History at this property (N)": starts closed; the parent holds the open state (the strip
 * opens it, ?open=history opens it on arrival). The rows load when it opens.
 */
export function HistoryFold({
  job,
  open,
  onOpenChange,
}: {
  job: { id: string; location_id: string | null };
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const summary = useHistorySummary(job.id);
  return (
    <div id={HISTORY_FOLD_ID}>
      <Box
        title={historyFoldTitle(summary.data?.count ?? null)}
        icon={MapPinned}
        collapsible
        open={open}
        onOpenChange={onOpenChange}
        defaultOpen={false}
        tone="earlier"
        summary={
          summary.error ? (
            <span className="text-destructive">could not load</span>
          ) : summary.data ? (
            historyFoldSummary(summary.data)
          ) : null
        }
      >
        <HistoryTimeline jobId={job.id} locationId={job.location_id} enabled={open} />
      </Box>
    </div>
  );
}

/** A small heading inside a timeline entry: "FOUND ON THE INSPECTION". */
const HEAD = "text-xs font-medium uppercase tracking-wide text-muted-foreground";

/** The icon of a shared Activity entry, as the ticket's own Activity draws it. */
const NOTE_ICONS: Record<string, typeof Phone> = {
  called: Phone,
  texted: MessageSquare,
  emailed: Mail,
  visited: MapPin,
  comment: MessageSquarePlus,
};

/** "Nov 10 · Inspection · #6069 · Done · Ted Tech · North wing": an earlier ticket's line. */
function TicketLine({ ticket, sameSpot }: { ticket: SiteHistoryTicket; sameSpot: boolean }) {
  const when = historyWhen(ticket);
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="font-semibold">{when ? dayText(when) : "No date"}</span>
      <span className="text-muted-foreground">
        · {TYPE_LABELS[ticket.service_type as ServiceType] ?? "Other"} · #{ticket.number} ·{" "}
        {STAGE_LABELS[ticket.stage as ServiceStage] ?? ticket.stage}
        {ticket.technician_name ? ` · ${ticket.technician_name}` : ""}
        {ticket.location_name ? ` · ${ticket.location_name}` : ""}
      </span>
      {sameSpot && (
        <span
          className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
          title="The same spot on the property as this ticket"
          data-tag="same-spot"
        >
          same spot
        </span>
      )}
    </span>
  );
}

/**
 * One earlier ticket on the timeline (owner, Nov 17; lib/service-history.ts has his words). Its
 * line is the button: a tap opens the ticket's photos (HistoryPhotos). Under the line, always in
 * view: the description, what the inspection found, the repairs and the closing notes; then the
 * Activity entries the office ticked "Viewable to technicians", drawn as the ticket's own
 * Activity draws them. Nothing else of the earlier ticket is here.
 */
function HistoryRow({
  ticket,
  sameSpot,
  canOpen,
  refresh,
}: {
  ticket: SiteHistoryTicket;
  sameSpot: boolean;
  canOpen: boolean;
  refresh: () => void;
}) {
  const [open, setOpen] = useState(false);
  const flagged = flaggedHistoryItems(ticket);
  const outcome = ticket.inspection_outcome
    ? (OUTCOME_LABELS[ticket.inspection_outcome as InspectionOutcome] ?? ticket.inspection_outcome)
    : null;
  return (
    <li className="relative pl-5 text-sm" data-ticket={ticket.id}>
      {/* The timeline's dot, on the line the list draws down its left side. */}
      <span
        className="absolute -left-[5px] top-3 h-2.5 w-2.5 rounded-full border-2 border-background bg-primary"
        aria-hidden
      />
      <button
        type="button"
        className="-ml-2 flex w-[calc(100%+0.5rem)] flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-md px-2 py-1.5 text-left hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-haspopup="dialog"
        data-history="row"
        title="See this ticket's photos"
        onClick={() => {
          // The photo links are signed for an hour: fresh ones before the pop-up shows them.
          refresh();
          setOpen(true);
        }}
      >
        <TicketLine ticket={ticket} sameSpot={sameSpot} />
        <span
          className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-primary"
          data-history="hint"
        >
          <Camera className="h-3.5 w-3.5" aria-hidden />
          {historyPhotosHint(ticket)}
          <ChevronRight className="h-3.5 w-3.5" aria-hidden />
        </span>
      </button>
      <div className="space-y-2 pb-1">
        {ticket.description && <p className="whitespace-pre-line">{ticket.description}</p>}
        {flagged.length > 0 && (
          <div data-history="found">
            <p className={HEAD}>Found on the inspection</p>
            <ul className="list-disc space-y-0.5 pl-5">
              {flagged.map((f) => (
                <li key={f.key}>
                  <span className="font-medium">{f.label}</span>
                  {f.note && <span className="whitespace-pre-line">: {f.note}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
        {ticket.inspection_notes && (
          <p className="whitespace-pre-line" data-history="inspection-notes">
            <span className="text-muted-foreground">Inspection notes: </span>
            {ticket.inspection_notes}
          </p>
        )}
        {outcome && (
          <p>
            <span className="text-muted-foreground">Outcome: </span>
            {outcome}
          </p>
        )}
        {ticket.repairs.length > 0 && (
          <div data-history="repairs">
            <p className={HEAD}>Repairs</p>
            <ul className="space-y-1">
              {ticket.repairs.map((r) => (
                <li key={r.id}>
                  <span className="font-medium">{r.name}</span>
                  {r.problem_text && (
                    <p className="whitespace-pre-line">
                      <span className="text-muted-foreground">What was wrong: </span>
                      {r.problem_text}
                    </p>
                  )}
                  {r.resolution_text && (
                    <p className="whitespace-pre-line">
                      <span className="text-muted-foreground">What was done: </span>
                      {r.resolution_text}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
        {ticket.closing_notes && (
          <p className="whitespace-pre-line" data-history="closing-notes">
            <span className="text-muted-foreground">Closing notes: </span>
            {ticket.closing_notes}
          </p>
        )}
        {/* The Activity entries ticked "Viewable to technicians", as the Activity draws them. */}
        {ticket.shared_notes.length > 0 && (
          <ol className="space-y-1 text-xs" data-history="shared-notes">
            {ticket.shared_notes.map((n) => {
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
                    {n.note ? <span className="whitespace-pre-line"> — {n.note}</span> : null}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>
      {open && (
        <HistoryPhotos
          ticket={ticket}
          sameSpot={sameSpot}
          canOpen={canOpen}
          refresh={refresh}
          onClose={() => setOpen(false)}
        />
      )}
    </li>
  );
}

/**
 * The earlier ticket's photos, and only its photos (owner, Nov 17: "i dont really want them to
 * see the whole ticket"; "id like to be able to click the ticket to see the photos"): every
 * photo as a thumbnail, each opening the viewer. "Open the ticket" only for someone who can
 * read it (never a technician-only login).
 */
function HistoryPhotos({
  ticket,
  sameSpot,
  canOpen,
  refresh,
  onClose,
}: {
  ticket: SiteHistoryTicket;
  sameSpot: boolean;
  canOpen: boolean;
  refresh: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="flex max-h-[90svh] w-[calc(100vw-1rem)] max-w-2xl flex-col gap-0 p-0"
        data-history-photos={ticket.id}
      >
        <DialogHeader className="space-y-1 border-b px-4 py-3 text-left">
          <DialogTitle>
            Photos · {TYPE_LABELS[ticket.service_type as ServiceType] ?? "Ticket"} #{ticket.number}
          </DialogTitle>
          <DialogDescription asChild>
            <div className="text-sm">
              <TicketLine ticket={ticket} sameSpot={sameSpot} />
            </div>
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 text-sm">
          {ticket.photos.length > 0 ? (
            <PhotoGrid ticket={ticket} photos={ticket.photos} refresh={refresh} />
          ) : (
            <p className="text-muted-foreground" data-history="empty">
              {HISTORY_NO_PHOTOS}
            </p>
          )}
        </div>
        <DialogFooter className="flex-row items-center justify-end gap-2 border-t px-4 py-3">
          {canOpen && (
            <Button asChild variant="outline" className="h-10">
              <Link to="/service" search={{ id: ticket.id }}>
                Open the ticket
              </Link>
            </Button>
          )}
          <Button type="button" className="h-10 min-w-24" data-history-close onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── The photos ─────────────────────────────────────────────────────────────────────────────

/** A history photo as the viewer's row type (the fields the lightbox reads, the rest empty). */
const asPhotoRow = (
  ticketId: string,
  p: HistoryPhoto,
): JobPhotoRow & { item_keys?: string[] | undefined } => ({
  // Every item the photo is on (Oct 28), when the JSON carries it; an older JSON has item_key only.
  ...(p.item_keys ? { item_keys: p.item_keys } : {}),
  id: p.id,
  service_job_id: ticketId,
  repair_id: p.repair_id,
  role: p.role,
  storage_path: p.storage_path,
  thumb_path: p.thumb_path ?? null,
  file_name: p.file_name,
  file_size: null,
  taken_at: p.taken_at,
  lat: null,
  lng: null,
  by_user: null,
  created_at: p.created_at,
  annotations: p.annotations as JobPhotoRow["annotations"],
  item_key: p.item_key,
});

/**
 * Every photo of the set as thumbnails (four to a row on a phone, more on a wide screen; no
 * cap — the owner: every picture), each opening the viewer on that photo with arrows between
 * the set.
 */
function PhotoGrid({
  ticket,
  photos,
  refresh,
  compact,
}: {
  ticket: SiteHistoryTicket;
  photos: readonly HistoryPhoto[];
  refresh: () => void;
  /** Smaller cells (the "Last time" line under a checklist item). */
  compact?: boolean | undefined;
}) {
  const [viewing, setViewing] = useState<number | null>(null);
  const ordinals = useMemo(() => photoOrdinals(ticket.photos), [ticket.photos]);
  const open = (i: number) => {
    refresh();
    setViewing(i);
  };
  const shown = viewing === null ? null : photos[viewing];
  return (
    <>
      <div
        className={
          compact
            ? "grid grid-cols-6 gap-2 sm:grid-cols-8 lg:grid-cols-10"
            : "grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-8"
        }
        data-line="history-photos"
      >
        {photos.map((p, i) => (
          <HistoryThumb key={p.id} photo={p} onOpen={() => open(i)} />
        ))}
      </div>
      {shown && viewing !== null && (
        <HistoryViewer
          ticket={ticket}
          photo={shown}
          ordinal={ordinals.get(shown.id) ?? viewing + 1}
          nav={{ index: viewing, count: photos.length, onStep: (d) => setViewing(viewing + d) }}
          onClose={() => setViewing(null)}
        />
      )}
    </>
  );
}

/** A square thumbnail with the photo's marks drawn over it; a tap opens the viewer. */
function HistoryThumb({ photo, onOpen }: { photo: HistoryPhoto; onOpen: () => void }) {
  // The small copy for the square when the photo has one (Nov 3); the server signed the links,
  // and when that failed the browser asks for its own.
  // The link this browser already used for the file is kept while it is good (Nov 10: a fresh
  // link each read made every thumbnail download again; field-utils stableLink).
  const small = useStableLink(
    photo.thumb_url ? photo.thumb_path : photo.storage_path,
    photo.thumb_url ?? photo.url,
  );
  const own = useSignedUrl(small ? null : (photo.thumb_path ?? photo.storage_path));
  const url = small ?? own.data ?? null;
  const { marks, rotation } = useMemo(
    () => parsePhotoMarkup(photo.annotations),
    [photo.annotations],
  );
  const label = ROLE_LABEL[photo.role] ?? "Photo";
  return (
    <button
      type="button"
      className="relative aspect-square min-h-10 w-full overflow-hidden rounded-md border bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      title={
        marks.length
          ? `Open the ${label.toLowerCase()} photo (marked)`
          : `Open the ${label.toLowerCase()} photo`
      }
      aria-label={`Open the ${label.toLowerCase()} photo`}
      onClick={onOpen}
    >
      {url ? (
        <RotatedPhoto
          url={url}
          alt={`${label} photo`}
          marks={marks}
          rotation={rotation}
          fit="cover"
          className="h-full w-full"
          loading="lazy"
        />
      ) : own.error ? (
        <span className="flex h-full items-center justify-center p-1 text-center text-[10px] text-destructive">
          Could not load
        </span>
      ) : (
        <span className="flex h-full items-center justify-center">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </span>
      )}
      <span className="pointer-events-none absolute bottom-0 left-0 rounded-tr bg-black/60 px-1 text-[10px] font-medium text-white">
        {label}
      </span>
      {marks.length > 0 && (
        <span
          className="pointer-events-none absolute left-0 top-0 inline-flex items-center gap-0.5 rounded-br bg-red-600 px-1 text-[10px] font-medium text-white"
          title={marksSummary(marks)}
        >
          <PenLine className="h-2.5 w-2.5" aria-hidden /> Marked
        </span>
      )}
    </button>
  );
}

/**
 * The ticket's own viewer, read-only (no Mark up on another ticket's photo), with the arrows.
 * The link: the server's, else the browser's own signed link (asked when opening).
 */
function HistoryViewer({
  ticket,
  photo,
  ordinal,
  nav,
  onClose,
}: {
  ticket: SiteHistoryTicket;
  photo: HistoryPhoto;
  ordinal: number;
  nav: { index: number; count: number; onStep: (delta: 1 | -1) => void };
  onClose: () => void;
}) {
  const listed = useStableLink(photo.storage_path, photo.url);
  const own = useSignedUrl(listed ? null : photo.storage_path);
  const url = listed ?? own.data ?? null;
  if (!url) return null;
  return (
    <PhotoLightbox
      photo={asPhotoRow(ticket.id, photo)}
      url={url}
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      canAnnotate={false}
      ticketNumber={ticket.number}
      ordinal={ordinal}
      nav={{ index: nav.index, count: nav.count, onStep: nav.onStep }}
    />
  );
}

// ── The inspection step ────────────────────────────────────────────────────────────────────

/**
 * Under a checklist item: "Last time: Jun 12 — Issue: cracked sealant" and the photo(s) taken
 * for that item on the newest earlier ticket that has one. Nothing when there is none.
 */
export function LastTimeLine({ jobId, itemKey }: { jobId: string; itemKey: string }) {
  const q = useHistory(jobId, true);
  const hit = q.data ? lastTimeForItem(q.data, itemKey) : null;
  const refresh = () => {
    if (q.data && Date.now() - q.dataUpdatedAt > LINKS_FRESH_MS) void q.refetch();
  };
  if (!hit) return null;
  return (
    <div className="space-y-1.5 border-t pt-2" data-line="last-time">
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <History className="h-3.5 w-3.5 shrink-0" aria-hidden />
        {lastTimeText(historyWhen(hit.ticket), itemHistoryText(hit.ticket, itemKey))}
      </p>
      <PhotoGrid ticket={hit.ticket} photos={hit.photos} refresh={refresh} compact />
    </div>
  );
}
