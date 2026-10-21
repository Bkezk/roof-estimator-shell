/**
 * History at this property (owner, Oct 21; approved as proposed, with one change: every photo,
 * not three). A technician working a ticket sees, with no extra taps, what happened at this
 * property before, and can open the earlier tickets' details and every photo.
 *
 *  * HistoryStrip — one line under the property on the ticket page: "History here: 3 earlier
 *    tickets, last Jun 12 (leak at HVAC curb, patched). 7 photos." A tap opens the fold below.
 *    "First ticket at this property." (muted) when there is none.
 *  * HistoryLink — the same line as a link to the ticket with the fold open (?open=history):
 *    on My tickets under the address (left out when there is none — the card stays short) and
 *    on the close-out's header.
 *  * HistoryFold — "History at this property (N)", a folding section that starts closed; the
 *    strip is its header summary. One row per earlier ticket at the same property, newest first,
 *    the same named spot first with a "same spot" tag: date, type, description, each repair's
 *    problem → work completed, the closing notes, the inspection outcome, and ALL its photos as
 *    thumbnails. A tap opens the ticket's own viewer (photo-markup.tsx PhotoLightbox) read-only,
 *    with arrows / a swipe between that ticket's photos. "Open" (the earlier ticket) only for
 *    someone who can read it — a technician-only user sees no link and the row says nothing
 *    about it: it already carries everything.
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
import { History, Loader2, MapPinned, PenLine } from "lucide-react";

import { useAuth } from "@/lib/auth-store";
import { isFieldOnly } from "@/lib/access";
import { OUTCOME_LABELS, type InspectionOutcome } from "@/lib/inspection";
import { marksSummary, parsePhotoMarks, photoOrdinals } from "@/lib/photo-annotations";
import type { JobPhotoRow } from "@/lib/service-field.functions";
import {
  FIRST_TICKET,
  HISTORY_OPEN_PARAM,
  dayText,
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
import { siteHistory, siteHistorySummary } from "@/lib/service-history.functions";
import {
  STAGE_LABELS,
  TYPE_LABELS,
  type ServiceStage,
  type ServiceType,
} from "@/lib/service.functions";
import { Box } from "@/components/service/field-shared";
import { MarksOverlay, PhotoLightbox } from "@/components/service/photo-markup";
import { errText, fieldKeys, useSignedUrl } from "@/components/service/field-utils";

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

function useHistorySummary(jobId: string) {
  const { session } = useAuth();
  const fn = useServerFn(siteHistorySummary);
  return useQuery({
    queryKey: fieldKeys.historySummary(jobId),
    queryFn: () => fn({ data: { id: jobId } }),
    enabled: !!session,
    staleTime: 5 * 60_000,
  });
}

function useHistory(jobId: string, enabled: boolean) {
  const { session } = useAuth();
  const fn = useServerFn(siteHistory);
  return useQuery({
    queryKey: fieldKeys.history(jobId),
    queryFn: () => fn({ data: { id: jobId } }),
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
 * The strip as a link to the ticket with its History fold open — My tickets (whenNone "hide":
 * the card stays short when there is nothing before) and the close-out's header (whenNone
 * "say": the muted first-ticket line).
 */
export function HistoryLink({ jobId, whenNone }: { jobId: string; whenNone: "hide" | "say" }) {
  const q = useHistorySummary(jobId);
  if (!q.data) return null;
  if (q.data.count === 0) {
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
    <Link
      to="/service"
      search={{ id: jobId, open: HISTORY_OPEN_PARAM }}
      className="-mx-1 flex min-h-10 items-center gap-1.5 rounded-md px-1 text-sm hover:bg-muted/40"
      title="Open the history at this property"
      data-line="history-strip"
    >
      <History className="h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" aria-hidden />
      <span>{historyStrip(q.data)}</span>
    </Link>
  );
}

// ── The fold ───────────────────────────────────────────────────────────────────────────────

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
  const { profile } = useAuth();
  // A technician-only user cannot read another technician's ticket: no Open link, nothing said.
  // Nor until the profile is known (Oct 21: isFieldOnly(null) is false, and the link showed
  // while it loaded).
  const canOpen = !!profile && !isFieldOnly(profile);
  const summary = useHistorySummary(job.id);
  const q = useHistory(job.id, open);
  const rows = useMemo(
    () => (q.data ? orderHistory(q.data, job.location_id) : []),
    [q.data, job.location_id],
  );
  // The viewer asks for fresh links when the signed ones are near their end.
  const refresh = () => {
    if (q.data && Date.now() - q.dataUpdatedAt > LINKS_FRESH_MS) void q.refetch();
  };
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
        {q.error ? (
          <p className="text-sm text-destructive">
            Could not load the history here: {errText(q.error)}
          </p>
        ) : q.isLoading || !q.data ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{FIRST_TICKET}</p>
        ) : (
          <ol className="space-y-3" aria-label="Earlier tickets at this property">
            {rows.map((t) => (
              <HistoryRow
                key={t.id}
                ticket={t}
                sameSpot={isSameSpot(t, job.location_id)}
                canOpen={canOpen}
                refresh={refresh}
              />
            ))}
          </ol>
        )}
      </Box>
    </div>
  );
}

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
  const when = historyWhen(ticket);
  const outcome = ticket.inspection_outcome
    ? (OUTCOME_LABELS[ticket.inspection_outcome as InspectionOutcome] ?? ticket.inspection_outcome)
    : null;
  return (
    <li className="space-y-2 rounded-md border p-3 text-sm" data-ticket={ticket.id}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
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
        {canOpen && (
          <Link
            to="/service"
            search={{ id: ticket.id }}
            className="ml-auto inline-flex min-h-10 items-center px-1 font-medium text-primary underline-offset-2 hover:underline"
          >
            Open
          </Link>
        )}
      </div>
      {ticket.description && <p className="whitespace-pre-line">{ticket.description}</p>}
      {ticket.repairs.length > 0 && (
        <ul className="space-y-1">
          {ticket.repairs.map((r) => (
            <li key={r.id}>
              <span className="font-medium">{r.name}</span>
              {(r.problem_text || r.resolution_text) && (
                <span className="text-muted-foreground">
                  {": "}
                  {r.problem_text ?? ""}
                  {r.problem_text && r.resolution_text ? " → " : ""}
                  {r.resolution_text ?? ""}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {ticket.closing_notes && (
        <p className="whitespace-pre-line">
          <span className="text-muted-foreground">Notes: </span>
          {ticket.closing_notes}
        </p>
      )}
      {outcome && (
        <p>
          <span className="text-muted-foreground">Outcome: </span>
          {outcome}
        </p>
      )}
      {ticket.photos.length > 0 && (
        <PhotoGrid ticket={ticket} photos={ticket.photos} refresh={refresh} />
      )}
    </li>
  );
}

// ── The photos ─────────────────────────────────────────────────────────────────────────────

/** A history photo as the viewer's row type (the fields the lightbox reads, the rest empty). */
const asPhotoRow = (ticketId: string, p: HistoryPhoto): JobPhotoRow => ({
  id: p.id,
  service_job_id: ticketId,
  repair_id: p.repair_id,
  role: p.role,
  storage_path: p.storage_path,
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
  // The server signed the link; when that failed, the browser asks for its own.
  const own = useSignedUrl(photo.url ? null : photo.storage_path);
  const url = photo.url ?? own.data ?? null;
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const marks = useMemo(() => parsePhotoMarks(photo.annotations), [photo.annotations]);
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
        <>
          <img
            src={url}
            alt={`${label} photo`}
            className="h-full w-full object-cover"
            loading="lazy"
            onLoad={(e) =>
              setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })
            }
          />
          {natural && <MarksOverlay marks={marks} w={natural.w} h={natural.h} fit="cover" />}
        </>
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
  const own = useSignedUrl(photo.url ? null : photo.storage_path);
  const url = photo.url ?? own.data ?? null;
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
