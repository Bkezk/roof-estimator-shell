/*
 * JBK Portal service worker — notifications only.
 *
 * Deliberately minimal: no fetch handler and no caching, so it never changes how pages or data
 * load. It shows a push message ({ title, body, url, tag } JSON from notify.server.ts) and, on a
 * click, focuses a window already on that url or opens one.
 */
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  const title = typeof data.title === "string" && data.title ? data.title : "JBK Portal";
  const url = typeof data.url === "string" && data.url ? data.url : "/";
  const options = {
    body: typeof data.body === "string" ? data.body : "",
    tag: typeof data.tag === "string" && data.tag ? data.tag : undefined,
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    data: { url },
  };
  event.waitUntil(
    Promise.all([
      self.registration.showNotification(title, options),
      // Let an open app refresh its bell right away instead of waiting for the next poll.
      self.clients
        .matchAll({ type: "window", includeUncontrolled: true })
        .then((list) => list.forEach((c) => c.postMessage({ type: "bid-o-matic:notification" })))
        .catch(() => undefined),
    ]),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const raw = (event.notification.data && event.notification.data.url) || "/";
  let target;
  try {
    target = new URL(raw, self.location.origin);
  } catch {
    target = new URL("/", self.location.origin);
  }
  // Only ever open this app's own pages (a link built for another host of the app keeps its path).
  if (target.origin !== self.location.origin) {
    target = new URL(target.pathname + target.search + target.hash, self.location.origin);
  }

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const exact = windows.find((c) => c.url === target.href);
      if (exact) return exact.focus();
      const mine = windows.find((c) => new URL(c.url).origin === self.location.origin);
      if (mine && "navigate" in mine) {
        try {
          const moved = await mine.navigate(target.href);
          if (moved) return moved.focus();
        } catch {
          /* not controlled by this worker yet — open a new window instead */
        }
      }
      return self.clients.openWindow(target.href);
    })(),
  );
});
