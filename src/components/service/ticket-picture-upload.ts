/**
 * Pictures added from the web ticket page (owner, Oct 26: the Photos & repairs fold; Oct 27: "can
 * pictures be added to inspections from the web view like the leaks" — a flagged checklist row's
 * own "Add pictures"). One pipeline for both: each picked (or dropped) file is shrunk (field-utils
 * shrinkPhoto), uploaded under the ticket's folder (uploadPlan, uploadToServiceBucket) and
 * recorded with registerJobPhoto as an "other" photo on no repair — on the checklist item when
 * `itemKey` is given, loose on the ticket when not. One at a time with an "Uploading 2 of 5…"
 * line; a file that fails is named in a loud toast and the rest still go up. The ticket's photo
 * list (fieldKeys.photos) refreshes when the batch is done, so the Photos fold, the Inspection
 * fold's row and the close-out agree.
 */
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { registerJobPhoto, type JobPhotoRow } from "@/lib/service-field.functions";
import {
  fieldKeys,
  imageFiles,
  loudError,
  removeFromServiceBucket,
  shrinkPhoto,
  uploadPlan,
  uploadToServiceBucket,
  uploadingLabel,
} from "@/components/service/field-utils";

/**
 * What registerJobPhoto is told about one uploaded picture: an "other" photo on no repair, on
 * the checklist item `itemKey` (null: loose on the ticket), named after the shrunk file, taken
 * when the file says it was. Pure, so the item_key path is pinned by a test.
 */
export function jobPhotoRegistration(args: {
  jobId: string;
  /** `${jobId}/<uuid>.<ext>` from uploadPlan. */
  path: string;
  shrunk: { name: string; blob: { size: number } };
  file: { name: string; lastModified: number };
  itemKey?: string | null | undefined;
  now?: (() => number) | undefined;
}) {
  const takenAt = args.file.lastModified || (args.now ?? Date.now)();
  return {
    service_job_id: args.jobId,
    repair_id: null,
    item_key: args.itemKey ?? null,
    role: "other" as const,
    storage_path: args.path,
    file_name: args.shrunk.name || args.file.name || null,
    file_size: args.shrunk.blob.size,
    taken_at: new Date(takenAt).toISOString(),
  };
}

/**
 * The upload batch for a ticket: `add(files)` shrinks, uploads and registers each picture (on
 * the checklist item `itemKey` when given); `uploading` while it runs; `progressText` the
 * "Uploading 2 of 5…" line. A register that fails removes the object again so the bucket holds
 * no orphan.
 */
export function useTicketPictureUpload(
  jobId: string,
  opts: { itemKey?: string | null | undefined } = {},
) {
  const itemKey = opts.itemKey ?? null;
  const qc = useQueryClient();
  const registerFn = useServerFn(registerJobPhoto);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const batch = useMutation({
    mutationFn: async (picked: File[]) => {
      const files = imageFiles(picked);
      if (files.length === 0) {
        toast.error("Pick picture files (JPG, PNG, HEIC…)");
        return { landed: 0, total: 0 };
      }
      setProgress({ done: 0, total: files.length });
      let landed = 0;
      for (const [i, file] of files.entries()) {
        setProgress({ done: i, total: files.length });
        try {
          const shrunk = await shrinkPhoto(file);
          const [plan] = uploadPlan([shrunk], jobId);
          const path = plan!.path;
          await uploadToServiceBucket(path, shrunk.blob, shrunk.type);
          try {
            const row = await registerFn({
              data: jobPhotoRegistration({ jobId, path, shrunk, file, itemKey }),
            });
            qc.setQueryData<JobPhotoRow[]>(fieldKeys.photos(jobId), (old) =>
              old ? [...old, row] : old,
            );
            landed += 1;
          } catch (e) {
            await removeFromServiceBucket(path);
            throw e;
          }
        } catch (e) {
          loudError(`${file.name || "A picture"} did not upload`, e);
        }
      }
      return { landed, total: files.length };
    },
    onSuccess: ({ landed, total }) => {
      if (total === 0) return;
      if (landed > 0) toast.success(landed === 1 ? "Picture added" : `${landed} pictures added`);
    },
    onSettled: () => {
      setProgress(null);
      void qc.invalidateQueries({ queryKey: fieldKeys.photos(jobId) });
      void qc.invalidateQueries({ queryKey: fieldKeys.events(jobId) });
    },
  });
  return {
    /** Start the batch (nothing while one runs). Pass a copy, not a live FileList: takePickedFiles. */
    add: (files: ArrayLike<File> | null | undefined) => {
      const list = Array.from(files ?? []);
      if (list.length > 0 && !batch.isPending) batch.mutate(list);
    },
    uploading: batch.isPending,
    progressText: progress ? uploadingLabel(progress.done, progress.total) : null,
  };
}
