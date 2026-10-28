/**
 * The app's one picture queue (owner, Oct 28; the pure core is lib/photo-upload-queue.ts): the
 * real shrink (field-utils shrinkPhoto — 2048 px / JPEG 0.85, unchanged), the service bucket,
 * registerJobPhoto, savePhotoAnnotations, GPS beside the upload, and the phone's store
 * (lib/picture-store.ts: IndexedDB, else memory with a loud note). One instance per browser tab,
 * made the first time a screen asks for it; it restores what the phone kept and then listens for
 * the signal coming back (`online`), the portal coming to the front (focus / visibilitychange) and a
 * slow timer while pictures wait — the technician never has to do anything.
 *
 * Its events are the portal's: a registered row goes straight into the ticket's photo list
 * (fieldKeys.photos) and the events refresh; a failure is a loud toast naming the file with
 * Retry; a picture held for signal says so once; marks that could not be saved are loud.
 *
 * `usePictures(filter)` is what the screens use: the entries in flight for a ticket (and repair /
 * item / role), their counts, and add / retry / discard / attachMarks.
 */
import { useCallback, useMemo } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import {
  registerJobPhoto,
  savePhotoAnnotations,
  type JobPhotoRow,
} from "@/lib/service-field.functions";
import {
  PhotoUploadQueue,
  usePictureQueue,
  type PictureStore,
  type PictureTarget,
  type QueuedPicture,
  type StoredPicture,
} from "@/lib/photo-upload-queue";
import type { PhotoMarks } from "@/lib/photo-annotations";
import { openPictureStore } from "@/lib/picture-store";
import {
  fieldKeys,
  getPosition,
  loudError,
  removeFromServiceBucket,
  shrinkPhoto,
  uploadPlan,
  uploadToServiceBucket,
} from "@/components/service/field-utils";

const ROLE_LABEL: Record<string, string> = { before: "Before", after: "After", other: "" };

/** How often held pictures are tried again on their own (the phone may say online and still have no bars). */
const RETRY_EVERY_MS = 45_000;

/** A store whose every call waits for the device's store to open (IndexedDB, else memory). */
function deferredStore(ready: Promise<PictureStore>): PictureStore {
  return {
    put: (p: StoredPicture) => ready.then((s) => s.put(p)),
    remove: (id) => ready.then((s) => s.remove(id)),
    all: () => ready.then((s) => s.all()),
  };
}

let instance: PhotoUploadQueue<JobPhotoRow> | null = null;
let boundClient: QueryClient | null = null;

/** The one queue, wired to this QueryClient the first time; later calls return the same queue. */
export function getPictureQueue(qc: QueryClient): PhotoUploadQueue<JobPhotoRow> {
  if (instance) {
    if (boundClient !== qc) {
      boundClient = qc;
      instance.setEvents(events(instance, qc));
    }
    return instance;
  }
  const opened = openPictureStore();
  const ready = opened.then((o) => o.store);
  const queue = new PhotoUploadQueue<JobPhotoRow>({
    shrink: shrinkPhoto,
    upload: (path, p) => uploadToServiceBucket(path, p.blob, p.type),
    removeUpload: removeFromServiceBucket,
    register: (data) => registerJobPhoto({ data }),
    saveMarks: async (row, marks) => {
      const saved = await savePhotoAnnotations({
        data: { id: row.id, service_job_id: row.service_job_id, annotations: marks },
      });
      boundClient?.setQueryData<JobPhotoRow[]>(fieldKeys.photos(row.service_job_id), (old) =>
        old?.map((p) => (p.id === saved.id ? saved : p)),
      );
    },
    store: deferredStore(ready),
    online: () => (typeof navigator === "undefined" ? true : navigator.onLine !== false),
    pathFor: (jobId, p) => uploadPlan([p], jobId)[0]!.path,
    // GPS runs beside the upload and gives up after 3 s; a photo never waits on it.
    locate: () => getPosition(3000),
  });
  instance = queue;
  boundClient = qc;
  queue.setEvents(events(queue, qc));

  void opened.then((o) => {
    if (o.fallback && typeof window !== "undefined")
      toast.error(
        "This phone will not keep pictures waiting for signal if this page closes — keep it open until they are up",
        { duration: 15_000, id: "picture-store" },
      );
    return queue.restore();
  });

  if (typeof window !== "undefined") {
    const resume = () => {
      if (navigator.onLine !== false) queue.resume();
    };
    window.addEventListener("online", resume);
    window.addEventListener("focus", resume);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") resume();
    });
    window.setInterval(() => {
      if (queue.snapshot().some((e) => e.status === "held")) resume();
    }, RETRY_EVERY_MS);
  }
  return queue;
}

function events(queue: PhotoUploadQueue<JobPhotoRow>, qc: QueryClient) {
  return {
    onRegistered: (entry: QueuedPicture, row: JobPhotoRow) => {
      qc.setQueryData<JobPhotoRow[]>(fieldKeys.photos(row.service_job_id), (old) =>
        old ? (old.some((p) => p.id === row.id) ? old : [...old, row]) : old,
      );
      void qc.invalidateQueries({ queryKey: fieldKeys.photos(row.service_job_id) });
      void qc.invalidateQueries({ queryKey: fieldKeys.events(row.service_job_id) });
      const role = ROLE_LABEL[entry.target.role] ?? "";
      toast.success(role ? `${role} photo saved` : "Picture added", { id: "picture-landed" });
    },
    onFailed: (entry: QueuedPicture, e: unknown) => {
      toast.error(`${entry.fileName || "A picture"} did not upload: ${msg(e)}`, {
        duration: 12_000,
        action: { label: "Retry", onClick: () => queue.retry(entry.id) },
      });
    },
    onHeld: () => {
      toast.message("Picture kept on this phone — it goes up when the signal is back", {
        id: "picture-held",
        duration: 6_000,
      });
    },
    onMarksFailed: (entry: QueuedPicture, e: unknown) => {
      loudError(`The marks on ${entry.fileName || "the picture"} did not save`, e);
    },
    onStoreError: (e: unknown) => {
      toast.error(
        `This phone could not keep a picture waiting for signal (${msg(e)}) — keep this page open until it is up`,
        { duration: 15_000, id: "picture-store" },
      );
    },
  };
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export interface Pictures {
  /** The pictures in flight for the filter, in pick order. */
  entries: QueuedPicture[];
  /** In line / shrinking / uploading. */
  uploading: number;
  /** Held on the phone for signal. */
  waitingForSignal: number;
  failed: number;
  /** Put files in line; the ids (a camera shot's, for the after-shot editor). */
  add: (files: readonly File[], target: PictureTarget, opts?: { fromCamera?: boolean }) => string[];
  retry: (id: string) => void;
  discard: (id: string) => void;
  /** Marks drawn right after the shot, for the row when it exists. */
  attachMarks: (id: string, marks: PhotoMarks | null) => Promise<void>;
}

/** The queue as one screen sees it: a ticket's pictures (and a repair's / item's / role's). */
export function usePictures(filter: Partial<PictureTarget> | null): Pictures {
  const qc = useQueryClient();
  const queue = getPictureQueue(qc);
  const { entries, summary } = usePictureQueue(queue, filter);
  const add = useCallback<Pictures["add"]>(
    (files, target, opts) => queue.add(files, target, opts),
    [queue],
  );
  const retry = useCallback((id: string) => queue.retry(id), [queue]);
  const discard = useCallback((id: string) => queue.discard(id), [queue]);
  const attachMarks = useCallback(
    (id: string, marks: PhotoMarks | null) => queue.attachMarks(id, marks),
    [queue],
  );
  return useMemo(
    () => ({
      entries,
      uploading: summary.uploading,
      waitingForSignal: summary.waitingForSignal,
      failed: summary.failed,
      add,
      retry,
      discard,
      attachMarks,
    }),
    [entries, summary, add, retry, discard, attachMarks],
  );
}
