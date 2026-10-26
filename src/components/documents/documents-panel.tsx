/**
 * A record's documents (owner, Oct 26: a CenterPoint-style generator whose output stays
 * editable). DocumentsPanel is the right-side Sheet a bid or ticket opens ("Documents — 4344"):
 * "New document" on top, then one row per document — title, "v3 · Oct 26, 10:19 AM by Brian",
 * chips (PDF ready / Sent / Shared), Open, and a ⋮ menu with Open PDF, Share link (Copy link /
 * Turn off link once shared), Email… and Delete. DocumentsList is the same list inline for a
 * fold or tab; with an accountId it lists every document of the customer with a "For" column.
 */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useNavigate } from "@tanstack/react-router";
import {
  FileText,
  Link2,
  Link2Off,
  Loader2,
  Mail,
  MoreHorizontal,
  PenLine,
  Plus,
  Trash2,
} from "lucide-react";

import { versionLine } from "@/lib/documents/editor-helpers";
import type { DocKind } from "@/lib/documents/model";
import { listDocuments } from "@/lib/documents.functions";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

import { useDocumentActions } from "./document-actions";
import { type DocumentListRow, documentsKey, errText } from "./document-types";
import { NewDocumentDialog } from "./new-document-dialog";

export function DocumentsPanel(props: {
  kind: DocKind;
  bidId?: string | undefined;
  serviceJobId?: string | undefined;
  recordLabel: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [newOpen, setNewOpen] = useState(false);
  return (
    <>
      <Sheet open={props.open} onOpenChange={props.onOpenChange}>
        <SheetContent side="right" className="flex w-full flex-col gap-4 sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>Documents — {props.recordLabel}</SheetTitle>
            <SheetDescription>
              Proposals and letters made from this {props.kind === "bid" ? "bid" : "ticket"}.
            </SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <DocumentsList
              bidId={props.bidId}
              serviceJobId={props.serviceJobId}
              onNew={() => setNewOpen(true)}
            />
          </div>
        </SheetContent>
      </Sheet>
      <NewDocumentDialog
        kind={props.kind}
        bidId={props.bidId}
        serviceJobId={props.serviceJobId}
        recordLabel={props.recordLabel}
        open={newOpen}
        onOpenChange={setNewOpen}
        onCreated={() => props.onOpenChange(false)}
      />
    </>
  );
}

export function DocumentsList(props: {
  bidId?: string | undefined;
  serviceJobId?: string | undefined;
  /** Every document of the customer, with a "For" column. */
  accountId?: string | undefined;
  compact?: boolean | undefined;
  /** Shown as the "New document" button when given. */
  onNew?: (() => void) | undefined;
}) {
  const listFn = useServerFn(listDocuments);
  const scope = {
    bidId: props.bidId,
    serviceJobId: props.serviceJobId,
    accountId: props.accountId,
  };
  const q = useQuery({
    queryKey: documentsKey(scope),
    queryFn: () =>
      listFn({
        data: {
          ...(props.bidId ? { bidId: props.bidId } : {}),
          ...(props.serviceJobId ? { serviceJobId: props.serviceJobId } : {}),
          ...(props.accountId ? { accountId: props.accountId } : {}),
        },
      }),
  });
  const rows = q.data ?? [];
  return (
    <div className={cn("space-y-2", props.compact && "space-y-1")}>
      {props.onNew ? (
        <Button
          type="button"
          size={props.compact ? "sm" : "default"}
          title="Make a document from a template"
          onClick={props.onNew}
        >
          <Plus className="h-4 w-4" />
          New document
        </Button>
      ) : null}
      {q.isLoading ? (
        <div className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading documents…
        </div>
      ) : q.isError ? (
        <div className="py-3 text-sm text-destructive">
          Could not load the documents: {errText(q.error)}
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
          No documents yet.
        </div>
      ) : (
        <ul className="divide-y rounded-md border">
          {rows.map((d) => (
            <DocumentRowView
              key={d.id}
              row={d}
              showFor={!!props.accountId}
              compact={props.compact ?? false}
              scopeKey={documentsKey(scope)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function DocumentRowView(props: {
  row: DocumentListRow;
  showFor: boolean;
  compact: boolean;
  scopeKey: readonly unknown[];
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const d = props.row;
  const refetch = () => void qc.invalidateQueries({ queryKey: props.scopeKey });
  const actions = useDocumentActions(
    { id: d.id, title: d.title, shared: d.shared },
    { onChanged: refetch, onDeleted: refetch },
  );
  const open = () => void navigate({ to: "/documents", search: { id: d.id } });
  const pdfCurrent = d.rendered_version !== null && d.rendered_version === d.version;
  return (
    <li className={cn("flex items-center gap-3 px-3", props.compact ? "py-1.5" : "py-2")}>
      <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <button
          type="button"
          className="block max-w-full truncate text-left text-sm font-medium hover:underline"
          title="Open in the editor"
          onClick={open}
        >
          {d.title}
        </button>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          <span>{versionLine(d)}</span>
          {props.showFor ? <span>· For {d.recordLabel}</span> : null}
          {d.rendered_at ? (
            <Badge
              variant="outline"
              className="h-4 px-1 text-[10px]"
              title={
                pdfCurrent
                  ? "The PDF matches the latest save"
                  : `The PDF is from v${d.rendered_version}; export again after editing`
              }
            >
              {pdfCurrent ? "PDF ready" : `PDF v${d.rendered_version}`}
            </Badge>
          ) : null}
          {d.sent_at ? (
            <Badge variant="outline" className="h-4 px-1 text-[10px]" title="Emailed">
              Sent
            </Badge>
          ) : null}
          {d.shared ? (
            <Badge variant="outline" className="h-4 px-1 text-[10px]" title="Has a live share link">
              Shared
            </Badge>
          ) : null}
        </div>
      </div>
      <Button type="button" size="sm" variant="outline" title="Open in the editor" onClick={open}>
        <PenLine className="h-4 w-4" />
        Open
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-8 w-8"
            title="More"
            disabled={actions.busy}
          >
            {actions.busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <MoreHorizontal className="h-4 w-4" />
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={actions.openPdf}>
            <FileText className="h-4 w-4" /> Open PDF
          </DropdownMenuItem>
          {d.shared ? (
            <>
              <DropdownMenuItem onClick={actions.shareLink}>
                <Link2 className="h-4 w-4" /> Copy link
              </DropdownMenuItem>
              <DropdownMenuItem onClick={actions.revokeLink}>
                <Link2Off className="h-4 w-4" /> Turn off link
              </DropdownMenuItem>
            </>
          ) : (
            <DropdownMenuItem onClick={actions.shareLink}>
              <Link2 className="h-4 w-4" /> Share link
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={actions.openEmail}>
            <Mail className="h-4 w-4" /> Email…
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="text-destructive" onClick={actions.confirmDelete}>
            <Trash2 className="h-4 w-4" /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {actions.dialogs}
    </li>
  );
}
