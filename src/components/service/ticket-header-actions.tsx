/**
 * The ticket header's icon buttons (owner, Oct 27: "on service can we make the trashcan just a
 * trash icon and then make the documents the document icon to the left of it instead of it being
 * a whole new row menu"): Documents (FileText, a small count when the ticket has any) to the LEFT
 * of Delete (Trash2). Documents opens `TicketDocumentsDialog` — what the aside's Documents fold
 * held until Oct 27: the Inspection report button on an inspection ticket, the ticket's documents
 * (documents-panel DocumentsList), New document (the list's own button; NewDocumentDialog).
 * Shown where the fold was: the office's page (officeOrAdmin); a technician's one-column page
 * never had it. Delete stays the manager's (managesTickets) with the page's own confirm dialog.
 *
 * `TicketHeaderActions` is presentational — the page owns the open state, the delete confirm
 * and the documents count (use-documents.ts) — so a render test pins it without the page.
 */
import { useState } from "react";
import { FileText, Trash2 } from "lucide-react";

import type { ServiceJobWithTech } from "@/lib/service.functions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DocumentsList } from "@/components/documents/documents-panel";
import { InspectionReportButton } from "@/components/documents/inspection-report-button";
import { NewDocumentDialog } from "@/components/documents/new-document-dialog";

export function TicketHeaderActions({
  documents,
  onDelete,
}: {
  /** The Documents button; null where the fold was never shown (a technician's page). */
  documents: { count: number | null; onOpen: () => void } | null;
  /** Delete — the manager's; null for everyone else. */
  onDelete: (() => void) | null;
}) {
  if (!documents && !onDelete) return null;
  const count = documents?.count ?? 0;
  return (
    <>
      {documents && (
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="relative"
          aria-label="Documents"
          aria-haspopup="dialog"
          title={`Documents${count ? ` (${count})` : ""} — reports and letters made from this ticket`}
          onClick={documents.onOpen}
        >
          <FileText className="h-4 w-4" />
          {count > 0 && (
            <span
              className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-medium leading-none tabular-nums text-primary-foreground dark:bg-primary dark:text-primary-foreground"
              data-documents-count={count}
              aria-hidden
            >
              {count > 99 ? "99+" : count}
            </span>
          )}
        </Button>
      )}
      {onDelete && (
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="text-destructive hover:text-destructive dark:text-destructive"
          aria-label="Delete ticket"
          title="Delete this ticket"
          onClick={onDelete}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      )}
    </>
  );
}

/**
 * "Documents · Ticket #N": the Inspection report button (an inspection ticket), the documents,
 * New document. The NewDocumentDialog sits beside this dialog, not inside it (two dialogs do not
 * nest); creating one closes this dialog as the editor opens.
 */
export function TicketDocumentsDialog({
  job,
  open,
  onOpenChange,
}: {
  job: ServiceJobWithTech;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [newOpen, setNewOpen] = useState(false);
  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Documents · Ticket #{job.number}</DialogTitle>
            <DialogDescription>
              Reports and letters made from this ticket. Nothing is made on its own — every document
              is a click.
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
            {job.service_type === "inspection" && (
              <InspectionReportButton
                serviceJobId={job.id}
                ticketNumber={job.number}
                size="default"
              />
            )}
            <DocumentsList serviceJobId={job.id} onNew={() => setNewOpen(true)} />
          </div>
        </DialogContent>
      </Dialog>
      <NewDocumentDialog
        kind="ticket"
        serviceJobId={job.id}
        recordLabel={`Ticket ${job.number}`}
        open={newOpen}
        onOpenChange={setNewOpen}
        onCreated={() => onOpenChange(false)}
      />
    </>
  );
}
