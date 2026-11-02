/**
 * A property's named sites on the Customers page (owner, Oct 6): the names as chips under the
 * property. They are added and changed in the property's own form (Add property / the pencil;
 * site-form.tsx), not here. Nothing shows when the property has none.
 *
 * Phase 2 of the documents (owner, Oct 26): the property's COVER PHOTO — one picture of the
 * building on the property card (SiteCoverPhoto), kept in the documents bucket
 * (site-photo.functions.ts) and printed as the "Property photo" a document's cover page starts
 * with. Set cover photo / Replace / Remove, each a click; the picture is shrunk on the phone
 * first (shrinkPhoto) and capped at 4 MB.
 */
import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Building2, ImagePlus, Loader2, RotateCcw, Trash2 } from "lucide-react";

import { useAuth } from "@/lib/auth-store";
import { listPropertySites } from "@/lib/property-sites.functions";
import { clearSiteCoverPhoto, setSiteCoverPhoto, siteCoverUrl } from "@/lib/site-photo.functions";
import { ensureSiteAerialCover, retrySiteAerialCover } from "@/lib/site-aerial-cover.functions";
import {
  type AerialCoverResult,
  AERIAL_REMOVED_NOTE,
  aerialCaption,
  aerialDue,
  limitConcurrency,
  NO_AERIAL_PREFIX,
} from "@/lib/aerial-cover";
import { coverButtonLabel, MAX_SITE_COVER_BYTES, siteCoverKey } from "@/lib/site-photo";
import { Button } from "@/components/ui/button";
import { shrinkPhoto } from "@/components/service/field-utils";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export const propertySitesKey = (propertyId: string) => ["property-sites", propertyId] as const;
/** As site-warranties.tsx WARRANTIES_STALE_MS: the customer's page fills the cache first. */
export const PROPERTY_SITES_STALE_MS = 60_000;

export function PropertySites({ propertyId }: { propertyId: string }) {
  const { session } = useAuth();
  const listFn = useServerFn(listPropertySites);
  const q = useQuery({
    queryKey: propertySitesKey(propertyId),
    queryFn: () => listFn({ data: { property_id: propertyId } }),
    enabled: !!session,
    staleTime: PROPERTY_SITES_STALE_MS,
  });
  if (q.error)
    return (
      <p className="mt-1 text-xs text-destructive">Could not load the sites: {errText(q.error)}</p>
    );
  const sites = q.data ?? [];
  if (!sites.length) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs" aria-label="Sites">
      <span className="inline-flex items-center gap-1 font-medium">
        <Building2 className="h-3.5 w-3.5" /> Sites:
      </span>
      {sites.map((s) => (
        <span
          key={s.id}
          className="rounded-full border bg-card px-2 py-0.5"
          title={s.notes ?? undefined}
        >
          {s.name}
        </span>
      ))}
    </div>
  );
}

/** A File as the base64 the server takes. */
function fileBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read the file"));
    reader.onload = () => {
      const s = String(reader.result ?? "");
      resolve(s.slice(s.indexOf(",") + 1));
    };
    reader.readAsDataURL(blob);
  });
}

/** What the card needs of the property row (crm_sites). */
export interface SiteCoverSite {
  id: string;
  cover_photo_path: string | null;
  cover_photo_source: string;
  aerial_state: string | null;
  aerial_tried_at: string | null;
  aerial_note: string | null;
}

/** A few aerials at a time across the page's cards (a customer with 46 properties). */
const aerialTurn = limitConcurrency(2);

/**
 * The property's cover picture on its card (phase 2 of the documents, Oct 26; the aerial,
 * Nov 2): the thumbnail (a signed link, an hour) with "Aerial · KyFromAbove imagery" under an
 * aerial, and, for the property's editors, Set cover photo (Set a photo over an aerial: a photo
 * wins) / Replace / Remove. A property with no picture asks the server for its aerial when the
 * card mounts (a few at a time; ensureSiteAerialCover makes it once); one nothing was found for
 * shows why, with "Try the aerial again". `site` is the row as the page loaded it; the card
 * follows its own changes from there.
 */
export function SiteCoverPhoto({ site, canEdit }: { site: SiteCoverSite; canEdit: boolean }) {
  const { session } = useAuth();
  const qc = useQueryClient();
  const urlFn = useServerFn(siteCoverUrl);
  const ensureFn = useServerFn(ensureSiteAerialCover);
  const retryFn = useServerFn(retrySiteAerialCover);
  const setFn = useServerFn(setSiteCoverPhoto);
  const clearFn = useServerFn(clearSiteCoverPhoto);
  const fileRef = useRef<HTMLInputElement>(null);
  const siteId = site.id;
  // Will the first read make an aerial? (No picture, the lookup due, an editor.)
  const willMake = !site.cover_photo_path && canEdit && aerialDue(site.aerial_tried_at, new Date());
  const cover = useQuery<AerialCoverResult>({
    queryKey: siteCoverKey(siteId),
    queryFn: async () => {
      if (!canEdit) {
        if (!site.cover_photo_path)
          return { path: null, url: null, source: null, state: null, note: null };
        const r = await urlFn({ data: { siteId } });
        return {
          path: r.path,
          url: r.url,
          source: site.cover_photo_source === "aerial" ? "aerial" : "photo",
          state: site.aerial_state,
          note: null,
        };
      }
      if (!site.cover_photo_path && !aerialDue(site.aerial_tried_at, new Date()))
        return { path: null, url: null, source: null, state: null, note: site.aerial_note };
      return willMake
        ? aerialTurn(() => ensureFn({ data: { siteId } }))
        : ensureFn({ data: { siteId } });
    },
    enabled: !!session && (!!site.cover_photo_path || canEdit),
    staleTime: 30 * 60_000,
  });
  const put = (r: AerialCoverResult) => qc.setQueryData(siteCoverKey(siteId), r);
  const upload = useMutation({
    mutationFn: async (file: File) => {
      const shrunk = await shrinkPhoto(file);
      if (shrunk.blob.size > MAX_SITE_COVER_BYTES)
        throw new Error("The picture is over 4 MB even after shrinking; pick a smaller one");
      return setFn({
        data: { siteId, bytesBase64: await fileBase64(shrunk.blob), contentType: shrunk.type },
      });
    },
    onSuccess: (r) => {
      put({ path: r.path, url: r.url, source: "photo", state: null, note: null });
      toast.success("Cover photo set");
    },
    onError: (e) => toast.error(`Could not set the cover photo: ${errText(e)}`),
  });
  const clear = useMutation({
    mutationFn: () => clearFn({ data: { siteId } }),
    onSuccess: () => {
      const wasAerial = cover.data?.source === "aerial";
      put({
        path: null,
        url: null,
        source: null,
        state: null,
        note: wasAerial ? AERIAL_REMOVED_NOTE : null,
      });
      toast.success(wasAerial ? "Aerial removed" : "Cover photo removed");
    },
    onError: (e) => toast.error(`Could not remove the cover photo: ${errText(e)}`),
  });
  const retry = useMutation({
    mutationFn: () => retryFn({ data: { siteId } }),
    onSuccess: (r) => {
      put(r);
      toast[r.path ? "success" : "info"](r.path ? "Aerial made" : `${NO_AERIAL_PREFIX}: ${r.note}`);
    },
    onError: (e) => toast.error(`Could not make the aerial: ${errText(e)}`),
  });
  const busy = upload.isPending || clear.isPending || retry.isPending;
  const c = cover.data;
  const has = !!(c ? c.path : site.cover_photo_path);
  const isAerial = c ? c.source === "aerial" : site.cover_photo_source === "aerial";
  const note = c ? c.note : site.cover_photo_path ? null : site.aerial_note;
  if (!has && !canEdit) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2" data-site-cover={siteId}>
      {has ? (
        c?.url ? (
          <figure className="flex shrink-0 flex-col gap-0.5">
            <img
              src={c.url}
              alt={isAerial ? "The property from the air" : "Property cover photo"}
              title={
                isAerial
                  ? "The building from our aerial imagery: a document's cover page prints it until a photo is set"
                  : "The property's cover photo: the picture a document's cover page starts with"
              }
              className="h-24 w-32 shrink-0 rounded-md border object-cover"
              loading="lazy"
              data-cover-source={isAerial ? "aerial" : "photo"}
            />
            {isAerial && (
              <figcaption className="text-[10px] text-muted-foreground">
                {aerialCaption(c.state)}
              </figcaption>
            )}
          </figure>
        ) : cover.isError ? (
          <span className="flex h-24 w-32 shrink-0 items-center justify-center rounded-md border p-1 text-center text-[10px] text-destructive">
            Could not load
          </span>
        ) : (
          <span className="flex h-24 w-32 shrink-0 items-center justify-center rounded-md border bg-muted">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </span>
        )
      ) : cover.isError ? (
        // Said plainly (owner: bugs announced loudly), never a quiet "No cover photo".
        <span
          role="alert"
          className="flex h-24 w-40 shrink-0 items-center justify-center rounded-md border border-destructive/40 p-1 text-center text-[10px] text-destructive"
          title={errText(cover.error)}
          data-cover-error
        >
          Could not make the aerial: {errText(cover.error).slice(0, 120)}
        </span>
      ) : cover.isPending && willMake ? (
        <span
          className="flex h-24 w-32 shrink-0 items-center justify-center gap-1 rounded-md border border-dashed p-1 text-center text-[10px] text-muted-foreground"
          data-cover-making
        >
          <Loader2 className="h-3 w-3 animate-spin" /> Finding the aerial…
        </span>
      ) : (
        <span
          className="flex h-24 w-32 shrink-0 items-center justify-center rounded-md border border-dashed p-1 text-center text-[10px] text-muted-foreground"
          title={
            note
              ? `${NO_AERIAL_PREFIX}: ${note}`
              : "No cover photo yet: a document's cover page prints a blank picture slot"
          }
          data-cover-none
        >
          {note ? `${NO_AERIAL_PREFIX}: ${note}` : "No cover photo"}
        </span>
      )}
      {canEdit && (
        <div className="flex flex-wrap items-center gap-1">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) upload.mutate(f);
            }}
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            title={
              isAerial
                ? "A photo of the building takes the aerial's place on the property's documents"
                : "A picture of the building for the property's documents (shrunk and stored privately)"
            }
            onClick={() => fileRef.current?.click()}
          >
            {upload.isPending ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <ImagePlus className="mr-1 h-4 w-4" />
            )}
            {isAerial && has ? "Set a photo" : coverButtonLabel(has)}
          </Button>
          {has && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="text-destructive"
              disabled={busy}
              title={
                isAerial
                  ? "Take the aerial off this property (it is not made again until Try the aerial again)"
                  : "Take the cover photo off this property (the aerial may take its place)"
              }
              onClick={() => clear.mutate()}
            >
              <Trash2 className="mr-1 h-4 w-4" /> Remove
            </Button>
          )}
          {!has && (note || cover.isError) && !cover.isPending && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={busy}
              title="Look the address up on our aerial imagery again (after the address was fixed, or the imagery server is back)"
              onClick={() => retry.mutate()}
              data-action="retry-aerial"
            >
              {retry.isPending ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <RotateCcw className="mr-1 h-4 w-4" />
              )}
              Try the aerial again
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
