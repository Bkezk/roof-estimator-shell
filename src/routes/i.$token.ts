/**
 * GET /i/<token> — an invoice's share link (owner, Oct 13: "On CenterPoint you can create a
 * shareable link for the invoice, can we have that as well?"). Whoever has the link gets the
 * invoice's PDF in the browser, no login: the token (invoices.share_token, migration
 * 20261013140000) is looked up with the admin client on a final / sent / paid invoice, the PDF is
 * the one stored at finalising (invoices.functions.ts invoicePdf), served inline and never cached
 * or indexed. Then the view is counted (invoice_share_viewed) — awaited but never allowed to fail
 * the response (a serverless host may drop work left running after the response). Anything else —
 * a token of the wrong shape, one nobody holds, a turned-off link, a void invoice, a read that
 * failed — is one small plain 404 page. Only GET (HEAD falls back to it); anything else is 405.
 *
 * Outside the sign-in gate by construction: this route has a server handler and no component, so
 * the server answers with the handler's Response and the app (AuthGate, src/components/
 * auth-gate.tsx) is never rendered for it — exactly as the /api/* routes. pageForPath
 * (src/lib/access.ts) is not consulted. One log line per request: the invoice number and the
 * outcome, never the token (shareLogLine).
 */
import { createFileRoute } from "@tanstack/react-router";

import {
  isShareToken,
  SHAREABLE_STATUSES,
  shareGonePage,
  shareLogLine,
  type ShareLogOutcome,
} from "@/lib/invoice-share";
import { invoiceFileStem, invoiceLabel } from "@/lib/invoice-numbering";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The 404 page for a link that is not live; private and unindexed like the PDF. */
function gone(outcome: ShareLogOutcome, label?: string | null, detail?: string): Response {
  console.info(shareLogLine(outcome, label, detail));
  return new Response(shareGonePage(), {
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
  let label: string | null = null;
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: inv, error } = await supabaseAdmin
      .from("invoices")
      .select("id, number, display_number, status")
      .eq("share_token", token)
      .in("status", [...SHAREABLE_STATUSES])
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!inv) return gone("no active link");
    label = invoiceLabel(inv);
    const { loadBundle } = await import("@/lib/invoices.server");
    const { invoicePdf } = await import("@/lib/invoices.functions");
    const bundle = await loadBundle(supabaseAdmin, inv.id);
    const pdf = await invoicePdf(supabaseAdmin, bundle);
    // The view counter: the service role's function; a failure is logged, the PDF still served.
    try {
      const { error: vErr } = await supabaseAdmin.rpc("invoice_share_viewed", { p_token: token });
      if (vErr) throw new Error(vErr.message);
    } catch (e) {
      console.warn(`Invoice share link: invoice #${label} — view not counted (${errText(e)})`);
    }
    console.info(shareLogLine("served", label));
    return new Response(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `inline; filename="Invoice-${invoiceFileStem(inv)}.pdf"`,
        "cache-control": "private, no-store",
        "x-robots-tag": "noindex",
      },
    });
  } catch (e) {
    console.warn(shareLogLine("failed", label, errText(e)));
    return gone("failed", label);
  }
}

function notAllowed(): Response {
  console.info(shareLogLine("method not allowed"));
  return new Response("Method Not Allowed", { status: 405, headers: { allow: "GET, HEAD" } });
}

export const Route = createFileRoute("/i/$token")({
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
