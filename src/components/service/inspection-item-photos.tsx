/**
 * Pictures on a checklist item (owner, Oct 26: "add pictures from the service ticket to each
 * part of the inspection (like the seams, flashing etc)"). A flagged row shows its pictures —
 * taken with the close-out's camera (inspection-camera.ts, item_key = the item) or attached from
 * the ticket's loose photos here — on both screens (the close-out's step 2 and the office's
 * Inspection fold):
 *
 * Owner, Oct 28: one photo may be on several items ("associate one photo to multiple inspection
 * checklist items") — the links are service_job_photo_items, read as the row's `item_keys`.
 *
 *   - `ItemPhotoThumbs`: the item's pictures (inspection.ts photosOnItem: `item_keys` includes
 *     the item) with Delete (as everywhere) and a small Detach that removes THIS item's link only —
 *     the photo stays on its other items and on the ticket. A picture on other items too says
 *     "also on Seams" under it.
 *   - `FromTicketPhotosButton`: opens `TicketPhotoPicker`, a small dialog listing the ticket's
 *     pictures not on this item yet (inspection.ts attachableTicketPhotos: role "other", no
 *     repair, not on this item — the ones on another item too, marked "also on …") as thumbnails
 *     with their marks drawn, multi-select, Attach.
 *
 * Both go through setJobPhotoItems (service-field.functions.ts; the mutations are
 * item-photo-mutations.ts) and refresh the ticket's photo list (fieldKeys.photos) so the Photos
 * fold and the other screen agree.
 */
import { useRef, useState } from "react";
import { Check, ImagePlus, Images, Loader2 } from "lucide-react";

import { parsePhotoMarkup } from "@/lib/photo-annotations";
import {
  alsoOnText,
  attachableTicketPhotos,
  otherItemLabels,
  photosOnItem,
} from "@/lib/inspection";
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
import { RotatedPhoto } from "@/components/service/photo-markup";
import { takePickedFiles, useSignedUrl } from "@/components/service/field-utils";
import { useDeleteJobPhoto, useSetPhotoItem } from "@/components/service/item-photo-mutations";
import { useTicketPictureUpload } from "@/components/service/ticket-picture-upload";

/** A checklist row as the "also on …" labels need it (the ticket's inspection draft items). */
export type ChecklistRowLike = { id: string; label: string };

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
  const { marks, rotation } = parsePhotoMarkup(photo.annotations);
  return (
    <button
      type="button"
      aria-pressed={picked}
      aria-label={`${photo.file_name ?? "Photo"}${marks.length ? " (marked)" : ""}`}
      className={`relative h-24 w-24 overflow-hidden rounded-md border bg-muted ${picked ? "ring-2 ring-primary ring-offset-2 ring-offset-background" : ""}`}
      onClick={onToggle}
    >
      {url.data ? (
        <RotatedPhoto
          url={url.data}
          alt=""
          marks={marks}
          rotation={rotation}
          fit="cover"
          className="h-full w-full"
          loading="lazy"
        />
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
 * The picker: the ticket's pictures not on this item (`photos`, already filtered —
 * attachableTicketPhotos), multi-select, Attach. A picture already on another item carries
 * "also on Seams" under it (`items` names the rows). Pure in what it shows; the attach itself is
 * the caller's.
 */
export function TicketPhotoPicker({
  open,
  onOpenChange,
  photos,
  itemKey,
  itemLabel,
  items,
  busy,
  onAttach,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  photos: readonly JobPhotoRow[];
  itemKey: string;
  itemLabel: string;
  /** The checklist rows, for the "also on …" labels; none = no labels. */
  items?: readonly ChecklistRowLike[] | undefined;
  busy: boolean;
  onAttach: (ids: string[]) => void;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const toggle = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const alsoOn = (p: JobPhotoRow) => alsoOnText(otherItemLabels(p, itemKey, items ?? []));
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
            Pictures on this ticket that are not on {itemLabel} yet. Pick the ones that show it — a
            picture already on another item can go here too.
          </DialogDescription>
        </DialogHeader>
        {photos.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No pictures to add — every loose photo on this ticket is already on this item or belongs
            to a repair.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2" role="group" aria-label="Ticket photos">
            {photos.map((p) => {
              const note = alsoOn(p);
              return (
                <div key={p.id} className="flex w-24 flex-col items-center gap-0.5">
                  <PickTile
                    photo={p}
                    picked={picked.includes(p.id)}
                    onToggle={() => toggle(p.id)}
                  />
                  {note && (
                    <span
                      className="w-full truncate text-center text-[11px] text-muted-foreground dark:text-muted-foreground"
                      title={note}
                      data-also-on={p.id}
                    >
                      {note}
                    </span>
                  )}
                </div>
              );
            })}
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
  items,
  compact,
}: {
  jobId: string;
  itemKey: string;
  itemLabel: string;
  /** Every photo on the ticket; the pictures not on this item yet are offered. */
  photos: readonly JobPhotoRow[];
  /** The checklist rows, for the picker's "also on …" labels. */
  items?: readonly ChecklistRowLike[] | undefined;
  compact?: boolean | undefined;
}) {
  const [open, setOpen] = useState(false);
  const setItem = useSetPhotoItem(jobId);
  const pickable = attachableTicketPhotos(photos, itemKey);
  return (
    <>
      <Button
        type="button"
        variant="outline"
        className={compact ? "h-10 px-3 text-sm" : "h-11 text-base"}
        disabled={pickable.length === 0}
        title={
          pickable.length === 0
            ? "Every picture on this ticket is already on this item or belongs to a repair"
            : undefined
        }
        aria-label={`${itemLabel}: from ticket photos`}
        onClick={() => setOpen(true)}
      >
        <Images className={compact ? "mr-1 h-4 w-4" : "mr-2 h-5 w-5"} />
        From ticket photos{pickable.length ? ` (${pickable.length})` : ""}
      </Button>
      <TicketPhotoPicker
        open={open}
        onOpenChange={setOpen}
        photos={pickable}
        itemKey={itemKey}
        itemLabel={itemLabel}
        items={items}
        busy={setItem.isPending}
        onAttach={(ids) =>
          setItem.mutate(
            { ids, item_key: itemKey, attach: true },
            { onSuccess: () => setOpen(false) },
          )
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
  items,
  ticketNumber,
  canEdit,
  compact,
}: {
  jobId: string;
  itemKey: string;
  itemLabel: string;
  /** Every photo on the ticket; the item's are shown. */
  photos: readonly JobPhotoRow[];
  /** The checklist rows, for the "also on …" line under a picture on other items too. */
  items?: readonly ChecklistRowLike[] | undefined;
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
      {mine.map((p) => {
        const note = alsoOnText(otherItemLabels(p, itemKey, items ?? []));
        return (
          <div key={p.id} className="flex flex-col items-center gap-0.5">
            <PhotoThumb
              photo={p}
              size={compact ? "sm" : undefined}
              deleting={del.isPending && del.variables === p.id}
              onDelete={canEdit ? () => del.mutate(p.id) : undefined}
              canAnnotate={canEdit}
              ticketNumber={ticketNumber}
            />
            {note && (
              <span
                className="max-w-24 truncate text-[11px] text-muted-foreground dark:text-muted-foreground"
                title={note}
                data-also-on={p.id}
              >
                {note}
              </span>
            )}
            {canEdit && (
              <button
                type="button"
                className="text-[11px] text-muted-foreground underline-offset-2 hover:underline disabled:opacity-50"
                aria-label={`Detach this photo from ${itemLabel} (it stays on the ticket${note ? ` and ${note.replace(/^also on /, "on ")}` : ""})`}
                title="Detach from this item — the photo stays on the ticket and on its other items"
                disabled={setItem.isPending && setItem.variables?.ids.includes(p.id)}
                onClick={() => setItem.mutate({ ids: [p.id], item_key: itemKey, attach: false })}
              >
                Detach
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * "Add pictures" — new pictures straight onto one checklist item from the web (owner, Oct 27:
 * "can pictures be added to inspections from the web view like the leaks"). A plain file input
 * (accept="image/*", multiple, no `capture`: a phone offers the camera or the camera roll), the
 * ticket photos' pipeline (ticket-picture-upload.ts) registering each with item_key = the item,
 * so the row's thumbnails show them when the batch lands. The picked files are copied out before
 * the input is cleared (takePickedFiles — a FileList is live).
 */
export function AddItemPicturesButton({
  jobId,
  itemKey,
  itemLabel,
  compact,
}: {
  jobId: string;
  itemKey: string;
  itemLabel: string;
  compact?: boolean | undefined;
}) {
  const upload = useTicketPictureUpload(jobId, { itemKey });
  const fileRef = useRef<HTMLInputElement | null>(null);
  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        tabIndex={-1}
        aria-hidden
        data-item-pictures={itemKey}
        onChange={(e) => upload.add(takePickedFiles(e.target))}
      />
      <Button
        type="button"
        variant="outline"
        className={compact ? "h-10 px-3 text-sm" : "h-11 text-base"}
        disabled={upload.uploading}
        aria-label={`${itemLabel}: add pictures`}
        title="Add new pictures to this item — on a phone, the camera or the camera roll"
        onClick={() => fileRef.current?.click()}
      >
        {upload.uploading ? (
          <Loader2 className={`${compact ? "mr-1 h-4 w-4" : "mr-2 h-5 w-5"} animate-spin`} />
        ) : (
          <ImagePlus className={compact ? "mr-1 h-4 w-4" : "mr-2 h-5 w-5"} />
        )}
        Add pictures
      </Button>
      {upload.progressText && (
        <span
          className="text-xs text-muted-foreground dark:text-muted-foreground"
          role="status"
          aria-live="polite"
        >
          {upload.progressText}
        </span>
      )}
    </>
  );
}

/**
 * The office fold's row extra: the item's pictures, then Add pictures (new ones) beside From
 * ticket photos (the ticket's loose ones), for whoever may edit the ticket.
 */
export function ItemPhotoTools(props: {
  jobId: string;
  itemKey: string;
  itemLabel: string;
  photos: readonly JobPhotoRow[];
  /** The checklist rows, for the "also on …" labels. */
  items?: readonly ChecklistRowLike[] | undefined;
  ticketNumber: number;
  canEdit: boolean;
}) {
  return (
    <div className="space-y-2">
      <ItemPhotoThumbs {...props} compact />
      {props.canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          <AddItemPicturesButton
            jobId={props.jobId}
            itemKey={props.itemKey}
            itemLabel={props.itemLabel}
            compact
          />
          <FromTicketPhotosButton {...props} compact />
        </div>
      )}
    </div>
  );
}
