/**
 * The mutations behind a checklist item's pictures (inspection-item-photos.tsx; owner, Oct 26):
 * delete a ticket photo, and move photos onto a checklist item (item_key = the item) or off it
 * (null) through setJobPhotoItem. A .ts module so the components file exports components only
 * (fast refresh). Both keep the ticket's photo list (fieldKeys.photos) current for every screen
 * that shows it — the close-out, the Inspection fold and the Photos fold.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { deleteJobPhoto, setJobPhotoItem, type JobPhotoRow } from "@/lib/service-field.functions";
import { fieldKeys, loudError } from "@/components/service/field-utils";

/** The ticket's photos on one checklist item: role "other", on no repair, item_key = the item. */
export const photosOnItem = (photos: readonly JobPhotoRow[], itemKey: string) =>
  photos.filter((p) => p.role === "other" && !p.repair_id && p.item_key === itemKey);

/** Delete a ticket photo (the storage object and the row); the list drops it at once. */
export function useDeleteJobPhoto(jobId: string) {
  const qc = useQueryClient();
  const deleteFn = useServerFn(deleteJobPhoto);
  return useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id, service_job_id: jobId } }),
    onSuccess: (_r, id) =>
      qc.setQueryData<JobPhotoRow[]>(fieldKeys.photos(jobId), (old) =>
        old?.filter((p) => p.id !== id),
      ),
    onError: (e) => loudError("Could not delete the photo", e),
  });
}

/**
 * Move photos onto a checklist item (item_key = the item) or off it (null), one request each;
 * the rows that came back replace theirs in the list, then the list is re-read.
 */
export function useSetPhotoItem(jobId: string) {
  const qc = useQueryClient();
  const setFn = useServerFn(setJobPhotoItem);
  return useMutation({
    mutationFn: async (v: { ids: string[]; item_key: string | null }) => {
      const rows: JobPhotoRow[] = [];
      for (const id of v.ids)
        rows.push(await setFn({ data: { id, service_job_id: jobId, item_key: v.item_key } }));
      return rows;
    },
    onSuccess: (rows, v) => {
      qc.setQueryData<JobPhotoRow[]>(fieldKeys.photos(jobId), (old) =>
        (old ?? []).map((p) => rows.find((r) => r.id === p.id) ?? p),
      );
      void qc.invalidateQueries({ queryKey: fieldKeys.photos(jobId) });
      void qc.invalidateQueries({ queryKey: fieldKeys.events(jobId) });
      if (v.item_key)
        toast.success(rows.length === 1 ? "Photo attached" : `${rows.length} photos attached`);
    },
    onError: (e, v) =>
      loudError(v.item_key ? "Could not attach the photo" : "Could not detach the photo", e),
  });
}
