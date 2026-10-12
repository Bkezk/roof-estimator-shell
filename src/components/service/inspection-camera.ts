/**
 * The inspection close-out's camera (owner, Oct 12; inspection-closeout.tsx has the cards): one
 * hidden file input and one upload mutation for the whole flow. `aim` is the checklist item the
 * next picked file belongs to (null: the findings step's general roll). The photo is recorded
 * with role "other", no repair, and the item's id in `item_key` (service_job_photos.item_key,
 * migration 20261012190000) — the same upload path as a repair's photo (shrinkPhoto → the service
 * bucket → registerJobPhoto; a failed register removes the object). A failed upload keeps its
 * file (one per item) for "Retry upload", as on a repair. A .ts module (createElement, no JSX) so
 * the cards file exports components only.
 */
import { createElement, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { photoObjectPath, registerJobPhoto, type JobPhotoRow } from "@/lib/service-field.functions";
import {
  fieldKeys,
  getPosition,
  loudError,
  removeFromServiceBucket,
  shrinkPhoto,
  uploadToServiceBucket,
} from "@/components/service/field-utils";

/** The findings step's general roll: no item. */
const ROLL = "__roll";
interface Shot {
  file: File;
}
export interface InspectionPhotoControls {
  uploading: boolean;
  failed: Shot | undefined;
  onPhoto: () => void;
  onRetry: () => void;
  onDiscard: () => void;
}
export interface InspectionCamera {
  inputs: React.ReactNode;
  /** The controls for one checklist item (its id), or for the roll (null). */
  controls: (itemKey: string | null) => InspectionPhotoControls;
}

export function useInspectionCamera(jobId: string): InspectionCamera {
  const qc = useQueryClient();
  const registerFn = useServerFn(registerJobPhoto);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const aim = useRef<string | null>(null);
  const [failed, setFailed] = useState<Record<string, Shot>>({});
  const slot = (key: string | null) => key ?? ROLL;
  const upload = useMutation({
    mutationFn: async ({ file, itemKey }: Shot & { itemKey: string | null }) => {
      // GPS runs beside the upload and gives up after 3 s; a photo never waits on it.
      const where = getPosition(3000);
      const shrunk = await shrinkPhoto(file);
      const path = photoObjectPath(jobId, shrunk.name || "photo.jpg");
      await uploadToServiceBucket(path, shrunk.blob, shrunk.type);
      const pos = await where;
      try {
        return await registerFn({
          data: {
            service_job_id: jobId,
            repair_id: null,
            role: "other",
            item_key: itemKey,
            storage_path: path,
            file_name: shrunk.name || null,
            file_size: shrunk.blob.size,
            taken_at: new Date(file.lastModified || Date.now()).toISOString(),
            lat: pos?.lat ?? null,
            lng: pos?.lng ?? null,
          },
        });
      } catch (e) {
        await removeFromServiceBucket(path);
        throw e;
      }
    },
    onSuccess: (row, v) => {
      qc.setQueryData<JobPhotoRow[]>(fieldKeys.photos(jobId), (old) => [...(old ?? []), row]);
      void qc.invalidateQueries({ queryKey: fieldKeys.events(jobId) });
      setFailed((f) => {
        const k = slot(v.itemKey);
        if (!(k in f)) return f;
        const { [k]: _landed, ...rest } = f;
        return rest;
      });
      toast.success("Photo saved");
    },
    onError: (e, v) => {
      setFailed((f) => ({ ...f, [slot(v.itemKey)]: { file: v.file } }));
      loudError("The photo did not upload (it is kept here — Retry upload with signal)", e);
    },
  });
  const pick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    const itemKey = aim.current;
    for (const file of files) upload.mutate({ file, itemKey });
  };
  const controls = (itemKey: string | null): InspectionPhotoControls => ({
    uploading: upload.isPending && slot(upload.variables?.itemKey ?? null) === slot(itemKey),
    failed: failed[slot(itemKey)],
    onPhoto: () => {
      aim.current = itemKey;
      inputRef.current?.click();
    },
    onRetry: () => {
      const shot = failed[slot(itemKey)];
      if (shot) upload.mutate({ ...shot, itemKey });
    },
    onDiscard: () =>
      setFailed((f) => {
        const { [slot(itemKey)]: _dropped, ...rest } = f;
        return rest;
      }),
  });
  const inputs = createElement("input", {
    ref: inputRef,
    type: "file",
    accept: "image/*",
    capture: "environment",
    className: "hidden",
    onChange: pick,
    "data-camera": "inspection",
  });
  return { inputs, controls };
}
