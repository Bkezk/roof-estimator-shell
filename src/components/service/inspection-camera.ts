/**
 * The inspection close-out's camera (owner, Oct 12; inspection-closeout.tsx has the cards): one
 * hidden file input for the whole flow, feeding the portal's one picture queue (picture-queue.ts;
 * Oct 28). `aim` is the checklist item the next shot belongs to (null: the findings step's
 * general roll). The photo is recorded with role "other", no repair, and the item's id in
 * `item_key` (service_job_photos.item_key, migration 20261012190000) — the same path as every
 * other ticket picture (shrinkPhoto → the service bucket → registerJobPhoto; a refused register
 * removes the object), up to three at a time while the technician carries on. A shot the signal
 * dropped is kept on the phone and goes up on its own; a refused one is red in the roll with
 * Retry / Discard.
 *
 * Mark up as you shoot: the input has `capture`, so on a phone (shouldMarkUpAfterShot) the markup
 * editor opens on the fresh shot (AfterShotEditor), with Skip, Done and "Take another" for the
 * same item. A .ts module (createElement, no JSX) so the cards file exports components only.
 */
import { createElement, useRef, useState, type ReactNode } from "react";

import { shouldMarkUpAfterShot, type QueuedPicture } from "@/lib/photo-upload-queue";
import { coarsePointer, takePickedFiles } from "@/components/service/field-utils";
import { usePictures } from "@/components/service/picture-queue";
import { AfterShotEditor, type FreshShot } from "@/components/service/picture-queue-ui";

export interface InspectionPhotoControls {
  /** In line / going up for this item (the badge). */
  uploading: number;
  /** Kept on the phone for signal. */
  waitingForSignal: number;
  /** This item's pictures in flight (placeholders in the roll). */
  pending: QueuedPicture[];
  onPhoto: () => void;
  onRetry: (id: string) => void;
  onDiscard: (id: string) => void;
}
export interface InspectionCamera {
  inputs: ReactNode;
  /** The controls for one checklist item (its id), or for the roll (null). */
  controls: (itemKey: string | null, label?: string) => InspectionPhotoControls;
}

export function useInspectionCamera(jobId: string): InspectionCamera {
  const pictures = usePictures({ jobId, repairId: null, role: "other" });
  const inputRef = useRef<HTMLInputElement | null>(null);
  const aim = useRef<{ itemKey: string | null; label: string }>({ itemKey: null, label: "Photo" });
  const [shot, setShot] = useState<(FreshShot & { itemKey: string | null }) | null>(null);
  const open = (itemKey: string | null, label: string) => {
    aim.current = { itemKey, label };
    inputRef.current?.click();
  };
  const pick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target;
    const files = takePickedFiles(input);
    if (files.length === 0) return;
    const { itemKey, label } = aim.current;
    const fromCamera = shouldMarkUpAfterShot({
      capture: input.getAttribute("capture"),
      coarsePointer: coarsePointer(),
    });
    const ids = pictures.add(
      files,
      { jobId, repairId: null, itemKey, role: "other" },
      { fromCamera },
    );
    const [first] = files;
    const [id] = ids;
    if (fromCamera && files.length === 1 && first && id)
      setShot({ id, file: first, label, itemKey });
  };
  const controls = (itemKey: string | null, label = "Photo"): InspectionPhotoControls => {
    const mine = pictures.entries.filter((p) => p.target.itemKey === itemKey);
    return {
      uploading: mine.filter((p) => p.status !== "held" && p.status !== "failed").length,
      waitingForSignal: mine.filter((p) => p.status === "held").length,
      pending: mine,
      onPhoto: () => open(itemKey, label),
      onRetry: pictures.retry,
      onDiscard: pictures.discard,
    };
  };
  const inputs = createElement(
    "span",
    { className: "contents" },
    createElement("input", {
      ref: inputRef,
      type: "file",
      accept: "image/*",
      capture: "environment",
      className: "hidden",
      onChange: pick,
      "data-camera": "inspection",
    }),
    shot
      ? createElement(AfterShotEditor, {
          shot,
          onClose: () => setShot(null),
          onTakeAnother: () => open(shot.itemKey, shot.label),
          attachMarks: pictures.attachMarks,
        })
      : null,
  );
  return { inputs, controls };
}
