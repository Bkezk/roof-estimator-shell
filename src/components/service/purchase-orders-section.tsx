/**
 * Purchase orders on a ticket (owner, Oct 1: CenterPoint's close-out "PO Information"): what a
 * crew bought for the job on the way (Lowe's, a supply house). A folding section with a summary
 * ("2 · $412.00 · 1 awaiting approval"); each PO shows its date, PO #, title, price, whether it
 * is approved and a link to its receipt (a signed URL, opened in a new tab), with Edit and
 * Delete for whoever may change it. "+ Add PO" opens the form: Date (today), PO #, Title,
 * Price (the box starts blank — owner rule: never a placeholder 0), Notes, Upload Receipt
 * (a photo or a PDF, straight to the private "service" bucket like the photos), Approved? and
 * Submit / Back. The fields stack on a phone.
 *
 * Approval is a manager's: the Approved toggle shows only to admins and managers
 * (`managesTickets`) and never on the technician's close-out (`field`); everyone else sees a
 * read-only badge. The approved total is an internal cost on the invoice (invoice-editor.tsx).
 * Mounted on the ticket page (service-page.tsx) and the close-out (closeout.tsx).
 */
import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, Paperclip, Pencil, Plus, Receipt, Trash2, Upload, X } from "lucide-react";

import { useAuth } from "@/lib/auth-store";
import { managesTickets } from "@/lib/access";
import {
  PO_NUMBER_MAX,
  parsePrice,
  poFormProblem,
  poMoney,
  poSummary,
  receiptContentType,
  receiptFileProblem,
  type PoDraft,
} from "@/lib/purchase-orders";
import {
  deletePurchaseOrder,
  listPurchaseOrders,
  receiptObjectName,
  savePurchaseOrder,
  setPurchaseOrderApproved,
  type PurchaseOrderView,
} from "@/lib/service-pos.functions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { AutoTextarea } from "@/components/ui/auto-textarea";
import { Box } from "@/components/service/field-shared";
import {
  errText,
  fieldKeys,
  localYmd,
  loudError,
  removeFromServiceBucket,
  shortDay,
  uploadToServiceBucket,
  useSignedUrl,
} from "@/components/service/field-utils";

export function PurchaseOrdersSection({
  jobId,
  field = false,
}: {
  jobId: string;
  /** The technician's close-out: never the Approved toggle there. */
  field?: boolean | undefined;
}) {
  const { session, profile } = useAuth();
  const listFn = useServerFn(listPurchaseOrders);
  const q = useQuery({
    queryKey: fieldKeys.pos(jobId),
    queryFn: () => listFn({ data: { jobId } }),
    enabled: !!session,
  });
  // null = no form open; "new" = adding; an id = editing that PO.
  const [editing, setEditing] = useState<string | null>(null);
  const pos = q.data?.pos ?? [];
  const approver = !field && managesTickets(profile) && !!q.data?.canApprove;

  return (
    <Box
      title="Purchase orders"
      icon={Receipt}
      collapsible
      storageKey="purchase-orders"
      defaultOpen={false}
      summary={q.data ? poSummary(pos) : undefined}
    >
      {q.error ? (
        <p className="text-sm text-destructive">
          Could not load the purchase orders: {errText(q.error)}
        </p>
      ) : !q.data ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading the purchase orders…
        </p>
      ) : (
        <div className="space-y-3">
          {pos.length === 0 && editing !== "new" && (
            <p className="text-sm text-muted-foreground">
              No purchase orders. Add one for material bought for this job.
            </p>
          )}
          {pos.length > 0 && (
            <ul className="divide-y rounded-md border" aria-label="Purchase orders">
              {pos.map((po) =>
                editing === po.id ? (
                  <li key={po.id} className="p-2">
                    <PoForm
                      jobId={jobId}
                      po={po}
                      approver={approver}
                      onClose={() => setEditing(null)}
                    />
                  </li>
                ) : (
                  <PoRow
                    key={po.id}
                    jobId={jobId}
                    po={po}
                    approver={approver}
                    onEdit={() => setEditing(po.id)}
                  />
                ),
              )}
            </ul>
          )}
          {editing === "new" ? (
            <PoForm jobId={jobId} approver={approver} onClose={() => setEditing(null)} />
          ) : (
            q.data.canAdd && (
              <Button
                type="button"
                variant="outline"
                className="h-11 w-full sm:h-9 sm:w-auto"
                onClick={() => setEditing("new")}
              >
                <Plus className="mr-1 h-4 w-4" /> Add PO
              </Button>
            )
          )}
        </div>
      )}
    </Box>
  );
}

function ApprovedBadge({ approved }: { approved: boolean }) {
  return approved ? (
    <Badge className="border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
      Approved
    </Badge>
  ) : (
    <Badge variant="outline" className="text-amber-700 dark:text-amber-300">
      Awaiting approval
    </Badge>
  );
}

/** The receipt as a link (a one-hour signed URL), opened in a new tab. */
function ReceiptLink({ path, name }: { path: string; name: string | null }) {
  const url = useSignedUrl(path);
  if (url.error)
    return (
      <span className="text-xs text-destructive">Receipt could not load: {errText(url.error)}</span>
    );
  if (!url.data)
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" /> Receipt
      </span>
    );
  return (
    <a
      href={url.data}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 text-xs text-primary underline-offset-2 hover:underline"
      title={name ?? "Open the receipt"}
    >
      <Paperclip className="h-3.5 w-3.5" /> Receipt
    </a>
  );
}

function usePoMutations(jobId: string) {
  const qc = useQueryClient();
  const refresh = () => void qc.invalidateQueries({ queryKey: fieldKeys.pos(jobId) });
  return { qc, refresh };
}

function PoRow({
  jobId,
  po,
  approver,
  onEdit,
}: {
  jobId: string;
  po: PurchaseOrderView;
  approver: boolean;
  onEdit: () => void;
}) {
  const { refresh } = usePoMutations(jobId);
  const approveFn = useServerFn(setPurchaseOrderApproved);
  const deleteFn = useServerFn(deletePurchaseOrder);
  const approve = useMutation({
    mutationFn: (approved: boolean) => approveFn({ data: { id: po.id, approved } }),
    onSuccess: (r) => {
      refresh();
      toast.success(r.approved ? `PO ${r.po_number} approved` : `PO ${r.po_number} not approved`);
    },
    onError: (e) => loudError("Could not change the approval", e),
  });
  const remove = useMutation({
    mutationFn: () => deleteFn({ data: { id: po.id } }),
    onSuccess: () => {
      refresh();
      toast.success(`PO ${po.po_number} deleted`);
    },
    onError: (e) => {
      refresh();
      loudError("Could not delete the PO", e);
    },
  });
  return (
    <li className="space-y-1.5 p-3 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="min-w-0">
          <span className="text-muted-foreground">{shortDay(po.po_date)}</span>
          {" · "}
          <span className="font-medium">PO {po.po_number}</span>
          {po.title ? <span> · {po.title}</span> : null}
        </span>
        <span className="font-medium tabular-nums">{poMoney(Number(po.price))}</span>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {approver ? (
          <label className="flex items-center gap-2 text-xs">
            <Switch
              checked={po.approved}
              disabled={approve.isPending}
              aria-label={`Approve PO ${po.po_number}`}
              onCheckedChange={(v) => approve.mutate(v)}
            />
            Approved
          </label>
        ) : (
          <ApprovedBadge approved={po.approved} />
        )}
        {po.receipt_path && <ReceiptLink path={po.receipt_path} name={po.receipt_name} />}
        {po.can_edit && (
          <span className="ml-auto flex gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-10 sm:h-8"
              aria-label={`Edit PO ${po.po_number}`}
              onClick={onEdit}
            >
              <Pencil className="mr-1 h-3.5 w-3.5" /> Edit
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-10 text-destructive hover:text-destructive sm:h-8"
              aria-label={`Delete PO ${po.po_number}`}
              disabled={remove.isPending}
              onClick={() => {
                if (
                  window.confirm(
                    `Delete PO ${po.po_number}?${po.receipt_path ? " Its receipt is deleted too." : ""}`,
                  )
                )
                  remove.mutate();
              }}
            >
              {remove.isPending ? (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Trash2 className="mr-1 h-3.5 w-3.5" />
              )}
              Delete
            </Button>
          </span>
        )}
      </div>
      {po.notes && <p className="whitespace-pre-line text-xs text-muted-foreground">{po.notes}</p>}
      {(po.created_by_name || po.approved_by_name) && (
        <p className="text-[11px] text-muted-foreground">
          {po.created_by_name ? `Added by ${po.created_by_name}` : ""}
          {po.created_by_name && po.approved_by_name ? " · " : ""}
          {po.approved_by_name ? `approved by ${po.approved_by_name}` : ""}
        </p>
      )}
    </li>
  );
}

const draftOf = (po?: PurchaseOrderView): PoDraft => ({
  po_date: po?.po_date ?? localYmd(),
  po_number: po?.po_number ?? "",
  title: po?.title ?? "",
  // The Price box starts blank on a new PO (owner rule: never a placeholder 0).
  price: po ? String(Number(po.price)) : "",
  notes: po?.notes ?? "",
});

/**
 * Add or edit a PO, in CenterPoint's order: Date *, PO # *, Title, Price *, Notes, Upload
 * Receipt, Approved? (managers only), Submit / Back.
 */
function PoForm({
  jobId,
  po,
  approver,
  onClose,
}: {
  jobId: string;
  po?: PurchaseOrderView;
  approver: boolean;
  onClose: () => void;
}) {
  const { refresh } = usePoMutations(jobId);
  const saveFn = useServerFn(savePurchaseOrder);
  const approveFn = useServerFn(setPurchaseOrderApproved);
  const [draft, setDraft] = useState<PoDraft>(() => draftOf(po));
  const [approved, setApproved] = useState(po?.approved ?? false);
  const [file, setFile] = useState<File | null>(null);
  // Editing: the stored receipt stays unless removed or replaced.
  const [dropReceipt, setDropReceipt] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const set = <K extends keyof PoDraft>(k: K, v: PoDraft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const idp = po ? `po-${po.id}` : "po-new";

  const save = useMutation({
    mutationFn: async () => {
      const price = parsePrice(draft.price);
      let uploaded: string | null = null;
      let receipt: {
        receipt_path?: string | null;
        receipt_name?: string | null;
        receipt_size?: number | null;
      } = {};
      if (file) {
        uploaded = receiptObjectName(jobId, file.name);
        await uploadToServiceBucket(uploaded, file, receiptContentType(file));
        receipt = { receipt_path: uploaded, receipt_name: file.name, receipt_size: file.size };
      } else if (dropReceipt) {
        receipt = { receipt_path: null };
      }
      let row: PurchaseOrderView;
      try {
        row = await saveFn({
          data: {
            ...(po ? { id: po.id } : {}),
            jobId,
            po_date: draft.po_date,
            po_number: draft.po_number.trim(),
            title: draft.title.trim() || null,
            price: price ?? 0,
            notes: draft.notes.trim() || null,
            ...receipt,
          },
        });
      } catch (e) {
        if (uploaded) await removeFromServiceBucket(uploaded);
        throw e;
      }
      if (approver && row.approved !== approved)
        row = await approveFn({ data: { id: row.id, approved } });
      return row;
    },
    onSuccess: (row) => {
      refresh();
      toast.success(po ? `PO ${row.po_number} saved` : `PO ${row.po_number} added`);
      onClose();
    },
    onError: (e) => {
      refresh();
      loudError(po ? "Could not save the PO" : "Could not add the PO", e);
    },
  });

  const submit = () => {
    const problem = poFormProblem(draft);
    if (problem) {
      loudError("The PO is not saved", new Error(problem));
      return;
    }
    save.mutate();
  };
  const busy = save.isPending;
  const currentReceipt = !file && !dropReceipt ? po?.receipt_path : null;

  return (
    <form
      className="space-y-3 rounded-md border border-primary/40 bg-muted/30 p-3"
      aria-label={po ? `Edit PO ${po.po_number}` : "New purchase order"}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor={`${idp}-date`}>Date *</Label>
          <Input
            id={`${idp}-date`}
            type="date"
            required
            className="h-11 text-base sm:h-9 sm:text-sm"
            value={draft.po_date}
            disabled={busy}
            onChange={(e) => set("po_date", e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${idp}-number`}>PO # *</Label>
          <Input
            id={`${idp}-number`}
            required
            maxLength={PO_NUMBER_MAX}
            autoComplete="off"
            className="h-11 text-base sm:h-9 sm:text-sm"
            value={draft.po_number}
            disabled={busy}
            onChange={(e) => set("po_number", e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${idp}-title`}>Title</Label>
          <Input
            id={`${idp}-title`}
            maxLength={200}
            className="h-11 text-base sm:h-9 sm:text-sm"
            value={draft.title}
            disabled={busy}
            onChange={(e) => set("title", e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${idp}-price`}>Price *</Label>
          <Input
            id={`${idp}-price`}
            type="text"
            inputMode="decimal"
            required
            autoComplete="off"
            className="h-11 text-right text-base tabular-nums sm:h-9 sm:text-sm"
            value={draft.price}
            disabled={busy}
            onChange={(e) => set("price", e.target.value)}
          />
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${idp}-notes`}>Notes</Label>
        <AutoTextarea
          id={`${idp}-notes`}
          rows={2}
          className="text-base sm:text-sm"
          value={draft.notes}
          disabled={busy}
          onChange={(e) => set("notes", e.target.value)}
        />
      </div>
      <div className="space-y-1">
        <span className="text-sm font-medium">Receipt</span>
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/*,application/pdf"
            className="hidden"
            aria-label="Upload Receipt"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              e.target.value = "";
              if (!f) return;
              const problem = receiptFileProblem(f);
              if (problem) {
                loudError("That file cannot be the receipt", new Error(problem));
                return;
              }
              setFile(f);
              setDropReceipt(false);
            }}
          />
          <Button
            type="button"
            variant="outline"
            className="h-11 sm:h-9"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            <Upload className="mr-1 h-4 w-4" />
            {file || currentReceipt ? "Replace Receipt" : "Upload Receipt"}
          </Button>
          {file && (
            <span className="inline-flex min-w-0 items-center gap-1 text-xs">
              <span className="truncate">{file.name}</span>
              <button
                type="button"
                className="rounded p-1 text-muted-foreground hover:text-foreground"
                aria-label="Do not upload this file"
                onClick={() => setFile(null)}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </span>
          )}
          {currentReceipt && (
            <span className="inline-flex items-center gap-1">
              <ReceiptLink path={currentReceipt} name={po?.receipt_name ?? null} />
              <button
                type="button"
                className="rounded p-1 text-muted-foreground hover:text-destructive"
                aria-label="Remove the receipt"
                onClick={() => setDropReceipt(true)}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </span>
          )}
          {dropReceipt && !file && (
            <span className="text-xs text-muted-foreground">
              The receipt is removed when you submit.
            </span>
          )}
        </div>
      </div>
      {approver && (
        <label className="flex min-h-11 items-center justify-between gap-3 rounded-md border bg-background px-3 py-2 text-sm">
          <span className="font-medium">Approved?</span>
          <Switch checked={approved} disabled={busy} onCheckedChange={setApproved} />
        </label>
      )}
      <div className="flex gap-2">
        <Button type="submit" className="h-11 flex-1 sm:h-9 sm:flex-none" disabled={busy}>
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Submit
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="h-11 sm:h-9"
          disabled={busy}
          onClick={onClose}
        >
          Back
        </Button>
      </div>
    </form>
  );
}
