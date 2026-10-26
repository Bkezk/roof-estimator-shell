/**
 * GET /d/<token> — a document's share link (owner, Oct 26: the document generator; the invoice's
 * share link, /i/<token>, is the pattern). Whoever has the link gets the document's PDF in the
 * browser, no login: the token (documents.share_token, migration 20261026150000) is looked up
 * with the admin client on a live document, the PDF is this version's stored file — drawn and
 * stored first when the document was saved since (documents.functions.ts documentPdfBytes) —
 * served inline and never cached or indexed. Then the view is counted (document_share_viewed) —
 * awaited but never allowed to fail the response. Anything else — a token of the wrong shape, one
 * nobody holds, a turned-off link, a deleted document, a read that failed — is one small plain
 * 404 page. Only GET (HEAD falls back to it); anything else is 405.
 *
 * Outside the sign-in gate by construction: a server handler and no component, so the server
 * answers with the handler's Response and the app shell is never rendered for it — exactly as
 * /i/<token> and the /api/* routes. One log line per request: the document's title and the
 * outcome, never the token (documentShareLogLine).
 */
import { createFileRoute } from "@tanstack/react-router";

import { isShareToken } from "@/lib/invoice-share";
import {
  documentFileName,
  documentShareGonePage,
  documentShareLogLine,
  type DocumentShareLogOutcome,
} from "@/lib/documents/server-pure";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The 404 page for a link that is not live; private and unindexed like the PDF. */
function gone(outcome: DocumentShareLogOutcome, title?: string | null, detail?: string): Response {
  console.info(documentShareLogLine(outcome, title, detail));
  return new Response(documentShareGonePage(), {
    status: 404,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "private, no-store",
      "x-robots-tag": "noindex",
    },
  });
}

async function serve(token: string): Promise<Response> {
  if (!isShareToken(token)) return gone("malformed token");
  let title: string | null = null;
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: doc, error } = await supabaseAdmin
      .from("documents")
      .select("*")
      .eq("share_token", token)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!doc) return gone("no active link");
    title = doc.title;
    const { documentPdfBytes } = await import("@/lib/documents.functions");
    const pdf = await documentPdfBytes(supabaseAdmin, doc);
    // The view counter: the service role's function; a failure is logged, the PDF still served.
    try {
      const { error: vErr } = await supabaseAdmin.rpc("document_share_viewed", { p_token: token });
      if (vErr) throw new Error(vErr.message);
    } catch (e) {
      console.warn(`Document share link: "${title}" — view not counted (${errText(e)})`);
    }
    console.info(documentShareLogLine("served", title));
    return new Response(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `inline; filename="${documentFileName(doc.title).replace(/"/g, "")}"`,
        "cache-control": "private, no-store",
        "x-robots-tag": "noindex",
      },
    });
  } catch (e) {
    console.warn(documentShareLogLine("failed", title, errText(e)));
    return gone("failed", title);
  }
}

function notAllowed(): Response {
  console.info(documentShareLogLine("method not allowed"));
  return new Response("Method Not Allowed", { status: 405, headers: { allow: "GET, HEAD" } });
}

export const Route = createFileRoute("/d/$token")({
  server: {
    handlers: {
      GET: ({ params }) => serve(params.token),
      POST: () => notAllowed(),
      PUT: () => notAllowed(),
      PATCH: () => notAllowed(),
      DELETE: () => notAllowed(),
    },
  },
});
