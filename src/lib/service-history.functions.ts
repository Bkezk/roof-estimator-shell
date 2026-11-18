/**
 * History at this property, the server side (owner, Oct 21; service-history.ts has the words).
 * A technician-only login reads only the tickets assigned to them (service_jobs_read), so the
 * earlier tickets at the property come through the SECURITY DEFINER functions of
 * 20261021110000_site_history.sql — site_history (the fold's rows) and site_history_summary
 * (the strip) — which refuse a caller who may not see the ticket they start from (42501, in
 * plain English; the message reaches the screen as is). Nothing is read from the tables here.
 *
 * Photos are files in the private "service" bucket: the rows carry storage paths, and this
 * signs them in one call (an hour, like field-utils.ts useSignedUrl) so the fold's thumbnails
 * load straight away; a photo whose signing failed carries url null and the thumbnail asks the
 * browser's own signed link instead. The fold asks for the history when it opens, not on page
 * load; the viewer re-asks when the links are near their end.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware.hardened";
import type { Database } from "@/integrations/supabase/types";
import { isFieldOnly } from "@/lib/access";
import { readProfile } from "@/lib/profile-cache.server";
import { withInstructions } from "@/lib/ticket-instructions";
import {
  siteHistorySchema,
  siteHistorySummarySchema,
  type SiteHistorySummary,
  type SiteHistoryTicket,
} from "@/lib/service-history";

type Client = SupabaseClient<Database>;
/** The private bucket the ticket's photos live in (service-field.functions.ts SERVICE_BUCKET). */
const BUCKET = "service";
/** How long a signed photo link lasts: an hour, as the ticket page's own thumbnails. */
export const SIGNED_SECONDS = 3600;

/**
 * An rpc the generated types do not list yet (the types file is Lovable's to regenerate; the
 * same PostgREST call — as notify.server.ts rawRpc).
 */
const rawRpc = (
  sb: Client,
  fn: string,
  args?: Record<string, unknown>,
): Promise<{ data: unknown; error: { code?: string; message: string } | null }> =>
  (
    sb as unknown as {
      rpc: (
        fn: string,
        args?: Record<string, unknown>,
      ) => Promise<{ data: unknown; error: { code?: string; message: string } | null }>;
    }
  ).rpc(fn, args);

/** Signed links for the paths, in one call; a failure signs nothing (the thumbnails fall back). */
async function signAll(sb: Client, paths: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!paths.length) return out;
  const { data, error } = await sb.storage.from(BUCKET).createSignedUrls(paths, SIGNED_SECONDS);
  if (error || !data) return out;
  for (const d of data) if (d.path && d.signedUrl && !d.error) out.set(d.path, d.signedUrl);
  return out;
}

const idInput = (d: unknown) => z.object({ id: z.string().uuid() }).parse(d);

/** How many earlier tickets the fold shows at first (Nov 3, review item 46); "Show more" asks for all. */
export const HISTORY_FIRST_TICKETS = 10;

/**
 * The earlier tickets at this ticket's property, newest first, each with its repairs,
 * inspection items and ALL its photos (signed). The database decides who may ask. `limit`
 * (Nov 3): the newest N only — the fold opens on ten and asks for the rest on "Show more"; the
 * whole history used to be built and every photo signed on every open.
 */
export const siteHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z
      .object({ id: z.string().uuid(), limit: z.number().int().min(1).max(500).optional() })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<SiteHistoryTicket[]> => {
    const r = await rawRpc(
      context.supabase,
      "site_history",
      data.limit ? { p_job_id: data.id, p_limit: data.limit } : { p_job_id: data.id },
    );
    if (r.error) throw new Error(r.error.message);
    const rows = siteHistorySchema.parse(r.data ?? []);
    // The small copies for the squares (thumb_path, Nov 3) and the full pictures for the viewer.
    const paths = [
      ...new Set(
        rows.flatMap((t) =>
          t.photos.flatMap((p) => [p.storage_path, ...(p.thumb_path ? [p.thumb_path] : [])]),
        ),
      ),
    ];
    const urls = await signAll(context.supabase, paths);
    return rows.map((t) => ({
      ...t,
      photos: t.photos.map((p) => ({
        ...p,
        url: urls.get(p.storage_path) ?? null,
        thumb_url: p.thumb_path ? (urls.get(p.thumb_path) ?? null) : null,
      })),
    }));
  });

/** The strip's numbers: how many earlier tickets, how many photos, the last one's day and gist. */
export const siteHistorySummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator(idInput)
  .handler(async ({ data, context }): Promise<SiteHistorySummary> => {
    const r = await rawRpc(context.supabase, "site_history_summary", { p_job_id: data.id });
    if (r.error) throw new Error(r.error.message);
    return siteHistorySummarySchema.parse(r.data);
  });

/** This ticket's Special instructions, for the box above the timeline (owner, Nov 18). */
export interface TicketInstructions {
  /** The instructions the reader may see; null when there are none (or none for them). */
  text: string | null;
  /** True for the office while the box is unticked: technicians do not see the text. */
  officeOnly: boolean;
}

/**
 * The Special instructions of the ticket whose history is open: read with the caller's own
 * sign-in, so a technician reads them on a ticket that is theirs, and never the ones the
 * office keeps to itself (those are not on the ticket's row; ticket-instructions.ts).
 */
export const ticketInstructions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator(idInput)
  .handler(async ({ data, context }): Promise<TicketInstructions> => {
    const sb = context.supabase;
    const p = await readProfile(sb, context.userId);
    const { data: row, error } = await sb
      .from("service_jobs")
      .select("id, notes, notes_tech_visible")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    // A ticket the caller may not read has no instructions for them; the history says the rest.
    if (!row) return { text: null, officeOnly: false };
    const { notes } = await withInstructions(sb, p, row);
    const text = (notes ?? "").trim() || null;
    return { text, officeOnly: !!text && !row.notes_tech_visible && !isFieldOnly(p) };
  });
