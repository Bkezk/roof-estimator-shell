/**
 * The action bar over a strip of picked photos (owner, Oct 28: fewer taps; the pure rules are
 * lib/photo-select.ts): "3 selected", then Remove (asks once, deletes each — deleteJobPhoto, the
 * thumb's own delete), Attach to inspection item (only when every picked photo is a loose "other"
 * photo — the server's rule; the ticket's checklist rows in a small dialog, one tap each; through
 * setJobPhotoItem per photo, item-photo-mutations.ts useSetPhotoItem), Download (one file per
 * photo with its marks drawn in, as Download all does) and Cancel. Sticky at the bottom of its
 * strip so it stays in reach on a phone.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Download, Link2, Loader2, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import { mergeChecklist, visibleChecklist } from "@/lib/inspection";
import { photoOrdinals } from "@/lib/photo-annotations";
import { attachable, removeQuestion, selectedLabel } from "@/lib/photo-select";
import { getTicketInspection } from "@/lib/service-inspection.functions";
import type { JobPhotoRow } from "@/lib/service-field.functions";
import { useAuth } from "@/lib/auth-store";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { inspectionKey } from "@/components/service/inspection-draft";
import { errText, loudError } from "@/components/service/field-utils";
import { useDeleteJobPhoto, useSetPhotoItem } from "@/components/service/item-photo-mutations";
import { downloadPhoto } from "@/components/service/photo-export";

/** The checklist rows of the ticket, each a button: the photos go onto the one tapped. */
function AttachToItemDialog({
  jobId,
  count,
  open,
  onOpenChange,
  busy,
  onPick,
}: {
  jobId: string;
  count: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  busy: boolean;
  onPick: (itemKey: string, label: string) => void;
}) {
  const { session } = useAuth();
  const getFn = useServerFn(getTicketInspection);
  const q = useQuery({
    queryKey: inspectionKey(jobId),
    queryFn: () => getFn({ data: { id: jobId } }),
    enabled: !!session && open,
    staleTime: 30_000,
  });
  const items = q.data ? visibleChecklist(mergeChecklist(q.data.inspection, q.data.checklist)) : [];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Attach to inspection item</DialogTitle>
          <DialogDescription>
            The {count === 1 ? "picture goes" : `${count} pictures go`} onto the checklist row you
            tap. They stay on the ticket.
          </DialogDescription>
        </DialogHeader>
        {q.error ? (
          <p className="text-sm text-destructive">
            Could not load the checklist: {errText(q.error)}
          </p>
        ) : !q.data ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading the checklist…
          </p>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">This ticket has no checklist rows.</p>
        ) : (
          <div className="flex max-h-[60vh] flex-col gap-1 overflow-y-auto" role="list">
            {items.map((item) => (
              <Button
                key={item.id}
                type="button"
                variant="outline"
                className="h-11 justify-start text-left"
                disabled={busy}
                onClick={() => onPick(item.id, item.label)}
              >
                {item.label}
                {item.status === "issue" && (
                  <span className="ml-auto text-xs text-amber-700 dark:text-amber-400">issue</span>
                )}
              </Button>
            ))}
          </div>
        )}
        <DialogFooter>
          <Button type="button" variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function PhotoSelectBar({
  jobId,
  ticketNumber,
  photos,
  selected,
  onClear,
}: {
  jobId: string;
  ticketNumber: string | number | null | undefined;
  /** Every photo of the strip (the ordinals for the file names). */
  photos: readonly JobPhotoRow[];
  /** The picked ones, in pick order. */
  selected: readonly JobPhotoRow[];
  onClear: () => void;
}) {
  const del = useDeleteJobPhoto(jobId);
  const setItem = useSetPhotoItem(jobId);
  const [attachOpen, setAttachOpen] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const n = selected.length;
  const canAttach = attachable(selected);
  const busy = removing || downloading !== null || setItem.isPending;

  const remove = async () => {
    if (!window.confirm(removeQuestion(n))) return;
    setRemoving(true);
    let gone = 0;
    for (const p of selected) {
      try {
        await del.mutateAsync(p.id);
        gone++;
      } catch {
        // Loud already (useDeleteJobPhoto's onError); the rest still go.
      }
    }
    setRemoving(false);
    if (gone > 0) toast.success(gone === 1 ? "Photo removed" : `${gone} photos removed`);
    onClear();
  };

  const download = async () => {
    const ord = photoOrdinals([...photos]);
    let failed = 0;
    for (const [i, p] of selected.entries()) {
      setDownloading(`${i + 1} of ${n}`);
      try {
        await downloadPhoto(p, ticketNumber, ord.get(p.id) ?? i + 1);
      } catch (e) {
        failed++;
        loudError(`${p.file_name ?? "A photo"} did not download`, e);
      }
      // A breath between files, so the browser takes each as its own download.
      await new Promise((r) => setTimeout(r, 400));
    }
    setDownloading(null);
    if (!failed) toast.success(`${n} ${n === 1 ? "photo" : "photos"} downloaded`);
  };

  return (
    <div
      className="sticky bottom-2 z-10 flex flex-wrap items-center gap-2 rounded-xl border bg-card p-2 shadow-md"
      role="toolbar"
      aria-label="Selected photos"
      data-line="photo-select-bar"
    >
      <span className="px-1 text-sm font-medium">{selectedLabel(n)}</span>
      <Button
        type="button"
        variant="outline"
        className="h-11 text-destructive hover:text-destructive sm:h-9"
        disabled={busy}
        onClick={() => void remove()}
      >
        {removing ? (
          <Loader2 className="mr-1 h-4 w-4 animate-spin" />
        ) : (
          <Trash2 className="mr-1 h-4 w-4" />
        )}
        Remove
      </Button>
      {canAttach && (
        <Button
          type="button"
          variant="outline"
          className="h-11 sm:h-9"
          disabled={busy}
          onClick={() => setAttachOpen(true)}
        >
          {setItem.isPending ? (
            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
          ) : (
            <Link2 className="mr-1 h-4 w-4" />
          )}
          Attach to inspection item
        </Button>
      )}
      <Button
        type="button"
        variant="outline"
        className="h-11 sm:h-9"
        disabled={busy}
        onClick={() => void download()}
      >
        {downloading ? (
          <Loader2 className="mr-1 h-4 w-4 animate-spin" />
        ) : (
          <Download className="mr-1 h-4 w-4" />
        )}
        {downloading ? `Downloading ${downloading}…` : "Download"}
      </Button>
      <Button
        type="button"
        variant="ghost"
        className="ml-auto h-11 sm:h-9"
        disabled={busy}
        onClick={onClear}
        aria-label="Cancel the selection"
      >
        <X className="mr-1 h-4 w-4" /> Cancel
      </Button>
      {canAttach && (
        <AttachToItemDialog
          jobId={jobId}
          count={n}
          open={attachOpen}
          onOpenChange={setAttachOpen}
          busy={setItem.isPending}
          onPick={(itemKey) =>
            setItem.mutate(
              // Oct 28: a photo can be on several items — this ADDS the pick, keeping the others.
              { ids: selected.map((p) => p.id), item_key: itemKey, attach: true },
              {
                onSuccess: () => {
                  setAttachOpen(false);
                  onClear();
                },
              },
            )
          }
        />
      )}
    </div>
  );
}
