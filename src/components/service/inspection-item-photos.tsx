/**
 * Pictures on a checklist item (owner, Oct 26: "add pictures from the service ticket to each
 * part of the inspection (like the seams, flashing etc)"). A flagged row shows its pictures —
 * taken with the close-out's camera (inspection-camera.ts, item_key = the item) or attached from
 * the ticket's loose photos here — on both screens (the close-out's step 2 and the office's
 * Inspection fold):
 *
 *   - `ItemPhotoThumbs`: the item's pictures with Delete (as everywhere) and a small Detach that
 *     sets item_key back to null — the photo stays on the ticket, under "Other photos".
 *   - `FromTicketPhotosButton`: opens `TicketPhotoPicker`, a small dialog listing the ticket's
 *     photos not yet on any item (inspection.ts unattachedTicketPhotos: role "other", no repair,
 *     no item) as thumbnails with their marks drawn, multi-select, Attach.
 *
 * Both go through setJobPhotoItem (service-field.functions.ts; the mutations are
 * item-photo-mutations.ts) and refresh the ticket's photo list (fieldKeys.photos) so the Photos
 * fold and the other screen agree.
 */
import { useState } from "react";
import { Check, Images, Loader2 } from "lucide-react";

import { parsePhotoMarks } from "@/lib/photo-annotations";
import { unattachedTicketPhotos } from "@/lib/inspection";
import type { JobPhotoRow } from "@/lib/service-field.functions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PhotoThumb } from "@/components/service/field-shared";
import { MarksOverlay } from "@/components/service/photo-markup";
import { useSignedUrl } from "@/components/service/field-utils";
import {
  photosOnItem,
  useDeleteJobPhoto,
  useSetPhotoItem,
} from "@/components/service/item-photo-mutations";

/** One picture in the picker: the photo with its marks, pressed = picked. */
function PickTile({
  photo,
  picked,
  onToggle,
}: {
  photo: JobPhotoRow;
  picked: boolean;
  onToggle: () => void;
}) {
  const url = useSignedUrl(photo.storage_path);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const marks = parsePhotoMarks(photo.annotations);
  return (
    <button
      type="button"
      aria-pressed={picked}
      aria-label={`${photo.file_name ?? "Photo"}${marks.length ? " (marked)" : ""}`}
      className={`relative h-24 w-24 overflow-hidden rounded-md border bg-muted ${picked ? "ring-2 ring-primary ring-offset-2 ring-offset-background" : ""}`}
      onClick={onToggle}
    >
      {url.data ? (
        <>
          <img
            src={url.data}
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
            onLoad={(e) =>
              setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })
            }
          />
          {natural && <MarksOverlay marks={marks} w={natural.w} h={natural.h} fit="cover" />}
        </>
      ) : url.error ? (
        <span className="flex h-full items-center justify-center p-1 text-center text-[10px] text-destructive">
          Could not load
        </span>
      ) : (
        <span className="flex h-full items-center justify-center">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </span>
      )}
      {picked && (
        <span className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <Check className="h-4 w-4" aria-hidden />
        </span>
      )}
    </button>
  );
}

/**
 * The picker: the ticket's loose photos (`photos`, already filtered — unattachedTicketPhotos),
 * multi-select, Attach. Pure in what it shows; the attach itself is the caller's.
 */
export function TicketPhotoPicker({
  open,
  onOpenChange,
  photos,
  itemLabel,
  busy,
  onAttach,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  photos: readonly JobPhotoRow[];
  itemLabel: string;
  busy: boolean;
  onAttach: (ids: string[]) => void;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const toggle = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setPicked([]);
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>From ticket photos</DialogTitle>
          <DialogDescription>
            Pictures on this ticket that are not on a checklist item yet. Pick the ones that show{" "}
            {itemLabel}.
          </DialogDescription>
        </DialogHeader>
        {photos.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No loose photos on this ticket — every picture is already on an item or a repair.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2" role="group" aria-label="Ticket photos">
            {photos.map((p) => (
              <PickTile
                key={p.id}
                photo={p}
                picked={picked.includes(p.id)}
                onToggle={() => toggle(p.id)}
              />
            ))}
          </div>
        )}
        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={busy || picked.length === 0}
            onClick={() => {
              onAttach(picked);
              setPicked([]);
            }}
          >
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Attach{picked.length ? ` (${picked.length})` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The "From ticket photos" button with its picker, for one checklist item. */
export function FromTicketPhotosButton({
  jobId,
  itemKey,
  itemLabel,
  photos,
  compact,
}: {
  jobId: string;
  itemKey: string;
  itemLabel: string;
  /** Every photo on the ticket; the loose ones are offered. */
  photos: readonly JobPhotoRow[];
  compact?: boolean | undefined;
}) {
  const [open, setOpen] = useState(false);
  const setItem = useSetPhotoItem(jobId);
  const loose = unattachedTicketPhotos(photos);
  return (
    <>
      <Button
        type="button"
        variant="outline"
        className={compact ? "h-10 px-3 text-sm" : "h-11 text-base"}
        disabled={loose.length === 0}
        title={
          loose.length === 0
            ? "Every photo on this ticket is already on an item or a repair"
            : undefined
        }
        aria-label={`${itemLabel}: from ticket photos`}
        onClick={() => setOpen(true)}
      >
        <Images className={compact ? "mr-1 h-4 w-4" : "mr-2 h-5 w-5"} />
        From ticket photos{loose.length ? ` (${loose.length})` : ""}
      </Button>
      <TicketPhotoPicker
        open={open}
        onOpenChange={setOpen}
        photos={loose}
        itemLabel={itemLabel}
        busy={setItem.isPending}
        onAttach={(ids) =>
          setItem.mutate({ ids, item_key: itemKey }, { onSuccess: () => setOpen(false) })
        }
      />
    </>
  );
}

/** The item's pictures: each a thumbnail (marks drawn, lightbox, Delete) with Detach under it. */
export function ItemPhotoThumbs({
  jobId,
  itemKey,
  itemLabel,
  photos,
  ticketNumber,
  canEdit,
  compact,
}: {
  jobId: string;
  itemKey: string;
  itemLabel: string;
  /** Every photo on the ticket; the item's are shown. */
  photos: readonly JobPhotoRow[];
  ticketNumber: number;
  canEdit: boolean;
  compact?: boolean | undefined;
}) {
  const mine = photosOnItem(photos, itemKey);
  const del = useDeleteJobPhoto(jobId);
  const setItem = useSetPhotoItem(jobId);
  if (mine.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2" data-item-photos={itemKey}>
      {mine.map((p) => (
        <div key={p.id} className="flex flex-col items-center gap-0.5">
          <PhotoThumb
            photo={p}
            size={compact ? "sm" : undefined}
            deleting={del.isPending && del.variables === p.id}
            onDelete={canEdit ? () => del.mutate(p.id) : undefined}
            canAnnotate={canEdit}
            ticketNumber={ticketNumber}
          />
          {canEdit && (
            <button
              type="button"
              className="text-[11px] text-muted-foreground underline-offset-2 hover:underline disabled:opacity-50"
              aria-label={`Detach this photo from ${itemLabel} (it stays on the ticket)`}
              title="Detach from this item — the photo stays on the ticket"
              disabled={setItem.isPending && setItem.variables?.ids.includes(p.id)}
              onClick={() => setItem.mutate({ ids: [p.id], item_key: null })}
            >
              Detach
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

/** The office fold's row extra: the item's pictures and the From ticket photos button. */
export function ItemPhotoTools(props: {
  jobId: string;
  itemKey: string;
  itemLabel: string;
  photos: readonly JobPhotoRow[];
  ticketNumber: number;
  canEdit: boolean;
}) {
  return (
    <div className="space-y-2">
      <ItemPhotoThumbs {...props} compact />
      {props.canEdit && <FromTicketPhotosButton {...props} compact />}
    </div>
  );
}
