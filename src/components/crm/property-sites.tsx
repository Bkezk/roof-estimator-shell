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
import { Building2, ImagePlus, Loader2, Trash2 } from "lucide-react";

import { useAuth } from "@/lib/auth-store";
import { listPropertySites } from "@/lib/property-sites.functions";
import { clearSiteCoverPhoto, setSiteCoverPhoto, siteCoverUrl } from "@/lib/site-photo.functions";
import { coverButtonLabel, MAX_SITE_COVER_BYTES, siteCoverKey } from "@/lib/site-photo";
import { Button } from "@/components/ui/button";
import { shrinkPhoto } from "@/components/service/field-utils";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function PropertySites({ propertyId }: { propertyId: string }) {
  const { session } = useAuth();
  const listFn = useServerFn(listPropertySites);
  const q = useQuery({
    queryKey: ["property-sites", propertyId],
    queryFn: () => listFn({ data: { property_id: propertyId } }),
    enabled: !!session,
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

/**
 * The property's cover photo on its card: the thumbnail (a signed link, an hour) and, for the
 * property's editors, Set cover photo / Replace / Remove. `path` is the row's
 * cover_photo_path as the page loaded it; the component follows its own changes from there.
 */
export function SiteCoverPhoto({
  siteId,
  path,
  canEdit,
}: {
  siteId: string;
  path: string | null;
  canEdit: boolean;
}) {
  const { session } = useAuth();
  const qc = useQueryClient();
  const urlFn = useServerFn(siteCoverUrl);
  const setFn = useServerFn(setSiteCoverPhoto);
  const clearFn = useServerFn(clearSiteCoverPhoto);
  const fileRef = useRef<HTMLInputElement>(null);
  const [has, setHas] = useState(!!path);
  const url = useQuery({
    queryKey: siteCoverKey(siteId),
    queryFn: () => urlFn({ data: { siteId } }),
    enabled: !!session && has,
    staleTime: 30 * 60_000,
  });
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
      setHas(true);
      qc.setQueryData(siteCoverKey(siteId), { path: r.path, url: r.url });
      toast.success("Cover photo set");
    },
    onError: (e) => toast.error(`Could not set the cover photo: ${errText(e)}`),
  });
  const clear = useMutation({
    mutationFn: () => clearFn({ data: { siteId } }),
    onSuccess: () => {
      setHas(false);
      qc.setQueryData(siteCoverKey(siteId), { path: null, url: null });
      toast.success("Cover photo removed");
    },
    onError: (e) => toast.error(`Could not remove the cover photo: ${errText(e)}`),
  });
  const busy = upload.isPending || clear.isPending;
  if (!has && !canEdit) return null;
  return (
    <div className="mt-2 flex items-center gap-2" data-site-cover={siteId}>
      {has ? (
        url.data?.url ? (
          <img
            src={url.data.url}
            alt="Property cover photo"
            title="The property's cover photo: the picture a document's cover page starts with"
            className="h-16 w-24 shrink-0 rounded-md border object-cover"
            loading="lazy"
          />
        ) : url.isError ? (
          <span className="flex h-16 w-24 shrink-0 items-center justify-center rounded-md border p-1 text-center text-[10px] text-destructive">
            Could not load
          </span>
        ) : (
          <span className="flex h-16 w-24 shrink-0 items-center justify-center rounded-md border bg-muted">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </span>
        )
      ) : (
        <span
          className="flex h-16 w-24 shrink-0 items-center justify-center rounded-md border border-dashed text-center text-[10px] text-muted-foreground"
          title="No cover photo yet: a document's cover page prints a blank picture slot"
        >
          No cover photo
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
            title="A picture of the building for the property's documents (shrunk and stored privately)"
            onClick={() => fileRef.current?.click()}
          >
            {upload.isPending ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <ImagePlus className="mr-1 h-4 w-4" />
            )}
            {coverButtonLabel(has)}
          </Button>
          {has && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="text-destructive"
              disabled={busy}
              title="Take the cover photo off this property"
              onClick={() => clear.mutate()}
            >
              <Trash2 className="mr-1 h-4 w-4" /> Remove
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
