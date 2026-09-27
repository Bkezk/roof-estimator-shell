/**
 * The header bell: unread count, the latest notifications in a popover (opening it marks the
 * shown ones read), and "Mark all read". Polls once a minute while the tab is visible — React
 * Query pauses the interval in a background tab — and refreshes at once when the service worker
 * reports an incoming push. Also registers the service worker (public/sw.js) once per page load.
 */
import { useEffect, useState, type MouseEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useRouter } from "@tanstack/react-router";
import { formatDistanceToNow } from "date-fns";
import { Bell, Loader2 } from "lucide-react";

import { useAuth } from "@/lib/auth-store";
import {
  listNotifications,
  markNotificationsRead,
  type NotificationRow,
} from "@/lib/followups.functions";
import { registerServiceWorker } from "@/lib/push-client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export const NOTIFICATIONS_QUERY_KEY = ["notifications"] as const;
const LIMIT = 30;

function when(iso: string): string {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? formatDistanceToNow(t, { addSuffix: true }) : "";
}

export function NotificationsBell() {
  const { session } = useAuth();
  const qc = useQueryClient();
  const router = useRouter();
  const listFn = useServerFn(listNotifications);
  const markFn = useServerFn(markNotificationsRead);
  const [open, setOpen] = useState(false);
  // Rows that were unread when the popover opened stay bold until it closes, although they are
  // marked read on the server the moment they are shown.
  const [fresh, setFresh] = useState<ReadonlySet<number>>(new Set());

  const q = useQuery({
    queryKey: NOTIFICATIONS_QUERY_KEY,
    queryFn: () => listFn({ data: { limit: LIMIT } }),
    enabled: !!session,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });
  const rows = q.data ?? [];
  const unread = rows.filter((r) => !r.read_at).length;

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

  const markLocally = (ids: number[] | null) => {
    const now = new Date().toISOString();
    qc.setQueryData<NotificationRow[]>(NOTIFICATIONS_QUERY_KEY, (old) =>
      old?.map((r) => (!r.read_at && (!ids || ids.includes(r.id)) ? { ...r, read_at: now } : r)),
    );
  };

  const markRead = (ids: number[] | null) => {
    markLocally(ids);
    markFn({ data: ids ? { ids } : {} })
      .catch((e: unknown) => console.error("Could not mark notifications read", e))
      .finally(() => void qc.invalidateQueries({ queryKey: NOTIFICATIONS_QUERY_KEY }));
  };

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) {
      setFresh(new Set());
      return;
    }
    const ids = rows.filter((r) => !r.read_at).map((r) => r.id);
    setFresh(new Set(ids));
    if (ids.length) markRead(ids);
  };

  const markAll = () => {
    setFresh(new Set());
    markRead(null);
  };

  const follow = (e: MouseEvent<HTMLAnchorElement>, url: string) => {
    // Let ctrl/cmd/shift/middle-click open a new tab as usual.
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
      return;
    let target: URL;
    try {
      target = new URL(url, window.location.origin);
    } catch {
      return;
    }
    e.preventDefault();
    onOpenChange(false);
    if (target.origin === window.location.origin) {
      void router.navigate({ href: target.pathname + target.search + target.hash });
    } else {
      window.location.assign(target.href);
    }
  };

  const badge = unread > 9 ? "9+" : String(unread);

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
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
            disabled={!rows.length}
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
                const bold = !r.read_at || fresh.has(r.id);
                const inner = (
                  <>
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
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          {when(r.created_at)}
                        </p>
                      </div>
                    </div>
                  </>
                );
                return (
                  <li key={r.id}>
                    {r.url ? (
                      <a
                        href={r.url}
                        onClick={(e) => follow(e, r.url ?? "/")}
                        className="block px-3 py-2 hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                      >
                        {inner}
                      </a>
                    ) : (
                      <div className="px-3 py-2">{inner}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
