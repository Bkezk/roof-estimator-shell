/**
 * The header bell: the real unread count (unreadNotificationCount, "99+" past two digits), the
 * latest notifications in a popover, "Mark all read" and "See all" (the /notifications page).
 * Opening the popover marks nothing read (owner, Oct 12: an unread row is a to-do) — a row is
 * read when it is clicked. Polls once a minute while the tab is visible — React Query pauses the
 * interval in a background tab — and refreshes at once when the service worker reports an
 * incoming push. Also registers the service worker (public/sw.js) once per page load.
 */
import { useEffect, useState, type MouseEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link, useRouter } from "@tanstack/react-router";
import { formatDistanceToNow } from "date-fns";
import { Bell, Loader2 } from "lucide-react";

import { useAuth } from "@/lib/auth-store";
import {
  listMyNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  unreadBadge,
  unreadNotificationCount,
  type NotificationRow,
} from "@/lib/notifications.functions";
import { registerServiceWorker } from "@/lib/push-client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/** The latest rows (the bell's list); the page's queries live under it, so one invalidation does all. */
export const NOTIFICATIONS_QUERY_KEY = ["notifications"] as const;
/** The real unread count, shared by the bell's badge and the page's header. */
export const UNREAD_COUNT_QUERY_KEY = ["notifications", "unread-count"] as const;
const LIMIT = 30;

function when(iso: string): string {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? formatDistanceToNow(t, { addSuffix: true }) : "";
}

export function NotificationsBell() {
  const { session } = useAuth();
  const qc = useQueryClient();
  const router = useRouter();
  const listFn = useServerFn(listMyNotifications);
  const countFn = useServerFn(unreadNotificationCount);
  const markFn = useServerFn(markNotificationRead);
  const markAllFn = useServerFn(markAllNotificationsRead);
  const [open, setOpen] = useState(false);

  const q = useQuery({
    queryKey: NOTIFICATIONS_QUERY_KEY,
    queryFn: () => listFn({ data: { limit: LIMIT } }),
    enabled: !!session,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });
  const count = useQuery({
    queryKey: UNREAD_COUNT_QUERY_KEY,
    queryFn: () => countFn(),
    enabled: !!session,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });
  const rows = q.data ?? [];
  const unread = count.data ?? 0;

  useEffect(() => {
    void registerServiceWorker();
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    const onMessage = (e: MessageEvent) => {
      const d = e.data as { type?: unknown } | null;
      if (d?.type === "bid-o-matic:notification") {
        void qc.invalidateQueries({ queryKey: NOTIFICATIONS_QUERY_KEY });
      }
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [qc]);

  const settle = () => void qc.invalidateQueries({ queryKey: NOTIFICATIONS_QUERY_KEY });

  /** One row read now: the list and the badge change at once, the server call follows. */
  const markRead = (id: number) => {
    const now = new Date().toISOString();
    qc.setQueryData<NotificationRow[]>(NOTIFICATIONS_QUERY_KEY, (old) =>
      old?.map((r) => (r.id === id && !r.read_at ? { ...r, read_at: now } : r)),
    );
    qc.setQueryData<number>(UNREAD_COUNT_QUERY_KEY, (n) =>
      n === undefined ? n : Math.max(0, n - 1),
    );
    markFn({ data: { id, read: true } })
      .catch((e: unknown) => console.error("Could not mark the notification read", e))
      .finally(settle);
  };

  const markAll = () => {
    const now = new Date().toISOString();
    qc.setQueryData<NotificationRow[]>(NOTIFICATIONS_QUERY_KEY, (old) =>
      old?.map((r) => (r.read_at ? r : { ...r, read_at: now })),
    );
    qc.setQueryData<number>(UNREAD_COUNT_QUERY_KEY, 0);
    markAllFn()
      .catch((e: unknown) => console.error("Could not mark notifications read", e))
      .finally(settle);
  };

  const follow = (e: MouseEvent<HTMLAnchorElement>, r: NotificationRow) => {
    // Opening the item reads it, however the click opens it.
    if (!r.read_at) markRead(r.id);
    // Let ctrl/cmd/shift/middle-click open a new tab as usual.
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
      return;
    let target: URL;
    try {
      target = new URL(r.url ?? "/", window.location.origin);
    } catch {
      return;
    }
    e.preventDefault();
    setOpen(false);
    if (target.origin === window.location.origin) {
      void router.navigate({ href: target.pathname + target.search + target.hash });
    } else {
      window.location.assign(target.href);
    }
  };

  const badge = unreadBadge(unread);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
        >
          <Bell className="h-5 w-5" />
          {unread > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-none text-white">
              {badge}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(22rem,calc(100vw-2rem))] p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-sm font-semibold">Notifications</span>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={markAll}
            disabled={!unread}
          >
            Mark all read
          </Button>
        </div>
        <div className="max-h-[min(24rem,70svh)] overflow-y-auto">
          {q.isPending ? (
            <div className="flex justify-center p-6">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : q.isError && !rows.length ? (
            <p className="p-4 text-sm text-muted-foreground">Could not load notifications.</p>
          ) : !rows.length ? (
            <p className="p-4 text-sm text-muted-foreground">No notifications yet.</p>
          ) : (
            <ul className="divide-y">
              {rows.map((r) => {
                const bold = !r.read_at;
                const inner = (
                  <div className="flex items-start gap-2">
                    {bold && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" />}
                    <div className="min-w-0 flex-1">
                      <p className={cn("text-sm", bold ? "font-semibold" : "font-normal")}>
                        {r.title}
                      </p>
                      {r.body && (
                        <p
                          className={cn(
                            "mt-0.5 line-clamp-3 text-xs",
                            bold ? "text-foreground" : "text-muted-foreground",
                          )}
                        >
                          {r.body}
                        </p>
                      )}
                      <p className="mt-1 text-[11px] text-muted-foreground">{when(r.created_at)}</p>
                    </div>
                  </div>
                );
                return (
                  <li key={r.id}>
                    {r.url ? (
                      <a
                        href={r.url}
                        onClick={(e) => follow(e, r)}
                        className="block px-3 py-2 hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                      >
                        {inner}
                      </a>
                    ) : bold ? (
                      // Nothing to open: the click itself reads it.
                      <button
                        type="button"
                        onClick={() => markRead(r.id)}
                        className="block w-full px-3 py-2 text-left hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                      >
                        {inner}
                      </button>
                    ) : (
                      <div className="px-3 py-2">{inner}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <div className="border-t px-3 py-2 text-center">
          <Link
            to="/notifications"
            onClick={() => setOpen(false)}
            className="text-xs font-medium text-primary underline-offset-4 hover:underline"
          >
            See all
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
