/**
 * Pictures added from the web ticket page (owner, Oct 26: the Photos & repairs fold; Oct 27: "can
 * pictures be added to inspections from the web view like the leaks" — a flagged checklist row's
 * own "Add pictures"). Since Oct 28 a thin wrapper over the portal's one picture queue
 * (picture-queue.ts; the core lib/photo-upload-queue.ts): each picked (or dropped) image file goes
 * in line as an "other" photo on no repair — on the checklist item when `itemKey` is given,
 * loose on the ticket when not — and is shrunk (field-utils shrinkPhoto, unchanged), uploaded
 * under the ticket's folder and recorded with registerJobPhoto in the background, up to three at
 * a time, while the office keeps working. The queue's events put each registered row in the
 * ticket's photo list (fieldKeys.photos) and refresh it; a file that fails is named in a loud
 * toast with Retry; a picture the signal dropped is kept and goes up when it is back.
 *
 * Nothing picked from here opens the markup editor (no `capture` input: the camera roll or files;
 * shouldMarkUpAfterShot).
 */
import { toast } from "sonner";

import { imageFiles } from "@/components/service/field-utils";
import { usePictures, type Pictures } from "@/components/service/picture-queue";

export interface TicketPictureUpload extends Omit<Pictures, "add"> {
  /** Start the pictures (a copy, not a live FileList: takePickedFiles). Nothing blocks the next pick. */
  add: (files: ArrayLike<File> | null | undefined) => void;
  /** Something of this place is still going up (the badge: "3 uploading"). */
  uploadingAny: boolean;
}

/**
 * The upload for one place on a ticket: loose pictures (`itemKey` absent / null) or a checklist
 * item's. `entries` are its pictures in flight (placeholders), `uploading` / `waitingForSignal` /
 * `failed` their counts.
 */
export function useTicketPictureUpload(
  jobId: string,
  opts: { itemKey?: string | null | undefined } = {},
): TicketPictureUpload {
  const itemKey = opts.itemKey ?? null;
  const pictures = usePictures({ jobId, repairId: null, itemKey, role: "other" });
  return {
    ...pictures,
    add: (files) => {
      const picked = Array.from(files ?? []);
      if (picked.length === 0) return;
      const list = imageFiles(picked);
      if (list.length === 0) {
        toast.error("Pick picture files (JPG, PNG, HEIC…)");
        return;
      }
      pictures.add(list, { jobId, repairId: null, itemKey, role: "other" });
    },
    uploadingAny: pictures.uploading > 0,
  };
}
