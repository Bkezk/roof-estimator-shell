/**
 * The Notifications page, /notifications (owner, Oct 12): the whole inbox, not the bell's latest
 * 30. Header with the real unread count and Mark all read; Unread / All and a kind filter built
 * from the kinds seen so far; the list grouped by day (Today / Yesterday / date), each row with
 * its kind chip, a link that opens the item and marks it read, and Mark read / Mark unread (an
 * unread row is a to-do, so a read one can be made unread again); Load more pages by keyset.
 * Reached from the bell's "See all" and the Account page — not the sidebar.
 */
import { useMemo, useState, type MouseEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useRouter } from "@tanstack/react-router";
import { format } from "date-fns";
import { Check, Loader2, Mail, MailOpen } from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/lib/auth-store";
import {
  NOTIFICATIONS_PAGE,
  cursorOf,
  groupByDay,
  kindChips,
  kindLabel,
  listMyNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  unreadNotificationCount,
  type NotificationRow,
} from "@/lib/notifications.functions";
import { cn } from "@/lib/utils";
import { NOTIFICATIONS_QUERY_KEY, UNREAD_COUNT_QUERY_KEY } from "@/components/notifications-bell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Follow a row's url inside the app (same-origin) or by a plain navigation; modifier clicks pass. */
function useFollow() {
  const router = useRouter();
  return (e: MouseEvent<HTMLAnchorElement>, url: string) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
      return;
    let target: URL;
    try {
      target = new URL(url, window.location.origin);
    } catch {
      return;
    }
    e.preventDefault();
    if (target.origin === window.location.origin) {
      void router.navigate({ href: target.pathname + target.search + target.hash });
    } else {
      window.location.assign(target.href);
    }
  };
}

type Filter = { unreadOnly: boolean; kinds: string[] | null };

export function NotificationsPage() {
  const { session } = useAuth();
  const qc = useQueryClient();
  const listFn = useServerFn(listMyNotifications);
  const countFn = useServerFn(unreadNotificationCount);
  const markFn = useServerFn(markNotificationRead);
  const markAllFn = useServerFn(markAllNotificationsRead);
  const follow = useFollow();

  const [unreadOnly, setUnreadOnly] = useState(false);
  const [kindFilter, setKindFilter] = useState<{ label: string; kinds: string[] } | null>(null);
  // Every kind string seen in any page so far, so the chips survive a narrowing filter.
  const [seenKinds, setSeenKinds] = useState<ReadonlySet<string>>(new Set());
  // Pages after the first, for the current filter (reset when the filter changes).
  const [older, setOlder] = useState<{ key: string; rows: NotificationRow[] }>({
    key: "",
    rows: [],
  });
  const [loadingOlder, setLoadingOlder] = useState(false);

  const filter: Filter = { unreadOnly, kinds: kindFilter?.kinds ?? null };
  const filterKey = JSON.stringify(filter);
  const args = {
    limit: NOTIFICATIONS_PAGE,
    ...(unreadOnly ? { unreadOnly: true } : {}),
    ...(filter.kinds ? { kind: filter.kinds } : {}),
  };

  const first = useQuery({
    queryKey: [...NOTIFICATIONS_QUERY_KEY, "inbox", filter],
    queryFn: async () => {
      const rows = await listFn({ data: args });
      setSeenKinds((s) => {
        const next = new Set(s);
        for (const r of rows) next.add(r.kind);
        return next.size === s.size ? s : next;
      });
      return rows;
    },
    enabled: !!session,
  });
  const count = useQuery({
    queryKey: UNREAD_COUNT_QUERY_KEY,
    queryFn: () => countFn(),
    enabled: !!session,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });

  const firstRows = useMemo(() => first.data ?? [], [first.data]);
  // Older pages count only while they belong to the filter shown.
  const olderRows = useMemo(() => (older.key === filterKey ? older.rows : []), [older, filterKey]);
  const rows = useMemo(() => [...firstRows, ...olderRows], [firstRows, olderRows]);
  const lastPage = olderRows.length ? olderRows : firstRows;
  const hasMore = first.isFetched && lastPage.length >= NOTIFICATIONS_PAGE;
  const groups = useMemo(() => groupByDay(rows), [rows]);
  const chips = useMemo(() => kindChips(seenKinds), [seenKinds]);
  const unread = count.data ?? 0;

  const loadMore = async () => {
    const oldest = rows[rows.length - 1];
    if (!oldest || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const page = await listFn({ data: { ...args, before: cursorOf(oldest) } });
      setOlder((o) => ({
        key: filterKey,
        rows: [...(o.key === filterKey ? o.rows : []), ...page],
      }));
      setSeenKinds((s) => {
        const next = new Set(s);
        for (const r of page) next.add(r.kind);
        return next.size === s.size ? s : next;
      });
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setLoadingOlder(false);
    }
  };

  /** Patch one row everywhere it is shown (the first page's cache and the older pages). */
  const patch = (id: number, read_at: string | null) => {
    qc.setQueriesData<NotificationRow[]>(
      { queryKey: [...NOTIFICATIONS_QUERY_KEY, "inbox"] },
      (old) => old?.map((r) => (r.id === id ? { ...r, read_at } : r)),
    );
    qc.setQueryData<NotificationRow[]>(NOTIFICATIONS_QUERY_KEY, (old) =>
      old?.map((r) => (r.id === id ? { ...r, read_at } : r)),
    );
    setOlder((o) => ({ ...o, rows: o.rows.map((r) => (r.id === id ? { ...r, read_at } : r)) }));
  };

  const toggle = useMutation({
    mutationFn: (v: { id: number; read: boolean }) => markFn({ data: v }),
    onMutate: (v) => {
      const before = rows.find((r) => r.id === v.id)?.read_at ?? null;
      patch(v.id, v.read ? new Date().toISOString() : null);
      qc.setQueryData<number>(UNREAD_COUNT_QUERY_KEY, (n) =>
        n === undefined ? n : Math.max(0, n + (v.read ? -1 : 1)),
      );
      return { before };
    },
    onError: (e, v, ctx) => {
      patch(v.id, ctx?.before ?? null);
      toast.error(errText(e));
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: UNREAD_COUNT_QUERY_KEY }),
  });

  const markAll = useMutation({
    mutationFn: () => markAllFn(),
    onMutate: () => {
      const now = new Date().toISOString();
      const fill = (old?: NotificationRow[]) =>
        old?.map((r) => (r.read_at ? r : { ...r, read_at: now }));
      qc.setQueriesData<NotificationRow[]>(
        { queryKey: [...NOTIFICATIONS_QUERY_KEY, "inbox"] },
        fill,
      );
      qc.setQueryData<NotificationRow[]>(NOTIFICATIONS_QUERY_KEY, fill);
      setOlder((o) => ({ ...o, rows: fill(o.rows) ?? [] }));
      qc.setQueryData<number>(UNREAD_COUNT_QUERY_KEY, 0);
    },
    onError: (e) => toast.error(errText(e)),
    onSettled: () => void qc.invalidateQueries({ queryKey: NOTIFICATIONS_QUERY_KEY }),
  });

  /** Opening an item reads it (the server call rides along; the navigation does not wait). */
  const open = (e: MouseEvent<HTMLAnchorElement>, r: NotificationRow) => {
    if (!r.read_at) toggle.mutate({ id: r.id, read: true });
    follow(e, r.url ?? "/");
  };

  const pickUnread = (v: boolean) => setUnreadOnly(v);
  const pickKind = (c: { label: string; kinds: string[] } | null) =>
    setKindFilter((cur) => (c && cur?.label === c.label ? null : c));

  return (
    <div className="mx-auto w-full min-w-0 max-w-2xl space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Notifications</h1>
          <p className="text-sm text-muted-foreground">
            {count.isPending
              ? "Counting…"
              : unread === 0
                ? "Nothing unread"
                : unread === 1
                  ? "1 unread"
                  : `${unread} unread`}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => markAll.mutate()}
          disabled={markAll.isPending || unread === 0}
        >
          <Check /> Mark all read
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filters">
        <Chip active={unreadOnly} onClick={() => pickUnread(true)}>
          Unread
        </Chip>
        <Chip active={!unreadOnly} onClick={() => pickUnread(false)}>
          All
        </Chip>
        {chips.length > 0 && <span className="mx-1 h-4 w-px bg-border" aria-hidden />}
        {chips.map((c) => (
          <Chip key={c.label} active={kindFilter?.label === c.label} onClick={() => pickKind(c)}>
            {c.label}
          </Chip>
        ))}
      </div>

      {first.isPending ? (
        <div className="flex justify-center p-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : first.isError && !rows.length ? (
        <p className="rounded-md border p-4 text-sm text-destructive">{errText(first.error)}</p>
      ) : !rows.length ? (
        <p className="rounded-md border p-6 text-center text-sm text-muted-foreground">
          {unreadOnly ? "Nothing unread." : "No notifications yet."}
        </p>
      ) : (
        <div className="space-y-5">
          {groups.map((g) => (
            <section key={g.label} aria-label={g.label}>
              <h2 className="mb-1 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {g.label}
              </h2>
              <ul className="divide-y rounded-md border bg-card">
                {g.rows.map((r) => (
                  <NotificationItem
                    key={r.id}
                    row={r}
                    onOpen={open}
                    onToggle={() => toggle.mutate({ id: r.id, read: !r.read_at })}
                  />
                ))}
              </ul>
            </section>
          ))}
          {hasMore && (
            <div className="flex justify-center">
              <Button variant="outline" onClick={() => void loadMore()} disabled={loadingOlder}>
                {loadingOlder ? "Loading…" : "Load more"}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "bg-background text-foreground hover:bg-accent hover:text-accent-foreground",
      )}
    >
      {children}
    </button>
  );
}

function timeOf(iso: string): string {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? format(t, "h:mm a") : "";
}

function NotificationItem({
  row: r,
  onOpen,
  onToggle,
}: {
  row: NotificationRow;
  onOpen: (e: MouseEvent<HTMLAnchorElement>, r: NotificationRow) => void;
  onToggle: () => void;
}) {
  const unread = !r.read_at;
  const body = (
    <>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <p className={cn("min-w-0 flex-1 text-sm", unread ? "font-semibold" : "font-normal")}>
          {r.title}
        </p>
        <Badge variant="secondary" className="shrink-0 font-medium">
          {kindLabel(r.kind)}
        </Badge>
      </div>
      {r.body && (
        <p
          className={cn(
            "mt-0.5 line-clamp-3 text-xs",
            unread ? "text-foreground" : "text-muted-foreground",
          )}
        >
          {r.body}
        </p>
      )}
      <p className="mt-1 text-[11px] text-muted-foreground">
        <time dateTime={r.created_at}>{timeOf(r.created_at)}</time>
      </p>
    </>
  );
  return (
    <li className="flex items-start gap-2 px-3 py-2">
      <span
        className={cn(
          "mt-2 h-2 w-2 shrink-0 rounded-full",
          unread ? "bg-primary" : "bg-transparent",
        )}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        {r.url ? (
          <a
            href={r.url}
            onClick={(e) => onOpen(e, r)}
            className="-mx-1 block rounded px-1 hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
          >
            {body}
          </a>
        ) : (
          <div>{body}</div>
        )}
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 shrink-0"
        onClick={onToggle}
        aria-label={unread ? "Mark read" : "Mark unread"}
        title={unread ? "Mark read" : "Mark unread"}
      >
        {unread ? <MailOpen className="h-4 w-4" /> : <Mail className="h-4 w-4" />}
      </Button>
    </li>
  );
}
