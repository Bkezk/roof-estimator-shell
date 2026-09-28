/**
 * One construction lead on the Leads page (owner, Sep 28): a state planroom job with its bid
 * countdown, or a Louisville commercial permit with its size and cost. The whole card opens the
 * lead's own page on the source site; the buttons (Watch, Dismiss, Add to prospects, Note) do
 * their own thing and never trigger the card.
 */
import { useState, type ReactNode, type SyntheticEvent } from "react";
import { Link } from "@tanstack/react-router";
import { Building2, Eye, EyeOff, Loader2, Plus, StickyNote, Undo2, X } from "lucide-react";

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
    parts.push(
      <span key="issued">
        Permit issued {issued} ({agoText})
      </span>,
    );
  }
  if (!parts.length) return null;
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-sm text-muted-foreground">{parts}</div>
  );
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
  onAdd: () => void;
  /** A status change or an add is in flight for this lead. */
  busy: boolean;
}) {
  const l = props.lead;
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState(l.note ?? "");
  const status = l.status as LeadStatus;

  const open = () => {
    if (l.url) window.open(l.url, "_blank", "noopener,noreferrer");
  };
  const stop = (e: SyntheticEvent) => e.stopPropagation();

  const who = [
    l.agency ?? (l.contractor ? `Contractor ${l.contractor}` : null),
    l.location ?? [l.address, l.city].filter(Boolean).join(", "),
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
      role={l.url ? "link" : undefined}
      tabIndex={l.url ? 0 : undefined}
      title={l.url ? `Open on the ${SOURCE_LABELS[l.source] ?? l.source} site` : undefined}
      className={`space-y-2 rounded-lg border p-4 transition-all duration-150 ${
        l.url
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
        {l.is_roof && <Badge variant="destructive">Roof</Badge>}
        {status === "new" && <Badge>New</Badge>}
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
            {status !== "added" &&
              status !== "dismissed" &&
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
              status !== "added" && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={props.busy}
                  onClick={() => props.onStatus("dismissed")}
                >
                  <X className="mr-1 h-3.5 w-3.5" /> Dismiss
                </Button>
              )
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
            {l.building_id ? (
              <Button asChild size="sm" variant="outline">
                <Link to="/prospect" search={{ building: l.building_id }}>
                  <Building2 className="mr-1 h-3.5 w-3.5" /> Open building
                </Link>
              </Button>
            ) : (
              <Button size="sm" disabled={props.busy} onClick={props.onAdd}>
                <Plus className="mr-1 h-3.5 w-3.5" /> Add to prospects
              </Button>
            )}
          </div>
        )}
        {!props.canWrite && l.building_id && (
          <Button asChild size="sm" variant="outline" onClick={stop}>
            <Link to="/prospect" search={{ building: l.building_id }}>
              <Building2 className="mr-1 h-3.5 w-3.5" /> Open building
            </Link>
          </Button>
        )}
      </div>
    </div>
  );
}
