/**
 * The actions a document has wherever it is listed (the Documents panel, the editor header):
 * open or export its PDF (base64 → Blob → a new tab), make / copy / turn off its share link,
 * email it (the dialog: To, Subject, Message), and delete it (confirm). One hook returns the
 * functions and the dialogs so a menu can call them while the dialogs live outside the menu.
 */
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, Send } from "lucide-react";

import { emailDefaults } from "@/lib/documents/editor-helpers";
import {
  createDocumentShareLink,
  deleteDocument,
  emailDocument,
  getDocumentPdf,
  renderDocumentPdf,
  revokeDocumentShareLink,
} from "@/lib/documents.functions";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

import { isEmail, openPdfBase64, splitEmails } from "./document-files";
import { errText } from "./document-types";

export interface DocumentActionTarget {
  id: string;
  title: string;
  /** Has a live share link. */
  shared: boolean;
  contacts?: ReadonlyArray<{ name: string; email: string }> | undefined;
}

export function useDocumentActions(
  target: DocumentActionTarget,
  hooks: {
    /** The share link or sent stamp changed: refetch the list / document. */
    onChanged?: (() => void) | undefined;
    onDeleted?: (() => void) | undefined;
    /** Runs before the PDF is rendered (the editor saves first). Return false to stop. */
    beforeExport?: (() => Promise<boolean>) | undefined;
  } = {},
) {
  const getPdfFn = useServerFn(getDocumentPdf);
  const renderFn = useServerFn(renderDocumentPdf);
  const shareFn = useServerFn(createDocumentShareLink);
  const revokeFn = useServerFn(revokeDocumentShareLink);
  const emailFn = useServerFn(emailDocument);
  const deleteFn = useServerFn(deleteDocument);
  const [emailOpen, setEmailOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const openPdf = useMutation({
    mutationFn: async () => {
      try {
        return await getPdfFn({ data: { id: target.id } });
      } catch {
        // Not rendered yet: render it now.
        return renderFn({ data: { id: target.id } });
      }
    },
    onSuccess: (r) => {
      openPdfBase64(r.base64, r.fileName);
      hooks.onChanged?.();
    },
    onError: (e) => toast.error(`Could not open the PDF: ${errText(e)}`),
  });
  const exportPdf = useMutation({
    mutationFn: async () => {
      if (hooks.beforeExport && !(await hooks.beforeExport())) return null;
      return renderFn({ data: { id: target.id } });
    },
    onSuccess: (r) => {
      if (!r) return;
      openPdfBase64(r.base64, r.fileName);
      toast.success(`PDF ready (v${r.version})`);
      hooks.onChanged?.();
    },
    onError: (e) => toast.error(`Could not make the PDF: ${errText(e)}`),
  });
  const share = useMutation({
    mutationFn: () => shareFn({ data: { id: target.id } }),
    onSuccess: async (r) => {
      try {
        await navigator.clipboard.writeText(r.url);
        toast.success("Link copied", { description: r.url });
      } catch {
        toast.success("Share link ready", { description: r.url, duration: 15_000 });
      }
      hooks.onChanged?.();
    },
    onError: (e) => toast.error(`Could not make the share link: ${errText(e)}`),
  });
  const revoke = useMutation({
    mutationFn: () => revokeFn({ data: { id: target.id } }),
    onSuccess: () => {
      toast.success("Share link turned off");
      hooks.onChanged?.();
    },
    onError: (e) => toast.error(`Could not turn the link off: ${errText(e)}`),
  });
  const remove = useMutation({
    mutationFn: () => deleteFn({ data: { id: target.id } }),
    onSuccess: () => {
      toast.success("Document deleted");
      setDeleteOpen(false);
      hooks.onDeleted?.();
      hooks.onChanged?.();
    },
    onError: (e) => toast.error(`Could not delete the document: ${errText(e)}`),
  });
  const email = useMutation({
    mutationFn: (input: { to: string[]; subject: string; text: string }) =>
      emailFn({ data: { id: target.id, ...input } }),
    onSuccess: (_r, input) => {
      toast.success(`Emailed to ${input.to.join(", ")}`);
      setEmailOpen(false);
      hooks.onChanged?.();
    },
    onError: (e) => toast.error(`Could not email the document: ${errText(e)}`),
  });

  const busy =
    openPdf.isPending ||
    exportPdf.isPending ||
    share.isPending ||
    revoke.isPending ||
    remove.isPending;

  const dialogs = (
    <>
      <EmailDialog
        open={emailOpen}
        onOpenChange={setEmailOpen}
        title={target.title}
        contacts={target.contacts ?? []}
        sending={email.isPending}
        onSend={(input) => email.mutate(input)}
      />
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this document?</AlertDialogTitle>
            <AlertDialogDescription>
              "{target.title}" goes to the bin. A share link it had stops working.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={remove.isPending}
              onClick={(e) => {
                e.preventDefault();
                remove.mutate();
              }}
            >
              {remove.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );

  return {
    busy,
    openPdf: () => openPdf.mutate(),
    openingPdf: openPdf.isPending,
    exportPdf: () => exportPdf.mutate(),
    exportingPdf: exportPdf.isPending,
    /** Make the link (or fetch it again) and copy it. */
    shareLink: () => share.mutate(),
    revokeLink: () => revoke.mutate(),
    openEmail: () => setEmailOpen(true),
    confirmDelete: () => setDeleteOpen(true),
    dialogs,
  };
}

export function EmailDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  contacts: ReadonlyArray<{ name: string; email: string }>;
  sending: boolean;
  onSend: (input: { to: string[]; subject: string; text: string }) => void;
}) {
  const [form, setForm] = useState<{ to: string; subject: string; text: string } | null>(null);
  const defaults = emailDefaults(props.title, props.contacts);
  const f = form ?? defaults;
  const to = splitEmails(f.to);
  const bad = to.filter((e) => !isEmail(e));
  const canSend =
    to.length > 0 && bad.length === 0 && f.subject.trim().length > 0 && !props.sending;
  const send = () => {
    if (!canSend) return;
    props.onSend({ to, subject: f.subject.trim(), text: f.text });
  };
  return (
    <Dialog
      open={props.open}
      onOpenChange={(o) => {
        if (!o) setForm(null);
        props.onOpenChange(o);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Email the document</DialogTitle>
          <DialogDescription>
            The latest PDF goes as an attachment from the office mailbox.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="doc-email-to">To</Label>
            <Input
              id="doc-email-to"
              autoFocus
              placeholder="name@example.com, another@example.com"
              title="Email addresses, separated by commas"
              value={f.to}
              onChange={(e) => setForm({ ...f, to: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  send();
                }
              }}
            />
            {bad.length ? (
              <p className="text-xs text-destructive">Not an email address: {bad.join(", ")}</p>
            ) : null}
          </div>
          <div className="space-y-1">
            <Label htmlFor="doc-email-subject">Subject</Label>
            <Input
              id="doc-email-subject"
              value={f.subject}
              onChange={(e) => setForm({ ...f, subject: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="doc-email-text">Message</Label>
            <Textarea
              id="doc-email-text"
              rows={5}
              value={f.text}
              onChange={(e) => setForm({ ...f, text: e.target.value })}
            />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => props.onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" disabled={!canSend} title="Send the email" onClick={send}>
            {props.sending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            Send
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
