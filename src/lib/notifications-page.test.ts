/**
 * The Notifications page and the bell's new manners (owner, Oct 12), pinned to the source:
 *   route   /notifications, registered in the generated tree, open to every signed-in user, not
 *           in the sidebar; reached from the bell's "See all" and the Account page;
 *   page    header with the real unread count and Mark all read; Unread / All chips and the kind
 *           chips from the kinds seen; day groups; each row's kind chip, link that opens the item
 *           and reads it, Mark read / Mark unread; Load more by keyset; the two empty states;
 *   bell    opening the popover marks nothing read; the badge is unreadNotificationCount with
 *           the 99+ cap; a clicked row is read; Mark all read stays; See all at the bottom; the
 *           minute poll and the service-worker refresh stay.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { pageForPath } from "@/lib/access";

const read = (p: string) => readFileSync(p, "utf8");
const route = read("src/routes/notifications.tsx");
const page = read("src/components/notifications-page.tsx");
const bell = read("src/components/notifications-bell.tsx");
const account = read("src/routes/account.tsx");
const tree = read("src/routeTree.gen.ts");
const sidebar = read("src/components/app-sidebar.tsx");
const flat = (s: string) => s.replace(/\s+/g, " ");

describe("the route", () => {
  it("/notifications renders NotificationsPage with its title", () => {
    expect(route).toContain('createFileRoute("/notifications")({');
    expect(route).toContain("component: NotificationsPage,");
    expect(route).toContain('title: "Notifications — JBK Portal"');
    expect(route).toContain('import { NotificationsPage } from "@/components/notifications-page";');
  });
  it("is in the generated route tree like its neighbours", () => {
    expect(tree).toContain(
      "import { Route as NotificationsRouteImport } from './routes/notifications'",
    );
    expect(flat(tree)).toContain(
      "const NotificationsRoute = NotificationsRouteImport.update({ id: '/notifications', path: '/notifications', getParentRoute: () => rootRouteImport, } as any)",
    );
    expect(tree).toContain("'/notifications': typeof NotificationsRoute");
    expect(tree).toContain("NotificationsRoute: NotificationsRoute,");
  });
  it("every signed-in user may open it (their own rows under RLS); it is not a sidebar entry", () => {
    expect(pageForPath("/notifications")).toBeNull();
    expect(sidebar).not.toContain("/notifications");
  });
  it("the Account page links to it, once", () => {
    expect(account.match(/to="\/notifications"/g)).toHaveLength(1);
    expect(flat(account)).toContain('<Link to="/notifications"> <Inbox /> Notifications </Link>');
    expect(account).toContain('import { Link, createFileRoute } from "@tanstack/react-router";');
  });
});

describe("the page", () => {
  const fns = page.slice(
    page.indexOf("export function NotificationsPage()"),
    page.indexOf("function Chip("),
  );
  it("uses the four inbox functions and the shared query keys", () => {
    for (const f of [
      "listMyNotifications",
      "markAllNotificationsRead",
      "markNotificationRead",
      "unreadNotificationCount",
    ])
      expect(fns).toContain(`useServerFn(${f})`);
    expect(page).toContain(
      'import { NOTIFICATIONS_QUERY_KEY, UNREAD_COUNT_QUERY_KEY } from "@/components/notifications-bell";',
    );
    expect(fns).toContain("queryKey: UNREAD_COUNT_QUERY_KEY,");
  });
  it("header: Notifications, the real unread count, Mark all read", () => {
    expect(fns).toContain(">Notifications</h1>");
    expect(flat(fns)).toContain('unread === 1 ? "1 unread" : `${unread} unread`');
    expect(flat(fns)).toContain("<Check /> Mark all read");
    expect(fns).toContain("disabled={markAll.isPending || unread === 0}");
    expect(fns).toContain("mutationFn: () => markAllFn(),");
  });
  it("filters: Unread / All, and kind chips from the kinds seen (a label covers its raw kinds)", () => {
    expect(flat(fns)).toContain(
      "<Chip active={unreadOnly} onClick={() => pickUnread(true)}> Unread </Chip>",
    );
    expect(flat(fns)).toContain(
      "<Chip active={!unreadOnly} onClick={() => pickUnread(false)}> All </Chip>",
    );
    expect(fns).toContain("const chips = useMemo(() => kindChips(seenKinds), [seenKinds]);");
    expect(fns).toContain("...(unreadOnly ? { unreadOnly: true } : {}),");
    expect(fns).toContain("...(filter.kinds ? { kind: filter.kinds } : {}),");
    // The chips remember every kind seen in any page, so a narrowing filter keeps them.
    expect(fns.match(/for \(const r of (rows|page)\) next\.add\(r\.kind\);/g)).toHaveLength(2);
    expect(fns).toContain("kindFilter?.label === c.label");
  });
  it("the list is grouped by day; each row has its kind chip, the link reads it, Mark unread toggles", () => {
    expect(fns).toContain("const groups = useMemo(() => groupByDay(rows), [rows]);");
    expect(flat(fns)).toContain("<section key={g.label} aria-label={g.label}>");
    expect(fns).toContain("{g.label}");
    const item = page.slice(page.indexOf("function NotificationItem("));
    expect(item).toContain("{kindLabel(r.kind)}");
    expect(item).toContain('aria-label={unread ? "Mark read" : "Mark unread"}');
    expect(item).toContain("onClick={onToggle}");
    expect(item).toContain("onClick={(e) => onOpen(e, r)}");
    expect(item).toContain("<time dateTime={r.created_at}>");
    expect(fns).toContain("onToggle={() => toggle.mutate({ id: r.id, read: !r.read_at })}");
    expect(fns).toContain("if (!r.read_at) toggle.mutate({ id: r.id, read: true });");
    expect(fns).toContain("mutationFn: (v: { id: number; read: boolean }) => markFn({ data: v }),");
  });
  it("Load more pages by the created_at + id cursor, until a short page", () => {
    expect(fns).toContain("before: cursorOf(oldest)");
    expect(fns).toContain(
      "const hasMore = first.isFetched && lastPage.length >= NOTIFICATIONS_PAGE;",
    );
    expect(flat(fns)).toContain('{loadingOlder ? "Loading…" : "Load more"}');
  });
  it("empty states", () => {
    expect(fns).toContain('{unreadOnly ? "Nothing unread." : "No notifications yet."}');
  });
  it("one column that fits a phone: a capped width, wrapping chips, no fixed light colours", () => {
    expect(fns).toContain('className="mx-auto w-full min-w-0 max-w-2xl space-y-4"');
    expect(fns).toContain('className="flex flex-wrap items-center gap-2" role="group"');
    expect(page).not.toMatch(/bg-white|text-black|bg-gray-|text-gray-|#[0-9a-f]{3,6}\b/i);
  });
});

describe("the bell", () => {
  it("opening the popover marks nothing read; a clicked row is read", () => {
    expect(bell).toContain("<Popover open={open} onOpenChange={setOpen}>");
    expect(bell).not.toContain("onOpenChange = (");
    expect(bell).not.toContain("setFresh");
    expect(bell).not.toContain("markNotificationsRead");
    expect(bell).not.toContain("@/lib/followups.functions");
    const follow = bell.slice(bell.indexOf("const follow = ("), bell.indexOf("const badge = "));
    expect(follow).toContain("if (!r.read_at) markRead(r.id);");
    expect(bell).toContain("markFn({ data: { id, read: true } })");
    // A row with nothing to open is read by the click itself.
    expect(bell).toContain("onClick={() => markRead(r.id)}");
  });
  it("the badge is the real count with the 99+ cap, not the count within 30 rows", () => {
    expect(bell).toContain("useServerFn(unreadNotificationCount)");
    expect(bell).toContain("queryKey: UNREAD_COUNT_QUERY_KEY,");
    expect(bell).toContain("const unread = count.data ?? 0;");
    expect(bell).toContain("const badge = unreadBadge(unread);");
    expect(bell).not.toContain("rows.filter((r) => !r.read_at).length");
    expect(bell).not.toContain('"9+"');
    expect(bell).toContain(
      'export const UNREAD_COUNT_QUERY_KEY = ["notifications", "unread-count"] as const;',
    );
  });
  it("Mark all read stays; See all opens the page and closes the popover", () => {
    expect(bell).toContain("useServerFn(markAllNotificationsRead)");
    expect(bell).toContain(">\n            Mark all read\n          </Button>");
    const footer = bell.slice(bell.lastIndexOf('<div className="border-t px-3 py-2 text-center">'));
    expect(flat(footer)).toContain('<Link to="/notifications" onClick={() => setOpen(false)}');
    expect(flat(footer)).toContain("> See all </Link>");
  });
  it("the minute poll and the service-worker refresh stay", () => {
    expect(bell.match(/refetchInterval: 60_000,/g)).toHaveLength(2);
    expect(bell.match(/refetchIntervalInBackground: false,/g)).toHaveLength(2);
    expect(bell).toContain("void registerServiceWorker();");
    expect(bell).toContain('if (d?.type === "bid-o-matic:notification") {');
    expect(bell).toContain("listFn({ data: { limit: LIMIT } })");
    expect(bell).toContain("const LIMIT = 30;");
  });
});
