/**
 * "Show the customer" (owner, Oct 27: "make it to where the person doing the takeoff can click
 * the deficiency spot to open the picture to show the customer, this is also kind of becoming a
 * selling tool"): a full-screen lightbox over the takeoff with the deficiency's pictures large,
 * prev / next (the arrow keys, a swipe on a phone), its name and note under them, and
 * "Previous / Next deficiency" to walk every deficiency on the takeoff in number order. No
 * prices, no internal data. Dark by design (black, white text) so it reads the same in either
 * theme. Opened by a click on an already selected deficiency pin, the card's View button, or a
 * double-click on the pin (editor.tsx holds which one is open).
 *
 * The pictures' signed read URLs come from `useDeficiencyPhotoUrls` (./deficiency-photos.ts).
 */
import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, ImageOff, Loader2, X } from "lucide-react";

import type { DeficiencyQuantity, TakeoffObject } from "@/lib/takeoff/model";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

import { useDeficiencyPhotoUrls } from "./deficiency-photos";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function DeficiencyLightbox(props: {
  takeoffId: string;
  /** Every deficiency on the takeoff, in number order. */
  deficiencies: readonly DeficiencyQuantity[];
  objects: readonly TakeoffObject[];
  /** The deficiency shown, or null when closed. */
  openId: string | null;
  onClose: () => void;
  /** Walk to another deficiency (the editor also selects it and shows its page). */
  onWalk: (id: string) => void;
}) {
  const { openId, deficiencies } = props;
  const index = deficiencies.findIndex((d) => d.objectId === openId);
  const current = index >= 0 ? deficiencies[index]! : null;
  const object = current ? props.objects.find((o) => o.id === current.objectId) : undefined;
  const photos = object?.kind === "count" ? (object.attrs.photos ?? []) : [];
  const urls = useDeficiencyPhotoUrls(
    props.takeoffId,
    photos.map((p) => p.path),
  );
  const [pic, setPic] = useState(0);
  // A new deficiency starts on its first picture.
  useEffect(() => setPic(0), [openId]);
  const count = photos.length;
  const canPrev = pic > 0;
  const canNext = pic < count - 1;
  const prevDef = index > 0 ? deficiencies[index - 1] : undefined;
  const nextDef =
    index >= 0 && index < deficiencies.length - 1 ? deficiencies[index + 1] : undefined;
  const open = !!current;
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft" && canPrev) setPic((p) => p - 1);
      else if (e.key === "ArrowRight" && canNext) setPic((p) => p + 1);
      else if (e.key === "ArrowUp" && prevDef) props.onWalk(prevDef.objectId);
      else if (e.key === "ArrowDown" && nextDef) props.onWalk(nextDef.objectId);
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    // Capture: the viewer's own key handler must not see these.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, canPrev, canNext, prevDef, nextDef, props]);
  const touchX = useRef<number | null>(null);
  const photo = photos[pic];
  const url = photo ? (urls.data?.[photo.path] ?? null) : null;
  return (
    <Dialog open={open} onOpenChange={(o) => (!o ? props.onClose() : undefined)}>
      <DialogContent
        className="left-0 top-0 h-svh w-screen max-w-none translate-x-0 translate-y-0 gap-0 rounded-none border-0 bg-black p-0 text-white [&>button]:hidden"
        aria-describedby={undefined}
      >
        {current && (
          <div className="flex h-full flex-col">
            <div className="flex items-center gap-3 px-4 py-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-600 text-sm font-bold">
                {current.number}
              </span>
              <DialogTitle className="min-w-0 flex-1 truncate text-base font-semibold text-white">
                {current.name}
              </DialogTitle>
              <span className="hidden text-xs text-neutral-400 sm:inline">
                Deficiency {index + 1} of {deficiencies.length}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 text-white hover:bg-white/10 hover:text-white"
                aria-label="Close"
                onClick={props.onClose}
              >
                <X className="h-5 w-5" />
              </Button>
            </div>
            <div
              className="relative flex min-h-0 flex-1 items-center justify-center bg-black"
              // A swipe leafs through the pictures.
              onTouchStart={(e) => {
                touchX.current = e.touches[0]?.clientX ?? null;
              }}
              onTouchEnd={(e) => {
                const from = touchX.current;
                touchX.current = null;
                const to = e.changedTouches[0]?.clientX;
                if (from === null || to === undefined) return;
                const dx = to - from;
                if (dx <= -40 && canNext) setPic((p) => p + 1);
                else if (dx >= 40 && canPrev) setPic((p) => p - 1);
              }}
            >
              {count === 0 ? (
                <div className="flex flex-col items-center gap-2 text-neutral-400">
                  <ImageOff className="h-10 w-10" />
                  <p className="text-sm">No pictures on this deficiency yet.</p>
                </div>
              ) : urls.isLoading ? (
                <Loader2 className="h-8 w-8 animate-spin text-neutral-400" />
              ) : urls.error ? (
                <p className="max-w-md px-4 text-center text-sm text-red-300">
                  Could not load the pictures: {errText(urls.error)}
                </p>
              ) : url ? (
                <img
                  src={url}
                  alt={photo?.name ?? `${current.name} picture ${pic + 1}`}
                  className="max-h-full max-w-full object-contain select-none"
                  draggable={false}
                />
              ) : (
                <div className="flex flex-col items-center gap-2 text-neutral-400">
                  <ImageOff className="h-10 w-10" />
                  <p className="text-sm">This picture is missing from storage.</p>
                </div>
              )}
              {count > 1 && (
                <>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute left-2 top-1/2 h-12 w-12 -translate-y-1/2 rounded-full bg-black/50 text-white hover:bg-black/70 hover:text-white"
                    aria-label="Previous picture"
                    disabled={!canPrev}
                    onClick={() => setPic((p) => p - 1)}
                  >
                    <ChevronLeft className="h-7 w-7" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute right-2 top-1/2 h-12 w-12 -translate-y-1/2 rounded-full bg-black/50 text-white hover:bg-black/70 hover:text-white"
                    aria-label="Next picture"
                    disabled={!canNext}
                    onClick={() => setPic((p) => p + 1)}
                  >
                    <ChevronRight className="h-7 w-7" />
                  </Button>
                  <span className="absolute bottom-2 right-3 rounded bg-black/60 px-2 py-0.5 text-xs tabular-nums text-neutral-200">
                    {pic + 1} / {count}
                  </span>
                </>
              )}
            </div>
            <div className="space-y-2 px-4 py-3">
              <DialogDescription className="whitespace-pre-wrap text-sm text-neutral-200">
                {current.note ?? "No note."}
              </DialogDescription>
              {deficiencies.length > 1 && (
                <div className="flex items-center justify-between gap-2">
                  <Button
                    variant="outline"
                    className="h-11 border-neutral-700 bg-transparent text-white hover:bg-white/10 hover:text-white sm:h-9"
                    disabled={!prevDef}
                    onClick={() => prevDef && props.onWalk(prevDef.objectId)}
                  >
                    <ChevronLeft className="mr-1 h-4 w-4" /> Previous deficiency
                  </Button>
                  <span className="text-xs text-neutral-400 sm:hidden">
                    {index + 1} of {deficiencies.length}
                  </span>
                  <Button
                    variant="outline"
                    className="h-11 border-neutral-700 bg-transparent text-white hover:bg-white/10 hover:text-white sm:h-9"
                    disabled={!nextDef}
                    onClick={() => nextDef && props.onWalk(nextDef.objectId)}
                  >
                    Next deficiency <ChevronRight className="ml-1 h-4 w-4" />
                  </Button>
                </div>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
