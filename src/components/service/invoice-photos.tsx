/**
 * The invoice editor's "Photos" fold (owner, Oct 1: "the pictures should be able to be added to
 * the invoice"): the ticket's photos, with their marks, grouped by repair, each with a tick for
 * "prints on this invoice". Untouched, an invoice prints what it always did — each printed
 * repair's first Before and first After (src/lib/invoice-photos.ts); a tick or an untick stores
 * this invoice's own choice (invoices.photo_ids, so 6012 and 6012.2 each keep theirs) and
 * "Use the default" goes back. On the PDF a printed repair's photos sit on its Work Completed
 * page and every other ticked photo on a closing Photos page, marks drawn in. A final invoice
 * shows its choice read-only. Saved on each tick; a failure is a toast with the server's message.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ChevronDown, Images, Loader2, RotateCcw } from "lucide-react";

import { useAuth } from "@/lib/auth-store";
import {
  getInvoicePhotos,
  setInvoicePhotos,
  type InvoicePhotos as InvoicePhotosData,
} from "@/lib/invoice-photos.functions";
import {
  REPAIR_PAGE_PHOTOS,
  invoicePhotoRoleLabel,
  invoicePhotosSummary,
} from "@/lib/invoice-photos";
import { photoOrdinals } from "@/lib/photo-annotations";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { PhotoThumb } from "@/components/service/field-shared";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
/** Under "invoice-photos" (the photo editor refreshes every invoice's fold after a save). */
const invoicePhotosKey = (invoiceId: string) => ["invoice-photos", invoiceId] as const;

export function InvoicePhotos({
  invoiceId,
  ticketNumber,
  editable,
}: {
  invoiceId: string;
  ticketNumber: number | string;
  /** A draft: the ticks can change. */
  editable: boolean;
}) {
  const { session } = useAuth();
  const [open, setOpen] = useState(false);
  const getFn = useServerFn(getInvoicePhotos);
  const q = useQuery({
    queryKey: invoicePhotosKey(invoiceId),
    queryFn: () => getFn({ data: { id: invoiceId } }),
    enabled: !!session,
  });
  const summary = q.error
    ? "could not load"
    : q.data
      ? q.data.photos.length
        ? `${invoicePhotosSummary(q.data.chosen.length)}${q.data.photo_ids === null ? " (default)" : ""}`
        : "no photos on the ticket"
      : null;
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-lg border p-3">
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-2 text-left text-sm font-medium"
          aria-label={open ? "Fold the photos" : "Show the photos"}
        >
          <Images className="h-4 w-4" aria-hidden />
          Photos
          {summary && (
            <span
              className={`min-w-0 truncate font-normal ${q.error ? "text-destructive" : "text-muted-foreground"}`}
            >
              · {summary}
            </span>
          )}
          <ChevronDown
            className={`ml-auto h-4 w-4 shrink-0 transition-transform ${open ? "" : "-rotate-90"}`}
            aria-hidden
          />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-3">
          {q.error ? (
            <p className="text-sm text-destructive">
              Could not load the photos: {errText(q.error)}
            </p>
          ) : !q.data ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading the photos…
            </p>
          ) : (
            <PhotoPicker
              data={q.data}
              invoiceId={invoiceId}
              ticketNumber={ticketNumber}
              editable={editable && q.data.status === "draft"}
            />
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function PhotoPicker({
  data,
  invoiceId,
  ticketNumber,
  editable,
}: {
  data: InvoicePhotosData;
  invoiceId: string;
  ticketNumber: number | string;
  editable: boolean;
}) {
  const qc = useQueryClient();
  const setFn = useServerFn(setInvoicePhotos);
  const save = useMutation({
    mutationFn: (photo_ids: string[] | null) => setFn({ data: { id: invoiceId, photo_ids } }),
    onSuccess: (r) => qc.setQueryData(invoicePhotosKey(invoiceId), r),
    onError: (e) => toast.error(`Could not save the invoice's photos: ${errText(e)}`),
  });
  const chosen = new Set(save.isPending && save.variables ? save.variables : data.chosen);
  const toggle = (id: string, on: boolean) => {
    const next = data.chosen.filter((x) => x !== id);
    if (on) next.push(id);
    // Kept in the ticket's photo order (the PDF orders them itself).
    const order = new Map(data.photos.map((p, i) => [p.id, i]));
    save.mutate(next.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0)));
  };
  if (!data.photos.length)
    return <p className="text-sm text-muted-foreground">This ticket has no photos yet.</p>;

  const ord = photoOrdinals(data.photos);
  const printed = new Set(data.repairs.filter((r) => r.print_on_invoice).map((r) => r.id));
  const groups: { key: string; title: string; note: string | null; photos: typeof data.photos }[] =
    [];
  for (const r of data.repairs) {
    const mine = data.photos.filter((p) => p.repair_id === r.id);
    if (!mine.length) continue;
    groups.push({
      key: r.id,
      title: r.name,
      note: printed.has(r.id)
        ? `prints on its Work Completed page (${REPAIR_PAGE_PHOTOS} photos there; more go on the Photos page)`
        : "this repair does not print: ticked photos go on the Photos page",
      photos: mine,
    });
  }
  const loose = data.photos.filter(
    (p) => !p.repair_id || !data.repairs.some((r) => r.id === p.repair_id),
  );
  if (loose.length)
    groups.push({
      key: "other",
      title: "Other photos",
      note: "ticked photos go on the Photos page at the end",
      photos: loose,
    });

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Ticked photos print on this invoice with their marks.
        {data.photo_ids === null
          ? " Nothing chosen yet: each printed repair's first Before and After photo prints."
          : " This invoice has its own choice."}
      </p>
      {groups.map((g) => (
        <div key={g.key} className="space-y-1.5">
          <p className="text-sm font-medium">
            {g.title}{" "}
            {g.note && (
              <span className="text-xs font-normal text-muted-foreground">· {g.note}</span>
            )}
          </p>
          <ul className="flex flex-wrap gap-3">
            {g.photos.map((p) => {
              const on = chosen.has(p.id);
              const n = ord.get(p.id) ?? 1;
              const label = `${invoicePhotoRoleLabel(p.role)} ${n}`;
              return (
                <li key={p.id} className="w-20 space-y-1">
                  <PhotoThumb photo={p} ticketNumber={ticketNumber} ordinal={n} />
                  <div className="flex items-center gap-1.5">
                    <Checkbox
                      id={`invoice-photo-${p.id}`}
                      checked={on}
                      disabled={!editable || save.isPending}
                      aria-label={`Print ${label} on the invoice`}
                      onCheckedChange={(v) => toggle(p.id, v === true)}
                    />
                    <label htmlFor={`invoice-photo-${p.id}`} className="truncate text-xs">
                      {label}
                    </label>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      {editable && data.photo_ids !== null && (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={save.isPending}
          title="Print each printed repair's first Before and After photo, as before"
          onClick={() => save.mutate(null)}
        >
          <RotateCcw className="mr-1 h-4 w-4" /> Use the default
        </Button>
      )}
      {!editable && (
        <p className="text-xs text-muted-foreground">
          This invoice is final: its photos are fixed on its PDF.
        </p>
      )}
      {save.isPending && (
        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…
        </p>
      )}
    </div>
  );
}
