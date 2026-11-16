/**
 * Who may show this site inside a frame (security audit, Nov 14).
 *
 * The site sent no frame rule, so any website could show the sign-in page inside a page of its
 * own and lay false buttons over it. Proven on the published site on Nov 14.
 *
 * The rule: only the site itself. Two headers say it, the modern one and the one older browsers
 * read. The one exception is Lovable's own preview address, which the Lovable editor shows in a
 * frame: it gets no rule, or the editor's preview pane would go blank. Nobody in the office signs
 * in on that address.
 *
 * Pure. The server entry (src/server.ts) puts the headers on every response. Tested in
 * notification-link-nov14b.test.ts.
 */
export const FRAME_HEADERS: Readonly<Record<string, string>> = {
  "content-security-policy": "frame-ancestors 'self'",
  "x-frame-options": "SAMEORIGIN",
};

const PREVIEW_NAME = /^(?:id-preview(?:-[a-z0-9]+)?|project)--[0-9a-f-]{36}(?:-dev)?\./i;
const PREVIEW_ZONES = [".lovableproject.com", ".lovableproject-dev.com"];
/**
 * Where a preview NAME is believed (audit, Nov 16, fix 28): only under Lovable's own domains.
 * The name alone used to do, so "project--<id>.anything.example" read as a preview. Tested on
 * the published site on Nov 16: a forged forwarded-host header did not remove the rule there
 * (the edge replaces it), so this narrows the code to what it means, nothing more.
 */
const PREVIEW_NAME_ZONES = [".lovable.app", ".lovable.dev", ...PREVIEW_ZONES];

/** Is `host` one of Lovable's preview addresses for a project (never the published site)? */
export function isLovablePreviewHost(host: string | null | undefined): boolean {
  const h = (host ?? "").trim().toLowerCase().replace(/:\d+$/, "");
  if (!h) return false;
  return (
    (PREVIEW_NAME.test(h) && PREVIEW_NAME_ZONES.some((z) => h.endsWith(z))) ||
    PREVIEW_ZONES.some((z) => h.endsWith(z))
  );
}

/** The headers a response from `host` carries: the frame rule, or none on a preview address. */
export function frameHeadersFor(host: string | null | undefined): Readonly<Record<string, string>> {
  return isLovablePreviewHost(host) ? {} : FRAME_HEADERS;
}

/** The address the visitor typed: the forwarded host when a proxy set one, else the request's. */
export function requestHost(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  if (forwarded) return forwarded;
  try {
    return new URL(request.url).host;
  } catch {
    return request.headers.get("host") ?? "";
  }
}

/** `response` with the frame rule for the request's address (a response's own rule is kept). */
export function withFrameRule(request: Request, response: Response): Response {
  const add = Object.entries(frameHeadersFor(requestHost(request))).filter(
    ([name]) => !response.headers.has(name),
  );
  if (!add.length) return response;
  try {
    for (const [name, value] of add) response.headers.set(name, value);
    return response;
  } catch {
    // Some responses have headers that cannot be changed: the same response, with new headers.
    const headers = new Headers(response.headers);
    for (const [name, value] of add) headers.set(name, value);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }
}
