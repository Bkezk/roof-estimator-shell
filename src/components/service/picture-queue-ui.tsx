/**
 * What the picture queue looks like on a screen (owner, Oct 28; the queue is picture-queue.ts,
 * the core lib/photo-upload-queue.ts):
 *
 *   - `UploadBadge`: "3 uploading", small, wherever pictures are added. Nothing when none is.
 *   - `WaitingForSignalLine`: "3 pictures waiting for signal" — plain words, amber, never
 *     "offline" / "network" / "sync". Nothing when none is.
 *   - `PendingThumbs`: a grey placeholder with a spinner for every picture still in flight, in
 *     the strip where its thumbnail will appear; a held one shows an hourglass; a failed one is
 *     red with Retry and Discard. Each goes when the row is registered (the real thumb takes its
 *     place through the query cache).
 *   - `AfterShotEditor`: mark up as you shoot (the phone's camera only — the caller decides with
 *     shouldMarkUpAfterShot): the fresh shot in the markup editor while its upload runs; Done
 *     saves the marks onto the row (held until the row exists), Skip saves none, "Take another"
 *     saves and opens the camera again for the same repair / item and role — one tap per shot.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, Hourglass, Loader2, RefreshCw, X } from "lucide-react";

import { serializePhotoMarks, type PhotoMark, type Rotation } from "@/lib/photo-annotations";
import { uploadingBadge, waitingForSignalLine, type QueuedPicture } from "@/lib/photo-upload-queue";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { loudError } from "@/components/service/field-utils";
import { useNaturalSize } from "@/components/service/photo-export";
import { PhotoMarkupSurface } from "@/components/service/photo-markup";

export function UploadBadge({ n, className = "" }: { n: number; className?: string }) {
  const text = uploadingBadge(n);
  if (!text) return null;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground ${className}`}
      role="status"
      aria-live="polite"
      data-line="uploading-badge"
    >
      <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> {text}
    </span>
  );
}

export function WaitingForSignalLine({ n, className = "" }: { n: number; className?: string }) {
  const text = waitingForSignalLine(n);
  if (!text) return null;
  return (
    <p
      className={`flex items-center gap-1.5 text-sm font-medium text-amber-700 dark:text-amber-400 ${className}`}
      role="status"
      aria-live="polite"
      data-line="waiting-for-signal"
    >
      <Hourglass className="h-4 w-4 shrink-0" aria-hidden /> {text}
    </p>
  );
}

/** One picture's placeholder in a strip. */
function PendingThumb({
  entry,
  size,
  onRetry,
  onDiscard,
}: {
  entry: QueuedPicture;
  size: "sm" | "md";
  onRetry: (id: string) => void;
  onDiscard: (id: string) => void;
}) {
  const box = size === "sm" ? "h-16 w-16" : "h-20 w-20";
  const failed = entry.status === "failed";
  const held = entry.status === "held";
  const title = failed
    ? `${entry.fileName || "This picture"} did not upload${entry.error ? `: ${entry.error}` : ""}`
    : held
      ? `${entry.fileName || "This picture"} is waiting for signal`
      : `${entry.fileName || "This picture"} is uploading`;
  return (
    <div className="flex flex-col items-center gap-0.5" data-pending={entry.status}>
      <div
        className={`relative ${box} shrink-0 overflow-hidden rounded-md border bg-muted/60 ${
          failed ? "border-destructive" : "opacity-70"
        }`}
        title={title}
        role="img"
        aria-label={title}
      >
        <span className="flex h-full items-center justify-center">
          {failed ? (
            <X className="h-5 w-5 text-destructive" aria-hidden />
          ) : held ? (
            <Hourglass className="h-5 w-5 text-amber-700 dark:text-amber-400" aria-hidden />
          ) : (
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden />
          )}
        </span>
      </div>
      {failed && (
        <div className="flex gap-1">
          <button
            type="button"
            className="min-h-9 px-1 text-[11px] font-medium text-primary underline-offset-2 hover:underline"
            aria-label={`Retry ${entry.fileName || "this picture"}`}
            onClick={() => onRetry(entry.id)}
          >
            <RefreshCw className="mr-0.5 inline h-3 w-3" aria-hidden />
            Retry
          </button>
          <button
            type="button"
            className="min-h-9 px-1 text-[11px] text-muted-foreground underline-offset-2 hover:underline"
            aria-label={`Discard ${entry.fileName || "this picture"}`}
            onClick={() => onDiscard(entry.id)}
          >
            Discard
          </button>
        </div>
      )}
    </div>
  );
}

/** The placeholders for a strip's pictures in flight (nothing when the list is empty). */
export function PendingThumbs({
  entries,
  size = "md",
  onRetry,
  onDiscard,
}: {
  entries: readonly QueuedPicture[];
  size?: "sm" | "md" | undefined;
  onRetry: (id: string) => void;
  onDiscard: (id: string) => void;
}) {
  if (entries.length === 0) return null;
  return (
    <>
      {entries.map((e) => (
        <PendingThumb key={e.id} entry={e} size={size} onRetry={onRetry} onDiscard={onDiscard} />
      ))}
    </>
  );
}

/** A shot just taken with the phone's camera, queued; the editor opens on it. */
export interface FreshShot {
  /** The queue entry's id (attachMarks). */
  id: string;
  file: File;
  /** "Before" / "After" / "Photo" / the item's label — the title and the Take another button. */
  label: string;
}

/** How long the picture gets to open before the editor gives up on it (a HEIC the browser cannot show). */
const OPEN_PATIENCE_MS = 4000;

export function AfterShotEditor({
  shot,
  onClose,
  onTakeAnother,
  attachMarks,
}: {
  shot: FreshShot;
  onClose: () => void;
  /** Open the camera again for the same place and role. */
  onTakeAnother: () => void;
  /** The queue's attachMarks for this shot: saved onto the row, or held until it exists. */
  attachMarks: (id: string, marks: ReturnType<typeof serializePhotoMarks>) => Promise<void>;
}) {
  const url = useMemo(() => URL.createObjectURL(shot.file), [shot.file]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  const size = useNaturalSize(url);
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (size) return;
    const t = window.setTimeout(() => setSlow(true), OPEN_PATIENCE_MS);
    return () => window.clearTimeout(t);
  }, [size]);
  const latest = useRef<{ marks: PhotoMark[]; rotation: Rotation }>({ marks: [], rotation: 0 });
  const closed = useRef(false);
  const finish = (save: boolean, then?: () => void) => {
    if (closed.current) return;
    closed.current = true;
    if (save) {
      const marks = serializePhotoMarks(latest.current.marks, latest.current.rotation);
      if (marks)
        void attachMarks(shot.id, marks).catch((e) =>
          loudError(`The marks on ${shot.file.name || "the picture"} did not save`, e),
        );
    }
    onClose();
    then?.();
  };
  const footer = (
    <>
      <Button
        type="button"
        variant="outline"
        className="h-11 sm:h-9"
        onClick={() => finish(true, onTakeAnother)}
        data-action="take-another"
      >
        <Camera className="mr-1 h-4 w-4" aria-hidden /> Take another {shot.label}
      </Button>
      <Button
        type="button"
        variant="ghost"
        className="h-11 sm:h-9"
        onClick={() => finish(false)}
        data-action="skip"
      >
        Skip
      </Button>
    </>
  );
  return (
    <Dialog open onOpenChange={(o) => !o && finish(true)}>
      <DialogContent
        className="max-h-[96vh] w-[calc(100vw-1rem)] max-w-4xl overflow-y-auto p-3 sm:p-6"
        data-dialog="after-shot"
      >
        <DialogHeader>
          <DialogTitle>{shot.label} photo — mark it up?</DialogTitle>
          <DialogDescription>
            Circle the problem, point at it, box it or write on it, then Done. The picture is going
            up meanwhile; Skip keeps it as taken.
          </DialogDescription>
        </DialogHeader>
        {size ? (
          <PhotoMarkupSurface
            url={url}
            size={size}
            initialMarks={[]}
            onChange={(marks, rotation) => {
              latest.current = { marks, rotation };
            }}
            onDone={(marks, rotation) => {
              latest.current = { marks, rotation };
              finish(true);
            }}
            footer={footer}
          />
        ) : (
          <div className="space-y-3">
            {slow ? (
              <p className="text-sm text-muted-foreground">
                This picture cannot be opened here yet — mark it up from its thumbnail once it is
                saved.
              </p>
            ) : (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Opening the picture…
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2">{footer}</div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
