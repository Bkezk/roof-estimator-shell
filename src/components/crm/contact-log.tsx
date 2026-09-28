/**
 * Contact log and untouched work on the page (owner, Sep 28: things get assigned and sit; we
 * need to see that people have been contacted or jobs have been initiated). The backend is
 * lib/contact-log.functions.ts; these are its shared pieces for the ticket, opportunity and
 * follow-up pages:
 *
 * - LogContactButtons: one tap = one contact logged (Called / Texted / Emailed / Visited, with an
 *   optional note). The database stamps the item, moves an Open opportunity to Contacted and
 *   writes the ticket timeline entry, so every list that shows the item is refreshed after it.
 * - ContactLogList: the item's past contacts, newest first.
 * - LatestContact: only the most recent contact on one line, with "Show all (N)" for the list.
 * - UntouchedBadge: muted before the admin limit, red at or past it.
 * - NeedsActionStrip: what has sat past the admin limit with no contact and not started (owner,
 *   Sep 28: not on day one — the row badge is the quiet hint until then).
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Loader2,
  Mail,
  MapPin,
  MessageSquare,
  Phone,
  Plus,
  X,
} from "lucide-react";

import { useAuth } from "@/lib/auth-store";
import {
  CONTACT_METHOD_LABELS,
  CONTACT_METHODS,
  daysSince,
  isPastLimit,
  listContactLog,
  listUntouched,
  logContact,
  type ContactKind,
  type ContactMethod,
  type UntouchedRow,
} from "@/lib/contact-log.functions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const whenShort = (iso: string) =>
  new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
const asMethod = (s: string): ContactMethod =>
  (CONTACT_METHODS as readonly string[]).includes(s) ? (s as ContactMethod) : "other";

/**
 * Map key of an untouched row: `${kind}:${id}`. The pages load listUntouched under the query key
 * ["untouched"] (shared with NeedsActionStrip, one request) and match their rows by this key.
 */
// eslint-disable-next-line react-refresh/only-export-components -- the one shared helper; the spec keeps it beside the badge
export const untouchedKey = (kind: string, id: string) => `${kind}:${id}`;

/** The one-tap buttons, in the order the office uses them. */
const BUTTONS: { method: ContactMethod; icon: typeof Phone }[] = [
  { method: "called", icon: Phone },
  { method: "texted", icon: MessageSquare },
  { method: "emailed", icon: Mail },
  { method: "visited", icon: MapPin },
];

/**
 * Every list that shows a ticket or an opportunity, the ticket timeline, the follow-ups and the
 * untouched strip: a logged contact changes all of them.
 */
const REFRESH_KEYS: readonly (readonly string[])[] = [
  ["service-jobs"],
  ["service-job"],
  ["service-job-events"],
  ["service-today"],
  ["opportunities"],
  ["opportunity"],
  ["untouched"],
  ["followups"],
  ["contact-log"],
];

export function LogContactButtons({
  kind,
  itemId,
  compact,
  onLogged,
}: {
  kind: ContactKind;
  itemId: string;
  /** Icon-only buttons (labels in the tooltip). */
  compact?: boolean | undefined;
  onLogged?: ((method: ContactMethod) => void) | undefined;
}) {
  const qc = useQueryClient();
  const logFn = useServerFn(logContact);
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState("");

  const log = useMutation({
    mutationFn: (method: ContactMethod) => {
      const n = note.trim();
      return logFn({ data: { kind, item_id: itemId, method, ...(n ? { note: n } : {}) } });
    },
    onSuccess: (_row, method) => {
      toast.success(`Logged: ${CONTACT_METHOD_LABELS[method]}`);
      setNote("");
      setNoteOpen(false);
      for (const queryKey of REFRESH_KEYS) void qc.invalidateQueries({ queryKey });
      onLogged?.(method);
    },
    onError: (e) => toast.error(`Could not log the contact: ${errText(e)}`, { duration: 12_000 }),
  });

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {BUTTONS.map(({ method, icon: Icon }) => {
          const label = CONTACT_METHOD_LABELS[method];
          const busy = log.isPending && log.variables === method;
          return (
            <Button
              key={method}
              type="button"
              size="sm"
              variant="outline"
              className={compact ? "h-8 w-8 p-0" : "h-8"}
              disabled={log.isPending}
              title={`Log: ${label}${note.trim() ? " (with the note)" : ""}`}
              aria-label={`Log: ${label}`}
              onClick={() => log.mutate(method)}
            >
              {busy ? (
                <Loader2 className={`h-4 w-4 animate-spin${compact ? "" : " mr-1"}`} />
              ) : (
                <Icon className={`h-4 w-4${compact ? "" : " mr-1"}`} />
              )}
              {!compact && label}
            </Button>
          );
        })}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-8 px-2 text-xs text-muted-foreground"
          aria-expanded={noteOpen}
          disabled={log.isPending}
          onClick={() => setNoteOpen((v) => !v)}
        >
          {noteOpen ? <X className="mr-1 h-3.5 w-3.5" /> : <Plus className="mr-1 h-3.5 w-3.5" />}
          {noteOpen ? "No note" : "note"}
        </Button>
      </div>
      {noteOpen && (
        <div className="space-y-1">
          <Textarea
            rows={2}
            value={note}
            maxLength={2000}
            autoFocus
            placeholder="e.g. Left a voicemail, will call back Tuesday"
            aria-label="Note for the contact"
            onChange={(e) => setNote(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Then pick how you reached them; the note is saved with it.
          </p>
        </div>
      )}
    </div>
  );
}

export function ContactLogList({ kind, itemId }: { kind: ContactKind; itemId: string }) {
  const { session } = useAuth();
  const listFn = useServerFn(listContactLog);
  const q = useQuery({
    queryKey: ["contact-log", kind, itemId],
    queryFn: () => listFn({ data: { kind, item_id: itemId } }),
    enabled: !!session,
  });
  if (q.error)
    return (
      <p className="text-xs text-destructive">Could not load the contact log: {errText(q.error)}</p>
    );
  if (q.isLoading || !q.data)
    return (
      <p className="flex items-center gap-1 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading the contact log…
      </p>
    );
  if (q.data.length === 0)
    return <p className="text-xs text-muted-foreground">No contact logged yet</p>;
  // The server returns newest first.
  return (
    <ul className="space-y-1 text-xs">
      {q.data.map((r) => (
        <li key={r.id}>
          <span className="font-medium">{CONTACT_METHOD_LABELS[asMethod(r.method)]}</span>
          <span className="text-muted-foreground">
            {" "}
            · {whenShort(r.at)}
            {r.by_name ? ` · ${r.by_name}` : ""}
          </span>
          {r.note ? <span className="whitespace-pre-line"> — {r.note}</span> : null}
        </li>
      ))}
    </ul>
  );
}

/**
 * The most recent contact on one line ("Last: Called · Sep 28, 2:10 PM · Braden Keck") and a
 * "Show all (N)" toggle that opens the full ContactLogList. Same query as the list, so the two
 * share the cache. Every button is type="button" (it sits inside the ticket's form).
 */
export function LatestContact({ kind, itemId }: { kind: ContactKind; itemId: string }) {
  const { session } = useAuth();
  const listFn = useServerFn(listContactLog);
  const q = useQuery({
    queryKey: ["contact-log", kind, itemId],
    queryFn: () => listFn({ data: { kind, item_id: itemId } }),
    enabled: !!session,
  });
  const [showAll, setShowAll] = useState(false);
  if (q.error)
    return (
      <p className="text-xs text-destructive">Could not load the contact log: {errText(q.error)}</p>
    );
  if (q.isLoading || !q.data)
    return (
      <p className="flex items-center gap-1 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading the contact log…
      </p>
    );
  // The server returns newest first.
  const [last] = q.data;
  if (!last) return <p className="text-xs text-muted-foreground">No contact logged yet</p>;
  const Chevron = showAll ? ChevronDown : ChevronRight;
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        {!showAll && (
          <p className="min-w-0 truncate text-xs" title={last.note ?? undefined}>
            <span className="text-muted-foreground">Last: </span>
            <span className="font-medium">{CONTACT_METHOD_LABELS[asMethod(last.method)]}</span>
            <span className="text-muted-foreground">
              {" "}
              · {whenShort(last.at)}
              {last.by_name ? ` · ${last.by_name}` : ""}
            </span>
            {last.note ? <span> — {last.note}</span> : null}
          </p>
        )}
        {(q.data.length > 1 || !!last.note) && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            aria-expanded={showAll}
            onClick={() => setShowAll((v) => !v)}
          >
            <Chevron className="mr-1 h-3.5 w-3.5" />
            {showAll ? "Show less" : `Show all (${q.data.length})`}
          </Button>
        )}
      </div>
      {showAll && <ContactLogList kind={kind} itemId={itemId} />}
    </div>
  );
}

export function UntouchedBadge({
  assignedAt,
  limitDays,
}: {
  assignedAt: string | null;
  limitDays: number;
}) {
  const d = daysSince(assignedAt);
  if (d !== null && d >= limitDays)
    return (
      <Badge
        variant="destructive"
        className="px-1.5 py-0 text-[11px]"
        title={`Assigned ${d} day${d === 1 ? "" : "s"} ago with no contact logged and not started (limit ${limitDays}d)`}
      >
        Untouched {d}d
      </Badge>
    );
  return (
    <Badge
      variant="outline"
      className="px-1.5 py-0 text-[11px] font-medium text-muted-foreground"
      title={`No contact logged and not started yet; turns red after ${limitDays} day${limitDays === 1 ? "" : "s"}`}
    >
      No contact{d === null ? "" : ` · assigned ${d === 0 ? "today" : `${d}d ago`}`}
    </Badge>
  );
}

const OPEN_KEY = "bid-o-matic:needs-action-open";
const readOpen = () => {
  try {
    return window.localStorage.getItem(OPEN_KEY) !== "0";
  } catch {
    return true;
  }
};
const writeOpen = (open: boolean) => {
  try {
    window.localStorage.setItem(OPEN_KEY, open ? "1" : "0");
  } catch {
    // Storage unavailable (private mode, blocked site data) — the toggle still works this visit.
  }
};

/** The row's page: `/service?id=…` and `/opportunities?id=…` as in-app links. */
function UntouchedLink({ row }: { row: UntouchedRow }) {
  const cls = "font-medium underline-offset-2 hover:underline";
  let path = "";
  let id: string | null = null;
  try {
    const u = new URL(row.url, "http://app.local");
    path = u.pathname;
    id = u.searchParams.get("id");
  } catch {
    // Not a url we know; fall through to plain text.
  }
  if (id && path === "/service")
    return (
      <Link to="/service" search={{ id }} className={cls} title="Open this ticket">
        {row.title}
      </Link>
    );
  if (id && path === "/opportunities")
    return (
      <Link to="/opportunities" search={{ id }} className={cls} title="Open this opportunity">
        {row.title}
      </Link>
    );
  return <span className="font-medium">{row.title}</span>;
}

export function NeedsActionStrip({
  kinds,
  title,
}: {
  kinds?: ContactKind[] | undefined;
  title?: string | undefined;
}) {
  const { session } = useAuth();
  const listFn = useServerFn(listUntouched);
  const q = useQuery({ queryKey: ["untouched"], queryFn: () => listFn(), enabled: !!session });
  const [open, setOpenState] = useState<boolean>(readOpen);
  const toggle = () =>
    setOpenState((v) => {
      writeOpen(!v);
      return !v;
    });

  const rows = useMemo(() => {
    const now = new Date();
    const wanted = kinds ?? ["ticket", "opportunity"];
    // Only past the limit: an item assigned this morning is not "needs action" yet.
    return (q.data ?? [])
      .filter((r) => (wanted as string[]).includes(r.kind) && isPastLimit(r, now))
      .sort((a, b) => (a.assigned_at ?? "9999").localeCompare(b.assigned_at ?? "9999"));
  }, [q.data, kinds]);

  if (q.error)
    return (
      <p className="text-sm text-destructive">
        Could not load the untouched items: {errText(q.error)}
      </p>
    );
  if (rows.length === 0) return null;
  const Chevron = open ? ChevronDown : ChevronRight;
  const showKind = (kinds ?? ["ticket", "opportunity"]).length > 1;

  return (
    <section className="rounded-lg border border-destructive/50" aria-label="Needs action">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 px-4 py-2 text-left font-semibold"
        aria-expanded={open}
        onClick={toggle}
      >
        <span className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-destructive" />
          {title ?? "Needs action"} · {rows.length} untouched past the limit
        </span>
        <span className="flex items-center gap-1 text-xs font-normal text-muted-foreground">
          {open ? "Hide" : "Show"}
          <Chevron className="h-3.5 w-3.5" />
        </span>
      </button>
      {open && (
        <div className="space-y-2 border-t p-3">
          <p className="text-xs text-muted-foreground">
            Assigned longer than the limit with no contact logged and not started. Open it and log
            the call, text, email or visit, or schedule it.
          </p>
          <ul className="divide-y">
            {rows.map((r) => (
              <li
                key={untouchedKey(r.kind, r.item_id)}
                className="flex flex-wrap items-center gap-x-2 gap-y-1 py-1.5 text-sm"
              >
                {showKind && (
                  <Badge variant="outline" className="px-1.5 py-0 text-[11px] font-medium">
                    {r.kind === "ticket" ? "Ticket" : "Opportunity"}
                  </Badge>
                )}
                <UntouchedLink row={r} />
                {r.account_name && (
                  <span className="text-muted-foreground">· {r.account_name}</span>
                )}
                <span className="text-muted-foreground">· {r.assignee_name ?? "Unassigned"}</span>
                <span className="ml-auto">
                  <UntouchedBadge assignedAt={r.assigned_at} limitDays={r.limit_days} />
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
