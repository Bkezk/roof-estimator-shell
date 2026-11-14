/**
 * Security audit, Nov 14. Owner: "Go with fixes for 1, 5".
 *
 * 1. A notification's link was followed as written: a script link ran in the reader's page and
 *    a link to another site took the reader there. Now a link is a page of this site or nothing,
 *    in the database (migration 20261114190000) and on the screens.
 * 5. Any website could show the sign-in page inside a frame of its own. Now every response says
 *    only the site itself may frame it.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  FRAME_HEADERS,
  frameHeadersFor,
  isLovablePreviewHost,
  requestHost,
  withFrameRule,
} from "./frame-rule";
import { isNotificationPath, NOTIFICATION_LINK_SQL, notificationPath } from "./notification-link";

const SITE = "https://jbkbid.lovable.app";

const GOOD = [
  "/",
  "/account",
  "/service?id=4d0dfce6-4ba5-4574-8012-ca22f304067e",
  "/prospect/leads?roof=1",
  "/customers/5a8712aa-a808-4dfc-a2a9-4bc881f6307d#contacts",
  "/estimate?bid=bf6b8731-c7b3-472a-906b-d1223014e08a&tab=setup",
];
const BAD = [
  "javascript:alert(1)",
  "javascript:void(document.title='x')",
  "JaVaScRiPt:alert(1)",
  "https://example.com/",
  "http://jbkbid.lovable.app.evil.example/",
  "//example.com",
  "//example.com/service",
  "/\\example.com",
  "\\\\example.com",
  "/\t/example.com",
  "/\n/example.com",
  "/a\\b",
  "/a\u0000b",
  "/a\u007fb",
  " /service",
  "service",
  "data:text/html,<script>alert(1)</script>",
  "mailto:someone@example.com",
  "",
];

describe("where a notification may lead", () => {
  it.each(GOOD)("a page of the site is kept as written: %s", (url) => {
    expect(notificationPath(url)).toBe(url);
  });
  it.each(BAD)("anything else is no link at all: %j", (url) => {
    expect(notificationPath(url)).toBeNull();
  });
  it("no link stays no link", () => {
    expect(notificationPath(null)).toBeNull();
    expect(notificationPath(undefined)).toBeNull();
  });
  it("every link that passes is on the site when a browser reads it", () => {
    for (const url of GOOD) expect(new URL(url, SITE).origin).toBe(SITE);
  });
  it("the browser itself reads several of the refused ones as another site or as a script", () => {
    // Why the rule is stricter than "starts with a slash".
    expect(new URL("//example.com", SITE).origin).toBe("https://example.com");
    expect(new URL("/\\example.com", SITE).origin).toBe("https://example.com");
    expect(new URL("/\t/example.com", SITE).origin).toBe("https://example.com");
    expect(new URL("javascript:alert(1)", SITE).protocol).toBe("javascript:");
  });
});

describe("the database applies the same rule", () => {
  const sql = readFileSync(
    "supabase/migrations/20261114190000_notification_link_internal.sql",
    "utf8",
  );
  it("as a check on the notifications table", () => {
    expect(sql).toContain("add constraint notifications_url_internal");
    expect(sql).toContain(`check (url is null or url ~ '${NOTIFICATION_LINK_SQL}')`);
  });
  it("can be run twice", () => {
    expect(sql).toContain(
      "alter table public.notifications drop constraint if exists notifications_url_internal;",
    );
  });
  it("and the two patterns say the same thing", () => {
    // The database's pattern, read as JavaScript: [:cntrl:] is the control characters.
    const asJs = new RegExp(
      NOTIFICATION_LINK_SQL.replaceAll("[:cntrl:]", "\\u0000-\\u001f\\u007f"),
    );
    for (const url of [...GOOD, ...BAD]) expect(asJs.test(url), url).toBe(isNotificationPath(url));
  });
});

describe("the screens follow only such a link", () => {
  const bell = readFileSync("src/components/notifications-bell.tsx", "utf8");
  const page = readFileSync("src/components/notifications-page.tsx", "utf8");
  it.each([
    ["the bell", bell],
    ["the Notifications page", page],
  ])("%s never sends the browser to an address taken from a notification", (_n, src) => {
    expect(src).not.toContain("window.location.assign");
    expect(src).not.toContain("href={r.url}");
    expect(src).toContain("href={notificationPath(r.url) ?? undefined}");
    expect(src).toContain("void router.navigate({ href: path })");
  });
  it("the bell shows a row with a refused link as a row with no link", () => {
    expect(bell).toContain("{notificationPath(r.url) ? (");
  });
  it("so does the page", () => {
    expect(page).toContain("{notificationPath(r.url) ? (");
  });
});

describe("who may frame the site", () => {
  it("only the site itself, said twice for old and new browsers", () => {
    expect(FRAME_HEADERS).toEqual({
      "content-security-policy": "frame-ancestors 'self'",
      "x-frame-options": "SAMEORIGIN",
    });
  });
  it.each(["jbkbid.lovable.app", "portal.example.com", "localhost:4173", "127.0.0.1:4173", ""])(
    "the rule goes out on %j",
    (host) => {
      expect(frameHeadersFor(host)).toBe(FRAME_HEADERS);
    },
  );
  it.each([
    "id-preview--c13d501c-079a-45a8-b496-b026f4e6f451.lovable.app",
    "id-preview-ab12--c13d501c-079a-45a8-b496-b026f4e6f451.lovable.app",
    "project--c13d501c-079a-45a8-b496-b026f4e6f451.lovable.app",
    "c13d501c-079a-45a8-b496-b026f4e6f451.lovableproject.com",
  ])("Lovable's preview address keeps working inside the Lovable editor: %s", (host) => {
    expect(isLovablePreviewHost(host)).toBe(true);
    expect(frameHeadersFor(host)).toEqual({});
  });
  it("a look-alike of the preview address is not excused", () => {
    expect(isLovablePreviewHost("id-preview--evil.lovable.app")).toBe(false);
    expect(isLovablePreviewHost("jbkbid.lovable.app")).toBe(false);
  });
  it("reads the address the visitor typed", () => {
    expect(requestHost(new Request("https://jbkbid.lovable.app/login"))).toBe("jbkbid.lovable.app");
    expect(
      requestHost(
        new Request("https://internal.example/login", {
          headers: { "x-forwarded-host": "jbkbid.lovable.app, proxy" },
        }),
      ),
    ).toBe("jbkbid.lovable.app");
  });
  it("puts the rule on a response", () => {
    const out = withFrameRule(new Request(`${SITE}/login`), new Response("<p>x</p>"));
    expect(out.headers.get("content-security-policy")).toBe("frame-ancestors 'self'");
    expect(out.headers.get("x-frame-options")).toBe("SAMEORIGIN");
  });
  it("on a response whose headers cannot be changed too, keeping its status", async () => {
    const out = withFrameRule(new Request(`${SITE}/`), Response.redirect(`${SITE}/login`, 307));
    expect(out.status).toBe(307);
    expect(out.headers.get("location")).toBe(`${SITE}/login`);
    expect(out.headers.get("x-frame-options")).toBe("SAMEORIGIN");
  });
  it("keeps a rule a response already carries", () => {
    const own = new Response("x", { headers: { "content-security-policy": "default-src 'none'" } });
    const out = withFrameRule(new Request(`${SITE}/x`), own);
    expect(out.headers.get("content-security-policy")).toBe("default-src 'none'");
    expect(out.headers.get("x-frame-options")).toBe("SAMEORIGIN");
  });
  it("leaves a preview response alone", () => {
    const res = new Response("x");
    const out = withFrameRule(
      new Request("https://id-preview--c13d501c-079a-45a8-b496-b026f4e6f451.lovable.app/"),
      res,
    );
    expect(out).toBe(res);
    expect(out.headers.has("x-frame-options")).toBe(false);
  });
  it("the server entry puts it on every response, the error page included", () => {
    const entry = readFileSync("src/server.ts", "utf8");
    expect(entry.match(/withFrameRule\(/g)).toHaveLength(2);
    expect(entry).toContain(
      "return withFrameRule(request, await normalizeCatastrophicSsrResponse(response));",
    );
  });
});
