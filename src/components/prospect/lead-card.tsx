/**
 * One construction lead on the Leads page (owner, Sep 28): a state planroom job with its bid
 * countdown, or a Louisville commercial permit with its size and cost. The whole card opens the
 * lead's own page on the source site (a permit has none: owner, Sep 29, "we don't want these
 * linked to the map, new builds just open a blank space"); the buttons (Watch, Dismiss, Note)
 * do their own thing and never trigger the card.
 */
import { useState, type ReactNode, type SyntheticEvent } from "react";
import { Eye, EyeOff, Loader2, StickyNote, Undo2, X } from "lucide-react";

import { SOURCE_LABELS, type LeadRow, type LeadStatus } from "@/lib/leads.functions";
import { formatCost } from "@/components/prospect/lead-format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

const ET = "America/New_York";
const DAY = 24 * 60 * 60 * 1000;

/** "2026-09-28" for an instant, on the Eastern calendar. */
const etDay = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: ET });
/** Whole calendar days from a to b ("2026-09-28" strings). */
const dayDiff = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);

/** "Oct 20, 1:30 PM ET". */
const etDateTime = (iso: string) =>
  `${new Date(iso).toLocaleString("en-US", {
    timeZone: ET,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })} ET`;
/** "Oct 20" on the Eastern calendar. */
const etDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { timeZone: ET, month: "short", day: "numeric" });
/** "Sep 28" in the viewer's time zone (seen / status stamps). */
const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

function BidLine({ lead }: { lead: LeadRow }) {
  const now = new Date();
  const parts: ReactNode[] = [];
  if (lead.bid_at) {
    const bid = new Date(lead.bid_at);
    if (bid.getTime() < now.getTime()) {
      parts.push(
        <span key="bid" className="font-medium text-destructive">
          Bid closed {etDate(lead.bid_at)}
        </span>,
      );
    } else {
      const days = dayDiff(etDay(now), etDay(bid));
      const when = days <= 0 ? "Bids today" : days === 1 ? "Bids tomorrow" : `Bids in ${days} days`;
      const tone =
        days > 7 ? "text-green-700 dark:text-green-400" : "text-amber-700 dark:text-amber-400";
      parts.push(
        <span key="bid" className={`font-medium ${tone}`}>
          {when} · {etDateTime(lead.bid_at)}
        </span>,
      );
    }
  } else if (lead.source === "ky_planroom") {
    parts.push(<span key="bid">No bid date posted</span>);
  }
  if (lead.prebid_at)
    parts.push(
      <span key="prebid" title={`Pre-bid meeting ${etDateTime(lead.prebid_at)}`}>
        Pre-bid {etDate(lead.prebid_at)}
      </span>,
    );
  if (lead.issued_on) {
    // A plain date ("2026-09-24"): compare calendar days, no time zone shift.
    const ago = dayDiff(lead.issued_on, etDay(now));
    const agoText = ago <= 0 ? "today" : ago === 1 ? "yesterday" : `${ago} days ago`;
    const [y, m, d] = lead.issued_on.split("-").map(Number);
    const issued = new Date(y ?? 0, (m ?? 1) - 1, d ?? 1).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
    // Louisville and Nashville rows are permits; the bid pages and SAM.gov give a posting date.
    const label =
      lead.source === "louisville_permits" || lead.source === "nashville_permits"
        ? "Permit issued"
        : "Posted";
    parts.push(
      <span key="issued">
        {label} {issued} ({agoText})
      </span>,
    );
  }
  if (!parts.length) return null;
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-sm text-muted-foreground">{parts}</div>
  );
}

/**
 * Where the job is. Kentucky rows read as before; a row from another state (Tennessee) names
 * it unless the place already does ("Pikeville, Bledsoe County, TN").
 */
function placeLine(l: LeadRow): string {
  const place = l.location ?? [l.address, l.city].filter(Boolean).join(", ");
  if (!place || !l.state || l.state === "KY") return place;
  const named = new RegExp(`\\b(${l.state}|Tennessee)\\b`).test(place);
  return named ? place : `${place}, ${l.state}`;
}

const STATUS_WORD: Record<string, string> = {
  new: "Marked new",
  watching: "Watching",
  dismissed: "Dismissed",
  added: "Added to prospects",
};

export function LeadCard(props: {
  lead: LeadRow;
  canWrite: boolean;
  /** Status or note change; the page runs the mutation and toasts. */
  onStatus: (status: LeadStatus, note?: string | null) => void;
  /** A status change is in flight for this lead. */
  busy: boolean;
}) {
  const l = props.lead;
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState(l.note ?? "");
  const status = l.status as LeadStatus;

  // Only a page on the source site is a link; a permit's in-app map address is not shown.
  const href = l.url && !l.url.startsWith("/") ? l.url : null;
  const open = () => {
    if (href) window.open(href, "_blank", "noopener,noreferrer");
  };
  // "New" is a recent arrival nobody has acted on: first seen in the last three days and
  // neither watched nor dismissed.
  const isNew = status === "new" && Date.now() - Date.parse(l.first_seen_at) < 3 * DAY;
  const stop = (e: SyntheticEvent) => e.stopPropagation();

  const who = [
    l.agency ?? (l.contractor ? `Contractor ${l.contractor}` : null),
    placeLine(l),
    l.project_type,
    l.sqft != null ? `${Math.round(l.sqft).toLocaleString()} sq ft` : null,
    l.project_cost != null && l.project_cost > 0 ? formatCost(l.project_cost) : null,
  ].filter(Boolean);

  const saveNote = () => {
    const next = note.trim();
    if (next === (l.note ?? "").trim()) return;
    props.onStatus(status, next || null);
  };

  return (
    <div
      role={href ? "link" : undefined}
      tabIndex={href ? 0 : undefined}
      title={href ? `Open on the ${SOURCE_LABELS[l.source] ?? l.source} site` : undefined}
      className={`space-y-2 rounded-lg border p-4 transition-all duration-150 ${
        href
          ? "cursor-pointer hover:border-primary/40 hover:bg-muted/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          : ""
      } ${l.gone_at || status === "dismissed" ? "opacity-70" : ""}`}
      onClick={open}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          open();
        }
      }}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant="outline">{SOURCE_LABELS[l.source] ?? l.source}</Badge>
        {isNew && <Badge>New</Badge>}
        {status === "watching" && <Badge variant="secondary">Watching</Badge>}
        {l.gone_at && (
          <Badge variant="outline" className="text-muted-foreground">
            No longer listed
          </Badge>
        )}
      </div>

      <div className="space-y-0.5">
        <div className="font-semibold leading-snug">{l.title}</div>
        {who.length > 0 && <div className="text-sm text-muted-foreground">{who.join(" · ")}</div>}
      </div>

      <BidLine lead={l} />

      {l.contact ? (
        <p className="text-sm">
          <span className="font-medium">Contact:</span> {l.contact}
        </p>
      ) : l.source === "ky_planroom" || l.source === "lynn_bids" ? (
        <p className="text-xs text-muted-foreground">
          Bid documents, the owner's contact and the plan-holder list are on the planroom job page
          (free sign-in); the nightly check fills them in here once the server has a login.
        </p>
      ) : null}

      {l.note && !noteOpen && (
        <p className="whitespace-pre-wrap text-sm italic text-muted-foreground">{l.note}</p>
      )}

      {noteOpen && (
        <Textarea
          rows={2}
          autoFocus
          className="text-sm"
          placeholder="Who to call, what the scope looks like…"
          value={note}
          maxLength={2000}
          onClick={stop}
          onKeyDown={stop}
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => {
            saveNote();
            setNoteOpen(false);
          }}
        />
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs text-muted-foreground">
          Seen {shortDate(l.first_seen_at)}
          {l.status_by_name && l.status_at && (
            <>
              {" · "}
              {STATUS_WORD[status] ?? status} — {l.status_by_name}, {shortDate(l.status_at)}
            </>
          )}
        </div>

        {props.canWrite && (
          <div className="flex flex-wrap gap-1.5" onClick={stop} onKeyDown={stop}>
            {props.busy && <Loader2 className="h-4 w-4 animate-spin self-center" />}
            {status !== "dismissed" &&
              (status === "watching" ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={props.busy}
                  onClick={() => props.onStatus("new")}
                >
                  <EyeOff className="mr-1 h-3.5 w-3.5" /> Unwatch
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={props.busy}
                  onClick={() => props.onStatus("watching")}
                >
                  <Eye className="mr-1 h-3.5 w-3.5" /> Watch
                </Button>
              ))}
            {status === "dismissed" ? (
              <Button
                size="sm"
                variant="outline"
                disabled={props.busy}
                onClick={() => props.onStatus("new")}
              >
                <Undo2 className="mr-1 h-3.5 w-3.5" /> Restore
              </Button>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                disabled={props.busy}
                onClick={() => props.onStatus("dismissed")}
              >
                <X className="mr-1 h-3.5 w-3.5" /> Dismiss
              </Button>
            )}
            <Button
              size="sm"
              variant={noteOpen ? "secondary" : "ghost"}
              // Keep the note box focused so its blur does not save and close it first.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                if (noteOpen) saveNote();
                else setNote(l.note ?? "");
                setNoteOpen(!noteOpen);
              }}
            >
              <StickyNote className="mr-1 h-3.5 w-3.5" />{" "}
              {noteOpen ? "Save note" : l.note ? "Edit note" : "Note"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
