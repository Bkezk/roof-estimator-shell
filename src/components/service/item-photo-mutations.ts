/**
 * The mutations behind a checklist item's pictures (inspection-item-photos.tsx; owner, Oct 26;
 * Oct 28: one photo on several items): delete a ticket photo, and put photos on a checklist item
 * or take them off it through setJobPhotoItems — the photo's full set of items, read from the
 * ticket's photo list in the cache (`item_keys`) with this item added or removed
 * (inspection.ts toggleItemKey), so its other items are untouched. A .ts module so the
 * components file exports components only (fast refresh). Both keep the ticket's photo list
 * (fieldKeys.photos) current for every screen that shows it — the close-out, the Inspection fold
 * and the Photos fold.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { photoItemKeys, photosOnItem, toggleItemKey } from "@/lib/inspection";
import { deleteJobPhoto, setJobPhotoItems, type JobPhotoRow } from "@/lib/service-field.functions";
import { fieldKeys, loudError } from "@/components/service/field-utils";

export { photosOnItem };

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

/** What an attach / detach asks: these photos, this item, on or off it. */
export interface SetPhotoItemArgs {
  ids: string[];
  item_key: string;
  attach: boolean;
}

/**
 * Put photos on a checklist item (`attach`) or take them off it, one request each: the photo's
 * items as the cached list has them, with this item added or removed; the rows that came back
 * replace theirs in the list, then the list is re-read.
 */
export function useSetPhotoItem(jobId: string) {
  const qc = useQueryClient();
  const setFn = useServerFn(setJobPhotoItems);
  return useMutation({
    mutationFn: async (v: SetPhotoItemArgs) => {
      const cached = qc.getQueryData<JobPhotoRow[]>(fieldKeys.photos(jobId)) ?? [];
      const rows: JobPhotoRow[] = [];
      for (const id of v.ids) {
        const photo = cached.find((p) => p.id === id);
        if (!photo) throw new Error("That photo is not in the ticket's list any more — reload");
        const item_keys = toggleItemKey(photoItemKeys(photo), v.item_key, v.attach);
        rows.push(await setFn({ data: { id, service_job_id: jobId, item_keys } }));
      }
      return rows;
    },
    onSuccess: (rows, v) => {
      qc.setQueryData<JobPhotoRow[]>(fieldKeys.photos(jobId), (old) =>
        (old ?? []).map((p) => rows.find((r) => r.id === p.id) ?? p),
      );
      void qc.invalidateQueries({ queryKey: fieldKeys.photos(jobId) });
      void qc.invalidateQueries({ queryKey: fieldKeys.events(jobId) });
      if (v.attach)
        toast.success(rows.length === 1 ? "Photo attached" : `${rows.length} photos attached`);
    },
    onError: (e, v) =>
      loudError(v.attach ? "Could not attach the photo" : "Could not detach the photo", e),
  });
}
